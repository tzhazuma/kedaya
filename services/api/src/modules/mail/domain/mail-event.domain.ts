/**
 * 校园邮箱 → 活动 · **纯函数**抽取器（零 IO、零框架依赖）
 *
 * 用户诉求：「活动可以从学校邮件中获取」。本文件负责其中**不碰网络**的那一半：
 * 从邮件主题/正文里认出讲座、会议、宣讲会等活动，并把时间归一成绝对时刻。
 *
 * ## 边界（写死在代码里）
 *
 * 1. **认不出就返回 `null`，不猜。**
 *    没有活动关键词、没有可解析的时间、日期非法（2 月 30 日）、
 *    带歧义时区缩写……一律 `null`。宁可漏一条，也不要在用户日历里塞一条假活动。
 * 2. **时间一律复用 `@kedaya/shared` 的 `parseDueText`。**
 *    时区解释、缺年份推断、夏令时不存在时刻等规则只维护一份；
 *    本文件只负责**把时间片段从邮件里切出来**，不自己实现日期解析。
 * 3. **只返回归一后的活动，不返回正文。** `matchedText` 只保留命中的时间片段，
 *    供用户核对"为什么识别成这个时间"，不是邮件正文副本。
 * 4. **不抛"认不出"异常。** 邮件格式千奇百怪，解析失败是常态；调用方按 `null` 处理。
 *
 * ## 支持的活动形态
 *
 * | 类别 | 中文关键词 | 英文关键词 |
 * | --- | --- | --- |
 * | 讲座 | 讲座 / 学术报告 / 报告会 / 专题报告 / 学术沙龙 | seminar / lecture / colloquium / talk |
 * | 会议 | 会议 / 研讨会 / 论坛 / 峰会 / 座谈会 | meeting / conference / workshop / symposium / panel |
 * | 宣讲会 | 宣讲会 / 宣讲 / 招生宣讲 / 招聘宣讲 | info session / open house / recruitment talk |
 *
 * 时间写法沿用 `parseDueText` 的支持范围，另在切分阶段补上邮件常见形态：
 * `2026年10月20日（周二）14:00`、`Oct 20, 2026 at 2:00 PM`、
 * `Date: October 21, 2026` + 下一行 `Time: 3:30 PM`、`下午2:00`、
 * 主题里的时间、带 `-` / `–` 的起止时间（取开始时刻）。
 */

import { parseDueText } from '@kedaya/shared';

/* ------------------------------------------------------------------ *
 * 返回类型
 * ------------------------------------------------------------------ */

export type MailEventKind = 'lecture' | 'meeting' | 'info-session';

/**
 * 从一封邮件中抽出的活动。
 *
 * ⚠️ `startsAt` 是 ISO-8601 UTC 串（与 `parseDueText` 一致），不是 Date。
 * `confidence` 是 0..1 的启发式置信度；它只用于排序/展示，不参与"要不要存"的判断
 * —— 能走到这里就说明关键词与时间都认出来了。
 */
export interface ExtractedMailEvent {
  readonly title: string;
  readonly startsAt: string;
  readonly location: string | null;
  readonly organizer: string | null;
  readonly confidence: number;
  readonly matchedText: string;
}

/* ------------------------------------------------------------------ *
 * 关键词
 * ------------------------------------------------------------------ */

interface EventKeyword {
  readonly kind: MailEventKind;
  readonly pattern: RegExp;
}

/**
 * ⚠️ 顺序有意义：`宣讲会` 里也含 "会"，必须先于 `meeting` 判断。
 * 这些正则**不带 `g`**，因为只做一次 `.test()`。
 */
const EVENT_KEYWORDS: readonly EventKeyword[] = [
  {
    kind: 'info-session',
    pattern:
      /宣讲会|宣讲|招生宣讲|招聘宣讲|info(?:rmation)?\s+session|open\s+house|recruitment\s+(?:talk|session)|admissions?\s+(?:talk|session)/i,
  },
  {
    kind: 'lecture',
    pattern:
      /讲座|学术报告|报告会|专题报告|学术沙龙|seminar|lecture|colloquium|\btalks?\b|distinguished\s+lecture/i,
  },
  {
    kind: 'meeting',
    pattern: /会议|研讨会|论坛|峰会|座谈会|workshop|conference|meeting|symposium|panel|roundtable/i,
  },
];

