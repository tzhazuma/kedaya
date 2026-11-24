/**
 * 校园活动 · 从单篇公众号文章抽取候选（纯函数，三端共用）
 *
 * ## 定位
 *
 * 输入是 `parseWechatArticle()` 已经规范化好的 `WechatArticle`（标题、公众号名、
 * 发布时间、正文纯文本行、原文链接），输出是**候选**活动 —— 不是日程。
 * 候选必须由用户确认后才进日程/提醒，所以这里不产生 `status`，也不写库。
 *
 * ## 为什么复用 `pickEventCandidateLines`
 *
 * 活动通知的写法千差万别（`10月25日 14:00`、`10.25（周六）14:00-16:00`、
 * `本周五下午两点`）。直接硬抽会把「2023级」识别成日期。
 * `pickEventCandidateLines` 先做段落级粗筛（同时含时间线索与地点/报名线索），
 * 本模块再在候选段落周围 ±3 行内用 `parseDueText` 精解。
 *
 * ## 四条「不猜」规则
 *
 * 1. **没有可靠时间就不产出候选**。`本周五下午两点` 不转成任何具体时刻；
 *    日期非法（`2026年2月30日`）同样丢弃。
 * 2. **只有报名截止也能成立**。报名截止是绝对时刻时正常建候选；
 *    原文只有 `10月24日` 时 `registrationDeadlineAt` 为 `null`，原文原样保留 ——
 *    **绝不补 23:59**。
 * 3. **不猜时长**。只写了开始时间就没有 `endsAt`；只有明确的 `14:00-16:00`
 *    才计算结束时刻。
 * 4. **不存正文**。`evidenceText` 只取本条活动附近的细节行，截断到 200 字。
 *
 * ## 同篇去重
 *
 * 一篇文章可能在标题、导语、正文里重复同一场活动。这里用
 * 「归一化标题 + 开始时刻 + 结束时刻 + 报名截止 + 地点」做键，保留第一条
 * （若后一条置信度更高则替换）。**不做跨文章合并** —— 那需要服务端持久化 id。
 */

import { activityWallClockInZone } from './activities-time';
import { parseDueText } from './deadline-normalize';
import { sanitizeSourceUrl } from './deadline-source-url';
import { pickEventCandidateLines } from './wechat-article';

/* ------------------------------------------------------------------ *
 * 类型
 * ------------------------------------------------------------------ */

/** 证据片段上限（与 `@kedaya/contracts` 的 `ACTIVITY_EVIDENCE_MAX_CHARS` 一致） */
export const ACTIVITY_EVIDENCE_MAX_CHARS = 200;

/**
 * 标题 / 地点 / 主办 / 来源展示名的上限（与 OpenAPI `ActivityItem` 的
 * `maxLength: 160` 一致）。按**码点**截断，不劈开 emoji。
 */
export const ACTIVITY_TEXT_FIELD_MAX_CHARS = 160;

/**
 * 学校时区。与 `@kedaya/contracts` 的 `ACTIVITY_TIMEZONE` 保持一致。
 *
 * shared 是零依赖叶子包，不能 import 契约包；API / Web 会直接从
 * `@kedaya/shared` 取这个常量，避免各自写一遍 `Asia/Shanghai`。
 */
export const ACTIVITY_TIMEZONE = 'Asia/Shanghai';

/** 来源展示名。与 `@kedaya/contracts` 的 `ACTIVITY_SOURCE_LABELS` 保持一致。 */
export const ACTIVITY_SOURCE_LABELS = Object.freeze({
  'campus-mail': '校园邮箱',
  'wechat-mp': '微信公众号',
  manual: '手动添加',
} as const);

/** 结构对齐 `WechatArticle`；只取抽取需要的字段，便于测试与三端复用 */
export interface ActivityArticleLike {
  readonly title: string;
  readonly accountName: string;
  readonly publishedAt: string | null;
  readonly bodyLines: readonly string[];
  readonly sourceUrl: string;
}

/** 一条活动候选（还没有服务端 id / status） */
export interface ActivityCandidate {
  readonly title: string;
  /** 开始时刻，ISO-8601 UTC；未知为 null */
  readonly startsAt: string | null;
  /** 结束时刻，ISO-8601 UTC；未知为 null */
  readonly endsAt: string | null;
  readonly location: string | null;
  readonly organizer: string | null;
  /** 报名截止绝对时刻，ISO-8601 UTC；原文只有日期时为 null */
  readonly registrationDeadlineAt: string | null;
  /** 报名截止原文；解析不出时刻也保留 */
  readonly registrationDeadlineRaw: string | null;
  readonly registrationUrl: string | null;
  /** ≤200 字证据片段 */
  readonly evidenceText: string;
  /** 0–1；仅用于排序/提示，不能替代用户确认 */
  readonly confidence: number;
}

