/**
 * 课程 DDL · 用户粘贴解析器（三端共用）
 *
 * 用户诉求：「抓取 gradescope、blackboard、ecourse e云平台、piazza 等的信息
 * 来统一给出课程 ddl」。采集端落地时，**不走**服务端代登录、也**不**逆向平台私有 API：
 * 用户在自己的浏览器里打开 BB / Gradescope / Piazza，把作业列表文本复制出来，粘进我们的小程序/Web，
 * 本模块只负责把这段文本**解析成结构化条目**。
 *
 * 这条路为什么是干净的：
 *   · 参数里没有任何 token / cookie / 学号密码，服务端永远不会成为「存了全校密码」的目标；
 *   · 没有网络请求，所以没有 ToS 风险，也不会因为平台改 DOM 就把整条链路弄坏；
 *   · 用户是数据的主动提供者，粘什么解析什么，不碰别人的数据。
 *
 * ## 本模块做什么 / 不做什么
 *
 * **做**：把五种真实复制形态切成条目 —— Blackboard 多行列表、Gradescope 的
 * `Due Date: ... Submitted`、Piazza 带缩进和 `@` 提及的碎文本、ecourse/泛雅的
 * 中文日期、以及「CS101 作业2 下周三 23:59」这种随手记；抽出标题、截止时刻、
 * 提交状态、总评占比。
 *
 * **不做**：
 * - 不做网络请求（本包按设计零依赖、纯函数）；
 * - 不猜日期。所有绝对时刻都交给 `parseDueText`（唯一日期解析入口），认不出就放进 `unparsed`；
 * - 不伪造 `dueAt`。契约的 `DeadlineItem.dueAt` 是 `string`（见 `@kedaya/contracts`
 *   的 `deadlines.ts`），**不允许 null**；因此「标题认出来了但日期认不出」的行
 *   不会被塞进 `items` 并编一个假时间，而是连同原文进 `unparsed` 让用户手填。
 *   这正是「不静默丢弃」：用户能在 `unparsed` 里看到缺的是哪一行。
 * - 不猜标题。能从日期两侧明确切出标题就取；切不出就用整行原文作标题并写 `warning`。
 *
 * ## `unparsed` 是产品要求，不是调试信息
 *
 * 粘贴解析最坏的失败不是「少解析一条」，而是**用户以为全导进去了**。所以：
 * 每一个非空行要么变成 `items` 里的一条（或作为跨行标题被合并），要么**原样**出现在
 * `unparsed` 里并带一句人话原因。`warnings` 再把「有 N 行没解析」这类整体提示带给 UI。
 *
 * ## 幂等
 *
 * 同样的文本 + 同样的 options 解析两次，`items` / `unparsed` / `warnings` 必须**完全一致**：
 *   · 不用 `Math.random()` / `Date.now()` / 自增计数器；
 *   · `id = ddl-paste-` + `hash(source + title + dueAt)`（64 位 FNV-1a + 混合哈希，16 位十六进制）。
 * 这样跨次粘贴同一条作业得到同一个 id，上层 `mergeDeadlines` 才能正常判重。
 *
 * ## 与 `@kedaya/contracts` 的关系
 *
 * `@kedaya/shared` 是**零依赖叶子包**，不能 import `@kedaya/contracts`（否则小程序 /
 * 服务端构建会绕回去）。这里的 `DeadlineItem` 与契约逐字段一致，是**结构等价定义**；
 * 改契约字段必须同步改这里。`DeadlineSource` / `DeadlineKind` 直接复用同包的
 * `deadline-normalize` 类型，避免两套枚举漂移。
 */

import {
  parseDueText,
  type DeadlineKind,
  type DeadlineSource,
} from './deadline-normalize';

/* ------------------------------------------------------------------ *
 * 类型
 * ------------------------------------------------------------------ */

/**
 * 一条从粘贴文本解析出的 DDL。
 *
 * 与 `@kedaya/contracts` 的 `DeadlineItem` 逐字段一致（含 `stale?`，但粘贴场景不会产生
 * `stale: true` —— 它只表示「上一次采集失败，保留旧数据」）。消费者可以直接把它当
 * 契约 DTO 用，不需要再做一次映射。
 */