const KIND_LABEL: Readonly<Record<MailEventKind, string>> = {
  lecture: '讲座',
  meeting: '会议',
  'info-session': '宣讲会',
};

/** 用于正文标题兜底：按类别只找对应关键词所在的行 */
const KEYWORD_BY_KIND: Readonly<Record<MailEventKind, RegExp>> = {
  lecture: EVENT_KEYWORDS[1]!.pattern,
  meeting: EVENT_KEYWORDS[2]!.pattern,
  'info-session': EVENT_KEYWORDS[0]!.pattern,
};

/* ------------------------------------------------------------------ *
 * 时间片段正则
 * ------------------------------------------------------------------ */

/**
 * 完整日期 + 时间（可含年份、星期、上午/下午）。
 * 只负责"切出来"，真正解析交给 `parseDueText`。
 */
const FULL_DATE_TIME_PATTERNS: readonly RegExp[] = [
  // 2026-10-20T14:00:00+08:00 / 2026-10-20 14:00
  /\d{4}-\d{1,2}-\d{1,2}[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,6})?(?:\s*(?:Z|UTC|GMT|[+-]\d{2}:?\d{2}))?/gi,
  // 2026年10月20日（周二）14:00 / 10月20日 下午2:00
  /(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*[日号](?:\s*[（(]\s*(?:周|星期)[一二三四五六日天]\s*[)）])?\s*(?:[，,·|]\s*)?(?:上午|早上|下午|晚上|中午)?\s*\d{1,2}:\d{2}(?::\d{2})?/g,
  // October 20, 2026 at 2:00 PM / Oct 20 14:00
  /(?:[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\s*(?:,|at)?\s*)\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]m)?/gi,
  // Due in 3 days / in 2 hours / 3 天后
  /(?:due\s+)?in\s+\d+\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?)/gi,
  /\d+\s*(?:分钟|小时|天|周|星期)\s*后(?:截止)?/g,
];

/** 只有日期、没有时间。用于和下一行/同一行的 `Time:` 拼接。 */
const DATE_ONLY_PATTERNS: readonly RegExp[] = [
  /\d{4}-\d{1,2}-\d{1,2}/g,
  /(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g,
  /[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?/gi,
];

/** 只有时间。非全局（一次 `.exec` 即可），避免 lastIndex 污染。 */
const TIME_ONLY = /(?:^|[^\d:])((?:上午|早上|下午|晚上|中午)?\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]m)?)/i;

/* ------------------------------------------------------------------ *
 * 地点 / 主办方
 * ------------------------------------------------------------------ */

const LOCATION_LABEL =
  /(?:^|[\n;；,，])\s*(?:地点|地址|会场|举办地点|活动地点|线下地点|线上地点|location|venue|where|place)\s*[:：]\s*([^\n]{1,160})/i;

const ORGANIZER_LABEL =
  /(?:^|[\n;；,，])\s*(?:主办方|主办单位|主办|承办方|承办单位|承办|组织方|组织单位|组织者|organizer|organiser|host)\s*[:：]\s*([^\n]{1,160})/i;

const ORGANIZER_EN = /\b(?:organized|organised|hosted)\s+by\s+([^\n]{1,160})/i;

/** 正文里属于"元信息"而不是标题的行 */
const LABEL_LINE =
  /^(?:时间|日期|地点|地址|会场|主办|承办|组织|讲者|演讲者|speaker|time|date|location|venue|organizer|host)\s*[:：]/i;

/* ------------------------------------------------------------------ *
 * 主函数
 * ------------------------------------------------------------------ */

