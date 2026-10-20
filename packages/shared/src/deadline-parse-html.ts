/**
 * 课程 DDL · 平台页面读取原语（三端共用）
 *
 * ## 出处（合并声明）
 *
 * 本文件移植自 **秦QIN**（`dev.matrix.shell`，Capacitor + React 的课程助手）的
 * `src/plugins/builtin/academic/html.ts` 与同目录 `parsers.ts` 里的读取原语。
 * 来源项目：秦QIN（2026 上海科技大学黑客松参赛组）。
 * 合并授权：项目负责人唐志昊确认「AgenticCampus / Shanghaitech-2026-Hackthon / 秦QIN
 * 三个项目的同学已同意合并」，因此此前「只学架构、不复制代码」的限制解除。
 *
 * 即便如此，本文件**不是**逐行复制：上游那套代码无类型、零测试、靠 `throw new Error`
 * 传递失败，且把「日期提取」和「时区换算」揉在同一个函数里。这里按我们的工程标准重写：
 *
 *   1. 显式类型，没有 `any`；每个导出都有 `readonly` 结构类型。
 *   2. 失败走 `Result`（`@kedaya/shared` 的 `result.ts`），不抛异常 —— 上游用异常
 *      表达「页面没认出来」，调用方只能 catch 成一句话；这里返回带 code 的失败对象，
 *      UI 能逐条显示，也便于测试断言。
 *   3. 时区换算**不重写**：上游自己实现了 `localDate()`（Intl 往返迭代），我们已有
 *      经过 44 条测试的 `parseDueText`。这里只做「把平台原文规范化成 `parseDueText`
 *      认得的写法」，绝对时刻一律交给它算 —— 少一份 DST 逻辑，少一类 bug。
 *   4. 全部行为有测试（`deadline-parse-html.test.ts`）。
 *
 * ## 这个模块做什么
 *
 * 只做「读页面」的原子操作：HTML → 可见文本、属性、链接、日期片段、
 * 登录态/HTTP 错误的识别。平台特定的结构（哪一行是作业、哪个模块是课程列表）
 * 在 `deadline-parse-gradescope` / `deadline-parse-blackboard` / `deadline-parse-eams`。
 *
 * ## 边界（产品约束，不是待办）
 *
 * - **纯函数，无 IO**：不 fetch、不登录、不执行页面脚本。输入是调用方已经拿到的
 *   HTML 字符串（用户另存为 / 扩展采集 / 粘贴），输出是结构体。
 * - **不建 DOM**：没有引入 cheerio / jsdom。只做线性标签扫描 + 少量正则，
 *   HTML5 的隐式闭合与错误恢复不模拟（宿主产物要能在小程序里跑，体积也敏感）。
 * - **不猜日期**：`parseDateSpanToIso` 缺时间（只有日期）一律返回 `null`，
 *   由调用方保留「时间待定」，绝不补一个 23:59 或午夜。
 * - **只读 https**：`collectAnchors` 丢弃非 https 链接 —— 平台页面里混进来的
 *   `http:` / `javascript:` / `data:` 链接不是课程入口。
 */

import { htmlToLines } from './deadline-html';
import { parseDueText } from './deadline-normalize';
import { type Result } from './result';

/* ------------------------------------------------------------------ *
 * 失败形状
 * ------------------------------------------------------------------ */

/**
 * 失败原因码。写死成联合类型而不是 `string`：
 * 调用方 switch 时能穷尽，测试也能断言具体原因，而不是匹配一句中文。
 */
export const DEADLINE_PARSE_FAILURES = Object.freeze([
  /** 传入的 URL 不是合法绝对地址 */
  'invalid-url',
  /** 平台返回非 200 */
  'http-error',
  /** 平台返回空页面 */
  'empty-page',
  /** 命中登录页 / 会话过期 */
  'login-required',
  /** 页面结构不认识（平台改版、或采集到了别的页面） */
  'unrecognized-structure',
  /** 预期存在的模块在页面上找不到 */
  'module-missing',
  /** 模块还在异步加载 */
  'module-loading',
  /** 页面自相矛盾（周次编码基准不明、字段数量不对） */
  'inconsistent-page',
  /** 平台明确报错（无权限、会话超时、页面错误页） */
  'source-refused',
] as const);