export interface DeadlineItem {
  /** 稳定 id（确定性哈希，见模块头「幂等」） */
  readonly id: string;
  /** 主来源：用户在 UI 上选的来源 */
  readonly source: DeadlineSource;
  /** 类型（仅展示，由标题关键词推断） */
  readonly kind: DeadlineKind;
  /** 标题（平台原文；切不出时用整行原文并写 warning） */
  readonly title: string;
  /** 课程 id：粘贴没有平台 courseId，用 `pasted:<课程名>`；未填课程名为 `pasted:unspecified` */
  readonly courseId: string;
  /** 课程名：用户可选填；未填为 `''` */
  readonly courseName: string;
  /** 截止绝对时刻，ISO-8601 UTC */
  readonly dueAt: string;
  /** 原始日期文本（`Oct 20, 2026 11:59 PM` / `2026年10月20日 23:59` / `下周三 23:59`） */
  readonly dueAtRaw: string;
  /** 回源链接：粘贴文本里若带 URL 就取，否则 `''`（不编平台地址） */
  readonly sourceUrl: string;
  /** 是否已提交。认不出时为 `false`（契约约定：未知按 false） */
  readonly submitted: boolean;
  /**
   * 占总评比例（%，0–100）。**只从 `%` 写法识别**（`占 10%` / `10%`）。
   * `10 pts` / `100分` 是分数不是占比，识别出来用于从标题里剔除，但**不写入 weight**
   * —— 把 10 分当 10% 是估，契约明确禁止「不要估」。
   */
  readonly weight: number | null;
  /** 粘贴场景不会产生；保留字段是为了与契约结构完全一致 */
  readonly stale?: boolean;
}

/** 解析参数：`source` / `timeZone` / `now` 都必须显式给，不设默认值 */
export interface PasteParseOptions {
  /** 用户在 UI 上选的来源（影响 id 与合并优先级） */
  readonly source: DeadlineSource;
  /** 学校时区（IANA，如 `Asia/Shanghai`）。**必传**，不依赖运行环境本地时区 */
  readonly timeZone: string;
  /** 相对时间的基准（`下周三` / `in 3 days` / 缺年份推断用） */
  readonly now: Date;
  /** 用户可选填的课程名；用于 `courseId` / `courseName`，并参与合并判重 */
  readonly courseName?: string;
}

/** 一行没解析成功的原文 + 原因。UI **必须**展示出来 */
export interface PasteUnparsedLine {
  /** 原文（已 trim，保留行内空格，方便用户对照） */
  readonly line: string;
  /** 人话原因，例如「截止时间「Oct 20, 2026」缺少具体时刻（时:分），不猜具体几点」 */
  readonly reason: string;
}

/** 解析结果 */
export interface PasteParseResult {
  /** 解析成功的条目，按原文行序排列；同 id 完全重复的行会被合并并写 warning */
  readonly items: DeadlineItem[];
  /** 解析不了的行（含只有日期没时间、只有时间没日期、页眉/@提及/闲聊等） */
  readonly unparsed: PasteUnparsedLine[];
  /** 整体提示：没填课程名、标题回退、分数未计入 weight、重复行、有 N 行未解析等 */
  readonly warnings: string[];
}

/* ------------------------------------------------------------------ *
 * 常量
 * ------------------------------------------------------------------ */

/** 与契约 `DEADLINE_SOURCES` 一致（本地定义，不 import 契约包） */
const PASTE_SOURCE_KEYS: readonly DeadlineSource[] = [
  'blackboard',
  'gradescope',
  'piazza',
  'ecourse',
  'manual',
];

/** 一次粘贴里最多向上找几行当作跨行标题（跳过「10 pts」这类纯元数据行） */
const MAX_TITLE_LOOKBACK_LINES = 2;

/** 形如 `Assignments` / `Grades` 的页眉不能当标题 */
const HEADER_ONLY_RE =
  /^(?:assignments?|homework|course\s+content|course\s+home|grades?|calendar|dashboard|to\s*do|tests?|quizzes|discussions?|announcements?|submissions?|作业|课程内容|成绩|日历|公告|讨论区|提交记录)\s*[:：]?$/i;

/* ------------------------------------------------------------------ *
 * 文本清理用的正则
 * ------------------------------------------------------------------ */

/** 提交状态：先判否定，再判肯定 —— 否则 `Not submitted` 会被 `submitted` 命中 */
const NOT_SUBMITTED_RE = /\b(?:not\s+submitted|unsubmitted|not\s+yet\s+submitted)\b|未提交|尚未提交|待提交|未交/i;
const NOT_SUBMITTED_ALL_RE =
  /\b(?:not\s+submitted|unsubmitted|not\s+yet\s+submitted)\b|未提交|尚未提交|待提交|未交/gi;

const SUBMITTED_RE = /\b(?:submitted|turned\s+in)\b|已提交|已交|已批改|已评分/i;
const SUBMITTED_ALL_RE = /\b(?:submitted|turned\s+in)\b|已提交|已交|已批改|已评分/gi;

/** `占 10%` / `Weight: 12.5%` 这类带标记的占比 */
const WEIGHT_MARKED_RE =
  /(?:占|权重|占比|占总评|weight(?:ing)?|grade\s+weight)\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)\s*(?:%|％|percent\b|per\s+cent\b)/i;

