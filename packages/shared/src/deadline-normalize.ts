/**
 * 课程 DDL 归一化 · 纯函数（三端共用）
 *
 * 用户诉求：「抓取 gradescope、blackboard、ecourse e云平台、piazza 等的信息
 * 来统一给出课程 ddl」。本文件负责其中**不碰网络**的那一半：
 * 把各平台五花八门的日期文本转成绝对时刻、跨平台去重、排序、汇总。
 *
 * ## 本模块的边界（写死在代码里，不是建议）
 *
 * 1. **不做任何网络请求**。采集端是独立的事（浏览器扩展 / 用户粘贴），
 *    它有自己的登录态、验证码、DOM 选择器要维护。这里只接收**已经抓到的文本**，
 *    所以它是纯函数、可在三端任意运行、可用固定时间做确定性测试。
 * 2. **不存任何平台凭据**。参数里没有 token / cookie / 密码，也不会有。
 * 3. **采集失败时不清空**。这是采集端的责任：保留上一次成功的结果并标 `stale: true`。
 *    本模块的所有函数都不认识「失败」，只认识条目 —— 不提供任何「清空」路径。
 * 4. **认不出就 `null`，不猜**。`parseDueText` 只认下面列出的写死格式；
 *    带 `CST`/`PST` 这类**有歧义**的时区缩写、缺时间的纯日期、`TBD` 一律返回 `null`，
 *    由调用方决定「丢弃」还是「让用户手填」。
 *
 * ## 时区：这里唯一一个「写错了不会报错、但学生会被扣分」的地方
 *
 * 各平台的时间文本分三类：
 *
 * | 形态 | 例子 | 处理 |
 * | --- | --- | --- |
 * | 已含偏移 | `2026-10-20T23:59:00+08:00`、`...Z` | 直接按绝对时刻 |
 * | 无偏移的字面时间 | `Oct 20, 2026 11:59 PM`、`2026-10-20 23:59`、`10月20日 23:59` | **按调用方显式传入的学校时区解释** |
 * | 相对时间 | `Due in 3 days` | 以 `now` 为基准 |
 *
 * ⚠️ **错误做法**：`new Date('2026-10-20 23:59')`。它会按**运行环境**时区解释 ——
 * 学生在伦敦打开浏览器时，上海时间 23:59 的作业会被算成伦敦 23:59，
 * 直接晚 8 小时。所以本模块**没有任何地方调用不带时区的 `new Date(string)`**：
 * 无偏移文本一定走 `wallClockToEpochMs()`（基于 `Intl.DateTimeFormat` 的 IANA 时区换算）。
 *
 * `parseDueText` 的 `timeZone` 是**必传参数**（没有默认值），这是刻意的：
 * 默认值会让调用方以为「不传也行」，而这类 bug 在 UTC 的 CI 上永远测不出来。
 *
 * ## 与 `@kedaya/contracts` 的关系
 *
 * `DeadlineItemLike` / `MergedDeadlineItem` 与契约的 `DeadlineItem` 逐字段一致。
 * 本包按设计**零依赖**（不 import 任何 workspace 包），所以这里用结构类型接收，
 * 而不是 `import type`。**改契约字段必须同步改这里。**
 */

/* ------------------------------------------------------------------ *
 * 类型（结构对齐 @kedaya/contracts 的 DeadlineItem）
 * ------------------------------------------------------------------ */

/** 平台来源。与契约 `DeadlineSource` 一致 */
export type DeadlineSource = 'blackboard' | 'gradescope' | 'piazza' | 'ecourse' | 'manual';

/** 截止类型。与契约 `DeadlineKind` 一致 */
export type DeadlineKind = 'assignment' | 'quiz' | 'exam' | 'project' | 'reading' | 'other';

/** 单条 DDL。与契约 `DeadlineItem` 逐字段一致 */
export interface DeadlineItemLike {
  readonly id: string;
  readonly source: DeadlineSource;
  readonly kind: DeadlineKind;
  readonly title: string;
  readonly courseId: string;
  readonly courseName: string;
  readonly dueAt: string;
  readonly dueAtRaw: string;
  readonly sourceUrl: string;
  readonly submitted: boolean;
  readonly weight: number | null;
  readonly stale?: boolean;
}

/** 合并后的一行：`sources` 记录全部来源（按优先级排序，去重） */
export interface MergedDeadlineItem extends DeadlineItemLike {
  readonly sources: readonly DeadlineSource[];
}