export type DeadlineParseFailureCode = (typeof DEADLINE_PARSE_FAILURES)[number];

/** 一次解析失败。`message` 是给人看的一句话，可以直接上屏 */
export interface DeadlineParseFailure {
  readonly code: DeadlineParseFailureCode;
  readonly message: string;
}

/** 平台页面解析结果。成功时携带 `value`，失败时只有可展示的原因 */
export type DeadlineParseResult<T> = Result<T, DeadlineParseFailure>;

/** 构造失败对象（便于测试与调用方一致地造数据） */
export function deadlineParseFailure(
  code: DeadlineParseFailureCode,
  message: string,
): DeadlineParseFailure {
  return { code, message };
}

/* ------------------------------------------------------------------ *
 * 属性与可见文本
 * ------------------------------------------------------------------ */

/**
 * 属性读取正则。
 *
 * 与常见写法 `(\w+)=["'](.*?)["']` 的区别：支持**无引号属性**（`class=foo`）与
 * 无值属性（`disabled`），并且**不会跨越 `>`**，避免把下一个标签当成同一个属性。
 */
const ATTRIBUTE_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
});

/**
 * 解码 HTML 实体。
 *
 * 为什么不用 `deadline-html` 的 `decodeHtmlEntities`：那个函数刻意**只认带分号的**
 * 实体（粘贴场景要保守）。平台页面里存在 `&#160`、`&amp` 这类缺分号的写法，
 * 读属性值时必须放宽；但放宽只影响本模块读到的属性/文本，不影响粘贴解析那条链路。
 */
function decodeEntities(value: string): string {
  return value.replace(/&(#(?:[xX][0-9a-fA-F]+|[0-9]+)|[A-Za-z][A-Za-z0-9]+);?/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const codePoint = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return match;
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) return match;
      return codePoint === 0xa0 ? ' ' : String.fromCodePoint(codePoint);
    }
    const decoded = NAMED_ENTITIES[body.toLowerCase()];
    return decoded ?? match;
  });
}

const ATTRIBUTE_NAME_RE = /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/;

/**
 * 从一个**开标签字符串**里读属性值。
 *
 * @param tagHtml 含标签名的开标签原文，例如 `<a href="/x" class="y">`
 * @param name    属性名（大小写不敏感）
 * @returns 已去引号、已解码的属性值；没有该属性返回空串
 */
export function readTagAttribute(tagHtml: string, name: string): string {
  if (typeof tagHtml !== 'string' || tagHtml.length === 0) return '';
  const wanted = name.trim().toLowerCase();
  if (!ATTRIBUTE_NAME_RE.test(wanted)) return '';

  ATTRIBUTE_RE.lastIndex = 0;
  let match = ATTRIBUTE_RE.exec(tagHtml);
  while (match !== null) {
    const attributeName = (match[1] ?? '').toLowerCase();
    if (attributeName === wanted) {
      return decodeEntities(match[2] ?? match[3] ?? match[4] ?? '').trim();
    }
    match = ATTRIBUTE_RE.exec(tagHtml);
  }
  return '';
}

/**
 * 页面可见文本。
 *
 * 基于已经测过的 `htmlToLines`（去 script/style、块级标签断行、实体解码），
 * 再把行拼成一段并折叠空白。**纯文本输入原样返回**（只折叠空白），
 * 所以调用方不需要先判断「这是 HTML 还是文本」。
 */