/** 裸百分比（`10%` / `10％` / `10 percent`） */
const PERCENT_RE = /(\d{1,3}(?:\.\d+)?)\s*(?:%|％|percent\b|per\s+cent\b)/i;
const PERCENT_ALL_RE = /(\d{1,3}(?:\.\d+)?)\s*(?:%|％|percent\b|per\s+cent\b)/gi;

/** 带标记的占比整段（用于从标题里删掉 `占 10%` 里的「占」） */
const WEIGHT_PHRASE_ALL_RE =
  /(?:占|权重|占比|占总评|weight(?:ing)?|grade\s+weight)\s*[:：]?\s*\d{1,3}(?:\.\d+)?\s*(?:%|％|percent\b|per\s+cent\b)?/gi;

/** 分数：`10 pts` / `10 points possible` / `100分`（`10分钟` 是时长，不算） */
const POINTS_ALL_RE =
  /(\d{1,3}(?:\.\d+)?)\s*(?:pts?|points?)(?:\s+possible)?\b|(\d{1,3}(?:\.\d+)?)\s*分(?!钟)/gi;

/** `Due:` / `Due Date:` / `Deadline:` / `截止时间：` —— 只删带冒号的标签 */
const LABEL_ALL_RE =
  /(?:\bdue\s*date\b|\bdue\b|\bdeadline\b|\bddl\b|截止时间|截止日期)\s*[:：]/gi;

/** `@John Doe` / `@张三` 这类提及（Piazza 复制里常见） */
const MENTION_ALL_RE =
  /(?:^|\s)@(?:[A-Za-z0-9_.-]+(?:\s+[A-Z][A-Za-z0-9_.-]*){0,2}|[\u4e00-\u9fa5]{1,4})/g;

/** 行内 URL（用户从 BB 复制时可能带出来） */
const URL_RE = /\bhttps?:\/\/[^\s<>"'\u3000]+/i;

/** 列表前缀：`- ` / `• ` / `1. ` / `1、` */
const LIST_PREFIX_RE = /^\s*(?:[-–—*•·>]+|\d{1,2}[.)、])\s+/;

/* ------------------------------------------------------------------ *
 * 日期片段识别
 * ------------------------------------------------------------------ */

/**
 * 日期候选模式。`parseDueText` 只接受**整段**日期文本，所以这里先从行里把日期片段
 * 「切」出来，再交给它解析；本文件不做任何 `new Date(text)` 式解析。
 *
 * 顺序只用于同一位置的重叠消歧；候选最终按在行内出现的先后排序。
 */
const DATE_PATTERNS: readonly RegExp[] = [
  // 英文相对：`Due in 3 days` / `in 2 hours`
  /\b(?:due\s+)?in\s+\d+\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?)\b/i,
  // 中文相对时长：`3 天后截止` / `2 小时后`
  /\d+\s*(?:分钟|小时|天|周|星期)\s*后(?:截止)?/,
  // 中文相对星期 / 今天明天：`下周三 23:59` / `本周五` / `明天 9:00`
  /(?:(?:下|本|这)\s*(?:周|星期|礼拜)\s*[一二三四五六日天1-7]|(?:周|星期|礼拜)\s*[一二三四五六日天1-7]|今天|明天|后天|大后天)\s*(?:\d{1,2}\s*[:：]\s*\d{2}(?:\s*[:：]\s*\d{2})?)?/,
  // 中文日历：`2026年10月20日 23:59` / `10月20日 23:59`
  /(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*[日号](?:\s*\d{1,2}\s*[:：]\s*\d{2}(?:\s*[:：]\s*\d{2})?)?/,
  // ISO：`2026-10-20 23:59` / `2026-10-20T23:59:00+08:00`
  /\b\d{4}-\d{1,2}-\d{1,2}(?:[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,6})?(?:\s*(?:Z|UTC|GMT|[+-]\d{2}:?\d{2}))?)?\b/i,
  // 英文月份：`Oct 20, 2026 11:59 PM` / `October 20 2026 23:59` / `Oct 20 11:59 PM`
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?(?:\s*,?\s*(?:at\s+)?\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?\s*m\.?)?)?/i,
];

interface DateCandidate {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly patternOrder: number;
}

interface WallDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  /** ISO 星期：周一 = 1 … 周日 = 7 */
  readonly weekday: number;
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const WEEKDAY_CHARS: Readonly<Record<string, number>> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
};

const wallFormatterCache = new Map<string, Intl.DateTimeFormat>();

/** 取某 IANA 时区的墙上时间 formatter；非法时区在这里抛 `RangeError`（配置错误） */
function requireWallFormatter(timeZone: string): Intl.DateTimeFormat {
  if (typeof timeZone !== 'string' || timeZone.trim().length === 0) {
    throw new RangeError('deadline-paste: timeZone 必须显式传入 IANA 时区名（如 Asia/Shanghai）');
  }
  const cached = wallFormatterCache.get(timeZone);
  if (cached !== undefined) return cached;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  wallFormatterCache.set(timeZone, formatter);
  return formatter;
}