/**
 * 从邮件主题/正文中抽取一条活动。
 *
 * @param subject    邮件主题（可空串）
 * @param body       已解码的正文纯文本（可含多行）
 * @param receivedAt 收信时刻；`parseDueText` 用它做"缺年份/相对时间"的基准
 * @param timeZone   **显式**的 IANA 学校时区（如 `Asia/Shanghai`），无默认值
 * @returns 认不出活动或时间时返回 `null`；`timeZone` 非法时抛 `RangeError`
 */
export function extractEventFromMail(
  subject: string,
  body: string,
  receivedAt: Date,
  timeZone: string,
): ExtractedMailEvent | null {
  if (typeof subject !== 'string' || typeof body !== 'string') return null;
  if (!(receivedAt instanceof Date) || Number.isNaN(receivedAt.getTime())) {
    throw new RangeError('extractEventFromMail: receivedAt 必须是有效的 Date');
  }
  if (typeof timeZone !== 'string' || timeZone.trim().length === 0) {
    throw new RangeError('extractEventFromMail: timeZone 必须显式传入 IANA 时区名');
  }

  const subjectText = normalizeText(subject);
  const bodyLines = splitLines(body);
  const kind = detectMailEventKind(`${subjectText}\n${bodyLines.join('\n')}`);
  if (kind === null) return null;

  const time = findEventTime(subjectText, bodyLines, receivedAt, timeZone);
  if (time === null) return null;

  const title = extractTitle(subjectText, bodyLines, kind);
  if (title === null) return null;

  const location = extractLocation(subjectText, bodyLines);
  const organizer = extractOrganizer(subjectText, bodyLines);

  return {
    title,
    startsAt: time.startsAt,
    location,
    organizer,
    confidence: scoreConfidence(subjectText, bodyLines, time, location, organizer),
    matchedText: time.matchedText,
  };
}

/** 只做关键词识别，供调用方在需要时单独使用（例如给事件打类别标签）。 */
export function detectMailEventKind(text: string): MailEventKind | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  const normalized = text.normalize('NFKC');
  for (const entry of EVENT_KEYWORDS) {
    if (entry.pattern.test(normalized)) return entry.kind;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 时间抽取
 * ------------------------------------------------------------------ */

interface FoundTime {
  readonly startsAt: string;
  readonly matchedText: string;
  readonly fromSubject: boolean;
}

function findEventTime(
  subject: string,
  bodyLines: readonly string[],
  receivedAt: Date,
  timeZone: string,
): FoundTime | null {
  const subjectLines = subject.length > 0 ? [subject] : [];
  const lines = [...subjectLines, ...bodyLines];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const nextLines = lines.slice(index + 1, index + 3);
    for (const candidate of collectTimeCandidates(line, nextLines)) {
      const sanitized = sanitizeCandidate(candidate);
      if (sanitized.length === 0) continue;

      // ⚠️ parseDueText 的 RangeError 只可能来自非法 timeZone / 非法 now —— 这是配置错误，
      // 必须抛出而不是静默跳过（静默会把"整站时间都错 8 小时"藏起来）。
      const startsAt = parseDueText(sanitized, receivedAt, timeZone);
      if (startsAt !== null) {
        return { startsAt, matchedText: candidate.trim(), fromSubject: index < subjectLines.length };
      }
    }
  }

  return null;
}

/**
 * 收集一行里所有可能的时间片段（按"完整日期+时间 → 日期+下一行时间"排序）。
 *
 * 只做切分，不做解析；同一个片段可能被不同正则重复命中，用 `push` 去重。
 */
function collectTimeCandidates(line: string, nextLines: readonly string[]): string[] {
  const candidates: string[] = [];
  const push = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed.length > 0 && !candidates.includes(trimmed)) candidates.push(trimmed);
  };

  for (const pattern of FULL_DATE_TIME_PATTERNS) {
    for (const match of line.matchAll(pattern)) push(match[0]);
  }

  // 日期在上一行、时间在下一行：`Date: Oct 21, 2026` + `Time: 3:30 PM`
  for (const pattern of DATE_ONLY_PATTERNS) {
    for (const dateMatch of line.matchAll(pattern)) {
      const dateText = dateMatch[0];
      const dateEnd = (dateMatch.index ?? 0) + dateText.length;

      const sameLineTime = firstTime(line.slice(dateEnd));
      if (sameLineTime !== null) push(`${dateText} ${sameLineTime}`);

      for (const nextLine of nextLines) {
        // 下一行自己带日期时不要拼：那多半是另一场活动
        if (hasDate(nextLine)) break;
        const nextTime = firstTime(nextLine);
        if (nextTime !== null) {
          push(`${dateText} ${nextTime}`);
          break;
        }
      }
    }
  }

  return candidates;
}