export function htmlText(html: string): string {
  if (typeof html !== 'string' || html.length === 0) return '';
  return htmlToLines(html)
    .join(' ')
    .replace(/[\t\u00a0\u3000]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ *
 * 标签扫描与链接
 * ------------------------------------------------------------------ */

interface ScannedTag {
  readonly name: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
  /** `<` 的下标 */
  readonly start: number;
  /** `>` 之后的下标 */
  readonly end: number;
  /** 标签名之后、`>`（或自闭合 `/`）之前的属性原文 */
  readonly attributes: string;
}

function isNameChar(char: string | undefined): boolean {
  if (char === undefined) return false;
  return (
    (char >= 'a' && char <= 'z') ||
    (char >= 'A' && char <= 'Z') ||
    (char >= '0' && char <= '9') ||
    char === '-' ||
    char === ':' ||
    char === '_'
  );
}

/**
 * 从 `<` 读一个标签。
 *
 * 读不出合法标签（`<3`、`a < b`、没有 `>` 的残缺标签、注释）返回 `null`，
 * 由调用方当普通文本跳过。属性值里的 `>` 不会提前结束标签 —— 扫描时跟踪引号。
 */
function scanTag(html: string, start: number): ScannedTag | null {
  if (start < 0 || start >= html.length || html[start] !== '<') return null;

  let index = start + 1;
  if (html[index] === '!' || html[index] === '?') return null; // 注释 / doctype / 处理指令

  let closing = false;
  if (html[index] === '/') {
    closing = true;
    index += 1;
  }

  const nameStart = index;
  while (index < html.length && isNameChar(html[index])) index += 1;
  const name = html.slice(nameStart, index).toLowerCase();
  if (name.length === 0) return null;
  if (name[0] === undefined || name[0] < 'a' || name[0] > 'z') return null;

  let quote: string | null = null;
  let end = -1;
  for (let cursor = index; cursor < html.length; cursor += 1) {
    const char = html[cursor];
    if (char === undefined) break;
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') {
      end = cursor;
      break;
    }
  }
  if (end === -1) return null;

  let beforeEnd = end - 1;
  while (beforeEnd > index && /\s/.test(html[beforeEnd] ?? '')) beforeEnd -= 1;
  const selfClosing = html[beforeEnd] === '/';

  return {
    name,
    closing,
    selfClosing,
    start,
    end: end + 1,
    attributes: html.slice(index, selfClosing ? beforeEnd : end),
  };
}

/** 页面里的一条链接（已解析成绝对地址） */
export interface AnchoredLink {
  /** 绝对 https 地址，已解析 `href` 里的相对路径 */
  readonly url: string;
  /** 链接的可见文本（已折叠空白） */
  readonly text: string;
  /** `<a ...>…</a>` 原文，调用方需要再取内部结构时用 */
  readonly html: string;
  /** `<a` 在输入里的下标，用于「取它前面的标题」这类位置判断 */
  readonly index: number;
}

const CLOSE_ANCHOR_RE = /<\/a\s*>/gi;

/**
 * 收集页面里所有可用的链接。
 *
 * 规则（比上游更严）：
 * - 只要 `https:` 绝对地址；`http:` / `javascript:` / `data:` / `mailto:` 一律丢弃；
 * - `href` 为空或 `#` 开头的锚点丢弃；
 * - 地址解析失败（含非法 base）丢弃该条，而不是让整页解析崩掉；
 * - 链接没有闭合标签时取到文档末尾（浏览器也是这么容错的）。
 */
export function collectAnchors(html: string, baseUrl: string): AnchoredLink[] {
  if (typeof html !== 'string' || html.length === 0) return [];

  const links: AnchoredLink[] = [];
  let cursor = 0;

  while (cursor < html.length) {
    const open = html.indexOf('<', cursor);
    if (open === -1) break;

    const tag = scanTag(html, open);
    if (tag === null) {
      cursor = open + 1;
      continue;
    }
    cursor = tag.end;

    if (tag.closing || tag.name !== 'a') continue;

    CLOSE_ANCHOR_RE.lastIndex = tag.end;
    const close = CLOSE_ANCHOR_RE.exec(html);
    const inner = html.slice(tag.end, close === null ? html.length : close.index);
    if (close !== null) cursor = close.index + close[0].length;

    const href = readTagAttribute(`<a ${tag.attributes}>`, 'href');
    if (href.length === 0 || href.startsWith('#')) continue;

    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      continue; // base 或 href 非法：跳过这一条，不影响整页
    }
    if (url.protocol !== 'https:') continue;

    links.push({ url: url.href, text: htmlText(inner), html: html.slice(open, cursor), index: open });
  }

  return links;
}