export interface ExtractActivityCandidatesOptions {
  /** 基准时刻（用于缺年份推断与相对时间） */
  readonly now: Date;
  /** IANA 学校时区，必传（例：`Asia/Shanghai`） */
  readonly timeZone: string;
  /** 最多产出多少条候选（默认 10） */
  readonly maxCandidates?: number;
}

/* ------------------------------------------------------------------ *
 * 时间表达式
 * ------------------------------------------------------------------ */

const ISO_DATE_TIME_RE =
  /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[T\s]+(上午|下午|晚上|中午)?\s*(\d{1,2})\s*[:：]\s*(\d{2})/g;

const CN_DATE_TIME_RE =
  /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?\s*(?:[（(][^）)]{0,24}[）)])?\s*(?:周[一二三四五六日天]\s*)?(上午|下午|晚上|中午)?\s*(\d{1,2})\s*[:：]\s*(\d{2})/g;

const DOTTED_DATE_TIME_RE =
  /(?:(\d{4})\s*[./])?(\d{1,2})\s*[./]\s*(\d{1,2})\s*(?:[（(][^）)]{0,24}[）)])?\s*(?:周[一二三四五六日天]\s*)?(上午|下午|晚上|中午)?\s*(\d{1,2})\s*[:：]\s*(\d{2})/g;

/** 只到日期（没有时刻）—— 用来保留原文，不用于 parseDueText 成功 */
const CN_DATE_ONLY_RE = /(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g;

const ENGLISH_DATE_RE =
  /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,\s*|\s+)\d{4}(?:\s+\d{1,2}\s*:\s*\d{2}\s*(?:AM|PM)?)?/gi;

interface DateClockMatch {
  readonly index: number;
  readonly end: number;
  readonly year: number | null;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  /** 归一化后的 `YYYY年M月D日 H:mm`（缺年份时省略年） */
  readonly text: string;
}

const DATE_CLOCK_PATTERNS: readonly RegExp[] = [
  ISO_DATE_TIME_RE,
  CN_DATE_TIME_RE,
  DOTTED_DATE_TIME_RE,
];

/** 把「下午 2:00」这类 12 小时制转成 24 小时制 */
function to24Hour(hour: number, period: string | undefined): number {
  if (period === '下午' || period === '晚上') return hour < 12 ? hour + 12 : hour;
  if (period === '中午') return hour < 11 ? hour + 12 : hour;
  if (period === '上午' && hour === 12) return 0;
  return hour;
}