/**
 * `now` 在指定时区的日历日期与星期。
 *
 * 只取年/月/日/星期，不取时刻 —— 中文相对星期（`下周三`）需要的是日历运算，
 * 而不是「now + N×24h」。日期加减用 `Date.UTC` 对日历分量做，不受运行环境时区影响。
 */
function wallDateAt(now: Date, timeZone: string): WallDate {
  const parts = requireWallFormatter(timeZone).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) {
      throw new RangeError(`deadline-paste: 无法从 Intl 取得 ${type}（时区 ${timeZone}）`);
    }
    return part.value;
  };
  const weekday = WEEKDAY_INDEX[pick('weekday')];
  if (weekday === undefined) {
    throw new RangeError(`deadline-paste: 无法识别星期 ${pick('weekday')}（时区 ${timeZone}）`);
  }
  return {
    year: Number(pick('year')),
    month: Number(pick('month')),
    day: Number(pick('day')),
    weekday,
  };
}

/** 日历加减（只操作年月日分量，不碰时刻，因此与时区/夏令时无关） */
function addCalendarDays(base: WallDate, days: number): WallDate {
  const probe = new Date(Date.UTC(base.year, base.month - 1, base.day + days));
  const weekday = probe.getUTCDay() === 0 ? 7 : probe.getUTCDay();
  return {
    year: probe.getUTCFullYear(),
    month: probe.getUTCMonth() + 1,
    day: probe.getUTCDate(),
    weekday,
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatWallDate(wall: WallDate): string {
  return `${String(wall.year).padStart(4, '0')}-${pad2(wall.month)}-${pad2(wall.day)}`;
}

/** `2026/10/20` 不会被这里接受；只处理中文相对星期/今天明天 */
const RELATIVE_WEEKDAY_RE =
  /^(?:(下|本|这)\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])|(?:周|星期|礼拜)\s*([一二三四五六日天1-7])|(今天|明天|后天|大后天))(?:\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * 把 `下周三 23:59` / `明天 9:00` 换成**墙上时间文本**（`2026-10-28 23:59`），
 * 再交给 `parseDueText` 按时区换算成绝对时刻。
 *
 * 这里只做「相对日历 → 具体年月日」的换算，不重复实现日期解析：
 * 时间部分原样保留，缺时间就返回只有日期的文本，让 `parseDueText` 按「不猜」返回 null。
 *
 * 语义：
 *   · `下周三` = 下周的周三（跨周）；
 *   · `本周三` / `这周三` = 本周的周三（即使已过，也照原样保留，便于发现逾期项）；
 *   · 裸 `周三` = 从今天起最近的那个周三；
 *   · `今天 / 明天 / 后天 / 大后天` 按自然日推。
 */
function resolveRelativeWeekday(text: string, now: Date, timeZone: string): string | null {
  const match = RELATIVE_WEEKDAY_RE.exec(text);
  if (match === null) return null;

  const nowWall = wallDateAt(now, timeZone);
  const prefix = match[1];
  const prefixedChar = match[2];
  const bareChar = match[3];
  const keyword = match[4];

  let target: WallDate;
  if (keyword !== undefined) {
    const offset = keyword === '今天' ? 0 : keyword === '明天' ? 1 : keyword === '后天' ? 2 : 3;
    target = addCalendarDays(nowWall, offset);
  } else {
    const char = prefixedChar ?? bareChar;
    const targetWeekday = char === undefined ? undefined : WEEKDAY_CHARS[char];
    if (targetWeekday === undefined) return null;

    const monday = addCalendarDays(nowWall, -(nowWall.weekday - 1));
    if (prefix === '下') {
      target = addCalendarDays(monday, 7 + targetWeekday - 1);
    } else if (prefix === '本' || prefix === '这') {
      target = addCalendarDays(monday, targetWeekday - 1);
    } else {
      const thisWeek = addCalendarDays(monday, targetWeekday - 1);
      const thisWeekUtc = Date.UTC(thisWeek.year, thisWeek.month - 1, thisWeek.day);
      const todayUtc = Date.UTC(nowWall.year, nowWall.month - 1, nowWall.day);
      target = thisWeekUtc < todayUtc ? addCalendarDays(thisWeek, 7) : thisWeek;
    }
  }

  const dateText = formatWallDate(target);
  const hourText = match[5];
  if (hourText === undefined) return dateText;

  const hour = Number(hourText);
  const minute = Number(match[6] ?? '');
  const second = match[7] === undefined ? 0 : Number(match[7]);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }
  const timeText = `${pad2(hour)}:${pad2(minute)}${match[7] === undefined ? '' : `:${pad2(second)}`}`;
  return `${dateText} ${timeText}`;
}

