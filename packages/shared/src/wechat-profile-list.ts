/**
 * 公众号「历史消息」页面解析。
 *
 * ## 这个模块解决的到底是什么问题
 *
 * 微信**没有**公开的「公众号历史文章列表」API。官方开放平台只给
 * **你自己运营的号**（`freepublish/batchget` + AppSecret），读不了别的号。
 *
 * 但用户在微信里**本来就能看到**这些历史文章：打开公众号 → 「查看历史消息」，
 * 微信客户端会返回 `mp.weixin.qq.com/mp/profile_ext` 页面，页面里有一个
 * `var msgList = '{"list":[...]}';` 的 JavaScript 变量，装着这一页的全部文章。
 *
 * 所以本模块的定位是：**用户把这一页保存下来，我们只负责解析**。
 * 不抓取、不带 Cookie、不调用任何内部接口、不绕过任何验证 ——
 * 输入是用户自己已经看见的内容。
 *
 * ## 为什么不做「自动批量抓」
 *
 * 那条路必须持有一段 `wap_sid2` 会话 Cookie，而它只存在于微信 App 内部；
 * 从外部拿到它等于逆向微信客户端。这条线不碰。
 *
 * ## 会失败在哪里
 *
 * - 页面不是历史页（拿成了文章页 / 登录页）→ `unrecognized-structure`
 * - `msgList` 存在但不是合法 JSON（转义方式变了）→ `unrecognized-structure`
 * - 页面为空 → `empty-page`
 */

import {
  deadlineParseFailure,
  type DeadlineParseResult,
} from './deadline-parse-html';
import { decodeHtmlEntities } from './deadline-html';

/** 一条推送里的单篇文章。一次推送可以有多篇（`multi_app_msg_item_list`）。 */
export interface WechatProfileArticle {
  readonly title: string;
  readonly url: string;
  /** ISO 8601（UTC）。 */
  readonly publishedAt: string;
  readonly digest?: string;
  readonly coverUrl?: string;
  /** 是不是这次推送的主条（副条为 false）。 */
  readonly isHeadline: boolean;
}

export interface WechatProfileList {
  /** 公众号的 `__biz` 标识（页面上有就用，没有就不编）。 */
  readonly biz?: string;
  readonly accountName?: string;
  readonly items: readonly WechatProfileArticle[];
}

/** `msgList` 取值：`var msgList = '...';`，内容是 JSON。 */
const MSG_LIST_PATTERN = /msgList\s*=\s*'([\s\S]*?)'\s*;/;

/**
 * 反序列化 `msgList`。
 *
 * 页面对引号的处理在不同版本里有差异（`\"` / `\x22` / `&quot;`），
 * 依次尝试，全都失败才算「结构不认识」—— 不要因为一种转义方式变了就放弃。
 */