/* ------------------------------------------------------------------ *
 * 日期片段
 * ------------------------------------------------------------------ */

/** 页面文本里的一段「日期表达式」及其位置 */
export interface DateSpan {
  /** 在输入文本里的下标 */
  readonly at: number;
  /** 命中的原文（未做任何改写） */
  readonly text: string;
}

/**
 * 页面文本里可能出现的五类日期写法（机器时间、中文全日期、英文月份、纯日期、
 * 带时间的中文短日期）。
 *
 * 顺序无所谓（结果会按位置排序），但**同位置带偏移的机器时间优先**：
 * `2026-10-20T23:59:00+08:00` 会同时命中「机器时间」与「纯日期」两条规则，
 * `findDateSpans` 保留更长的那个。
 */
const DATE_PATTERNS: readonly RegExp[] = Object.freeze([
  // 带偏移的机器时间（BB / Gradescope 的 datetime 属性）
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:\s?(?:Z|[+-]\d{2}:?\d{2}))?/,
  // 中文全日期：2026年10月20日 星期二 下午11:59
  /20\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*(?:星期|周)[一二三四五六日天])?(?:\s*(?:上午|下午|晚上|凌晨|中午|早上)?\s*\d{1,2}\s*[:：]\s*\d{2}(?:\s*[:：]\s*\d{2})?)?/,
  // 英文月份：Oct 20, 2026 11:59 PM / Oct 20 at 11:59PM
  /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?(?:\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i,
  // 纯日期：2026/10/20、2026-10-20
  /20\d{2}\s*[-/]\s*\d{1,2}\s*[-/]\s*\d{1,2}/,
  // 中文短日期**必须带时间**：10月20日 23:59（不带时间的裸「9月1日」多半是学期信息）
  /\d{1,2}\s*月\s*\d{1,2}\s*[日号]\s*(?:上午|下午|晚上|凌晨|中午|早上)?\s*\d{1,2}\s*[:：]\s*\d{2}/,
]);

/**
 * 找出一段文本里所有日期表达式，按出现位置排序。
 *
 * 同一位置被多条规则命中时保留**最长**的（信息更全）：
 * `2026-10-20 23:59` 同时命中机器时间与纯日期，取机器时间。
 */
export function findDateSpans(value: string): DateSpan[] {
  if (typeof value !== 'string' || value.length === 0) return [];

  const spans: DateSpan[] = [];

  for (const pattern of DATE_PATTERNS) {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (const match of value.matchAll(global)) {
      const at = match.index ?? 0;
      // match[0] 在带捕获组的规则里仍存在；类型上可能为 undefined，这里兜底
      const text = match[0] ?? '';
      if (text.length === 0) continue;

      const existing = spans.find((span) => span.at === at);
      if (existing === undefined) spans.push({ at, text });
      else if (text.length > existing.text.length) {
        const index = spans.indexOf(existing);
        spans[index] = { at, text };
      }
    }
  }

  return spans.sort((left, right) => left.at - right.at);
}

/** 回退时保留的最大字符数（认不出日期时给 UI 的原文片段） */
const FALLBACK_TEXT_LIMIT = 40;

/**
 * 从平台原文里只取出「日期时间」那一段。
 *
 * 上游的教训：早期实现是 `截止日期…(.{0,100})` —— 从整页纯文本截 100 个字，
 * 于是「2026年10月20日 下午11:59」后面跟着的按钮文案、说明、导航全被当成
 * 「平台原文」显示出来。这里改成只认日期表达式本身。
 *
 * `pick` 的语义：
 * - `'first'`：Blackboard「截止日期」后面只有一段，取第一个；
 * - `'last'`：Gradescope 的截止单元格是一整句拼起来的
 *   （`5 days left  Oct 13 at 8:00PM  Oct 22 at 11:59PM`），取最后一个才是截止。
 *
 * 认不出日期时**退化**成截断的原文（带 `…`），而不是返回空串：
 * 界面至少能显示「平台写的是什么」，用户自己判断。
 */