/** 全角冒号、`a.m.`、多余空白统一成 `parseDueText` 认得的写法 */
function normalizeDateText(raw: string): string {
  return raw
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/：/g, ':')
    .replace(/([ap])\.?\s*m\.?/gi, (_match, letter: string) =>
      letter.toLowerCase() === 'a' ? 'AM' : 'PM',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** 日期候选 → ISO；相对星期先换算成墙上时间再交给 `parseDueText` */
function parseDateCandidate(
  raw: string,
  now: Date,
  timeZone: string,
): string | null {
  const text = normalizeDateText(raw);
  if (text.length === 0) return null;
  const relative = resolveRelativeWeekday(text, now, timeZone);
  if (relative !== null) return parseDueText(relative, now, timeZone);
  return parseDueText(text, now, timeZone);
}

/** 行内所有可能的日期片段（同一位置只保留最先命中的模式） */
function collectDateCandidates(line: string): DateCandidate[] {
  const found: DateCandidate[] = [];
  DATE_PATTERNS.forEach((pattern, patternOrder) => {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const global = new RegExp(pattern.source, flags);
    for (const match of line.matchAll(global)) {
      if (match.index === undefined) continue;
      const text = match[0];
      if (text.trim().length === 0) continue;

      const start = match.index;
      const end = start + text.length;
      const duplicate = found.some(
        (candidate) => candidate.start === start && candidate.end === end,
      );
      if (!duplicate) {
        found.push({ start, end, text, patternOrder });
      }
    }
  });
  return found.sort((a, b) => a.start - b.start || a.patternOrder - b.patternOrder);
}

/** 日期片段前面紧挨着 `Due / 截止时间 / Deadline / until` 吗（同一行有多个日期时用它选） */
function hasDueMarkerBefore(line: string, start: number): boolean {
  const head = line.slice(Math.max(0, start - 24), start);
  return /(?:\bdue(?:\s+date)?|\bdeadline|\buntil|\bends?(?:\s+on)?|截止(?:时间|日期)?|\bddl)\s*[:：]?\s*$/i.test(
    head,
  );
}

interface DateChoice {
  readonly candidate: DateCandidate | null;
  readonly dueAt: string | null;
  readonly error: string | null;
}

/**
 * 从一行里选日期片段：
 *   1. 优先「紧跟 Due/截止」标记的片段（避免把 `Posted Sep 1` 当成截止）；
 *   2. 在该顺序里取**第一个能解析成功**的；
 *   3. 全部失败时保留第一个候选，用于 `unparsed` 的具体原因。
 */
function chooseDateCandidate(
  line: string,
  now: Date,
  timeZone: string,
): DateChoice {
  const candidates = collectDateCandidates(line);
  if (candidates.length === 0) return { candidate: null, dueAt: null, error: null };

  const marked = candidates.filter((candidate) => hasDueMarkerBefore(line, candidate.start));
  const ordered = [...marked, ...candidates.filter((candidate) => !marked.includes(candidate))];

  for (const candidate of ordered) {
    const dueAt = parseDateCandidate(candidate.text, now, timeZone);
    if (dueAt !== null) return { candidate, dueAt, error: null };
  }

  const fallback = marked[0] ?? candidates[0];
  if (fallback === undefined) return { candidate: null, dueAt: null, error: null };
  return { candidate: fallback, dueAt: null, error: describeDateFailure(fallback.text) };
}

/** 为什么这个日期片段解析不了 —— 尽量说人话，别只丢一个 null */
function describeDateFailure(raw: string): string {
  const text = raw.trim();
  const hasClock = /\d{1,2}\s*[:：]\s*\d{2}/.test(text);
  if (!hasClock) {
    return `截止时间「${text}」缺少具体时刻（时:分），不猜具体几点`;
  }
  return `截止时间「${text}」无法解析（日期非法或时区有歧义），不猜`;
}

/* ------------------------------------------------------------------ *
 * 单行分析
 * ------------------------------------------------------------------ */

interface LineAnalysis {
  /** 原文（trim 后） */
  readonly line: string;
  /** 日期片段的原文；没有候选为 null */
  readonly dateRaw: string | null;
  /** 解析出的绝对时刻；解析失败为 null */
  readonly dueAt: string | null;
  /** 日期解析失败原因；日期成功或无候选为 null */
  readonly dateError: string | null;
  readonly submitted: boolean;
  readonly weight: number | null;
  readonly weightError: string | null;
  /** 行内分数（pts/分）命中次数：用于「分数不算 weight」的整体提示 */
  readonly pointsCount: number;
  readonly sourceUrl: string | null;
  /** 从日期两侧切出来的标题；切不出为 '' */
  readonly title: string;
}

function detectSubmitted(line: string): boolean {
  if (NOT_SUBMITTED_RE.test(line)) return false;
  return SUBMITTED_RE.test(line);
}

interface WeightDetection {
  readonly weight: number | null;
  readonly error: string | null;
}

/** 只把百分比写进 weight；0–100 之外视为无效（不夹逼，避免把 150% 变成 100%） */
function detectWeight(line: string): WeightDetection {
  const marked = WEIGHT_MARKED_RE.exec(line);
  const raw = marked?.[1] ?? PERCENT_RE.exec(line)?.[1];
  if (raw === undefined) return { weight: null, error: null };

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return { weight: null, error: `占比「${raw}%」不在 0–100 之间，未写入 weight` };
  }
  return { weight: value, error: null };
}

