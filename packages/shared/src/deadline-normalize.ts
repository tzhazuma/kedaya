/**
 * 统一课程 DDL · 归一化纯函数
 *
 * ## 这个文件里最重要的东西是时区
 *
 * 各平台的日期文本分三类，处理方式完全不同：
 *
 * | 形态 | 例子 | 处理 |
 * | --- | --- | --- |
 * | 已含偏移的 ISO | `2026-10-20T23:59:00+08:00` | 直接用 |
 * | 无时区的本地字面时间 | `Oct 20, 2026 11:59 PM`、`2026-10-20 23:59` | **必须按 Asia/Shanghai 解释** |
 * | 相对时间 | `Due in 3 days` | 需要 `now` 作基准 |
 *
 * ⚠️ **错误做法**：`new Date('2026-10-20 23:59')`。
 * 这会按**运行环境**的时区解释 —— 学生在伦敦访问时，
 * 上海时间 23:59 的作业会被算成伦敦时间 23:59，**晚 8 小时**才发现要交。
 *
 * 正确做法：把字面时间 + 学校时区偏移**显式拼成带偏移的 ISO**，
 * 再交给 `Date` 解析。这样结果在任何运行环境下都一致。
 */

import {
  CAMPUS_UTC_OFFSET_MINUTES,
  DEADLINE_DEDUPE_TOLERANCE_MS,
  DEADLINE_TITLE_DEDUPE_MAX,
  type DeadlineItem,
  type DeadlineSource,
  type DeadlineSummary,
} from '@kedaya/contracts';

/* ------------------------------------------------------------------ *
 * 时区工具
 * ------------------------------------------------------------------ */

