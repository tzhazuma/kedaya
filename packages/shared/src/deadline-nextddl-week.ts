/**
 * 课程 DDL · 学期周次 ↔ 日期换算（三端共用，纯函数）
 *
 * ## 为什么需要这个模块（缺口是别人自己写出来的）
 *
 * `deadline-parse-eams.ts` 的边界写着：「课表只有『第几周第几节』，绝对时刻由调用方
 * 用它自己的第 1 周起点换算」。但仓库里**一直没有那个换算**：课表解析出来的
 * `EamsLesson.weeks` / `weekday` 至今换算不成日期，「下周三 23:59」这类说法也只能靠
 * 粘贴解析器硬算。本文件就是补这个缺口：把「第 N 周、星期 K」和「某个绝对时刻」互相换算，
 * 且**只用一份**周次算法，避免三端各写一套后错开一周。
 *
 * ## 出处与调研说明（NextDDL，2026-10-20）
 *
 * 本轮**取到了** NextDDL 的源码：`github.com/ShanghaitechGeekPie/NextDDL` 的 main 快照
 * （本机留存的 `/tmp/NextDDL.tgz`，解包后 `lib/` 共 1177 行），逐个读了
 * `lib/deadlines.ts`、`lib/fetch-ddls.ts`、`lib/deadline-status.ts`、
 * `app/api/ics/[token]/route.ts`。授权：项目负责人唐志昊确认已获作者同意合并。
 *
 * 许可证状态比 `docs/architecture/11-geekpie-repos-analysis.md` 记的更细一点：
 * 仓库里确实**没有** LICENSE 文件（11 号文档的结论成立），但 README 的 License 节
 * 自称 `MIT` —— 两件事同时为真。本文件不再依赖这个判断：授权已经拿到，
 * 而且下面这些实现都是独立写的。
 *
 * 结论：**NextDDL 里没有学期周次概念**，它的 `due` 永远是服务端算好的 unix 秒
 * （`DeadlineItem.due: number`），周次换算是我们独立实现的（不是翻译、不是改写）。
 * 它的 DDL 相关代码逐项评估如下，四条都**没有**并入本模块，理由写在右列：
 *
 * | NextDDL 的做法 | 我们的现状 | 为什么不再合并 |
 * | --- | --- | --- |
 * | `getDeadlineKey()`：`platform\|title\|course\|due\|url` 全等拼接 | `mergeDeadlines()`：课程 + 归一化标题 + 5 分钟窗口，**跨平台**合并 | 它的键含 `platform`，同一条作业在 BB 与 Gradescope 上永远不会合并；我们的判据严格更强，换掉是倒退 |
 * | `isSubmittedStatus()`：`status.trim().toLowerCase() === 'submitted'` | `deadline-paste.ts` 已有「先判否定再判肯定」的中英词表，且契约里 `submitted` 是布尔字段 | 它的单值判断会把 `Not submitted` 判成已提交；我们的实现更完整，不能替换 |
 * | ICS 导出（npm `ics` 包 + `due.getHours()`） | `deadline-ics.ts`：手写 RFC 5545、统一 UTC | 它用**服务器本地时区**取时分，正是本仓库明令禁止的 bug；且引入 `ics` 违反「零新增依赖」 |
 * | `ddl_retention_days`（默认 30 天）过滤已过期条目 | — | 纯函数化只值几行，且是否丢弃旧条目是 UI/存储决策；本轮不做（价值低于周次换算） |
 *
 * **硬红线**：它的 `loginHydroSession` / `loginGradescopeSession` /
 * `loginBlackboardSession` / `credential-vault.ts`（服务端存学生密码、重放登录）
 * **一行未取**。本文件没有网络、cookie、密码、会话参数，也不会有 —— 这跟授权无关，
 * 是架构判断（见 `docs/architecture/11-geekpie-repos-analysis.md` §3.3）。
 *
 * ## 语义（写死在这里，不随调用方漂移）
 *
 * 1. **周次从 1 开始**、`weekday` 用 ISO 编号（1 = 周一 … 7 = 周日）。
 *    这不是随手定的：`EamsLesson.weekday` 就是 1…7，`EamsLesson.weeks` 就是 1 起，
 *    所以课表解析结果可以**直接**喂进来，中间不做过一次编号转换（少一处错位机会）。
 * 2. **第 1 周 = 包含学期第一天的那一周**（按 `weekStartsOn` 切周，默认周一起）。
 *    学期第一天常常不是周一（例如周四开学），此时「第 1 周周一」会落在开学日之前 ——
 *    这是**正确的日历周语义**：学生说「第 2 周周一」指的是下一个周一，不是九天后。
 *    反方向同理：开学那一周里的任何一天都算第 1 周，包括开学前一两天。
 * 3. **只做日历算术，不碰时区**：`semesterWeekDate` 输入是墙上日期、输出也是墙上日期，
 *    没有任何绝对时刻参与，所以它**没有** `timeZone` 参数（硬要塞一个不用的参数
 *    只会让调用方以为它有时区语义）。反方向 `semesterWeekOf` 必须把绝对时刻落到
 *    学校时区的自然日上，所以 `timeZone` 是**必填**参数，没有默认值 —— 和
 *    `parseDueText` 同一条规矩。
 * 4. **与 `parseDueText` 分工**：本模块只回答「第 N 周星期 K 是哪一天」，
 *    不回答「那天的几点」。要绝对时刻就把日期交给唯一的日期解析入口：
 *
 *    ```ts
 *    const { date } = semesterWeekDate(cal, 7, 3);            // 2026-10-21
 *    const dueAt = parseDueText(`${date} 23:59`, now, tz);    // 绝对时刻
 *    ```
 *
 *    这样 DST / 时区缩写 / 缺年份那些坑仍然只有 `deadline-normalize` 一份实现。
 *
 * ## 边界（不处理，以及原因）
 *
 * - **不处理学期长度**：不知道这学期有几周（各学期不同，硬编码 16/18 周会在大一短学期
 *   上出错），所以 `week: 99` 照常算出一个真实日期，不设上限、不返回 null。
 *   调用方若要校验「第 99 周不存在」，请自己比对学期结束日。
 * - **不处理非法的 `firstWeekStart`**：它来自我们自己的学期配置，格式错（`2026/9/7`、
 *   `2026-02-30`）是**配置 bug**，抛 `RangeError` 而不是静默返回 null ——
 *   静默 null 会让整张课表整周错位而没人发现。
 * - **不处理平台脏数据**：`dueAt` 认不出返回 `null`（一行坏数据不该中断整批），
 *   这与「配置错误抛异常」是同一条分界：**配置错抛，数据错 null**。
 * - **不处理纯日期 `dueAt` 的歧义**：`Date.parse('2026-10-21')` 按 UTC 午夜解释，
 *    上海时区下仍在同一天，但负偏移时区会退到前一天。我们**不**额外修正：
 *    调用方该给绝对时刻（带 `Z` 或偏移），给纯日期是它的选择，我们不在共享层猜。
 * - **不处理校历假期 / 调休**：没有校历数据源，第 N 周就是连续 7 天；调休需要另行叠加。
 * - **不把「周次大到超出 `Date` 表示范围」包装成业务错误**：`week: 1e9` 会让
 *   `toISOString()` 抛 `RangeError`（英文文案）。真实校历里不会出现这种值，
 *   为它单独写一条错误码不值得维护。
 */