/** 首页汇总。已提交的条目计入 `total`，但不计入任何待办分档 */
export interface DeadlineSummary {
  readonly overdue: number;
  readonly dueToday: number;
  readonly dueThisWeek: number;
  readonly total: number;
}

/** 紧迫度分档。`done` = 已提交；`unknown` = 截止时刻无法解析（不该发生，兜底用） */
export type DeadlineUrgency = 'overdue' | 'today' | 'thisWeek' | 'later' | 'done' | 'unknown';

/**
 * 上科大张江校区时区（无夏令时，恒 +8）。
 *
 * 只在 `sortByUrgency` / `summarizeDeadlines` / `deadlineUrgency` 的**可选**参数
 * 里做默认值；`parseDueText` 没有默认值，必须显式传。
 */
export const DEFAULT_SCHOOL_TIME_ZONE = 'Asia/Shanghai';

/** 判重容差：截止时刻相差 ≤ 5 分钟视为同一时刻 */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

/** 一天毫秒数（仅用于 UTC 探针，不用于「按天」边界计算） */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 来源优先级：越靠前越权威（用于合并后选 `source` 与 `weight` 兜底） */
const SOURCE_PRIORITY: readonly DeadlineSource[] = [
  'blackboard',
  'gradescope',
  'ecourse',
  'piazza',
  'manual',
];

/* ------------------------------------------------------------------ *
 * 时区换算（IANA，不依赖运行环境本地时区）
 * ------------------------------------------------------------------ */

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

/**
 * 取得某 IANA 时区的 formatter。
 *
 * 非法时区名（拼错 / 空串）会抛 `RangeError` —— 这是**配置错误**，
 * 静默回退到本地时区只会制造上面说的 8 小时事故。
 */
function requireFormatter(timeZone: string): Intl.DateTimeFormat {
  if (typeof timeZone !== 'string' || timeZone.trim().length === 0) {
    throw new RangeError('deadline-normalize: timeZone 必须显式传入 IANA 时区名（如 Asia/Shanghai）');
  }
  const cached = formatterCache.get(timeZone);
  if (cached !== undefined) return cached;

  // 非法时区在这里抛 RangeError（Node 与浏览器行为一致）
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/** 某一绝对时刻在指定时区的「墙上时间」 */
function wallClockAt(epochMs: number, timeZone: string): WallClock {
  const parts = requireFormatter(timeZone).formatToParts(new Date(epochMs));
  const pick = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) {
      throw new RangeError(`deadline-normalize: 无法从 Intl 取得 ${type}（时区 ${timeZone}）`);
    }
    return Number(part.value);
  };
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
  };
}