/** 把"学校时区的字面时间"转成绝对时刻的 ISO 串 */
function localCampusToIso(
  year: number,
  month1: number,
  day: number,
  hour: number,
  minute: number,
): string | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month1) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    return null;
  }
  if (month1 < 1 || month1 > 12 || day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  // 先按 UTC 构造出"字面时间"的毫秒数，再减去学校时区偏移
  const asUtc = Date.UTC(year, month1 - 1, day, hour, minute, 0, 0);
  // 用 Date.UTC 的结果反查，能发现 2 月 30 日这类溢出（它会被滚动到下个月）
  const probe = new Date(asUtc);
  if (probe.getUTCMonth() !== month1 - 1 || probe.getUTCDate() !== day) return null;

  const absolute = asUtc - CAMPUS_UTC_OFFSET_MINUTES * 60 * 1000;
  return new Date(absolute).toISOString();
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/** `11:59 PM` / `23:59` → `{hour, minute}` */
function parseClock(raw: string): { hour: number; minute: number } | null {
  const m = /(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/.exec(raw);
  if (m === null) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const meridiem = m[3]?.toLowerCase();

  if (meridiem !== undefined) {
    if (hour < 1 || hour > 12) return null;
    // 12 AM = 0 点，12 PM = 12 点
    if (meridiem === 'am') hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/**
 * 解析各平台的截止日期文本。
 *
 * 支持的形态（按真实平台观察到的写）：
 * - `2026-10-20T23:59:00+08:00` / `2026-10-20T15:59:00Z`（已含偏移，直接用）
 * - `2026-10-20 23:59` / `2026-10-20`（按学校时区）
 * - `Oct 20, 2026 11:59 PM`（Blackboard 风格）
 * - `10月20日 23:59`（中文平台）
 * - `Due in 3 days` / `3 天后截止`（相对）
 *
 * @param raw  平台原始文本
 * @param now  基准时刻（相对时间用；也用于判断年份缺省）
 * @returns ISO 串；**认不出返回 `null`**，绝不猜
 */
export function parseDueText(raw: string, now: Date = new Date()): string | null {
  const text = raw.trim();
  if (text.length === 0) return null;

  // ---- 1) 已含偏移或 Z 的 ISO：直接用 ----
  // 注意：不能只判断 `Date.parse` 是否成功 —— `2026-10-20` 也会成功，
  // 但它没有时区信息，会按运行环境解释。所以要**显式**要求有偏移。
  if (/T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:?\d{2})\s*$/.test(text)) {
    const ms = Date.parse(text);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }

  // ---- 2) `YYYY-MM-DD[ HH:mm]`（无偏移 → 学校时区） ----
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(text);
  if (iso !== null) {
    const time = parseClock(`${iso[4] ?? '23'}:${iso[5] ?? '59'}`);
    if (time === null) return null;
    return localCampusToIso(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      time.hour,
      time.minute,
    );
  }

  // ---- 3) `Oct 20, 2026 11:59 PM`（Blackboard） ----
  const en = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:[ ,]+(\d{1,2}:\d{2}\s*[AaPp]?[Mm]?))?/.exec(
    text,
  );
  if (en !== null) {
    const month = MONTHS[(en[1] ?? '').toLowerCase()];
    if (month !== undefined) {
      const time = parseClock(en[4] ?? '23:59');
      if (time === null) return null;
      return localCampusToIso(Number(en[3]), month, Number(en[2]), time.hour, time.minute);
    }
  }

  // ---- 4) `10月20日 23:59`（中文） ----
  const zh = /(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2}):(\d{2}))?/.exec(text);
  if (zh !== null) {
    const yearMatch = /(\d{4})\s*年/.exec(text);
    const year = yearMatch !== null ? Number(yearMatch[1]) : now.getUTCFullYear();
    const time = parseClock(zh[3] !== undefined ? `${zh[3]}:${zh[4]}` : '23:59');
    if (time === null) return null;
    return localCampusToIso(year, Number(zh[1]), Number(zh[2]), time.hour, time.minute);
  }

  // ---- 5) 相对时间 ----
  const relEn = /(?:due\s+)?in\s+(\d+)\s*(day|days|hour|hours|week|weeks)/i.exec(text);
  if (relEn !== null) {
    const n = Number(relEn[1]);
    const unit = (relEn[2] ?? '').toLowerCase();
    const ms =
      unit.startsWith('day') ? n * 86_400_000
      : unit.startsWith('hour') ? n * 3_600_000
      : n * 7 * 86_400_000;
    return new Date(now.getTime() + ms).toISOString();
  }
  const relZh = /(\d+)\s*(天|小时|周|星期)\s*后/.exec(text);
  if (relZh !== null) {
    const n = Number(relZh[1]);
    const unit = relZh[2] ?? '';
    const ms =
      unit === '天' ? n * 86_400_000
      : unit === '小时' ? n * 3_600_000
      : n * 7 * 86_400_000;
    return new Date(now.getTime() + ms).toISOString();
  }

  // 认不出 —— **不猜**
  return null;
}

/* ------------------------------------------------------------------ *
 * 去重合并
 * ------------------------------------------------------------------ */

/** 标题归一：去空白、转小写、截断 */
function normalizeTitle(title: string): string {
  const compact = title.replace(/\s+/g, ' ').trim().toLowerCase();
  return compact.length > DEADLINE_TITLE_DEDUPE_MAX
    ? compact.slice(0, DEADLINE_TITLE_DEDUPE_MAX)
    : compact;
}

/** 来源优先级：越靠前越权威（用于选主来源） */
const SOURCE_PRIORITY: readonly DeadlineSource[] = [
  'manual',
  'blackboard',
  'gradescope',
  'ecourse',
  'piazza',
];

function pickPrimarySource(sources: readonly DeadlineSource[]): DeadlineSource {
  for (const candidate of SOURCE_PRIORITY) {
    if (sources.includes(candidate)) return candidate;
  }
  return sources[0] ?? 'manual';
}

/**
 * 跨平台去重合并。
 *
 * 判重依据：**同课程 + 归一后标题相同 + 截止时刻在容差内**（默认 5 分钟）。
 * 三条都满足才算同一条 —— 只靠标题会让"Homework 1"在五门课里被合成一条。
 *
 * 合并后：
 * - `sources` 记下全部来源
 * - 取**优先级最高**的来源作为 `source`
 * - 任一来源标了 `submitted` 就算已提交（学生可能只在一个平台上提交）
 * - `weightPercent` 取第一个非空值
 */