export function pickDateSpanText(raw: string, pick: 'first' | 'last' = 'first'): string {
  const value = htmlText(raw);
  const spans = findDateSpans(value);
  if (spans.length > 0) {
    const chosen = pick === 'last' ? spans[spans.length - 1] : spans[0];
    if (chosen !== undefined) return chosen.text.trim();
  }
  return value.length > FALLBACK_TEXT_LIMIT
    ? `${value.slice(0, FALLBACK_TEXT_LIMIT).trimEnd()}…`
    : value;
}

/* ------------------------------------------------------------------ *
 * 日期 → 绝对时刻
 * ------------------------------------------------------------------ */

/** 中文时段词。`晚上 / 下午` 是 12 小时制，`凌晨` 的 12 点要归 0 */
const MERIDIEMS: Readonly<Record<string, 'am' | 'pm'>> = Object.freeze({
  上午: 'am',
  早上: 'am',
  凌晨: 'am',
  中午: 'pm',
  下午: 'pm',
  晚上: 'pm',
});

/** 12 小时制 → 24 小时制；`12 AM` → 0，`12 PM` → 12 */
function applyMeridiem(hour: number, meridiem: 'am' | 'pm'): number {
  if (hour === 12) return meridiem === 'pm' ? 12 : 0;
  return meridiem === 'pm' ? hour + 12 : hour;
}

const CHINESE_FULL_DATE =
  /^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]\s*(?:(?:星期|周)\s*[一二三四五六日天]\s*)?(上午|下午|晚上|凌晨|中午|早上)?\s*(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*[:：]\s*(\d{2}))?$/;

const CHINESE_SHORT_DATE =
  /^(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]\s*(?:(?:星期|周)\s*[一二三四五六日天]\s*)?(上午|下午|晚上|凌晨|中午|早上)?\s*(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*[:：]\s*(\d{2}))?$/;

