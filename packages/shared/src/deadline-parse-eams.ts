/**
 * 课程 DDL · EAMS 教务系统解析（三端共用）
 *
 * ## 出处（合并声明）
 *
 * 移植自 **秦QIN** 的 `src/plugins/builtin/academic/parsers.ts`
 * （`eamsSelection` / `eamsTimetable`）。来源项目：秦QIN
 * （`dev.matrix.shell`，2026 上海科技大学黑客松参赛组）。
 * 合并授权：项目负责人唐志昊确认三个参赛项目已同意合并。
 *
 * ## 为什么 EAMS 不能当普通网页解析
 *
 * EAMS（`eams.shanghaitech.edu.cn`）的课表页**不是**服务端渲染的表格：它是一段
 * 脚本，逐个 `new TaskActivity(...)` 把排课塞进页面。上游用一个很聪明的边界做到
 * 「不执行网页脚本」：**只读字符串字面量**（`readJsStringLiterals`），绝不 `eval`，
 * 也绝不注入 DOM。
 *
 * 这段逻辑在我们这里价值更高：我们**永远**不会在小程序 / WebView 里跑教务页的脚本，
 * 所以「把字面量读成数据结构」是唯一能安全拿到排课的路子。
 *
 * ## 字段约定（保持上游语义，但全部显式化）
 *
 * `TaskActivity` 的前 7 个字符串参数依次是：
 *
 * ```
 * 0 teacherId  1 teacherName  2 courseNativeId  3 courseLabel
 * 4 roomId     5 location     6 weekBits
 * ```
 *
 * - `courseLabel` 形如 `高等数学(CS101)`：**末尾括号里是课程代码**，其余是课程名；
 * - `weekBits` 是 `01011…`：第 `i` 位为 `'1'` 表示第 `i` 周有课。上游发现首字符
 *   不可能是 `'1'`（否则就是「第 0 周」），所以首字符为 `'1'` 时**拒绝解析** ——
 *   编码基准不明时宁可报错，也不把周次整体错位一周。
 * - 节次来自 `index = 3 * unitCount + 4`：`3` 是星期（0 起），`4` 是节次（0 起）。
 *
 * ## 边界
 *
 * - 纯函数，不执行脚本、不联网、不持有会话；
 * - 解析失败返回 `Result`，不抛异常；失败语义是「保留旧课表」，绝不返回空表；
 * - 不猜时区：课表只有「第几周第几节」，绝对时刻由调用方用它自己的第 1 周起点换算
 *   （上游在自己的 UI 层做，我们把它留给课表模块，共享层不越界）。
 */

import {
  deadlineParseFailure,
  htmlText,
  inspectPlatformPage,
  readJsStringLiterals,
  type DeadlineParseResult,
} from './deadline-parse-html';

/* ------------------------------------------------------------------ *
 * 类型
 * ------------------------------------------------------------------ */

/** EAMS 课表页地址（只能在浏览器里由用户自己打开） */
export const EAMS_TIMETABLE_URL =
  'https://eams.shanghaitech.edu.cn/eams/courseTableForStd.action';

/** 上午 / 下午 / 晚上 —— 只用于配色与分组，不参与时间计算 */
export type EamsPeriodGroup = '上午' | '下午' | '晚上';

/** 一个「节次」（第 N 节几点到几点） */
export interface EamsPeriod {
  /** `HH:mm` */
  readonly start: string;
  /** `HH:mm` */
  readonly end: string;
  readonly group: EamsPeriodGroup;
}

/** 一条排课规则（同门课同一时段的多周合并成一条） */
export interface EamsLesson {
  /** 稳定 ID：`<courseId>:<weekday>:<first>:<last>:<周次列表>` —— 不含教室/教师 */
  readonly id: string;
  readonly courseId: string;
  readonly title: string;
  /** 课程代码（`courseLabel` 末尾括号里的内容）；没有则为空串 */
  readonly code: string;
  readonly term: string;
  readonly teacher: string;
  readonly location: string;
  /** 1 = 周一 … 7 = 周日 */
  readonly weekday: number;
  /** 起始节次（1 起，闭区间） */
  readonly first: number;
  /** 结束节次（1 起，闭区间） */
  readonly last: number;
  /** 上课周次（1 起，升序去重） */
  readonly weeks: readonly number[];
}

/** 课表里出现的一门课 */
export interface EamsCourse {
  readonly id: string;
  readonly title: string;
  readonly code: string;
  readonly term: string;
  readonly url: string;
}

/** `parseEamsTimetable` 的结果 */
export interface EamsTimetable {
  readonly lessons: readonly EamsLesson[];
  readonly courses: readonly EamsCourse[];
  /** 页面上能读到的节次时间表（可能为空 —— 页面没给就交给用户设置） */
  readonly periods: readonly EamsPeriod[];
}