function countPoints(line: string): number {
  return line.match(POINTS_ALL_RE)?.length ?? 0;
}

function extractUrl(line: string): string | null {
  const match = URL_RE.exec(line);
  if (match === null) return null;
  const url = match[0].replace(/[）)\]】.,，。;；]+$/u, '');
  return url.length > 0 ? url : null;
}

/**
 * 去掉日期之外的所有「平台噪声」，剩下的就是标题。
 *
 * 注意这里只做**删除**、不做**猜测**：删不干净就宁可留着，最后交给 `cleanTitle`
 * 和「切不出标题就用整行原文」的兜底。绝不用位置硬切出半截单词。
 */
function stripNoise(text: string): string {
  let result = text;

  result = result.replace(URL_RE, ' ');
  result = result.replace(NOT_SUBMITTED_ALL_RE, ' ');
  result = result.replace(SUBMITTED_ALL_RE, ' ');
  result = result.replace(WEIGHT_PHRASE_ALL_RE, ' ');
  result = result.replace(PERCENT_ALL_RE, ' ');
  result = result.replace(POINTS_ALL_RE, ' ');
  result = result.replace(/满分\s*/g, ' ');
  result = result.replace(LABEL_ALL_RE, ' ');
  result = result.replace(MENTION_ALL_RE, ' ');
  result = result.replace(LIST_PREFIX_RE, ' ');
  result = result.replace(/^\s*(?:due(?:\s+date)?|deadline|ddl)\b\s*[:：]?\s*/i, ' ');
  result = result.replace(/\s*\b(?:due(?:\s+date)?|deadline|ddl)\s*$/i, ' ');
  result = result.replace(/\s*截止(?:时间|日期)?\s*[:：]?\s*$/u, ' ');
  result = result.replace(/[（(]\s*[)）]/g, ' ');

  return cleanTitle(result);
}

/** 去掉首尾分隔符/标点并压缩空白；保留标题内部的 `·`、`.`、`-` */
function cleanTitle(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[\s:：,，;；\-–—_|/\\·•>]+/u, '')
    .replace(/[\s:：,，;；\-–—_|/\\·•]+$/u, '')
    .replace(/^[\s.。,，!！?？]+/u, '')
    .replace(/[\s.。,，!！?？]+$/u, '')
    .trim();
}

function analyzeLine(
  rawLine: string,
  now: Date,
  timeZone: string,
): LineAnalysis {
  const line = rawLine.trim();
  const choice = chooseDateCandidate(line, now, timeZone);

  const start = choice.candidate?.start ?? -1;
  const end = choice.candidate?.end ?? -1;
  const withoutDate =
    start >= 0 && end >= start ? `${line.slice(0, start)} ${line.slice(end)}` : line;

  const weight = detectWeight(line);
  return {
    line,
    dateRaw: choice.candidate?.text.trim() ?? null,
    dueAt: choice.dueAt,
    dateError: choice.error,
    submitted: detectSubmitted(line),
    weight: weight.weight,
    weightError: weight.error,
    pointsCount: countPoints(line),
    sourceUrl: extractUrl(line),
    title: stripNoise(withoutDate),
  };
}

/* ------------------------------------------------------------------ *
 * 幂等 id
 * ------------------------------------------------------------------ */

/**
 * 64 位稳定哈希（FNV-1a + 多项式混合），输出 16 位小写十六进制。
 *
 * 不用 `crypto`（小程序环境不保证）、不用 `Math.random()`（就不幂等了）。
 * 逐 UTF-16 码元处理，保证同一字符串在任何引擎上结果一致。
 */
function stableHash(input: string): string {
  let fnv = 0x811c9dc5;
  let mix = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    fnv ^= code;
    fnv = Math.imul(fnv, 0x01000193) >>> 0;
    mix = Math.imul(mix ^ code, 0x5bd1e995) >>> 0;
    mix = ((mix << 13) | (mix >>> 19)) >>> 0;
  }
  return `${fnv.toString(16).padStart(8, '0')}${mix.toString(16).padStart(8, '0')}`;
}