const ENGLISH_DATE =
  /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(20\d{2}))?(?:\s*,?\s*(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?)?$/i;

const ENGLISH_MONTHS: Readonly<Record<string, number>> = Object.freeze({
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
});

/** 解析日期时的上下文 */
export interface DateSpanParseOptions {
  /** 学校时区（IANA）。**必传**，没有默认值 —— 默认值会掩盖跨时区 bug */
  readonly timeZone: string;
  /** 基准时刻。只用于「原文缺年份」与相对时间的兜底 */
  readonly now: Date;
  /**
   * 学期标签，如 `Fall 2026` / `2026-fall` / `2026-秋`。
   * 有它就能把「Oct 20 at 11:59PM」这种缺年份的写法钉到正确学年。
   */
  readonly term?: string | null;
}

/** 从学期标签里取学年（`Fall 2026` → 2026）；取不到返回 `null` */
export function termYear(term: string | null | undefined): number | null {
  if (typeof term !== 'string') return null;
  const match = /(20\d{2})/.exec(term);
  if (match === null) return null;
  const year = Number(match[1]);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null;
}

/**
 * 缺年份时按学期推断年份。
 *
 * 秋季学期跨年：`Fall 2026` 的作业可能 1 月才截止，所以月份 ≤ 3 时年份 +1。
 * 这是上游 `parseDeadline` 的规则，我们只保留这一条 —— 春季学期的跨年反推
 * （12 月截止算上一年）没有真实样本，不猜。
 */
export function inferYearForTerm(termYearValue: number, month: number, term: string | null | undefined): number {
  const isAutumn = typeof term === 'string' && /fall|autumn|秋/i.test(term);
  return isAutumn && month >= 1 && month <= 3 ? termYearValue + 1 : termYearValue;
}

/** 两位补零 */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * 把一段日期原文规范化成 `parseDueText` 认得的写法，并算出绝对时刻。
 *
 * 支持的原文（与 `findDateSpans` 的命中保持一致）：
 *
 * | 原文 | 处理 |
 * | --- | --- |
 * | `2026-10-20T23:59:00+08:00` | 原样交给 `parseDueText`（偏移已知） |
 * | `2026-10-20 23:59` | 原样（按 `timeZone` 解释墙上时间） |
 * | `2026年10月20日 星期二 下午11:59` | 去星期、下午→23 点，转 `2026-10-20 23:59` |
 * | `10月20日 23:59` | 有学期年份则补年份，否则交给 `parseDueText` 按「最近一次」推断 |
 * | `Oct 20, 2026 11:59 PM` | 原样（`parseDueText` 支持英文月份） |
 * | `Oct 20 at 11:59PM` | 有学期年份则补 `, 2026` |
 * | `2026-10-20`（只有日期） | **返回 `null`** —— 缺时间不猜 |
 *
 * 返回 ISO-8601 UTC 串；认不出 / 缺时间 / 非法日期返回 `null`。
 */
export function parseDateSpanToIso(span: string, options: DateSpanParseOptions): string | null {
  const { timeZone, now, term } = options;
  if (typeof span !== 'string') return null;

  const value = span
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (value.length === 0) return null;

  const fallbackYear = termYear(term);

  const chineseFull = CHINESE_FULL_DATE.exec(value);
  if (chineseFull !== null) {
    return buildChineseInstant({
      year: Number(chineseFull[1]),
      month: Number(chineseFull[2]),
      day: Number(chineseFull[3]),
      meridiem: chineseFull[4],
      hour: chineseFull[5],
      minute: chineseFull[6],
      second: chineseFull[7],
      options,
    });
  }

  const chineseShort = CHINESE_SHORT_DATE.exec(value);
  if (chineseShort !== null) {
    const month = Number(chineseShort[1]);
    const day = Number(chineseShort[2]);
    return buildChineseInstant({
      year: fallbackYear === null ? null : inferYearForTerm(fallbackYear, month, term),
      month,
      day,
      meridiem: chineseShort[3],
      hour: chineseShort[4],
      minute: chineseShort[5],
      second: chineseShort[6],
      options,
    });
  }

  const english = ENGLISH_DATE.exec(value);
  if (english !== null) {
    const month = ENGLISH_MONTHS[(english[1] ?? '').slice(0, 3).toLowerCase()];
    const day = Number(english[2]);
    const hourText = english[4];
    // 缺时间（只有日期）→ 不猜
    if (month === undefined || hourText === undefined || !Number.isInteger(day)) return null;
    const hour = Number(hourText);
    const minute = Number(english[5]);
    const second = english[6] === undefined ? 0 : Number(english[6]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || !Number.isInteger(second)) return null;

    const meridiem = (english[7] ?? '').toLowerCase();
    const normalizedHour = meridiem === 'pm' || meridiem === 'am' ? applyMeridiem(hour, meridiem) : hour;
    const yearText = english[3];
    const year =
      yearText !== undefined
        ? Number(yearText)
        : fallbackYear === null
          ? null
          : inferYearForTerm(fallbackYear, month, term);

    const clock = `${pad2(normalizedHour)}:${pad2(minute)}${second === 0 ? '' : `:${pad2(second)}`}`;
    const canonical =
      year === null
        ? `${english[1] ?? ''} ${day} ${clock}`
        : `${english[1] ?? ''} ${day}, ${year} ${clock}`;
    return parseDueText(canonical, now, timeZone);
  }

  // 机器时间 / 纯日期：原样交给唯一的日期解析入口。
  // 纯日期（`2026-10-20`）会在那里因为缺时间返回 null —— 正是我们要的。
  return parseDueText(value, now, timeZone);
}

interface ChineseInstantInput {
  readonly year: number | null;
  readonly month: number;
  readonly day: number;
  readonly meridiem: string | undefined;
  readonly hour: string | undefined;
  readonly minute: string | undefined;
  readonly second: string | undefined;
  readonly options: DateSpanParseOptions;
}

/**
 * 中文日期的公共处理。
 *
 * 年份为 `null` 时保留「缺年份」形态（`10月20日 23:59`），交给 `parseDueText`
 * 按「最近一次」推断 —— 那条推断同样要求有学期上下文之外的兜底。
 */
function buildChineseInstant(input: ChineseInstantInput): string | null {
  const { year, month, day, meridiem, hour, minute, second, options } = input;
  const { timeZone, now } = options;

  // 缺时间 → 不猜（裸日期不补 23:59，也不补午夜）
  if (hour === undefined || minute === undefined) return null;
  if (!Number.isInteger(month) || !Number.isInteger(day)) return null;

  const hourValue = Number(hour);
  const minuteValue = Number(minute);
  const secondValue = second === undefined ? 0 : Number(second);
  if (!Number.isInteger(hourValue) || !Number.isInteger(minuteValue) || !Number.isInteger(secondValue)) {
    return null;
  }

  const marker = meridiem === undefined ? undefined : MERIDIEMS[meridiem];
  const normalizedHour = marker === undefined ? hourValue : applyMeridiem(hourValue, marker);

  const clock = `${pad2(normalizedHour)}:${pad2(minuteValue)}${secondValue === 0 ? '' : `:${pad2(secondValue)}`}`;
  const canonical =
    year === null ? `${month}月${day}日 ${clock}` : `${year}年${month}月${day}日 ${clock}`;
  return parseDueText(canonical, now, timeZone);
}

/* ------------------------------------------------------------------ *
 * JS 字面量读取（EAMS 课表页用）
 * ------------------------------------------------------------------ */

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  v: '\v',
  '0': '\0',
});

