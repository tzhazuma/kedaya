/**
 * 微信公众号文章解析。
 *
 * ## 为什么走「单篇 URL」而不是「批量爬取」
 *
 * 微信**没有**公开的「公众号历史文章」API。想批量拿，只能：
 * - 用登录态 Cookie 打内部接口（`mp.weixin.qq.com/mp/profile_ext`）——
 *   违反微信服务条款，且 Cookie 频繁失效；
 * - 依赖搜狗微信搜索 —— 该入口已大幅收紧，不可靠。
 *
 * 但**单篇文章**是公开网页：给定 `https://mp.weixin.qq.com/s/<id>`
 * 直接 GET 就能拿到完整 HTML（实测 2026-10-20：3.5 MB，含 `js_content` 正文容器，
 * 无「环境异常」拦截）。
 *
 * 所以本模块的定位是：**用户/管理员给一个链接，我们解析这一篇**。
 * 不是爬虫，是「把用户已经能看到的内容读出来」。
 *
 * ## 为什么这件事对可达鸭有价值
 *
 * 学校的活动通知主要发在公众号上。一条活动通知里同时含：
 * 时间、地点、报名方式、讲座主题 —— 正是课表/日程要的数据。
 * 但**它没有结构化字段**，只能从正文文本里抽。
 *
 * ## ⚠️ 三条边界
 *
 * 1. **不解析登录墙后的内容**。付费/仅关注可见的文章会拿不到 `js_content`，
 *    此时明确返回 `login-required`，不返回半篇正文。
 * 2. **不带 Cookie、不带 user-agent 伪装成别的平台**。用普通浏览器 UA 取公开页。
 * 3. **图片只取 URL，不下载**。图片有防盗链，下载到本地既不合规也无必要 ——
 *    渲染时由前端按原 URL 引用（或走我们的图片代理，见 `03-api-contract`）。
 */

import {
  deadlineParseFailure,
  type DeadlineParseFailure,
  type DeadlineParseResult,
} from './deadline-parse-html';
import { decodeHtmlEntities, htmlToLines, looksLikeHtml } from './deadline-html';

/** 微信文章的规范化结果 */
export interface WechatArticle {
  /** 文章标题（`var msg_title`） */
  readonly title: string;
  /** 公众号名称（`var nickname`；有时页面不给，为空串） */
  readonly accountName: string;
  /**
   * 发布时间。
   *
   * ⚠️ 微信只在页面里给 **unix 秒**（`var ct = "1694078981"`），
   * 不含时区。本字段是 `Asia/Shanghai` 下的时刻。
   * 读不到就是 `null` —— **不拿抓取时间冒充发布时间**。
   */
  readonly publishedAt: string | null;
  /** 正文纯文本行（已解码实体、已去标签） */
  readonly bodyLines: readonly string[];
  /** 正文里的图片 URL（绝对地址，已去重、保序） */
  readonly images: readonly string[];
  /** 文章原始链接 */
  readonly sourceUrl: string;
}

/** 微信文章页面的特征（用于在解析前快速判断「这到底是不是文章页」） */
const ARTICLE_SIGNALS = [
  'js_content',
  'rich_media_title',
  'mp.weixin.qq.com',
];

/** 「内容不可见」的特征 —— 登录墙、删文、违规下架 */
const BLOCKED_SIGNALS: readonly { readonly needle: string; readonly reason: string }[] = [
  { needle: '环境异常', reason: '微信要求验证环境（可能是频繁访问），请稍后再试' },
  { needle: '该内容已被发布者删除', reason: '文章已被发布者删除' },
  { needle: '此内容因违规无法查看', reason: '文章因违规无法查看' },
  { needle: '访问过于频繁', reason: '访问过于频繁，请稍后再试' },
  { needle: '请在微信客户端打开链接', reason: '该文章要求在微信客户端内打开' },
];

/**
 * 快速判断这份 HTML 是不是微信文章页。
 *
 * 用途：调用方在网络请求**之前或之后**都能用 —— 拿到 HTML 先判一次，
 * 不是文章页就不要浪费精力解析，直接给出能照着做的提示。
 */
export function looksLikeWechatArticle(html: string): boolean {
  if (!looksLikeHtml(html)) return false;
  return ARTICLE_SIGNALS.some((signal) => html.includes(signal));
}