function decodeMsgList(raw: string): unknown | null {
  const candidates: string[] = [raw];
  const unescapedQuotes = raw.replace(/\\x22/g, '"').replace(/\\"/g, '"');
  if (unescapedQuotes !== raw) candidates.push(unescapedQuotes);
  const unescapedEntities = decodeHtmlEntities(unescapedQuotes);
  if (unescapedEntities !== unescapedQuotes) candidates.push(unescapedEntities);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      continue;
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = decodeHtmlEntities(value).trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** 微信给的是秒；也兼容毫秒（大于 1e11 视为毫秒）。 */
function isoFromEpoch(value: unknown): string | null {
  const raw = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const millis = raw > 1e11 ? raw : raw * 1000;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** `content_url` 里常见 `&amp;`，还原成 `&` 才是可用链接。 */
function normaliseUrl(value: string | undefined): string | null {
  if (value === undefined) return null;
  const cleaned = value.replace(/&amp;/g, '&').trim();
  if (cleaned === '') return null;
  try {
    const url = new URL(cleaned);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * 从「历史消息」页面里抽出文章列表。
 *
 * 只返回能够确定字段的条目：没有标题或没有链接的会被跳过，
 * 因为一条「无标题无链接」的记录对用户没有任何用处，反而会污染列表。
 */
export function parseWechatProfileList(
  html: string,
): DeadlineParseResult<WechatProfileList> {
  if (html.trim() === '') {
    return {
      ok: false,
      error: deadlineParseFailure('empty-page', '页面为空，没有可解析的内容'),
    };
  }

  const match = MSG_LIST_PATTERN.exec(html);
  if (match === null) {
    return {
      ok: false,
      error: deadlineParseFailure(
        'unrecognized-structure',
        '这个页面里没有历史文章列表（msgList）。请确认保存的是公众号「查看历史消息」页，'
          + '而不是某一篇文章或登录页',
      ),
    };
  }

  const decoded = decodeMsgList(match[1] ?? '');
  if (decoded === null) {
    return {
      ok: false,
      error: deadlineParseFailure(
        'unrecognized-structure',
        '历史文章列表格式无法识别（微信可能改版了转义方式）。请把这一页反馈给我们',
      ),
    };
  }

  const root = asRecord(decoded);
  const list = root === null ? null : root['list'];
  if (!Array.isArray(list)) {
    return {
      ok: false,
      error: deadlineParseFailure(
        'unrecognized-structure',
        '历史文章列表是空的或结构不对，无法解析',
      ),
    };
  }

  const items: WechatProfileArticle[] = [];
  for (const entry of list) {
    const record = asRecord(entry);
    if (record === null) continue;

    const commInfo = asRecord(record['comm_msg_info']);
    // `type` 49 是图文消息；别的类型（文本/图片/系统提示）没有文章可读。
    if (commInfo === null) continue;
    const type = Number.parseInt(String(commInfo['type'] ?? ''), 10);
    if (Number.isFinite(type) && type !== 49) continue;

    const publishedAt = isoFromEpoch(commInfo['datetime'] ?? record['datetime']);
    if (publishedAt === null) continue;

    const appInfo = asRecord(record['app_msg_ext_info']);
    if (appInfo === null) continue;

    const headline = toArticle(appInfo, publishedAt, true);
    if (headline !== null) items.push(headline);

    const extras = appInfo['multi_app_msg_item_list'];
    if (Array.isArray(extras)) {
      for (const extra of extras) {
        const extraRecord = asRecord(extra);
        if (extraRecord === null) continue;
        const article = toArticle(extraRecord, publishedAt, false);
        if (article !== null) items.push(article);
      }
    }
  }

  if (items.length === 0) {
    return {
      ok: false,
      error: deadlineParseFailure(
        'module-missing',
        '这一页没有任何可读文章（可能只有系统消息）。请翻到有文章的一页再保存',
      ),
    };
  }

  // `__biz` 在页面里出现多次（每篇文章链接里都带），所以优先读页面级声明，
  // 读不到才退回落第一个链接里的值 —— 否则会把某一篇文章的 biz 当成这个号的。
  const declaredBiz = /var\s+biz\s*=\s*["']([^"']+)["']/.exec(html)?.[1];
  const linkedBiz = /__biz\s*=\s*([A-Za-z0-9+/=]+)/.exec(html)?.[1];
  const rawBiz = declaredBiz ?? linkedBiz;
  const biz = rawBiz?.replace(/^__biz=/, '');
  const accountName =
    /var\s+nickname\s*=\s*"([^"]+)"/.exec(html)?.[1] ??
    /nickname\s*=\s*'([^']+)'/.exec(html)?.[1];

  // 新的在前：同一页内的顺序微信并不保证，按时间排一次对用户更直观。
  items.sort((left, right) =>
    right.publishedAt.localeCompare(left.publishedAt),
  );

  return {
    ok: true,
    value: {
      ...(biz === undefined ? {} : { biz }),
      ...(accountName === undefined
        ? {}
        : { accountName: decodeHtmlEntities(accountName) }),
      items,
    },
  };
}

function toArticle(
  record: Record<string, unknown>,
  publishedAt: string,
  isHeadline: boolean,
): WechatProfileArticle | null {
  const title = text(record['title']);
  const url = normaliseUrl(text(record['content_url']));
  if (title === undefined || url === null) return null;

  const digest = text(record['digest']);
  const coverUrl = normaliseUrl(text(record['cover']));

  return {
    title,
    url,
    publishedAt,
    isHeadline,
    ...(digest === undefined ? {} : { digest }),
    ...(coverUrl === null ? {} : { coverUrl }),
  };
}