export function mergeDeadlines(items: readonly DeadlineItem[]): DeadlineItem[] {
  const groups: DeadlineItem[][] = [];

  for (const item of items) {
    const titleKey = normalizeTitle(item.title);
    const dueMs = item.dueAt === null ? null : Date.parse(item.dueAt);

    const existing = groups.find((group) => {
      const head = group[0];
      if (head === undefined) return false;
      if ((head.courseId ?? '') !== (item.courseId ?? '')) return false;
      if (normalizeTitle(head.title) !== titleKey) return false;

      const headMs = head.dueAt === null ? null : Date.parse(head.dueAt);
      if (headMs === null || dueMs === null) return head.dueAt === item.dueAt;
      return Math.abs(headMs - dueMs) <= DEADLINE_DEDUPE_TOLERANCE_MS;
    });

    if (existing !== undefined) existing.push(item);
    else groups.push([item]);
  }

  return groups.map((group) => {
    const head = group[0] as DeadlineItem;
    const sources = [...new Set(group.flatMap((g) => g.sources))];
    const weight = group.find((g) => g.weightPercent !== undefined)?.weightPercent;

    return {
      ...head,
      sources,
      source: pickPrimarySource(sources),
      submitted: group.some((g) => g.submitted),
      // 空值省略键，不下发 undefined
      ...(weight !== undefined ? { weightPercent: weight } : {}),
    };
  });
}

/* ------------------------------------------------------------------ *
 * 排序与汇总
 * ------------------------------------------------------------------ */

/** 紧迫度分档：越小越紧 */
function urgencyRank(dueMs: number, now: Date): number {
  const delta = dueMs - now.getTime();
  if (delta < 0) return 0; // 已逾期
  if (delta < 86_400_000) return 1; // 今天内
  if (delta < 7 * 86_400_000) return 2; // 本周内
  return 3;
}

/**
 * 按紧急度排序：已逾期 → 今天 → 本周 → 更远。
 * 同档内按截止时刻升序；无截止时刻的排最后（它们是"待补充"，不该抢占注意力）。
 */
export function sortByUrgency(items: readonly DeadlineItem[], now: Date = new Date()): DeadlineItem[] {
  return [...items].sort((a, b) => {
    const aMs = a.dueAt === null ? null : Date.parse(a.dueAt);
    const bMs = b.dueAt === null ? null : Date.parse(b.dueAt);

    if (aMs === null && bMs === null) return a.title.localeCompare(b.title);
    if (aMs === null) return 1;
    if (bMs === null) return -1;

    // 已提交的沉到同档末尾
    if (a.submitted !== b.submitted) return a.submitted ? 1 : -1;

    const rankDiff = urgencyRank(aMs, now) - urgencyRank(bMs, now);
    return rankDiff !== 0 ? rankDiff : aMs - bMs;
  });
}

/** 首页汇总。已提交的不计入"待办"。 */
export function summarizeDeadlines(
  items: readonly DeadlineItem[],
  now: Date = new Date(),
): DeadlineSummary {
  let overdue = 0;
  let dueToday = 0;
  let dueThisWeek = 0;
  let total = 0;

  const todayEnd = (() => {
    const d = new Date(now.getTime() + 8 * 3_600_000); // 学校时区的"今天"
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime() - 8 * 3_600_000 + 86_400_000;
  })();

  for (const item of items) {
    if (item.dueAt === null) continue;
    const dueMs = Date.parse(item.dueAt);
    if (Number.isNaN(dueMs)) continue;

    total += 1;
    if (item.submitted) continue;

    if (dueMs < now.getTime()) overdue += 1;
    else if (dueMs < todayEnd) dueToday += 1;
    else if (dueMs < now.getTime() + 7 * 86_400_000) dueThisWeek += 1;
  }

  return { overdue, dueToday, dueThisWeek, total };
}