/** 从 `var xxx = "..."` 形式的赋值里取值 */
function readJsVar(html: string, name: string): string | null {
  // 微信的赋值有**三种**写法，实测都出现过：
  //   var msg_title = "标题".html(false);
  //   var nickname = htmlDecode("上海科技大学");     ← 公众号名是这种
  //   var ct = "1694078981";
  // 中间的 `htmlDecode(` / `.html(false)` 是可选的包装。
  const pattern = new RegExp(
    `var\\s+${name}\\s*=\\s*(?:htmlDecode\\()?["']([\\s\\S]*?)["']\\s*(?:\\))?(?:\\.html\\(|;|\\r?\\n)`,
  );
  const match = pattern.exec(html);
  if (match === null) return null;
  const raw = match[1] ?? '';
  if (raw === '') return null;
  return decodeHtmlEntities(raw).trim();
}

/** 取正文容器内部的 HTML */
function readBodyHtml(html: string): string | null {
  // 优先：id="js_content"（微信正文容器）
  const startMatch = /<div[^>]*id="js_content"[^>]*>/i.exec(html);
  if (startMatch !== null) {
    const start = startMatch.index + startMatch[0].length;
    const rest = html.slice(start);

    // 结束标记必须落在**标签的起点**，否则会把半个标签切进正文
    //（踩过：`<div class="rich_media_area_extra">` 只匹配到类名，
    //  留下一段 `   <div class="` 被当成正文行）。
    //
    // 比数 div 嵌套稳：微信正文里 div 嵌套极深且不保证闭合规范。
    const endCandidates = [
      /<script/i,
      /<div[^>]*rich_media_area_extra/i,
    ]
      .map((pattern) => pattern.exec(rest)?.index ?? Number.POSITIVE_INFINITY);
    const end = Math.min(...endCandidates, rest.length);
    const body = rest.slice(0, end);

    // ⚠️ 空判断要**先剥标签**：容器里只剩空白和 `</div>` 时是「关注后可见」，
    // 不是「解析成功但正文为空」。用 trim() 判不出来。
    //
    // ⚠️ 但**只有图、没有字**是合法内容（很多通知就是一张长图），
    // 所以「有文字」或「有图片」任一成立就算非空。踩过一次：
    // 一开始只看文字，把纯图片通知判成了「需关注后查看」。
    const textOnly = body.replace(/<[^>]*>/g, '').trim();
    const hasImage = /<img\b/i.test(body);
    return textOnly === '' && !hasImage ? null : body;
  }

  // 回落：rich_media_content 类名
  const fallback = /<div[^>]*class="[^"]*rich_media_content[^"]*"[^>]*>([\s\S]{50,}?)<\/div>/i.exec(html);
  return fallback === null ? null : (fallback[1] ?? null);
}