/** 构造并校验墙上时间（拒绝 2 月 30 日这类会被 Date 静默进位的值） */
function makeWallClock(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): WallClock | null {
  const numbers = [year, month, day, hour, minute, second];
  if (!numbers.every((value) => Number.isInteger(value))) return null;
  if (year < 1000 || year > 9999) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;

  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

/** 某绝对时刻在指定时区的 UTC 偏移（毫秒，东八区 = +28_800_000） */
function offsetMsAt(epochMs: number, timeZone: string): number {
  const wall = wallClockAt(epochMs, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/**
 * 墙上时间 → 绝对时刻。
 *
 * 用「该时刻前后各 24 小时的偏移」作为候选，逐个验证往返一致：
 *   · 命中 1 个：正常；
 *   · 命中 0 个：夏令时「春季跳表」里不存在的时刻（如纽约 2026-03-08 02:30）→ `null`；
 *   · 命中 2 个：夏令时「秋季回拨」里重复的时刻（如纽约 2026-11-01 01:30）
 *     → 取**较早**的一次（同一墙上时间出现两次时，先到的那次才是真实截止）。
 *
 * 上海 1991 年后无夏令时，但本函数仍按 IANA 规则处理 —— 学校的交换项目、
 * 用户自定义时区、以及未来换城市都不该让这里出错。
 */
function wallClockToEpochMs(wall: WallClock, timeZone: string): number | null {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const offsets = new Set<number>();
  for (const probe of [asUtc - DAY_MS, asUtc + DAY_MS]) {
    offsets.add(offsetMsAt(probe, timeZone));
  }

  const matches: number[] = [];
  for (const offset of offsets) {
    const candidate = asUtc - offset;
    if (offsetMsAt(candidate, timeZone) === offset) matches.push(candidate);
  }

  if (matches.length === 0) return null;
  return Math.min(...matches);
}

/** 墙上时间 → ISO 串；非法/不存在返回 `null` */
function wallClockToIso(wall: WallClock, timeZone: string): string | null {
  const epochMs = wallClockToEpochMs(wall, timeZone);
  return epochMs === null ? null : new Date(epochMs).toISOString();
}

/** 指定时区里「这一天的开始」；夏令时把 00:00 跳掉时顺延到第一个存在的整点 */
function resolveDayStart(year: number, month: number, day: number, timeZone: string): number {
  for (let hour = 0; hour <= 3; hour += 1) {
    const wall = makeWallClock(year, month, day, hour, 0, 0);
    if (wall === null) break;
    const epochMs = wallClockToEpochMs(wall, timeZone);
    if (epochMs !== null) return epochMs;
  }
  throw new RangeError(
    `deadline-normalize: 无法确定 ${year}-${month}-${day} 在 ${timeZone} 的开始时刻`,
  );
}

/** 指定时区里某时刻所在自然日的开始 */
function startOfDayMs(epochMs: number, timeZone: string): number {
  const wall = wallClockAt(epochMs, timeZone);
  return resolveDayStart(wall.year, wall.month, wall.day, timeZone);
}

/** 从「某天开始」往后推 N 个自然日（按日历推，不是加 N×24h） */
function addCalendarDays(dayStartMs: number, days: number, timeZone: string): number {
  const wall = wallClockAt(dayStartMs, timeZone);
  const shifted = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days));
  return resolveDayStart(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), timeZone);
}

/* ------------------------------------------------------------------ *
 * 文本解析
 * ------------------------------------------------------------------ */

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

interface Clock {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** `11:59 PM` / `23:59` / `23:59:30` → 24 小时制 */
function parseClock(
  hourText: string,
  minuteText: string,
  secondText: string | undefined,
  meridiem: string | undefined,
): Clock | null {
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = secondText === undefined ? 0 : Number(secondText);

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || !Number.isInteger(second)) return null;
  if (minute < 0 || minute > 59 || second < 0 || second > 59) return null;

  let normalizedHour = hour;
  if (meridiem !== undefined) {
    // 12 小时制：1–12；12 AM = 0 点，12 PM = 12 点
    if (hour < 1 || hour > 12) return null;
    const isPm = meridiem.toLowerCase() === 'pm';
    normalizedHour = hour === 12 ? (isPm ? 12 : 0) : isPm ? hour + 12 : hour;
  }
  if (normalizedHour < 0 || normalizedHour > 23) return null;

  return { hour: normalizedHour, minute, second };
}

/** 去掉各平台爱加的「Due / 截止时间 / DDL」前缀，保留有意义的正文 */
function stripDuePrefix(text: string): string {
  return text
    .replace(/^(?:截止(?:时间|日期)?|ddl)\s*[:：]\s*/i, '')
    .replace(/^due\s*[:：]\s*/i, '')
    .replace(/^due\s+(?!in\b)/i, '')
    .trim();
}

/** `Z` / `UTC` / `GMT` / `+08:00` / `+0800` → 偏移分钟；认不出返回 `null` */
function parseOffsetMinutes(token: string): number | null {
  if (/^(?:z|utc|gmt)$/i.test(token)) return 0;
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(token);
  if (match === null) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 23 || minutes > 59) return null;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (hours * 60 + minutes);
}

/**
 * 缺年份时的推断规则（只用于 `10月20日 23:59`、`Oct 20 11:59 PM` 这类**没有年份**的文本）：
 *
 * 取**从现在起最近的一次**该月日；如果今年的那一天已经过去，就顺延到明年。
 * 这不是「猜时间」—— 时间（时:分）来自原文，缺的只是年份，而 DDL 语义上
 * 只会指向未来。若今年是 2 月 29 日而目标年不闰年，返回 `null`（不替用户选闰年）。
 */
function resolveWithoutYear(
  month: number,
  day: number,
  clock: Clock,
  now: Date,
  timeZone: string,
): string | null {
  const nowMs = now.getTime();
  const nowWall = wallClockAt(nowMs, timeZone);
  for (const year of [nowWall.year, nowWall.year + 1]) {
    const wall = makeWallClock(year, month, day, clock.hour, clock.minute, clock.second);
    if (wall === null) continue;
    const epochMs = wallClockToEpochMs(wall, timeZone);
    if (epochMs !== null && epochMs >= nowMs) return new Date(epochMs).toISOString();
  }
  return null;
}