/** `hash(source + title + dueAt)` —— 同一条作业跨次粘贴得到同一个 id */
function pasteItemId(source: DeadlineSource, title: string, dueAt: string): string {
  return `ddl-paste-${stableHash(`${source}\u0000${title.trim()}\u0000${dueAt}`)}`;
}

/* ------------------------------------------------------------------ *
 * 其它小工具
 * ------------------------------------------------------------------ */

function inferKind(title: string): DeadlineKind {
  const text = title.toLowerCase();
  if (/project|项目|大作业|coursework|课程设计/.test(text)) return 'project';
  if (/exam|midterm|final\b|考试|期末|期中/.test(text)) return 'exam';
  if (/quiz|测验|小测|随堂测/.test(text)) return 'quiz';
  if (/reading|阅读|读本|文献/.test(text)) return 'reading';
  return 'assignment';
}

/** 能当跨行标题用吗：非空、非纯数字、非页眉 */
function isUsableTitle(title: string): boolean {
  if (title.length === 0) return false;
  if (/^[\d\s.,，。、:：;；\-–—_|/\\]+$/.test(title)) return false;
  return !HEADER_ONLY_RE.test(title.trim());
}

/**
 * 向上找跨行标题：最多看 2 个非空行，允许中间夹一行「10 pts」这类纯元数据。
 * 遇到上一条记录/日期行就停 —— 不把上一条作业的标题挪给这一条。
 */
function findPreviousTitle(
  analyses: ReadonlyArray<LineAnalysis | null>,
  used: ReadonlySet<number>,
  from: number,
): number {
  let considered = 0;
  for (let index = from - 1; index >= 0 && considered < MAX_TITLE_LOOKBACK_LINES; index -= 1) {
    const analysis = analyses[index];
    if (analysis === null || analysis === undefined) continue;
    considered += 1;

    if (used.has(index)) return -1;
    if (analysis.dueAt !== null || analysis.dateRaw !== null) return -1;
    if (isUsableTitle(analysis.title)) return index;
  }
  return -1;
}

function assertOptions(options: PasteParseOptions): void {
  if (!(options.now instanceof Date) || Number.isNaN(options.now.getTime())) {
    throw new RangeError('deadline-paste: now 必须是有效的 Date');
  }
  if (typeof options.timeZone !== 'string' || options.timeZone.trim().length === 0) {
    throw new RangeError('deadline-paste: timeZone 必须显式传入 IANA 时区名（如 Asia/Shanghai）');
  }
  // 非法时区在这里抛 RangeError（与 parseDueText 行为一致）
  wallDateAt(options.now, options.timeZone);
  if (!PASTE_SOURCE_KEYS.includes(options.source)) {
    throw new RangeError(`deadline-paste: 未知来源 ${String(options.source)}`);
  }
}

/* ------------------------------------------------------------------ *
 * 主函数
 * ------------------------------------------------------------------ */

/**
 * 解析用户粘贴的 DDL 文本。
 *
 * @example
 * const result = parsePastedDeadlines(bbText, {
 *   source: 'blackboard',
 *   timeZone: 'Asia/Shanghai',
 *   now: new Date(),
 *   courseName: 'CS101',
 * });
 * // result.items: DeadlineItem[]
 * // result.unparsed: 每一行没看懂的原因（UI 必须展示）
 * // result.warnings: 标题回退 / 分数未计入 weight / 有 N 行未解析 等
 *
 * 行为约定：
 * - 每个非空行要么进 `items`、要么作为跨行标题被合并、要么进 `unparsed`；**绝不静默丢弃**；
 * - 日期一律经 `parseDueText`；认不出不进 `items`（契约 `dueAt` 不允许 null），进 `unparsed`；
 * - 同 `id` 的重复行合并为一条（`submitted` 取或、`weight` 取首个非空），并写 warning；
 * - 结果按原文行序排列，两次调用结果完全一致（幂等）。
 */