/** 从正文 HTML 里抽图片的绝对 URL */
function readImages(bodyHtml: string, pageUrl: string): string[] {
  const seen = new Set<string>();
  const images: string[] = [];

  // 微信图片有两种：`data-src`（懒加载真实地址）与 `src`（占位/真实）
  for (const match of bodyHtml.matchAll(/<img[^>]*>/gi)) {
    const tag = match[0];
    const dataSrc = /data-src\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const src = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const raw = dataSrc ?? src;
    if (raw === undefined || raw.trim() === '') continue;

    let absolute: string;
    try {
      absolute = new URL(raw.trim(), pageUrl).toString();
    } catch {
      continue; // 拼不出绝对地址就跳过，不猜
    }
    // 只留 http(s)；`data:` 内联图直接丢（体积大且不是真实照片）
    if (!/^https?:\/\//.test(absolute)) continue;
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    images.push(absolute);
  }

  return images;
}

/**
 * 解析一篇微信文章。
 *
 * 失败码沿用 `deadline-collect` 的那套（`login-required` / `empty-page` /
 * `unrecognized-structure`），这样 UI 层的错误文案是同一套，不用分叉。
 */
export function parseWechatArticle(
  html: string,
  sourceUrl: string,
): DeadlineParseResult<WechatArticle> {
  if (html.trim() === '') {
    return { ok: false, error: deadlineParseFailure('empty-page', '页面为空，没拿到任何内容') };
  }

  // 先是「不可见」判断 —— 这里要给出**具体原因**，
  // 笼统的「解析失败」会让用户以为是自己操作错了
  for (const signal of BLOCKED_SIGNALS) {
    if (html.includes(signal.needle)) {
      return { ok: false, error: deadlineParseFailure('login-required', signal.reason) };
    }
  }

  if (!looksLikeWechatArticle(html)) {
    return {
      ok: false,
      error: deadlineParseFailure(
        'unrecognized-structure',
        '这不像是微信公众号文章页。请确认链接以 mp.weixin.qq.com/s/ 开头，并且在浏览器里能正常打开',
      ),
    };
  }

  const title = readJsVar(html, 'msg_title');
  if (title === null || title === '') {
    return {
      ok: false,
      error: deadlineParseFailure(
        'unrecognized-structure',
        '读不到文章标题。可能是微信改版了页面结构 —— 请把这一篇的链接反馈给我们',
      ),
    };
  }

  const bodyHtml = readBodyHtml(html);
  if (bodyHtml === null) {
    // 有页面骨架但正文容器是空的：典型的「关注后才能看」
    return {
      ok: false,
      error: deadlineParseFailure(
        'login-required',
        '正文容器是空的 —— 这篇文章可能要求「关注公众号后查看」或「在微信内打开」',
      ),
    };
  }

  const bodyLines = htmlToLines(bodyHtml).filter((line) => line.trim() !== '');

  const publishedAtRaw = readJsVar(html, 'ct');
  let publishedAt: string | null = null;
  if (publishedAtRaw !== null && /^\d{9,11}$/.test(publishedAtRaw)) {
    // ⚠️ 微信给的是 unix 秒，不带时区。按 Asia/Shanghai（UTC+8）解释 ——
    // 公众号的发布时刻对国内用户就是本地时间，这是唯一合理假设。
    const seconds = Number(publishedAtRaw);
    const date = new Date((seconds + 8 * 3600) * 1000);
    // 转成不带 Z 的本地字符串，避免调用方再转一次时错位
    publishedAt = date.toISOString().replace('Z', '+08:00');
  }

  return {
    ok: true,
    value: {
      title,
      // 公众号名：先取 `var nickname`；取不到时回落 og:article:author
      // ——后者是「图信中心」这种部门名，比空串有用，但**不是同一个东西**，
      // 所以只有在 nickname 完全缺失时才用它。
      accountName:
        readJsVar(html, 'nickname')
        ?? /<meta\s+property="og:article:author"\s+content="([^"]*)"/i.exec(html)?.[1]?.trim()
        ?? '',
      publishedAt,
      bodyLines,
      images: readImages(bodyHtml, sourceUrl),
      sourceUrl,
    },
  };
}

/**
 * 从文章正文里粗筛「像活动通知的段落」。
 *
 * ## 为什么是粗筛而不是结构化抽取
 *
 * 活动通知的写法千差万别（"10月25日 14:00"、"本周五下午两点"、
 * "10.25（周六）14:00-16:00"）。硬抽会把"2023级"识别成日期。
 *
 * 所以这里只做**段落级粗筛**：把正文切成段，挑出**同时**含时间线索
 * 与地点/报名线索的段落，交给 `parseDueText` 逐条精解。
 * 这样调用的顺序是「先缩小范围，再用严格的解析器」——
 * 失败时错误信息指向具体段落，而不是整篇文章。
 */
export function pickEventCandidateLines(
  lines: readonly string[],
): readonly string[] {
  const timeHint = /(\d{1,2}\s*[:：]\s*\d{2})|(\d{1,2}\s*月\s*\d{1,2}\s*[日号])|(周[一二三四五六日天])/;
  const placeHint = /(地点|地址|地点[:：]|教室|楼|馆|报告厅|会议室|线上|腾讯会议|zoom)/i;
  const joinHint = /(报名|扫码|问卷|链接|参加|参与|名额)/;

  const picked: string[] = [];
  for (const line of lines) {
    const text = line.trim();
    // 太短的段落基本是标题/装饰，不参与
    if (text.length < 8) continue;
    const hasTime = timeHint.test(text);
    const hasContext = placeHint.test(text) || joinHint.test(text);
    if (hasTime && hasContext) picked.push(text);
  }
  return picked;
}

export type { DeadlineParseFailure, DeadlineParseResult };