/** 英文月份日期：`Oct 20, 2026 11:59 PM` / `October 20 2026 23:59`（年份可选） */
const ENGLISH_DATE =
  /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})?(?:\s*,?\s*(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?)?$/i;

/** ISO 日期：`2026-10-20 23:59` / `2026-10-20T23:59:00+08:00` */
const ISO_DATE =
  /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,6})?(?:\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2}))?$/i;

/** 中文日期：`2026年10月20日 23:59` / `10月20日 23:59` / `10月20号 23:59` */
const CHINESE_FULL =
  /^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号](?:\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*)?$/;
const CHINESE_SHORT =
  /^(\d{1,2})\s*月\s*(\d{1,2})\s*[日号](?:\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*)?$/;

/** 相对时间：`Due in 3 days` / `in 2 hours` / `3 天后截止` */
const RELATIVE_EN = /^(?:due\s+)?in\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)$/i;
const RELATIVE_ZH = /^(\d+)\s*(分钟|小时|天|周|星期)\s*后(?:截止)?$/;

/**
 * 解析各平台的截止日期文本，返回**绝对时刻** ISO 串。
 *
 * 支持的写法（写死在这里，新增写法必须同时补测试）：
 *
 * - 带偏移 / `Z`：`2026-10-20T23:59:00+08:00`、`2026-10-20T15:59:00Z`、`2026-10-20 23:59 UTC`
 * - 无偏移：`2026-10-20 23:59`、`2026-10-20T23:59`（按 `timeZone` 解释）
 * - Blackboard：`Oct 20, 2026 11:59 PM`、`Oct 20 2026 23:59`
 * - 中文：`2026年10月20日 23:59`、`10月20日 23:59`、`10月20号 23:59`
 * - 相对：`Due in 3 days`、`in 2 hours`、`3 天后截止`、`2 小时后`
 *
 * **不猜**的输入（返回 `null`）：空串、`TBD`、缺时间的纯日期（如 `2026-10-20`）、
 * 带歧义时区缩写（`... 11:59 PM CST`）、非法日期（`2026-02-30`、`2026-13-01`）、
 * 夏令时里不存在的墙上时间。
 *
 * ⚠️ 相对时间按「`now` + N×24h / N×1h」计算，是**精确保留平台倒计时给出的时长**；
 * 平台若把 3 天 4 小时显示成「3 days」，真实时刻会比本结果更晚。
 *
 * @param raw      平台原始文本
 * @param now      基准时刻（相对时间与缺年份推断用）
 * @param timeZone **必传**的 IANA 学校时区（如 `Asia/Shanghai`）；非法值抛 `RangeError`
 * @returns ISO-8601 UTC 串；认不出返回 `null`
 */