/* ------------------------------------------------------------------ *
 * 类型
 * ------------------------------------------------------------------ */

/** ISO 星期编号：1 = 周一 … 7 = 周日（与 `EamsLesson.weekday` 一致） */
export const SEMESTER_WEEKDAYS = Object.freeze([1, 2, 3, 4, 5, 6, 7] as const);

export type SemesterWeekday = (typeof SEMESTER_WEEKDAYS)[number];

/**
 * 学期周历配置。
 *
 * `firstWeekStart` 是**学期第一天**的墙上日期（不是「第 1 周周一」——
 * 它正好是周一只是巧合，见文件头第 2 条）。它按学校时区的自然日理解，
 * 但**不需要**传时区：日期本身没有时刻，换成绝对时刻是 `parseDueText` 的事。
 */
export interface SemesterWeekCalendar {
  /** 学期第一天的墙上日期，形如 `2026-09-07`（只认这一种写法） */
  readonly firstWeekStart: string;
  /** 每周从星期几开始，默认 1（周一）。上科大课表以周一起 */
  readonly weekStartsOn?: SemesterWeekday;
}

/** 一个「第 N 周星期 K」的位置 */
export interface SemesterWeekPosition {
  /** 第几周，从 1 开始 */
  readonly week: number;
  /** 星期几，1 = 周一 … 7 = 周日 */
  readonly weekday: SemesterWeekday;
  /** 该天的墙上日期，`YYYY-MM-DD`（学校时区下的自然日） */
  readonly date: string;
}