/** 「选课/课表查询」表单参数 */
export interface EamsSelection {
  /** 学号（纯数字） */
  readonly student: string;
  /** 学期 ID（纯数字） */
  readonly semester: string;
  /** 表单请求体原文。**不包含**任何 token / 密码 */
  readonly body: string;
}

/* ------------------------------------------------------------------ *
 * 选课参数
 * ------------------------------------------------------------------ */

const ADD_INPUT_IDS_RE = /addInput\(\s*form\s*,\s*["']ids["']\s*,\s*["'](\d+)["']\s*\)/;
const SEMESTER_CALENDAR_RE = /semesterCalendar\(\s*\{[^}]*value\s*:\s*["'](\d+)["']/;
const INPUT_TAG_RE = /<input\b[^>]*>/gi;

/** 从 `<input>` 里按 name 取 value（第一个命中的） */
function readInputValue(html: string, name: string): string | null {
  for (const match of html.matchAll(INPUT_TAG_RE)) {
    const tag = match[0];
    const tagName = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(tag);
    const found = tagName?.[1] ?? tagName?.[2] ?? tagName?.[3] ?? '';
    if (found !== name) continue;

    const value = /\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(tag);
    return value?.[1] ?? value?.[2] ?? value?.[3] ?? '';
  }
  return null;
}

/**
 * 读「按学生 + 学期查课表」所需的两个参数。
 *
 * 两个来源都试：页面脚本里的 `addInput(form,"ids","…")` / `semesterCalendar({value:"…"})`，
 * 以及隐藏的 `<input name="ids" value="…">`。**都读不到就失败** —— 拼一个空学号的请求
 * 只会让教务返回错误页，用户还以为是网络问题。
 */
export function parseEamsSelection(
  html: string,
  semesterOverride?: string,
): DeadlineParseResult<EamsSelection> {
  const blocked = inspectPlatformPage({ html, url: EAMS_TIMETABLE_URL });
  if (blocked !== null) return { ok: false, error: blocked };

  const student =
    ADD_INPUT_IDS_RE.exec(html)?.[1] ?? readInputValue(html, 'ids') ?? '';
  const semester =
    (semesterOverride !== undefined && semesterOverride.length > 0
      ? semesterOverride
      : (SEMESTER_CALENDAR_RE.exec(html)?.[1] ?? readInputValue(html, 'semester.id'))) ?? '';

  if (!/^\d+$/.test(student) || !/^\d+$/.test(semester)) {
    return {
      ok: false,
      error: deadlineParseFailure(
        'unrecognized-structure',
        '教务页未提供学生或学期参数，请先在网页登录到个人课表',
      ),
    };
  }

  return {
    ok: true,
    value: {
      student,
      semester,
      body: `setting.kind=std&startWeek=&semester.id=${semester}&ids=${student}`,
    },
  };
}

/* ------------------------------------------------------------------ *
 * 课表
 * ------------------------------------------------------------------ */

/**
 * 一个 `TaskActivity` 块。
 *
 * 参数区用 `[^;]*?`：参数里只有字符串与数字，没有分号；课程名里的括号、逗号都不影响。
 * 块体后面的内容归到「节次坐标」区，切到下一个 `TaskActivity` / `</script>` / 文末为止。
 */
const ACTIVITY_BLOCK_RE =
  /activity\s*=\s*new\s+TaskActivity\(\s*([^;]*?)\s*\)\s*;([\s\S]*?)(?=(?:var\s+)?activity\s*=\s*new\s+TaskActivity|\/script>|$)/gi;

/** `index = 3 * unitCount + 4`：3 是星期（0 起），4 是节次（0 起） */
const SLOT_RE = /index\s*=\s*(\d+)\s*\*\s*(?:unitCount|\d+)\s*\+\s*(\d+)/gi;

const WEEK_BITS_RE = /^[01]{2,64}$/;

const PERIOD_RANGE_RE = /(\d{1,2}:\d{2})\s*[-–~]\s*(\d{1,2}:\d{2})/g;

/** 页面明确写「这学期没课」 */
const NO_LESSON_RE = /本学期无课|暂无课表|没有排课/;

/** 教务明确报错 / 拒绝 */
const REFUSED_RE = /error\.courseTable|没有权限|会话超时/;

/** 课程标签：`高等数学(CS101)` → 名称 + 代码 */
const COURSE_CODE_RE = /\(([^()]*)\)\s*$/;

/** 姓名里至少要有一个字母或数字，否则是空白/占位符 */
const NAME_RE = /[\p{L}\p{N}]/u;

/**
 * 解析 EAMS 课表页。
 *
 * 失败即「保留旧课表」：任何一处结构对不上都整体失败，**不返回部分结果** ——
 * 半张课表比旧课表更危险（学生会以为那门课取消了）。
 */
export function parseEamsTimetable(
  html: string,
  semester: string,
): DeadlineParseResult<EamsTimetable> {
  const blocked = inspectPlatformPage({ html, url: EAMS_TIMETABLE_URL });
  if (blocked !== null) return { ok: false, error: blocked };

  if (REFUSED_RE.test(html)) {
    return {
      ok: false,
      error: deadlineParseFailure('source-refused', '教务课表请求未成功，保留旧课表'),
    };
  }

  const lessons: EamsLesson[] = [];
  const courses = new Map<string, EamsCourse>();
  let blockCount = 0;

  for (const block of html.matchAll(ACTIVITY_BLOCK_RE)) {
    blockCount += 1;
    const args = readJsStringLiterals(block[1] ?? '');
    if (args.length < 7) {
      return {
        ok: false,
        error: deadlineParseFailure('inconsistent-page', '教务排课字段发生变化'),
      };
    }

    const teacher = args[1] ?? '';
    const courseNative = args[2] ?? '';
    const courseLabel = args[3] ?? '';
    const location = args[5] ?? '';
    const weekBits = args[6] ?? '';

    if (!WEEK_BITS_RE.test(weekBits)) {
      return { ok: false, error: deadlineParseFailure('inconsistent-page', '教务周次编码未识别') };
    }

    const weeks = [...weekBits].flatMap((bit, index) => (bit === '1' ? [index] : []));
    // 首字符为 '1' 意味着「第 0 周」—— 说明编码基准换了，整体会错位一周
    if (weeks.includes(0)) {
      return {
        ok: false,
        error: deadlineParseFailure('inconsistent-page', '教务周次编码基准不明确，需要确认'),
      };
    }

    const code = COURSE_CODE_RE.exec(courseLabel)?.[1] ?? '';
    const title = courseLabel.replace(COURSE_CODE_RE, '').trim();
    const courseId = `eams:${semester}:${courseNative}`;

    courses.set(courseId, { id: courseId, title, code, term: semester, url: EAMS_TIMETABLE_URL });

    const byDay = new Map<number, number[]>();
    for (const slot of (block[2] ?? '').matchAll(SLOT_RE)) {
      const weekday = Number(slot[1]) + 1;
      const unit = Number(slot[2]) + 1;
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
        return { ok: false, error: deadlineParseFailure('inconsistent-page', '教务星期坐标越界') };
      }
      const units = byDay.get(weekday);
      if (units === undefined) byDay.set(weekday, [unit]);
      else units.push(unit);
    }

    if (byDay.size === 0) {
      return { ok: false, error: deadlineParseFailure('inconsistent-page', '教务节次坐标未识别') };
    }

    for (const [weekday, units] of byDay) {
      for (const group of groupConsecutive(units)) {
        const first = group[0];
        const last = group[group.length - 1];
        if (first === undefined || last === undefined) continue;
        // 身份不含地点与教师：源页面修正这些字段后，用户备注仍能对上
        lessons.push({
          id: `${courseId}:${weekday}:${first}:${last}:${weeks.join('.')}`,
          courseId,
          title,
          code,
          term: semester,
          teacher: NAME_RE.test(teacher) ? teacher.trim() : '',
          location,
          weekday,
          first,
          last,
          weeks,
        });
      }
    }
  }

  if (lessons.length === 0 && blockCount === 0 && !NO_LESSON_RE.test(htmlText(html))) {
    return {
      ok: false,
      error: deadlineParseFailure('unrecognized-structure', '未识别到教务排课数据，需要检查页面结构'),
    };
  }

  return { ok: true, value: { lessons, courses: [...courses.values()], periods: readPeriods(html) } };
}

/** 把升序节次分成连续段：`[1,2,3,5]` → `[[1,2,3],[5]]` */
function groupConsecutive(units: readonly number[]): number[][] {
  const sorted = [...new Set(units)].sort((left, right) => left - right);
  const groups: number[][] = [];

  for (const unit of sorted) {
    const last = groups[groups.length - 1];
    const tail = last?.[last.length - 1];
    if (last !== undefined && tail !== undefined && tail + 1 === unit) last.push(unit);
    else groups.push([unit]);
  }

  return groups;
}

/**
 * 从页面文本里读节次时间表（`08:15-09:00`）。
 *
 * 只做「去重 + 归类」，不做「第几节」的推断 —— 页面把时间列出来不代表顺序就是节次顺序。
 * 读不到返回空数组，由课表模块用自己的默认节次表。
 */
function readPeriods(html: string): EamsPeriod[] {
  const periods: EamsPeriod[] = [];

  for (const match of html.matchAll(PERIOD_RANGE_RE)) {
    const start = (match[1] ?? '').padStart(5, '0');
    const end = (match[2] ?? '').padStart(5, '0');
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) continue;
    if (periods.some((period) => period.start === start)) continue;

    const hour = Number(start.slice(0, 2));
    const group: EamsPeriodGroup = hour < 12 ? '上午' : hour < 18 ? '下午' : '晚上';
    periods.push({ start, end, group });
  }

  return periods;
}