/**
 * 只读 JS 源码里的**单引号 / 双引号字符串字面量**，按出现顺序返回。
 *
 * 刻意不处理模板字符串（`` ` ``）：模板里可以塞表达式，读成字面量会骗人。
 * 也不处理正则字面量与注释里的引号 —— 它们在 `TaskActivity(...)` 参数区里不出现，
 * 而多读一个字符串只会让参数个数变多，调用方的「参数不足」检查仍然生效。
 *
 * 转义支持：`\n \r \t \b \f \v \0 \\ \' \" \uXXXX \xXX`；其余 `\X` 按 `X` 处理。
 */
export function readJsStringLiterals(source: string): string[] {
  if (typeof source !== 'string' || source.length === 0) return [];

  const values: string[] = [];
  let index = 0;

  while (index < source.length) {
    const quote = source[index];
    if (quote !== "'" && quote !== '"') {
      index += 1;
      continue;
    }

    index += 1;
    let value = '';
    let closed = false;

    while (index < source.length) {
      const char = source[index];
      if (char === undefined) break;

      if (char === quote) {
        closed = true;
        index += 1;
        break;
      }

      if (char !== '\\') {
        value += char;
        index += 1;
        continue;
      }

      const escape = source[index + 1];
      index += 2;
      if (escape === undefined) break;

      if (escape === 'u') {
        const hex = source.slice(index, index + 4);
        index += 4;
        value += /^[0-9a-fA-F]{4}$/.test(hex) ? String.fromCharCode(Number.parseInt(hex, 16)) : '';
        continue;
      }
      if (escape === 'x') {
        const hex = source.slice(index, index + 2);
        index += 2;
        value += /^[0-9a-fA-F]{2}$/.test(hex) ? String.fromCharCode(Number.parseInt(hex, 16)) : '';
        continue;
      }

      value += SIMPLE_ESCAPES[escape] ?? escape;
    }

    // 未闭合的字符串不产出（宁可少一条，也不把半截源码当数据）
    if (closed) values.push(value);
  }

  return values;
}

/* ------------------------------------------------------------------ *
 * 提交状态
 * ------------------------------------------------------------------ */

/**
 * 提交状态（四态）。
 *
 * `unknown` 是**合法结论**：页面没写，就不该被当成「未交」。上游和 campusMate
 * 都踩过同一个坑 —— 把读不到当 `not_submitted`，然后催学生交已经交了的作业。
 */
export const SUBMISSION_STATES = Object.freeze([
  'not_submitted',
  'submitted',
  'graded',
  'unknown',
] as const);

export type SubmissionState = (typeof SUBMISSION_STATES)[number];

/**
 * 从一行/一页的可见文本里读提交状态。
 *
 * 判定顺序写死，**不能调换**：
 * 1. 「未提交 / not submitted」先判 —— 已交页面里也常有「提交记录」字样，
 *    反过来「未提交」页面不会出现「已提交」；
 * 2. 有分数（`85 / 100`、`graded`）说明已批改；
 * 3. 「已提交 / submission received」；
 * 4. 都没有 → `unknown`。
 */