/* ------------------------------------------------------------------ *
 * 日历算术（全部用 UTC 探针，不受运行环境时区影响）
 * ------------------------------------------------------------------ */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 只认 `2026-09-07` 这一种写法；`2026-9-7` / `2026/09/07` 视为配置错误 */
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 墙上日期 → 连续天数（1970-01-01 为 0）。
 *
 * 用 `Date.UTC` 而不是 `new Date(y, m, d)`：后者按**运行环境**时区构造，
 * 在 UTC-x 的机器上 `2026-09-07` 会变成前一天 —— 这正是本仓库反复强调的坑。
 * 同时用 UTC 往返校验拒绝 `2026-02-30` 这类会被 `Date` 静默进位的日期。
 */
function civilDayNumber(text: string): number {
  const match = typeof text === 'string' ? DATE_KEY_RE.exec(text) : null;
  if (match === null) {
    throw new RangeError(
      `deadline-nextddl-week: firstWeekStart 必须是 YYYY-MM-DD（如 2026-09-07），收到 ${String(text)}`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const probe = new Date(ms);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new RangeError(
      `deadline-nextddl-week: firstWeekStart 不是真实存在的日期（${text}）`,
    );
  }
  return Math.floor(ms / DAY_MS);
}

/** 连续天数 → `YYYY-MM-DD`（同样是 UTC 探针，不受本地时区影响） */
function formatCivilDay(dayNumber: number): string {
  return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
}

/** 连续天数 → ISO 星期（1 = 周一 … 7 = 周日） */
function isoWeekdayOf(dayNumber: number): SemesterWeekday {
  const sundayBased = new Date(dayNumber * DAY_MS).getUTCDay(); // 0 = 周日
  return (sundayBased === 0 ? 7 : sundayBased) as SemesterWeekday;
}

function requireWeekday(value: number, name: string): SemesterWeekday {
  if (!Number.isInteger(value) || value < 1 || value > 7) {
    throw new RangeError(
      `deadline-nextddl-week: ${name} 必须是 1（周一）… 7（周日）的整数，收到 ${String(value)}`,
    );
  }
  return value as SemesterWeekday;
}

/**
 * 校验并把学期第一天对齐到它所在周的周起点（见文件头第 2 条）。
 *
 * 例：`firstWeekStart = 2026-09-03`（周四）、`weekStartsOn = 1`
 * → 第 1 周从 2026-08-31（周一）起，开学日之前的 3 天仍属第 1 周。
 */
function requireCalendar(calendar: SemesterWeekCalendar): {
  readonly startDay: number;
  readonly weekStartsOn: SemesterWeekday;
} {
  // TS 之外（小程序产物、JS 调用方）可能传 null；这里挡一道，
  // 否则报的是看不懂的 TypeError 而不是「哪个字段错了」
  if (calendar === null || typeof calendar !== 'object') {
    throw new RangeError('deadline-nextddl-week: calendar 必须是 { firstWeekStart, weekStartsOn? }');
  }
  const firstDay = civilDayNumber(calendar.firstWeekStart);
  const weekStartsOn = requireWeekday(calendar.weekStartsOn ?? 1, 'weekStartsOn');
  const alignment = (isoWeekdayOf(firstDay) - weekStartsOn + 7) % 7;
  return { startDay: firstDay - alignment, weekStartsOn };
}

/* ------------------------------------------------------------------ *
 * 时区（仅反方向需要：绝对时刻 → 学校自然日）
 * ------------------------------------------------------------------ */

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

/**
 * 取「按学校时区输出 YYYY-MM-DD」的 formatter。
 *
 * 非法时区名是**配置错误**，抛 `RangeError`（和 `deadline-normalize` 一致）：
 * 静默回退到本地时区只会制造「上海 23:59 的作业在伦敦被算晚 8 小时」的事故。
 */
function requireDateFormatter(timeZone: string): Intl.DateTimeFormat {
  if (typeof timeZone !== 'string' || timeZone.trim().length === 0) {
    throw new RangeError(
      'deadline-nextddl-week: timeZone 必须显式传入 IANA 时区名（如 Asia/Shanghai）',
    );
  }
  const cached = dateFormatterCache.get(timeZone);
  if (cached !== undefined) return cached;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    throw new RangeError(`deadline-nextddl-week: 非法 IANA 时区 ${timeZone}`);
  }
  dateFormatterCache.set(timeZone, formatter);
  return formatter;
}