export function parsePastedDeadlines(
  text: string,
  options: PasteParseOptions,
): PasteParseResult {
  if (typeof text !== 'string') {
    throw new TypeError('deadline-paste: text 必须是字符串');
  }
  assertOptions(options);

  const normalizedText = text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '');

  const lines = normalizedText.split('\n').map((line) => line.trim());
  const nonEmptyCount = lines.filter((line) => line.length > 0).length;

  if (nonEmptyCount === 0) {
    return {
      items: [],
      unparsed: [],
      warnings: ['粘贴内容为空，没有可解析的文本'],
    };
  }

  const courseName = options.courseName?.trim() ?? '';
  const courseId = courseName.length > 0 ? `pasted:${courseName}` : 'pasted:unspecified';

  const warnings: string[] = [];
  if (courseName.length === 0) {
    warnings.push(
      '未填写课程名：courseId 固定为 pasted:unspecified；不同课程里同名、同截止时间的作业在合并时可能被归成一条，建议填写课程名。',
    );
  }

  const analyses: Array<LineAnalysis | null> = lines.map((line) =>
    line.length === 0 ? null : analyzeLine(line, options.now, options.timeZone),
  );

  const used = new Set<number>();
  const byId = new Map<string, DeadlineItem>();
  const orderedIds: string[] = [];
  const lineWarnings: string[] = [];
  let pointsCount = 0;
  let duplicateCount = 0;

  for (let index = 0; index < analyses.length; index += 1) {
    const analysis = analyses[index];
    if (analysis === null || analysis === undefined || analysis.dueAt === null) continue;

    used.add(index);
    pointsCount += analysis.pointsCount;

    if (analysis.weightError !== null) {
      lineWarnings.push(`第 ${index + 1} 行：${analysis.weightError}`);
    }

    let title = analysis.title;
    if (title.length === 0) {
      const previous = findPreviousTitle(analyses, used, index);
      if (previous !== -1) {
        const previousAnalysis = analyses[previous];
        if (previousAnalysis !== null && previousAnalysis !== undefined) {
          title = previousAnalysis.title;
          used.add(previous);
          // 标题与日期之间夹的纯元数据行（如 `100 pts`）已被「用掉」，
          // 不再重复进 unparsed；有内容的行（闲聊/页眉）仍然会回显。
          for (let skipped = index - 1; skipped > previous; skipped -= 1) {
            const skippedAnalysis = analyses[skipped];
            if (
              skippedAnalysis !== null &&
              skippedAnalysis !== undefined &&
              skippedAnalysis.title.length === 0 &&
              skippedAnalysis.dateRaw === null
            ) {
              used.add(skipped);
            }
          }
        }
      }
    }
    if (title.length === 0) {
      title = analysis.line;
      lineWarnings.push(
        `第 ${index + 1} 行未识别出标题，已用整行原文作为标题，请核对。`,
      );
    }

    const item: DeadlineItem = {
      id: pasteItemId(options.source, title, analysis.dueAt),
      source: options.source,
      kind: inferKind(title),
      title,
      courseId,
      courseName,
      dueAt: analysis.dueAt,
      dueAtRaw: analysis.dateRaw ?? '',
      sourceUrl: analysis.sourceUrl ?? '',
      submitted: analysis.submitted,
      weight: analysis.weight,
    };

    const existing = byId.get(item.id);
    if (existing === undefined) {
      byId.set(item.id, item);
      orderedIds.push(item.id);
    } else {
      duplicateCount += 1;
      byId.set(item.id, {
        ...existing,
        submitted: existing.submitted || item.submitted,
        weight: existing.weight ?? item.weight,
      });
    }
  }

  const unparsed: PasteUnparsedLine[] = [];
  for (let index = 0; index < analyses.length; index += 1) {
    const analysis = analyses[index];
    if (analysis === null || analysis === undefined || used.has(index)) continue;

    let reason: string;
    if (analysis.dateRaw !== null) {
      reason = analysis.dateError ?? `截止时间「${analysis.dateRaw}」无法解析，不猜`;
    } else if (analysis.title.length === 0) {
      reason = /@/.test(analysis.line)
        ? '只有 @ 提及，没有作业信息'
        : '没有可识别的作业标题或截止时间（可能是页眉/状态等页面噪声）';
    } else {
      const clock = /(?:^|\s)(\d{1,2}[:：]\d{2})(?:\s|$)/.exec(analysis.line);
      reason =
        clock !== null
          ? `只找到时间「${clock[1] ?? ''}」，缺少年/月/日`
          : '未找到可识别的截止时间（支持 Oct 20, 2026 11:59 PM / 2026-10-20 23:59 / 2026年10月20日 23:59 / 下周三 23:59）';
    }
    unparsed.push({ line: analysis.line, reason });
  }

  warnings.push(...lineWarnings);

  if (pointsCount > 0) {
    warnings.push(
      `识别到 ${pointsCount} 处分数（pts / 分）：契约的 weight 只表示总评占比（%），因此未把分数写入 weight；如需权重请手动补。`,
    );
  }
  if (duplicateCount > 0) {
    warnings.push(
      `有 ${duplicateCount} 行与前面的条目完全重复（同来源、同标题、同截止时间），已按同一 id 合并。`,
    );
  }
  if (unparsed.length > 0) {
    warnings.push(`有 ${unparsed.length} 行未解析，已原样列在 unparsed 中，请逐行核对。`);
  }
  if (orderedIds.length === 0) {
    warnings.push('没有解析出任何 DDL 条目。');
  }

  return {
    items: orderedIds.map((id) => {
      const item = byId.get(id);
      if (item === undefined) {
        throw new RangeError('deadline-paste: 内部错误，id 索引丢失');
      }
      return item;
    }),
    unparsed,
    warnings,
  };
}