export function readSubmissionState(words: string): SubmissionState {
  if (typeof words !== 'string' || words.length === 0) return 'unknown';
  if (
    /\b(?:not\s+submitted|no\s+submission|missing)\b/i.test(words) ||
    /未提交|尚未提交|未交|未上传/.test(words)
  ) {
    return 'not_submitted';
  }
  if (/\bgraded\b|\d+(?:\.\d+)?\s*\/\s*\d/.test(words) || /已批改|已评分|得分/.test(words)) {
    return 'graded';
  }
  if (
    /\b(?:submitted|submission\s+received|resubmitted)\b/i.test(words) ||
    /已提交|已上交|提交成功|重新提交/.test(words)
  ) {
    return 'submitted';
  }
  return 'unknown';
}

/* ------------------------------------------------------------------ *
 * 页面健康检查
 * ------------------------------------------------------------------ */

/** `inspectPlatformPage` 的输入 */
export interface PlatformPageInput {
  readonly html: string;
  /** HTTP 状态码；省略表示调用方没拿到状态（例如直接读本地文件） */
  readonly status?: number;
  /** 本次响应的地址，用于识别「被重定向到登录页」 */
  readonly url: string;
}

const LOGIN_PATH_RE = /\/(?:authserver\/login|login|signin)(?:[/?]|$)/i;
const PASSWORD_INPUT_RE = /<input\b[^>]*\btype\s*=\s*["']?password["']?/i;
const EMPTY_BODY_RE = /^\s*$/;

/**
 * 判断一次页面抓取是否可用。
 *
 * 返回 `null` 表示「这页能解析」；否则返回失败原因。三类问题的顺序是刻意的：
 *
 * 1. **登录态**先判 —— 被重定向到登录页时，HTTP 往往是 200，页面也不是空的，
 *    只有内容不对。若先判结构，用户会看到「页面结构不认识」而不是「请重新登录」。
 * 2. HTTP 状态其次。
 * 3. 空页面最后。
 *
 * 与上游的差异：上游直接 `throw`，`code` 只藏在中文消息前缀（`LOGIN_REQUIRED：…`）。
 * 这里把 code 变成结构化字段，UI 可以据此弹「重新登录」而不是一条红色错误。
 */
export function inspectPlatformPage(input: PlatformPageInput): DeadlineParseFailure | null {
  const { html, status, url } = input;

  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    return deadlineParseFailure('invalid-url', '抓取地址不是合法 URL');
  }

  if (PASSWORD_INPUT_RE.test(html) || LOGIN_PATH_RE.test(parsed.pathname)) {
    return deadlineParseFailure('login-required', '登录已过期，请重新登录后再采集');
  }

  if (typeof status === 'number' && status !== 200) {
    return deadlineParseFailure('http-error', `平台返回 HTTP ${status}`);
  }

  if (typeof html !== 'string' || EMPTY_BODY_RE.test(html)) {
    return deadlineParseFailure('empty-page', '平台返回空页面');
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * 与上游实现的差异（给自己和 review 的人看）
 * ------------------------------------------------------------------ *
 *
 * | 上游行为 | 本实现 | 原因 |
 * | --- | --- | --- |
 * | `text()` / `attr()` 不处理缺分号实体 | 属性与文本都放宽实体 | 平台页面存在 `&#160` |
 * | `anchors()` 只认 https，失败静默 | 同（保留），但记录为显式规则 | 安全属性值得写进文档 |
 * | `deadlineHits()` 只有 4 条规则 | 增加「中文短日期+时间」 | `10月20日 23:59` 是真实现象 |
 * | `parseDeadline()` 自带 `localDate()` | 复用 `parseDueText` | 不重复实现 DST 逻辑 |
 * | 失败抛 `Error` 字符串 | `Result` + code | 可断言、可展示、不靠 catch |
 * | `requirePage()` 顺序：登录 → 状态 → 空 | 同（保留） | 顺序是对的 |
 */