function readClockMatch(match: RegExpExecArray): DateClockMatch | null {
  const yearText = match[1];
  const month = Number(match[2]);
  const day = Number(match[3]);
  const period = match[4];
  const hour = Number(match[5]);
  const minute = Number(match[6]);

  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  const year = yearText === undefined ? null : Number(yearText);
  const hour24 = to24Hour(hour, period);
  if (hour24 > 23) return null;

  const datePart = year === null ? '' : `${year}年`;
  return {
    index: match.index,
    end: match.index + match[0].length,
    year,
    month,
    day,
    hour: hour24,
    minute,
    text: `${datePart}${month}月${day}日 ${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

/**
 * 找文本里**最早**的「日期 + 时刻」。
 *
 * `skipDeadline` 为 true 时，跳过前面紧邻「截止/截至」或「报名…至」的时刻 ——
 * 否则 `报名截止：10月23日 12:00` 会被误当成活动开始时间。
 */
function findDateClock(text: string, skipDeadline: boolean): DateClockMatch | null {
  const matches: DateClockMatch[] = [];
  for (const pattern of DATE_CLOCK_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
        continue;
      }
      const parsed = readClockMatch(match);
      if (parsed !== null) matches.push(parsed);
    }
  }

  matches.sort((a, b) => a.index - b.index);
  for (const match of matches) {
    if (skipDeadline && isDeadlineContext(text, match.index)) continue;
    return match;
  }
  return null;
}

function isDeadlineContext(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 40), index);
  // 「截止时间：10月23日 12:00」「报名将于 … 截止」
  if (/(?:截止|截至)[^。；;\n]{0,16}$/.test(before)) return true;
  // 「报名时间：即日起至 10月23日 12:00」—— 窗口结束是截止，不是开始
  if (/(?:报名|注册|申请|投稿|征稿)[^。；;\n]{0,40}?(?:至|到)[^。；;\n]{0,8}$/.test(before)) {
    return true;
  }
  // 「报名时间：10月20日 09:00」—— 窗口**起点**也不是活动开始
  if (
    /(?:报名|注册|申请|投稿|征稿)(?:时间|日期|开始|开放|启动|通道|窗口)[^。；;\n]{0,12}$/.test(
      before,
    )
  ) {
    return true;
  }
  if (/(?:报名|注册|申请)(?:于|从|自)[^。；;\n]{0,8}$/.test(before)) return true;
  return false;
}

/** 把各种写法归一成 `parseDueText` 能认的形状；不改变语义 */
function normalizeDateExpression(raw: string): string {
  let text = raw.trim();

  // 2026.10.25 / 2026/10/25 → 2026-10-25（四位年份开头的点分/斜杠日期）
  text = text.replace(/(\d{4})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{1,2})/g, '$1-$2-$3');
  // 去掉「（周六）」这类备注
  text = text.replace(/[（(][^）)]{0,24}[）)]/g, ' ');
  // 去掉「周六」
  text = text.replace(/周[一二三四五六日天]/g, ' ');
  // 10.25 / 10/25 → 10月25日（在四位年份已被处理之后）
  text = text.replace(/(\d{1,2})\s*[./]\s*(\d{1,2})(?![\d./])/g, '$1月$2日');
  // 下午 2:00 → 14:00
  text = text.replace(
    /(上午|下午|晚上|中午)\s*(\d{1,2})\s*[:：]\s*(\d{2})/g,
    (_whole, period: string, hour: string, minute: string) =>
      `${to24Hour(Number(hour), period)}:${minute}`,
  );
  text = text.replace(/：/g, ':');
  return text.replace(/\s+/g, ' ').trim();
}

/** 文本里是否已经写明四位年份（含 `2026年` / `2026-10-25` / `Oct 20, 2026`） */
const EXPLICIT_YEAR_RE = /(?:19|20)\d{2}\s*(?:年|[-/.]\s*\d{1,2})|\b(?:19|20)\d{2}\b/;

/**
 * 活动语义下的时刻解析。
 *
 * 与课程 DDL 不同：**缺年份的日期如果今年已经过去，就留在今年**，不顺延到明年。
 * 公众号文章经常是几个月前的旧通知；把「1月5日」推成明年的 1 月 5 日会凭空
 * 造出一场未来的活动，还会触发提醒。留在过去最多是「过期候选」，用户一眼能看出来。
 */
function parseInstant(raw: string, now: Date, timeZone: string): string | null {
  const normalized = normalizeDateExpression(raw);
  const parsed = parseDueText(normalized, now, timeZone);
  if (parsed === null) return null;
  if (EXPLICIT_YEAR_RE.test(normalized)) return parsed;

  const parsedWall = activityWallClockInZone(parsed, timeZone);
  const nowWall = activityWallClockInZone(now, timeZone);
  if (parsedWall === null || nowWall === null || parsedWall.year <= nowWall.year) return parsed;

  // parseDueText 把过去日期顺延到了下一年；用显式年份把它拉回今年。
  const pad = (value: number): string => String(value).padStart(2, '0');
  const sameYear = `${nowWall.year}年${parsedWall.month}月${parsedWall.day}日 ${pad(parsedWall.hour)}:${pad(parsedWall.minute)}`;
  return parseDueText(sameYear, now, timeZone) ?? parsed;
}

/* ------------------------------------------------------------------ *
 * 报名截止
 * ------------------------------------------------------------------ */

interface DeadlineObservation {
  readonly raw: string;
  readonly at: string | null;
}

const DEADLINE_LABEL_RE =
  /(?:报名|注册|申请|投稿|征稿)[^。；;\n]{0,12}?(?:截止|截至|结束)(?:时间|日期)?\s*[：:]?\s*([^。；;\n]+)/;

const REGISTRATION_UNTIL_RE =
  /(?:报名|注册|申请)[^。；;\n]{0,40}?至\s*([^。；;\n]+)/;

const GENERIC_DEADLINE_RE = /(?:截止|截至)(?:时间|日期)?\s*[：:]\s*([^。；;\n]+)/;

/** 「报名将于 10月23日 12:00 截止」—— 日期在截止之前 */
const DEADLINE_MARKER_RE = /(?:报名|注册|申请)[^。；;\n]{0,40}?(?:截止|截至|结束)/;

/** 从一段文字里取最早的日期表达式（日期+时刻优先于纯日期） */
function extractDateExpression(segment: string): string | null {
  const patterns = [ENGLISH_DATE_RE, ISO_DATE_TIME_RE, CN_DATE_TIME_RE, DOTTED_DATE_TIME_RE, CN_DATE_ONLY_RE];
  const found: Array<{ index: number; text: string }> = [];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(segment);
    if (match === null) continue;
    found.push({ index: match.index, text: match[0].trim() });
  }

  if (found.length === 0) return null;
  // 同一位置时取更长的（日期+时刻 胜过 纯日期）
  found.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
  return found[0]?.text ?? null;
}

function fallbackDeadlineRaw(segment: string): string | null {
  const cleaned = (segment.split(/[，,]\s*(?:名额|先到|额满|逾期|请|扫码|地点|时间|报名|链接)/)[0] ?? '')
    .replace(/[。；;，,]+$/, '')
    .trim();
  if (cleaned === '') return null;
  // 至少要有时间线索，否则「另行通知」也会被当成截止原文
  if (!/(?:\d|月|日|周|今天|明天|后天|Oct|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep)/i.test(cleaned)) {
    return null;
  }
  return truncateActivityEvidence(cleaned, 100);
}

function findRegistrationDeadline(
  lines: readonly string[],
  now: Date,
  timeZone: string,
): DeadlineObservation | null {
  let best: DeadlineObservation | null = null;

  const consider = (raw: string): void => {
    const at = parseInstant(raw, now, timeZone);
    const observation: DeadlineObservation = { raw, at };

    if (best === null) {
      best = observation;
      return;
    }
    if (observation.at === null) return;

    const bestMs = best.at === null ? Number.POSITIVE_INFINITY : Date.parse(best.at);
    if (Date.parse(observation.at) < bestMs) best = observation;
  };

  for (const line of lines) {
    // 裸「截止时间：…」也算报名截止：活动语境下用户看到的就是「什么时候截止」。
    const patterns = [DEADLINE_LABEL_RE, REGISTRATION_UNTIL_RE, GENERIC_DEADLINE_RE];

    let matchedOnLine = false;

    for (const pattern of patterns) {
      const match = pattern.exec(line);
      if (match === null) continue;
      const segment = match[1] ?? '';
      const raw = extractDateExpression(segment) ?? fallbackDeadlineRaw(segment);
      if (raw === null || raw === '') continue;

      matchedOnLine = true;
      consider(raw);
    }

    // 「报名将于 … 截止」把日期放在截止之前，标签模式抓不到末尾的日期。
    if (!matchedOnLine && DEADLINE_MARKER_RE.test(line)) {
      const raw = extractDateExpression(line);
      if (raw !== null) consider(raw);
    }
  }

  return best;
}

/* ------------------------------------------------------------------ *
 * 地点 / 主办 / 报名链接
 * ------------------------------------------------------------------ */

const LOCATION_RE =
  /(?:(?:活动|举办|讲座|报告)地点|地点|地址|场地)\s*(?:[：:]|设在|位于|在)\s*([^\n。；;]+)/;
const ORGANIZER_RE = /(?:主办方|主办|承办|组织)\s*[：:]\s*([^\n。；;]+)/;
const NEXT_LABEL_RE = /(?:主办|承办|组织|时间|报名|截止|链接|联系|扫码)\s*[：:]/;

/**
 * 地点/主办后面的动作词。`地点：图书馆 302 扫码报名` 只该留「图书馆 302」；
 * `名额有限`、`先到先得` 也不是地点的一部分。
 */
const LABEL_NOISE_RE =
  /(?:^|[\s，,；;、（(【[])(?:扫码|扫描二维码|报名|参加|参与|名额|先到先得|额满|欢迎|咨询|联系|详见|点击|关注)/;

function cleanLabelValue(value: string): string {
  const index = value.search(LABEL_NOISE_RE);
  if (index === 0) return '';
  const cut = index > 0 ? value.slice(0, index) : value;
  return cut.replace(/[\s，,；;、·:：-]+$/g, '').trim();
}

function labelValue(lines: readonly string[], pattern: RegExp): string | null {
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match === null) continue;
    const value = cleanLabelValue(
      (match[1] ?? '').split(NEXT_LABEL_RE)[0]?.trim() ?? '',
    );
    if (value === '') continue;
    return truncateActivityField(value);
  }
  return null;
}

/** 文本里的 URL；遇到中文标点/括号就停，避免把「，请扫码」吃进链接 */
const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"'，,。；;、）)】]+/g;
const TRAILING_URL_PUNCTUATION_RE = /[.,;:!?]+$/;

function stripUrlPunctuation(raw: string): { core: string; trailing: string } {
  const trailing = TRAILING_URL_PUNCTUATION_RE.exec(raw)?.[0] ?? '';
  return {
    core: trailing === '' ? raw : raw.slice(0, -trailing.length),
    trailing,
  };
}

function findRegistrationUrl(
  lines: readonly string[],
  sourceUrl: string | null,
): string | null {
  const articleSource = sanitizeSourceUrl(sourceUrl);
  let previousHadHint = false;

  for (const line of lines) {
    const hasHint = /(?:报名|扫码|问卷|登记|参加|参与)/.test(line);
    for (const match of line.matchAll(URL_IN_TEXT_RE)) {
      if (!hasHint && !previousHadHint) continue;
      const { core } = stripUrlPunctuation(match[0]);
      const sanitized = sanitizeSourceUrl(core);
      if (sanitized === null) continue;
      // 文章自身的回源链接不是报名入口 —— 否则「扫码报名 + 原文链接」
      // 会被当成一个可点的报名按钮。
      if (articleSource !== null && sanitized === articleSource) continue;
      return sanitized;
    }
    previousHadHint = hasHint;
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * 标题 / 证据 / 去重
 * ------------------------------------------------------------------ */

// 「主讲人：张三」是很常见的详情行。漏了它就会被 isHeadingLine 当成标题，
// 于是 sectionBounds 在此截断，后面的「地点：…」永远进不了上下文。
// 前缀允许「讲座地点」「报告时间」这类复合标签 —— 少了它，
// 「讲座地点：…」会被 isHeadingLine 判成标题，sectionBounds 当场截断，地点丢失。
const DETAIL_LABEL_RE =
  /^(?:讲座|报告|活动|论坛|会议|举办|培训|沙龙)?\s*(?:时间|地点|地址|场地|报名|截止|主办|承办|组织|链接|扫码|联系|主讲人|主讲嘉宾|主讲|报告人|讲者|嘉宾|主持人)\s*[：:]/;
const ACTION_PREFIX_RE = /^(?:扫码|报名|参加|参与|名额|截止|请|点击|关注)/;

function isHeadingLine(text: string): boolean {
  const line = text.trim();
  if (line.length < 2 || line.length > 60) return false;
  if (/\d{1,2}\s*[:：]\s*\d{2}/.test(line)) return false;
  // 纯日期 / 纯星期只是分隔行，不是标题
  if (/^(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*[日号]$/.test(line)) return false;
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(line)) return false;
  if (/^周[一二三四五六日天]$/.test(line)) return false;
  // 「1讲座信息」「2讲座内容」这类序号+栏目名是排版标题，不是活动名：
  // 当成标题会让候选标题变成「1讲座信息」。
  if (/^\d+\s*[.、)）]?\s*(?:讲座|报告|活动|论坛|会议|议程|信息|简介|安排|内容){1,3}$/.test(line)) {
    return false;
  }
  if (DETAIL_LABEL_RE.test(line)) return false;
  if (ACTION_PREFIX_RE.test(line)) return false;
  if (/https?:\/\//.test(line)) return false;
  if (/[。；;]$/.test(line)) return false;
  return true;
}

function findHeadingTitle(
  lines: readonly string[],
  index: number,
  sectionStart: number,
): string | null {
  const floor = Math.max(sectionStart, index - 8);
  for (let j = index; j >= floor; j -= 1) {
    const text = lines[j]?.trim() ?? '';
    if (text !== '' && isHeadingLine(text)) return text;
  }
  return null;
}

const TIME_ONLY_HINT_RE =
  /(\d{1,2}\s*[:：]\s*\d{2})|(\d{1,2}\s*月\s*\d{1,2}\s*[日号])|(\d{4}\s*[-/年]\s*\d{1,2})/;
/** 活动「回顾」语气词：这类文字后面不会再有可报名/可参加的活动。 */
const RECAP_HINT_RE =
  /(成功举办|顺利举办|已举办|举办了|举行了|开展了|圆满(?:结束|落幕)|落下帷幕|吸引了[^。]{0,12}(?:参加|参与)|现场气氛|回顾)/;

const PLACE_HINT_RE = /(地点|地址|场地|教室|楼|馆|报告厅|会议室|线上|腾讯会议|zoom)/i;

/**
 * 候选锚点行。
 *
 * `pickEventCandidateLines` 要求「时间 + 地点/报名」出现在**同一行**。
 * 公众号常写成两行：
 * ```
 * 时间：2026年10月25日 14:00
 * 地点：图书馆 302
 * ```
 * 这里额外把「下一行（或上一行）是地点」的时间行也作为锚点，抽取逻辑不变。
 */
/**
 * 把「只有标签」的行与下一行合并。
 *
 * 公众号里极常见的排版是标签独占一行：
 * ```
 * 讲座时间
 * 2024年6月3日 14:00
 * 讲座地点
 * 机械与动力工程学院 振华会议室
 * ```
 * 不合并的话：`讲座时间` 会被 isHeadingLine 当成标题（于是候选标题变成
 * 「讲座时间」），`讲座地点` 也匹配不上要求冒号的 LOCATION_RE，地点直接丢失。
 */
const LABEL_ONLY_RE =
  /^(?:讲座|报告|活动|论坛|会议|举办|培训|沙龙)?\s*(?:时间|日期|地点|地址|场地|报名|截止)\s*$/;

function mergeLabelOnlyLines(lines: readonly string[]): string[] {
  const merged: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();
    // 空行必须保留：sectionBounds 靠它分段，多活动文章的分段全靠空行。
    if (line === '') {
      merged.push('');
      continue;
    }
    if (LABEL_ONLY_RE.test(line)) {
      let next = '';
      for (let j = i + 1; j < lines.length; j += 1) {
        const candidate = (lines[j] ?? '').trim();
        if (candidate !== '') { next = candidate; i = j; break; }
      }
      merged.push(next === '' ? line : `${line}：${next}`);
      continue;
    }
    merged.push(line);
  }
  return merged;
}

function pickActivityLines(lines: readonly string[]): string[] {
  const picked = new Set(pickEventCandidateLines(lines));

  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i]?.trim() ?? '';
    if (text.length < 8 || !TIME_ONLY_HINT_RE.test(text)) continue;

    // 窗口取 ±2：通知里常见「时间… / 主讲人… / 地点…」三行连排，
    // 只认相邻一行会漏掉主讲人占位的情况。
    const near: string[] = [];
    for (let d = 1; d <= 2; d += 1) {
      const before = lines[i - d]?.trim() ?? '';
      const after = lines[i + d]?.trim() ?? '';
      if (before !== '') near.push(before);
      if (after !== '') near.push(after);
    }
    if (near.some((value) => PLACE_HINT_RE.test(value))) {
      // 放宽窗口后会把「4月10日…成功举办」这类回顾也捞进来。
      // 判据用**语气词**而不是日期先后：缺年份的过去日期在本项目里
      // 明确要求「留在今年并产出候选」（见 extract 测试），不能按时间拦。
      if (!RECAP_HINT_RE.test(text) && !near.some((value) => RECAP_HINT_RE.test(value))) {
        picked.add(text);
      }
      continue;
    }

    // 「截止时间：…」本身就是一个候选锚点：没有开始时间、没有地点、
    // 只有一条报名截止的通知也必须能产出候选。
    if (/(?:截止|截至)/.test(text)) picked.add(text);
  }

  // 锚点本身是回顾语气就不算锚点。`pickEventCandidateLines` 的「参加/参与」
  // 线索会把「…举办了讲座，吸引了…参加」也选进来，那一支绕过了上面的语气检查。
  return [...picked].filter((line) => !RECAP_HINT_RE.test(line));
}

function isEvidenceLine(text: string): boolean {
  return (
    /(?:时间|地点|地址|场地|报名|截止|主办|承办|组织|链接|扫码|参加|参与)/.test(text) ||
    /https?:\/\//.test(text) ||
    isHeadingLine(text)
  );
}

/**
 * 把一段文本里的 URL 全部过一遍 `sanitizeSourceUrl`。
 *
 * 证据片段是原文摘录，但**原文里的链接也可能带 `sid` / `token` / `scene`**。
 * 只清洗 `registrationUrl` 不够：证据会原样进 DB、进 ICS、进三端响应。
 * 清洗后为 `null`（非 http(s)、带凭据等）的链接替换成 `[链接已移除]`。
 */
export function redactSessionUrlsInText(text: string): string {
  return text.replace(URL_IN_TEXT_RE, (raw) => {
    const { core, trailing } = stripUrlPunctuation(raw);
    const safe = sanitizeSourceUrl(core);
    return safe === null ? `[链接已移除]${trailing}` : `${safe}${trailing}`;
  });
}

function buildEvidence(lines: readonly string[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const line of lines) {
    const text = redactSessionUrlsInText(line.trim());
    if (text === '' || seen.has(text) || !isEvidenceLine(text)) continue;
    seen.add(text);
    parts.push(text);
  }

  return truncateActivityEvidence(parts.join('\n'));
}

/**
 * 按**码点**截断（不是 UTF-16 码元）。
 *
 * 用 `slice` 截 emoji 会把代理对劈成两个孤立码元，存进 DB / JSON 后变成乱码。
 * 恰好到上限不截断；超出时保留 `limit - 1` 个码点 + 一个省略号。
 */
function truncateByCodePoints(text: string, limit: number): string {
  const normalized = text.trim();
  const max = Math.max(1, Math.floor(limit));
  const points = [...normalized];
  if (points.length <= max) return normalized;
  return points.slice(0, max - 1).join('') + '…';
}

/** 截断证据片段到 200 个码点（不是 200 个 UTF-16 码元） */
export function truncateActivityEvidence(
  text: string,
  limit: number = ACTIVITY_EVIDENCE_MAX_CHARS,
): string {
  return truncateByCodePoints(text, limit);
}

/** 截断标题 / 地点 / 主办等单行字段到 160 个码点（OpenAPI `maxLength: 160`） */
export function truncateActivityField(
  text: string,
  limit: number = ACTIVITY_TEXT_FIELD_MAX_CHARS,
): string {
  return truncateByCodePoints(text, limit);
}

function normalizeTitleForDedupe(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u200b-\u200d\ufeff]+/g, '')
    .replace(/[\-–—_/\\|:：,，.。;；!！?？'"‘’“”()（）[\]【】·•]/g, '');
}

/**
 * 同一个活动被多个锚点各抽到一次时，**合并**而不是二选一。
 *
 * 例如时间行和截止行都会成为锚点：时间行的上下文可能看不到报名链接，
 * 截止行看得到。只按置信度保留一条会随机丢掉字段；这里逐字段取第一个非空值，
 * 证据取更长的一份。
 */
function mergeDuplicateCandidate(
  existing: ActivityCandidate,
  incoming: ActivityCandidate,
): ActivityCandidate {
  return {
    title: existing.title,
    startsAt: existing.startsAt ?? incoming.startsAt,
    endsAt: existing.endsAt ?? incoming.endsAt,
    location: existing.location ?? incoming.location,
    organizer: existing.organizer ?? incoming.organizer,
    registrationDeadlineAt: existing.registrationDeadlineAt ?? incoming.registrationDeadlineAt,
    registrationDeadlineRaw:
      existing.registrationDeadlineRaw ?? incoming.registrationDeadlineRaw,
    registrationUrl: existing.registrationUrl ?? incoming.registrationUrl,
    evidenceText:
      existing.evidenceText.length >= incoming.evidenceText.length
        ? existing.evidenceText
        : incoming.evidenceText,
    confidence: Math.max(existing.confidence, incoming.confidence),
  };
}

function dedupeKey(candidate: ActivityCandidate): string {
  return [
    normalizeTitleForDedupe(candidate.title),
    candidate.startsAt ?? '',
    candidate.endsAt ?? '',
    candidate.registrationDeadlineAt ?? candidate.registrationDeadlineRaw ?? '',
    candidate.location ?? '',
  ].join('\u0000');
}

/* ------------------------------------------------------------------ *
 * 主函数
 * ------------------------------------------------------------------ */

/**
 * 从一篇文章里抽取活动候选。
 *
 * @param article 已经规范化好的文章（`parseWechatArticle` 的 value）
 * @param options `now` / `timeZone` 必传；`timeZone` 非法时抛 `RangeError`
 * @returns 按正文顺序排列的候选；同篇重复事件只保留一条
 */
export function extractActivityCandidates(
  article: ActivityArticleLike,
  options: ExtractActivityCandidatesOptions,
): ActivityCandidate[] {
  if (!(options.now instanceof Date) || Number.isNaN(options.now.getTime())) {
    throw new RangeError('activities-extract: now 必须是有效的 Date');
  }
  if (typeof options.timeZone !== 'string' || options.timeZone.trim() === '') {
    throw new RangeError('activities-extract: timeZone 必传（例：Asia/Shanghai）');
  }

  const bodyLines = mergeLabelOnlyLines(article.bodyLines);
  const picked = new Set(pickActivityLines(bodyLines));
  const headings: number[] = [];
  for (let i = 0; i < bodyLines.length; i += 1) {
    const text = bodyLines[i]?.trim() ?? '';
    if (text !== '' && isHeadingLine(text)) headings.push(i);
  }

  const maxCandidates = Math.max(0, Math.floor(options.maxCandidates ?? 10));
  if (maxCandidates === 0) return [];

  const byKey = new Map<string, ActivityCandidate>();

  for (let i = 0; i < bodyLines.length; i += 1) {
    const line = bodyLines[i]?.trim() ?? '';
    if (line === '' || !picked.has(line)) continue;

    const section = sectionBounds(bodyLines, headings, i);
    const context = bodyLines
      .slice(Math.max(section.start, i - 3), Math.min(section.end, i + 4))
      .map((value) => value.trim())
      .filter((value) => value !== '');
    if (context.length === 0) continue;

    const deadline = findRegistrationDeadline(context, options.now, options.timeZone);
    const start = findStart(context, options.now, options.timeZone, deadline);

    if (start.startsAt === null && deadline === null) continue;

    // 地点 / 主办 / 报名链接按**整段**找，不限于时间行附近的 3 行：
    // 通知常把「报告一 / 主讲人 / 邀请人 / 报告主题」排在时间与地点之间，
    // 只搜 ±3 行会让地点稳定丢失。开始时间仍然只看附近，避免串到下一场。
    const sectionLines = bodyLines
      .slice(section.start, section.end)
      .map((value) => value.trim())
      .filter((value) => value !== '');
    const location = labelValue(sectionLines, LOCATION_RE);
    const organizer = labelValue(sectionLines, ORGANIZER_RE);
    const registrationUrl = findRegistrationUrl(sectionLines, article.sourceUrl);

    const candidate: ActivityCandidate = {
      title: truncateActivityField(
        findHeadingTitle(bodyLines, i, section.start) ?? (article.title.trim() || '未命名活动'),
      ),
      startsAt: start.startsAt,
      endsAt: start.endsAt,
      location,
      organizer,
      registrationDeadlineAt: deadline?.at ?? null,
      registrationDeadlineRaw: deadline?.raw ?? null,
      registrationUrl,
      evidenceText: buildEvidence(context),
      confidence: scoreCandidate(start.startsAt, deadline, location, organizer),
    };

    const key = dedupeKey(candidate);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, candidate);
    } else {
      byKey.set(key, mergeDuplicateCandidate(existing, candidate));
    }
    if (byKey.size >= maxCandidates) break;
  }

  // 一段也没抽到时，退一步按「段」判断一次：通知常把时间写在一句里、
  // 地点写在另一句里（「4月10日…开设讲座」「讲座在图书馆报告厅举行」），
  // 逐行锚点永远匹配不上，但整段读是清楚的。
  // 只在这一步放宽，且仍然拒绝回顾语气 —— 放宽只影响「能不能认出来」，
  // 不影响「该不该是一条活动」。
  if (byKey.size === 0) {
    for (const section of splitIntoSections(bodyLines)) {
      const text = section.join(String.fromCharCode(10));
      if (RECAP_HINT_RE.test(text)) continue;
      const deadline = findRegistrationDeadline(section, options.now, options.timeZone);
      const start = findStart(section, options.now, options.timeZone, deadline);
      if (start.startsAt === null && deadline === null) continue;
      const location = labelValue(section, LOCATION_RE);
      const organizer = labelValue(section, ORGANIZER_RE);
      const candidate: ActivityCandidate = {
        title: truncateActivityField(article.title.trim() || '未命名活动'),
        startsAt: start.startsAt,
        endsAt: start.endsAt,
        location,
        organizer,
        registrationDeadlineAt: deadline?.at ?? null,
        registrationDeadlineRaw: deadline?.raw ?? null,
        registrationUrl: findRegistrationUrl(section, article.sourceUrl),
        evidenceText: buildEvidence(section),
        confidence: scoreCandidate(start.startsAt, deadline, location, organizer),
      };
      const key = dedupeKey(candidate);
      const existing = byKey.get(key);
      if (existing === undefined) byKey.set(key, candidate);
      else byKey.set(key, mergeDuplicateCandidate(existing, candidate));
      if (byKey.size >= maxCandidates) break;
    }
  }

  return [...byKey.values()];
}

/** 按空行切段（公众号最常见的分段方式）。 */
function splitIntoSections(lines: readonly string[]): string[][] {
  const sections: string[][] = [];
  let current: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') {
      if (current.length > 0) sections.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) sections.push(current);
  return sections;
}

/**
 * 一条活动在正文里的范围。
 *
 * 两个边界都要用：
 *   · **小标题**把文章切成活动段；
 *   · **空行**是公众号最常见的分隔符。只看小标题时，两段之间没有标题的活动
 *     会把上一段的报名截止/地点吸进来（串台）。
 */
function sectionBounds(
  bodyLines: readonly string[],
  headings: readonly number[],
  index: number,
): { start: number; end: number } {
  let start = 0;
  for (let j = index - 1; j >= 0; j -= 1) {
    if ((bodyLines[j] ?? '').trim() === '') {
      start = j + 1;
      break;
    }
  }

  let end = bodyLines.length;
  for (let j = index + 1; j < bodyLines.length; j += 1) {
    if ((bodyLines[j] ?? '').trim() === '') {
      end = j;
      break;
    }
  }

  for (const heading of headings) {
    if (heading <= index && heading >= start) start = heading;
    else if (heading > index && heading < end) {
      end = heading;
      break;
    }
  }

  return { start, end };
}

function findStart(
  context: readonly string[],
  now: Date,
  timeZone: string,
  deadline: DeadlineObservation | null,
): { startsAt: string | null; endsAt: string | null } {
  let text = context.join('\n');
  let match = findDateClock(text, true);

  // 「报名将于 10月23日 12:00 截止」：日期在截止之前，`isDeadlineContext`
  // 看不出来。这里用已解析出的截止时刻做精确排除，避免把截止当开始。
  const deadlineAt = deadline?.at ?? null;
  let guard = 0;
  while (match !== null && deadlineAt !== null && guard < 3) {
    const matchAt = parseInstant(match.text, now, timeZone);
    if (matchAt === null || matchAt !== deadlineAt) break;
    text =
      text.slice(0, match.index) +
      ' '.repeat(match.end - match.index) +
      text.slice(match.end);
    match = findDateClock(text, true);
    guard += 1;
  }

  if (match === null) return { startsAt: null, endsAt: null };

  const startsAt = parseInstant(match.text, now, timeZone);
  if (startsAt === null) return { startsAt: null, endsAt: null };

  const range = /^\s*(?:[-–~—]|至|到)\s*(上午|下午|晚上|中午)?\s*(\d{1,2})\s*[:：]\s*(\d{2})/.exec(
    text.slice(match.end),
  );
  if (range === null) return { startsAt, endsAt: null };

  const endHour = to24Hour(Number(range[2]), range[1]);
  const endMinute = Number(range[3]);
  if (endHour > 23 || endMinute > 59) return { startsAt, endsAt: null };

  let deltaMinutes = endHour * 60 + endMinute - (match.hour * 60 + match.minute);
  if (deltaMinutes < 0) {
    // 「下午 2:00-4:00」：结束没写「下午」，按同一半天的 16:00 处理
    if (endHour < 12 && match.hour >= 12) deltaMinutes += 12 * 60;
    // 跨午夜（23:00-01:00）
    if (deltaMinutes < 0) deltaMinutes += 24 * 60;
  }

  return {
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + deltaMinutes * 60 * 1000).toISOString(),
  };
}

function scoreCandidate(
  startsAt: string | null,
  deadline: DeadlineObservation | null,
  location: string | null,
  organizer: string | null,
): number {
  let score = 0.35;
  if (startsAt !== null) score += 0.25;
  if (deadline?.at !== null && deadline?.at !== undefined) score += 0.15;
  else if (deadline?.raw !== null && deadline?.raw !== undefined) score += 0.05;
  if (location !== null) score += 0.1;
  if (organizer !== null) score += 0.05;
  return Math.min(0.95, Math.round(score * 100) / 100);
}