export function parseDueText(raw: string, now: Date, timeZone: string): string | null {
  if (typeof raw !== 'string') return null;
  requireFormatter(timeZone);
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new RangeError('deadline-normalize: now 必须是有效的 Date');
  }

  const text = stripDuePrefix(
    raw
      .replace(/[\u00a0\u3000]/g, ' ')
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  if (text.length === 0) return null;

  // ---- 1) ISO（可能带偏移） ----
  const iso = ISO_DATE.exec(text);
  if (iso !== null) {
    const clock = parseClock(iso[4] ?? '', iso[5] ?? '', iso[6], undefined);
    if (clock === null) return null;
    const wall = makeWallClock(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      clock.hour,
      clock.minute,
      clock.second,
    );
    if (wall === null) return null;

    const offsetToken = iso[7];
    if (offsetToken === undefined) {
      return wallClockToIso(wall, timeZone);
    }
    const offsetMinutes = parseOffsetMinutes(offsetToken);
    if (offsetMinutes === null) return null;
    const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    return new Date(asUtc - offsetMinutes * 60 * 1000).toISOString();
  }

  // ---- 2) 英文月份 ----
  const english = ENGLISH_DATE.exec(text);
  if (english !== null) {
    const month = MONTHS[(english[1] ?? '').toLowerCase()];
    if (month === undefined) return null;
    const clockText = english[4];
    // 缺时间（只有日期）→ 不猜，返回 null
    if (clockText === undefined) return null;
    const clock = parseClock(clockText, english[5] ?? '', english[6], english[7]);
    if (clock === null) return null;

    const yearText = english[3];
    if (yearText === undefined) {
      return resolveWithoutYear(month, Number(english[2]), clock, now, timeZone);
    }
    const wall = makeWallClock(Number(yearText), month, Number(english[2]), clock.hour, clock.minute, clock.second);
    return wall === null ? null : wallClockToIso(wall, timeZone);
  }

  // ---- 3) 中文月份 ----
  const full = CHINESE_FULL.exec(text);
  if (full !== null) {
    // 缺时间 → 不猜
    if (full[4] === undefined) return null;
    const clock = parseClock(full[4], full[5] ?? '', full[6], undefined);
    if (clock === null) return null;
    const wall = makeWallClock(Number(full[1]), Number(full[2]), Number(full[3]), clock.hour, clock.minute, clock.second);
    return wall === null ? null : wallClockToIso(wall, timeZone);
  }

  const short = CHINESE_SHORT.exec(text);
  if (short !== null) {
    if (short[3] === undefined) return null;
    const clock = parseClock(short[3], short[4] ?? '', short[5], undefined);
    if (clock === null) return null;
    return resolveWithoutYear(Number(short[1]), Number(short[2]), clock, now, timeZone);
  }

  // ---- 4) 相对时间 ----
  const relative = RELATIVE_EN.exec(text) ?? RELATIVE_ZH.exec(text);
  if (relative !== null) {
    const amount = Number(relative[1]);
    const unit = (relative[2] ?? '').toLowerCase();
    const ms =
      unit.startsWith('min') || unit === '分钟'
        ? amount * 60 * 1000
        : unit.startsWith('h') || unit === '小时'
          ? amount * 60 * 60 * 1000
          : unit.startsWith('d') || unit === '天'
            ? amount * 24 * 60 * 60 * 1000
            : amount * 7 * 24 * 60 * 60 * 1000;
    return new Date(now.getTime() + ms).toISOString();
  }

  // ---- 5) 认不出 —— **不猜** ----
  return null;
}

/* ------------------------------------------------------------------ *
 * 去重合并
 * ------------------------------------------------------------------ */

/**
 * 标题归一化（只用于判重，不改变展示标题）。
 *
 * 做四件事：NFKC（全角→半角）→ 小写 → 去掉全部空白与分隔标点 → 保留其余字符。
 *
 * 为什么去掉空白：Blackboard 写 `Homework 1`、Gradescope 写 `Homework-1`、
 * 中文平台写 `作业 1`，这些是同一份作业。NFKC 之后 `Ａ`→`A`、`１`→`1`。
 *
 * 为什么**不**截断：截断会让 `... Part A` 与 `... Part B` 的长标题前缀相同而误合并。
 * 宁可漏合并（用户看到两条），也不要把两个不同作业合成一条（用户漏交一个）。
 */