/** 绝对时刻在指定时区的墙上日期 `YYYY-MM-DD` */
function localDateKey(epochMs: number, formatter: Intl.DateTimeFormat): string {
  const parts = formatter.formatToParts(new Date(epochMs));
  const pick = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((candidate) => candidate.type === type);
    return part === undefined ? '' : part.value;
  };
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  if (year === '' || month === '' || day === '') {
    throw new RangeError('deadline-nextddl-week: 无法从 Intl 取到年月日');
  }
  return `${year}-${month}-${day}`;
}

/* ------------------------------------------------------------------ *
 * 正向：周次 + 星期 → 日期
 * ------------------------------------------------------------------ */

/**
 * 「第 N 周星期 K」→ 具体日期。
 *
 * 纯日历算术：不读时钟、不碰时区、不做 IO。同样的入参在任何机器上得到同样结果。
 *
 * @param calendar 学期周历（`firstWeekStart` + 可选 `weekStartsOn`）
 * @param week     第几周，从 1 开始
 * @param weekday  星期几，1 = 周一 … 7 = 周日
 * @throws {RangeError} `firstWeekStart` 格式/日期非法、`week < 1` 或非整数、
 *                      `weekday` / `weekStartsOn` 不在 1…7
 */
export function semesterWeekDate(
  calendar: SemesterWeekCalendar,
  week: number,
  weekday: SemesterWeekday,
): SemesterWeekPosition {
  const { startDay, weekStartsOn } = requireCalendar(calendar);
  if (!Number.isInteger(week) || week < 1) {
    throw new RangeError(
      `deadline-nextddl-week: week 必须是从 1 开始的整数（形状如第 7 周），收到 ${String(week)}`,
    );
  }
  const target = requireWeekday(weekday, 'weekday');

  const offsetInWeek = (target - weekStartsOn + 7) % 7;
  const day = startDay + (week - 1) * 7 + offsetInWeek;

  return { week, weekday: target, date: formatCivilDay(day) };
}

/* ------------------------------------------------------------------ *
 * 反向：绝对时刻 → 周次 + 星期
 * ------------------------------------------------------------------ */

/**
 * 绝对时刻 → 「第 N 周星期 K」。
 *
 * `timeZone` **必填**：同一个时刻在不同时区可能是不同的自然日
 * （`2026-09-06T20:00:00Z` 在上海是 09-07 周一，在 UTC 还是 09-06 周日 ——
 * 后者会落在学期开始之前，返回 null）。少传一个参数就是一类静默错位。
 *
 * @param dueAt    绝对时刻（带 `Z` 或偏移的 ISO 串；纯日期见文件头「不处理」）
 * @param calendar 学期周历 —— 必须与正向用的是**同一份**配置
 * @param timeZone 学校时区（IANA 名），无默认值
 * @returns 位置；`dueAt` 认不出、或早于第 1 周第一天时返回 `null`
 * @throws {RangeError} `firstWeekStart` / `weekStartsOn` / `timeZone` 非法
 */
export function semesterWeekOf(
  dueAt: string,
  calendar: SemesterWeekCalendar,
  timeZone: string,
): SemesterWeekPosition | null {
  const { startDay } = requireCalendar(calendar);
  const formatter = requireDateFormatter(timeZone);

  if (typeof dueAt !== 'string' || dueAt.trim().length === 0) return null;
  const epochMs = Date.parse(dueAt);
  if (!Number.isFinite(epochMs)) return null;

  const date = localDateKey(epochMs, formatter);
  const day = civilDayNumber(date);
  const offset = day - startDay;

  // 学期开始之前：不编「第 0 周」，交给调用方决定「这是假期/上学期」
  if (offset < 0) return null;

  return {
    week: Math.floor(offset / 7) + 1,
    weekday: isoWeekdayOf(day),
    date,
  };
}