function firstTime(text: string): string | null {
  const match = TIME_ONLY.exec(text);
  return match?.[1]?.trim() ?? null;
}

function hasDate(text: string): boolean {
  return DATE_ONLY_PATTERNS.some((pattern) => new RegExp(pattern.source, pattern.flags).test(text));
}

/**
 * 把切出来的时间片段清洗成 `parseDueText` 认识的形式。
 *
 * 只做**无损**变换：去星期括注、把"下午2:00"换成 14:00。
 * 带 `CST` / `(UTC+8)` 这类歧义时区的文本**不剥离** —— 剥离会把错误时间当成正确时间，
 * 让 `parseDueText` 返回 `null` 才是正确行为。
 */
function sanitizeCandidate(raw: string): string {
  let text = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();

  // (周二) / (星期二)
  text = text.replace(/\s*[（(]\s*(?:周|星期)[一二三四五六日天]\s*[)）]\s*/g, ' ');
  // 不带括号的 "周二"
  text = text.replace(/\s*(?:周|星期)[一二三四五六日天]\s*/g, ' ');
  // (Tue) / (Tuesday)
  text = text.replace(
    /\s*[（(]\s*(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?\s*[)）]\s*/gi,
    ' ',
  );

  text = applyChineseMeridiem(text);
  text = text.replace(/^(?:date|time|日期|时间)\s*[:：]\s*/i, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

/** 下午2:00 → 14:00；上午12:00 → 00:00；中午12:00 → 12:00 */
function applyChineseMeridiem(text: string): string {
  return text.replace(
    /(上午|早上|下午|晚上|中午)\s*(\d{1,2}):(\d{2})/g,
    (_all, period: string, hourText: string, minuteText: string) => {
      let hour = Number(hourText);
      if (period === '下午' || period === '晚上') {
        if (hour < 12) hour += 12;
      } else if (period === '中午') {
        if (hour < 11) hour += 12;
      } else if (hour === 12) {
        hour = 0;
      }
      return `${String(hour).padStart(2, '0')}:${minuteText}`;
    },
  );
}

/* ------------------------------------------------------------------ *
 * 标题
 * ------------------------------------------------------------------ */

function extractTitle(subject: string, bodyLines: readonly string[], kind: MailEventKind): string | null {
  const cleaned = cleanSubject(subject);
  if (cleaned.length > 0 && !isGenericTitle(cleaned)) return clampTitle(cleaned);

  const fromBody = findBodyTitle(bodyLines, kind);
  if (fromBody !== null) return clampTitle(fromBody);

  if (cleaned.length > 0) return clampTitle(cleaned);
  const fallback = KIND_LABEL[kind];
  return fallback.length > 0 ? fallback : null;
}

function cleanSubject(raw: string): string {
  let title = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();

  // Re: / Fwd: / 回复: / 转发:（可能叠加多层）
  for (let index = 0; index < 4; index += 1) {
    const next = title.replace(/^(?:re|fw|fwd|回复|转发)\s*[:：]\s*/i, '').trim();
    if (next === title) break;
    title = next;
  }

  // 开头标签：`[Seminar]` / `【讲座】`（可能叠加）
  title = title.replace(/^(?:(?:\[[^\]]{1,24}\]|【[^】]{1,24}】)\s*)+/g, '');

  // 类型前缀：`讲座：` / `Lecture: ` / `会议通知：`
  title = title.replace(
    /^(?:(?:讲座|会议|宣讲会|seminar|lecture|meeting|conference|invitation|invite)\s*[:：|-]\s*)+/i,
    '',
  );
  title = title.replace(/^(?:(?:讲座|会议|宣讲会)?通知|邀请函|邀请|通知|公告)\s*[:：|-]\s*/i, '');

  return title.replace(/\s+/g, ' ').trim();
}

function findBodyTitle(bodyLines: readonly string[], kind: MailEventKind): string | null {
  const keyword = KEYWORD_BY_KIND[kind];

  for (const line of bodyLines) {
    if (line.length < 3 || line.length > 200) continue;
    if (!keyword.test(line)) continue;
    if (isGenericTitle(line)) continue;
    const cleaned = cleanBodyLine(line);
    if (cleaned.length >= 3 && !isGenericTitle(cleaned) && !isSalutation(cleaned)) return cleaned;
  }

  for (const line of bodyLines) {
    if (line.length < 3 || line.length > 200) continue;
    if (isSalutation(line) || LABEL_LINE.test(line)) continue;
    const cleaned = cleanBodyLine(line);
    if (cleaned.length >= 3) return cleaned;
  }

  return null;
}

function cleanBodyLine(line: string): string {
  return line
    .replace(/^(?:(?:讲座|会议|活动)?(?:题目|主题|名称)|title|topic)\s*[:：]\s*/i, '')
    .replace(/[。；;，,]+$/, '')
    .trim();
}

function isGenericTitle(value: string): boolean {
  return /^(?:通知|公告|活动|活动通知|讲座通知|会议通知|邀请|邀请函|invitation|event|announcement|reminder|newsletter|seminar|lecture|meeting|conference|info(?:rmation)? session)$/i.test(
    value.replace(/\s+/g, ' ').trim(),
  );
}

function isSalutation(value: string): boolean {
  return /^(?:各位|尊敬的|亲爱的|dear|hello|hi|老师们|同学们|all)\b/i.test(value) || /[:：]$/.test(value);
}

function clampTitle(value: string): string {
  return value.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

/* ------------------------------------------------------------------ *
 * 地点 / 主办方
 * ------------------------------------------------------------------ */

function extractLocation(subject: string, bodyLines: readonly string[]): string | null {
  const match = LOCATION_LABEL.exec([subject, ...bodyLines].join('\n'));
  return match === null ? null : cleanLabelValue(match[1] ?? '');
}

function extractOrganizer(subject: string, bodyLines: readonly string[]): string | null {
  const text = [subject, ...bodyLines].join('\n');
  const label = ORGANIZER_LABEL.exec(text);
  if (label !== null) return cleanLabelValue(label[1] ?? '');

  const english = ORGANIZER_EN.exec(text);
  return english === null ? null : cleanLabelValue(english[1] ?? '');
}

function cleanLabelValue(raw: string): string | null {
  let value = raw
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[。；;，,]+$/, '')
    .trim();

  // 同一行里还有下一个字段：`地点：图书馆 302 主办：学院`
  const nextField = /(?:时间|日期|地点|地址|主办|承办|组织|讲者|演讲者|speaker|time|date|location|venue|organizer|host)\s*[:：]/i.exec(
    value,
  );
  if (nextField !== null && nextField.index > 0) {
    value = value.slice(0, nextField.index).trim();
  }

  if (value.length === 0) return null;
  return value.slice(0, 120);
}

/* ------------------------------------------------------------------ *
 * 置信度
 * ------------------------------------------------------------------ */

function scoreConfidence(
  subject: string,
  bodyLines: readonly string[],
  time: FoundTime,
  location: string | null,
  organizer: string | null,
): number {
  let score = 0.55;
  if (detectMailEventKind(subject) !== null) score += 0.1;
  if (detectMailEventKind(bodyLines.join('\n')) !== null) score += 0.05;
  if (time.fromSubject) score += 0.1;
  if (location !== null) score += 0.05;
  if (organizer !== null) score += 0.05;
  return Math.min(0.95, Math.round(score * 100) / 100);
}

/* ------------------------------------------------------------------ *
 * 文本归一化
 * ------------------------------------------------------------------ */

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .trim();
}

function splitLines(body: string): string[] {
  return normalizeText(body)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0);
}