export function normalizeDeadlineTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u200b-\u200d\ufeff]+/g, '')
    .replace(/[\-–—_/\\|:：,，.。;；!！?？'"‘’“”()（）[\]【】·•]/g, '');
}

/** 一个判重桶里的条目 + 预先解析的截止时刻 */
interface DueEntry {
  readonly item: DeadlineItemLike;
  readonly dueMs: number;
}

/**
 * 跨平台去重合并。
 *
 * ## 判重规则（三条必须同时满足）
 *
 * 1. 同 `courseId`（trim 后完全相等）；
 * 2. 同归一化标题（`normalizeDeadlineTitle` 后完全相等）；
 * 3. `dueAt` 相差 ≤ 5 分钟。分簇方式是「与簇内**第一条**比」而不是链式传递：
 *    0/4/8 分钟三条会被分成 [0,4] 与 [8]，避免一串小误差把两个不同作业串成一条。
 *
 * ## 合并后取哪条
 *
 * - `dueAt` 取簇内**最早**的一个（宁可早提醒，不可漏交）；
 * - `source` 取来源优先级最高的（`blackboard > gradescope > ecourse > piazza > manual`）——
 *   平台数据比手填更可能有回源链接；
 * - `sources` 是全部来源，按优先级排序、去重；
 * - `submitted` 任一来源为 `true` 即 `true`（学生可能只在一个平台上提交）；
 * - `weight` 取主条目；主条目为 `null` 时取优先级最高的非空值；
 * - `stale` 任一来源为 `true` 即 `true`（有任何一个平台这次没抓到，数据就不完整）。
 *
 * `dueAt` 无法解析的条目**不参与判重**（没有时间就无从判断是否同一条），
 * 原样保留在结果末尾，`sources` 记为 `[source]`。
 *
 * 纯函数：不修改入参，返回新对象。
 */
export function mergeDeadlines(items: readonly DeadlineItemLike[]): MergedDeadlineItem[] {
  const buckets = new Map<string, DueEntry[]>();
  const unparsed: DeadlineItemLike[] = [];

  for (const item of items) {
    const dueMs = Date.parse(item.dueAt);
    if (!Number.isFinite(dueMs)) {
      unparsed.push(item);
      continue;
    }
    const key = `${item.courseId.trim()}\u0000${normalizeDeadlineTitle(item.title)}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [{ item, dueMs }]);
    else bucket.push({ item, dueMs });
  }

  const merged: Array<{ dueMs: number; item: MergedDeadlineItem }> = [];

  for (const bucket of buckets.values()) {
    bucket.sort(
      (a, b) =>
        a.dueMs - b.dueMs ||
        sourceRank(a.item.source) - sourceRank(b.item.source) ||
        compareText(a.item.id, b.item.id),
    );

    let cluster: DueEntry[] = [];
    const flush = (): void => {
      if (cluster.length === 0) return;
      const mergedItem = mergeCluster(cluster);
      merged.push({ dueMs: cluster[0]?.dueMs ?? 0, item: mergedItem });
      cluster = [];
    };

    for (const entry of bucket) {
      const head = cluster[0];
      if (head !== undefined && entry.dueMs - head.dueMs > DEDUPE_WINDOW_MS) flush();
      cluster.push(entry);
    }
    flush();
  }

  merged.sort((a, b) => a.dueMs - b.dueMs || compareText(a.item.id, b.item.id));

  const result: MergedDeadlineItem[] = merged.map((entry) => entry.item);
  for (const item of [...unparsed].sort((a, b) => compareText(a.id, b.id))) {
    result.push({ ...item, sources: [item.source] });
  }
  return result;
}

/** 合并一个已排序的簇（第一条即代表） */
function mergeCluster(cluster: readonly DueEntry[]): MergedDeadlineItem {
  const primary = cluster[0]?.item;
  if (primary === undefined) {
    throw new RangeError('deadline-normalize: mergeCluster 不接受空簇');
  }

  const present = new Set(cluster.map((entry) => entry.item.source));
  const sources: DeadlineSource[] = SOURCE_PRIORITY.filter((source) => present.has(source));
  // 契约外的来源（运行时脏数据）不静默丢弃，追加在末尾便于排查
  for (const source of present) {
    if (!sources.includes(source)) sources.push(source);
  }

  const submitted = cluster.some((entry) => entry.item.submitted);
  const stale = cluster.some((entry) => entry.item.stale === true);

  let weight: number | null = primary.weight ?? null;
  if (weight === null) {
    for (const source of sources) {
      const withWeight = cluster.find(
        (entry) => entry.item.source === source && entry.item.weight != null,
      );
      if (withWeight !== undefined) {
        weight = withWeight.item.weight ?? null;
        break;
      }
    }
  }

  return {
    ...primary,
    sources,
    submitted,
    weight,
    ...(stale ? { stale: true } : {}),
  };
}

function sourceRank(source: DeadlineSource): number {
  const rank = SOURCE_PRIORITY.indexOf(source);
  return rank === -1 ? SOURCE_PRIORITY.length : rank;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ------------------------------------------------------------------ *
 * 排序与汇总
 * ------------------------------------------------------------------ */

/** 排序/汇总只需要这三个字段，便于直接消费合并结果或平台原始条目 */
export interface DeadlineTiming {
  readonly id?: string;
  readonly dueAt: string;
  readonly submitted?: boolean;
}

const URGENCY_RANK: Readonly<Record<DeadlineUrgency, number>> = {
  overdue: 0,
  today: 1,
  thisWeek: 2,
  later: 3,
  done: 4,
  unknown: 5,
};

interface TimeWindows {
  readonly nowMs: number;
  readonly todayEnd: number;
  readonly weekEnd: number;
}

/** 「今天/本周」的边界按指定时区的**自然日**算，不是 now + 24h */
function timeWindows(now: Date, timeZone: string): TimeWindows {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new RangeError('deadline-normalize: now 必须是有效的 Date');
  }
  const nowMs = now.getTime();
  const dayStart = startOfDayMs(nowMs, timeZone);
  return {
    nowMs,
    todayEnd: addCalendarDays(dayStart, 1, timeZone),
    weekEnd: addCalendarDays(dayStart, 7, timeZone),
  };
}

function classify(dueMs: number, windows: TimeWindows): DeadlineUrgency {
  if (!Number.isFinite(dueMs)) return 'unknown';
  if (dueMs < windows.nowMs) return 'overdue';
  if (dueMs < windows.todayEnd) return 'today';
  if (dueMs < windows.weekEnd) return 'thisWeek';
  return 'later';
}

/**
 * 单条的紧迫度分档。
 *
 * - `overdue`：截止时刻已过（含今天早些时候）；
 * - `today`：今天剩余时间内截止（按学校时区自然日）；
 * - `thisWeek`：明天起 6 个自然日内；
 * - `later`：更远；
 * - `unknown`：`dueAt` 无法解析（调用方不该把这种条目交给用户）。
 *
 * 已提交状态**不**在这里判断（分档是纯时间概念）；排序时已提交的会沉到 `done`。
 */
export function deadlineUrgency(
  dueAt: string,
  now: Date,
  timeZone: string = DEFAULT_SCHOOL_TIME_ZONE,
): DeadlineUrgency {
  return classify(Date.parse(dueAt), timeWindows(now, timeZone));
}

/**
 * 按紧急度排序：已逾期 → 今天 → 本周 → 更远 → 已提交 → 未知。
 *
 * 同档内按截止时刻升序；时刻相同按 id 升序，保证结果稳定（可做快照测试）。
 * 已提交的排在所有待办之后 —— 首页不该让已交的作业抢占注意力。
 * `dueAt` 无法解析的排最后（它们是「待补充」，不是「最紧急」）。
 *
 * 返回新数组，不修改入参。
 */
export function sortByUrgency<T extends DeadlineTiming>(
  items: readonly T[],
  now: Date,
  timeZone: string = DEFAULT_SCHOOL_TIME_ZONE,
): T[] {
  const windows = timeWindows(now, timeZone);

  return items
    .map((item, index) => ({
      item,
      index,
      dueMs: Date.parse(item.dueAt),
      urgency: item.submitted === true ? 'done' : classify(Date.parse(item.dueAt), windows),
    }))
    .sort((a, b) => {
      const byUrgency = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      if (byUrgency !== 0) return byUrgency;
      const aDue = Number.isFinite(a.dueMs) ? a.dueMs : Number.POSITIVE_INFINITY;
      const bDue = Number.isFinite(b.dueMs) ? b.dueMs : Number.POSITIVE_INFINITY;
      if (aDue !== bDue) return aDue - bDue;
      const byId = compareText(a.item.id ?? '', b.item.id ?? '');
      if (byId !== 0) return byId;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

/**
 * 首页汇总。
 *
 * - `overdue` / `dueToday` / `dueThisWeek`：**只统计未提交**的待办；
 * - `total`：全部条目数（含已提交、含 `dueAt` 无法解析的），
 *   客户端用 `total - overdue - dueToday - dueThisWeek` 得到「更远/已完成」的数量，
 *   所以这里必须包含所有条目，不能只算能分档的。
 *
 * 边界同样按学校时区**自然日**：北京时间周一 00:30 时，周日 23:59 截止的作业
 * 已经算逾期，而不是「本周」。
 */
export function summarizeDeadlines(
  items: readonly DeadlineTiming[],
  now: Date,
  timeZone: string = DEFAULT_SCHOOL_TIME_ZONE,
): DeadlineSummary {
  const windows = timeWindows(now, timeZone);
  let overdue = 0;
  let dueToday = 0;
  let dueThisWeek = 0;

  for (const item of items) {
    if (item.submitted === true) continue;
    const urgency = classify(Date.parse(item.dueAt), windows);
    if (urgency === 'overdue') overdue += 1;
    else if (urgency === 'today') dueToday += 1;
    else if (urgency === 'thisWeek') dueThisWeek += 1;
  }

  return { overdue, dueToday, dueThisWeek, total: items.length };
}
