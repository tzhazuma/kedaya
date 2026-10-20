/**
 * 课程 DDL · Gradescope 页面解析（三端共用）
 *
 * ## 出处（合并声明）
 *
 * 移植自 **秦QIN** 的 `src/plugins/builtin/academic/parsers.ts`
 * （`gradescopeCourses` / `gradescopeAssignments`）。来源项目：秦QIN
 * （`dev.matrix.shell`，2026 上海科技大学黑客松参赛组）。
 * 合并授权：项目负责人唐志昊确认三个参赛项目已同意合并。
 *
 * 按我们的标准重写，**不是**逐行复制：
 * - 上游返回裸对象数组，字段是位置参数式拼出来的；这里每个字段都有名字和类型；
 * - 上游认不出页面就 `throw new Error('未识别…')`；这里返回带 code 的失败对象；
 * - 上游两处 `rows.set` 的覆盖规则藏在 `if(!rows.has(id)||term)` 里，这里拆成
 *   `addCourse` 单向合并并写进注释；
 * - 全部行为有测试（`deadline-parse-gradescope.test.ts`）。
 *
 * ## 这个平台为什么难
 *
 * Gradescope 的作业表格里，「截止」不是一个干净的时间字段，而是一整句拼起来的文本：
 *
 * ```html
 * <td class="submissionTimeChart--dueDate">
 *   5 days, 14 seconds left  Oct 13 at 8:00PM  Oct 22 at 11:59PM
 *   Late Due Date: Oct 22 at 11:59PM
 * </td>
 * ```
 *
 * 第一个日期是**发布**时间、最后一段是**迟交**截止、中间那个才是真正的截止。
 * 取错一个，学生就晚一天交。所以顺序写死：
 *
 *   1. 有 `class="…--dueDate"` 的 `datetime` 属性 → 用它（机器可读，最可信）；
 *   2. 否则把单元格文本从 `Late Due Date` 处切断，取**剩下最后一个**日期；
 *   3. 再否则取单元格里最后一个非 `releaseDate` 的 `datetime`；
 *   4. 都没有 → `dueAtIso: null` + 原文进 `dueText`，UI 显示「时间待定」。
 *
 * ## 边界
 *
 * - 纯函数：没有网络、没有登录态、没有 Cookie；
 * - 只产出**平台课程/作业**，不产出 `DeadlineItem`：`courseName`、`kind`、`weight`
 *   这些要靠跨平台聚合才能定，硬塞会逼调用方编字段；
 * - 不猜日期：缺时间返回 `null`（见 `parseDateSpanToIso`）。
 */

import {
  collectAnchors,
  deadlineParseFailure,
  htmlText,
  inspectPlatformPage,
  pickDateSpanText,
  parseDateSpanToIso,
  readSubmissionState,
  readTagAttribute,
  type DateSpanParseOptions,
  type DeadlineParseResult,
  type SubmissionState,
} from './deadline-parse-html';

/* ------------------------------------------------------------------ *
 * 类型
 * ------------------------------------------------------------------ */

/** 标题上限。平台标题偶尔会带上整段说明，截断避免撑爆列表与数据库列 */
const MAX_TITLE_LENGTH = 200;

/** Dashboard 上的一门课 */
export interface GradescopeCourse {
  /** 稳定 ID：`gradescope:<课程数字 ID>` */
  readonly id: string;
  /** 平台自己的课程数字 ID（URL 里那个） */
  readonly nativeId: string;
  /** 课程名（取课程卡片标题，不是学期名） */
  readonly name: string;
  /**
   * 学期标签，如 `Fall 2026`。**可能为空串** —— 侧栏重复出现的课程卡片没有学期，
   * 学期只能从页面标题分组里读；读不到就是空，不编。
   */
  readonly term: string;
  /** 课程页绝对地址 */
  readonly url: string;
}

/** 一条作业 */
export interface GradescopeAssignment {
  /** 稳定 ID：`<courseId>:assignment:<作业数字 ID>` */
  readonly id: string;
  readonly courseId: string;
  /** 平台自己的作业数字 ID */
  readonly nativeId: string;
  readonly title: string;
  readonly url: string;
  /** 截止时刻（ISO-8601 UTC）。缺时间/认不出为 `null` */
  readonly dueAtIso: string | null;
  /** 截止原文（只保留日期那一段，见 `pickDateSpanText`）；认不出时为截断的单元格文本 */
  readonly dueText: string;
  /** 迟交截止（ISO-8601 UTC）。页面没写迟交日期时为 `null` */
  readonly lateDueAtIso: string | null;
  readonly submission: SubmissionState;
}

/* ------------------------------------------------------------------ *
 * 课程列表
 * ------------------------------------------------------------------ */

/** 学期词：`Fall 2026` / `2026 Fall` / `Spring 2027` */
const TERM_PATTERN = /(?:Fall|Spring|Summer|Winter)\s+20\d{2}|20\d{2}\s+(?:Fall|Spring|Summer|Winter)/i;

/** 页面明确说「没有课程」时不算失败 */
const NO_COURSE_PATTERN = /no (?:active )?courses|not (?:currently )?enrolled|尚未选课|没有课程/i;

/**
 * 学期分组标题。
 *
 * 只认两种结构：`<h1>…<h6>` 标题，或 `class` 里带 `courseList--term` 的 `div`。
 * 不认任意 `div` —— 页面正文里出现「Fall」的普通容器会把作业标题误当学期。
 */
const TERM_HEADING_RE = /<(h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>|<div\b([^>]*)>([\s\S]*?)<\/div>/gi;

function findTermHeadings(html: string): Array<{ at: number; term: string }> {
  const headings: Array<{ at: number; term: string }> = [];

  for (const match of html.matchAll(TERM_HEADING_RE)) {
    const isDiv = match[1] === undefined;
    if (isDiv) {
      const classes = readTagAttribute(`<div ${match[4] ?? ''}>`, 'class').split(/\s+/);
      if (!classes.includes('courseList--term')) continue;
    }
    const inner = (isDiv ? match[5] : match[3]) ?? '';
    const text = htmlText(inner);
    const term = TERM_PATTERN.exec(text)?.[0];
    if (term !== undefined) headings.push({ at: match.index ?? 0, term });
  }

  return headings;
}

/** 课程名：优先卡片里的标题元素，其次元素类名带 courseName 的，最后退回链接文本 */
const CARD_HEADING_RE = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i;
const CARD_NAME_RE = /<[a-z][^>]*class\s*=\s*["'][^"']*(?:courseName|course-name)[^"']*["'][^>]*>([\s\S]*?)<\//i;

function readCourseName(
  anchorHtml: string,
  anchorText: string,
): { readonly name: string; readonly fromCard: boolean } {
  const heading = CARD_HEADING_RE.exec(anchorHtml)?.[1];
  const named = CARD_NAME_RE.exec(anchorHtml)?.[1];
  const inner = htmlText(heading ?? named ?? '');
  return {
    name: (inner || anchorText).slice(0, MAX_TITLE_LENGTH),
    fromCard: inner.length > 0,
  };
}

/**
 * 解析 Gradescope Dashboard 的课程列表。
 *
 * 只认同源、`/courses/<数字>` 的链接。侧栏会重复出现同一门课（没有学期），
 * Dashboard 卡片带学期 —— **带学期的赢**，这样 `term` 不会被侧栏冲掉。
 */
export function parseGradescopeCourseList(
  html: string,
  baseUrl: string,
): DeadlineParseResult<GradescopeCourse[]> {
  const blocked = inspectPlatformPage({ html, url: baseUrl });
  if (blocked !== null) return { ok: false, error: blocked };

  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return { ok: false, error: deadlineParseFailure('invalid-url', 'Gradescope 地址不是合法 URL') };
  }

  const termHeadings = findTermHeadings(html);
  const courses = new Map<string, { readonly course: GradescopeCourse; readonly rank: number }>();

  for (const anchor of collectAnchors(html, baseUrl)) {
    if (new URL(anchor.url).origin !== origin) continue;

    const nativeId = /^\/courses\/(\d+)\/?$/.exec(new URL(anchor.url).pathname)?.[1];
    if (nativeId === undefined) continue;

    const id = `gradescope:${nativeId}`;
    const { name, fromCard } = readCourseName(anchor.html, anchor.text);
    const term = readTerm(anchor, termHeadings);
    // 同一个课程会被渲染两次：Dashboard 卡片（有标题元素 + 学期）和侧栏纯文本链接
    // （没有标题元素，学期是从上一个小标题「继承」来的）。按信息量打分，高的留下：
    //   学期 2 分 + 卡片结构 1 分。同分保留先出现的，保证解析幂等。
    const rank = (term.length > 0 ? 2 : 0) + (fromCard ? 1 : 0);
    const existing = courses.get(id);
    if (existing !== undefined && existing.rank >= rank) continue;

    courses.set(id, { course: { id, nativeId, name, term, url: anchor.url }, rank });
  }

  if (courses.size === 0) {
    // 页面明确写「没有课程」是合法答案；否则是结构不认识（平台改版 / 抓错页面）
    if (NO_COURSE_PATTERN.test(htmlText(html))) return { ok: true, value: [] };
    return {
      ok: false,
      error: deadlineParseFailure(
        'unrecognized-structure',
        '未识别 Gradescope 课程列表，已保留上次数据',
      ),
    };
  }

  return { ok: true, value: [...courses.values()].map((entry) => entry.course) };
}

/** 学期：先看链接之前最近的分组标题，再看链接自己的文本 */
function readTerm(
  anchor: { readonly text: string; readonly index: number },
  headings: readonly { readonly at: number; readonly term: string }[],
): string {
  let heading: string | undefined;
  for (const candidate of headings) {
    if (candidate.at < anchor.index) heading = candidate.term;
    else break;
  }
  if (heading !== undefined) return heading;
  return TERM_PATTERN.exec(anchor.text)?.[0] ?? '';
}

/* ------------------------------------------------------------------ *
 * 作业表
 * ------------------------------------------------------------------ */

const ROW_RE = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL_RE = /<td\b[^>]*>[\s\S]*?<\/td>/gi;
const TIME_TAG_RE = /<(?:time|span)\b[^>]*\bdatetime\s*=\s*(["'])([\s\S]*?)\1[^>]*>/gi;
const ASSIGNMENT_PATH_RE = /^\/courses\/(\d+)\/assignments\/(\d+)/;
const LATE_MARKER_RE = /Late\s+Due\s*Date/i;
const RELEASE_CLASS_RE = /releaseDate/i;

interface TimeTag {
  readonly isoValue: string;
  readonly classes: readonly string[];
}

/** 单元格里的 `datetime` 属性（`<time datetime="…">` / `<span datetime="…">`） */
function collectTimeTags(fragment: string): TimeTag[] {
  const tags: TimeTag[] = [];

  for (const match of fragment.matchAll(TIME_TAG_RE)) {
    const value = match[2] ?? '';
    if (value.length === 0) continue;
    tags.push({ isoValue: value, classes: readTagAttribute(match[0], 'class').split(/\s+/) });
  }

  return tags;
}

function hasClassSuffix(tag: TimeTag, suffix: string): boolean {
  return tag.classes.some((className) => className.toLowerCase().endsWith(suffix.toLowerCase()));
}

/**
 * 一次「截止」判定的完整证据。
 *
 * 拆出来是为了让测试能直接断言中间结论（哪一段是迟交、截止取的是哪一个），
 * 而不是只断言最终的 ISO 串 —— 时间错了却看不出是哪一步错的调试成本太高。
 */
interface DueCellReading {
  readonly dueText: string;
  readonly lateText: string | null;
  readonly hasLate: boolean;
}

/** 把截止单元格切成「截止段」和「迟交段」 */
function readDueCell(dueCellHtml: string): DueCellReading {
  const cellText = htmlText(dueCellHtml);
  const lateAt = cellText.search(LATE_MARKER_RE);

  if (lateAt === -1) {
    return { dueText: pickDateSpanText(cellText, 'last'), lateText: null, hasLate: false };
  }

  const beforeLate = cellText.slice(0, lateAt).trim();
  const afterLate = cellText.slice(lateAt).replace(/^Late\s+Due\s*Date\s*[:：]?/i, '').trim();
  return {
    dueText: pickDateSpanText(beforeLate.length > 0 ? beforeLate : cellText, 'last'),
    lateText: afterLate.length > 0 ? pickDateSpanText(afterLate, 'last') : null,
    hasLate: true,
  };
}

/**
 * 解析一门课的作业表格。
 *
 * @param html   课程作业列表页 HTML
 * @param course 课程（来自 `parseGradescopeCourseList`；`term` 用于补全缺年份的日期）
 * @param options `timeZone` / `now` / 可选 `term` 覆盖
 */
export function parseGradescopeAssignments(
  html: string,
  course: GradescopeCourse,
  options: DateSpanParseOptions & { readonly url?: string },
): DeadlineParseResult<GradescopeAssignment[]> {
  const pageUrl = options.url ?? course.url;
  const blocked = inspectPlatformPage({ html, url: pageUrl });
  if (blocked !== null) return { ok: false, error: blocked };

  let courseOrigin: string;
  try {
    courseOrigin = new URL(course.url).origin;
  } catch {
    return { ok: false, error: deadlineParseFailure('invalid-url', 'Gradescope 课程地址不是合法 URL') };
  }

  const dateOptions: DateSpanParseOptions = {
    timeZone: options.timeZone,
    now: options.now,
    term: options.term ?? course.term,
  };

  const assignments = new Map<string, GradescopeAssignment>();

  for (const row of html.matchAll(ROW_RE)) {
    const rowHtml = row[1] ?? '';
    const link = collectAnchors(rowHtml, course.url).find((candidate) => {
      const url = new URL(candidate.url);
      const match = ASSIGNMENT_PATH_RE.exec(url.pathname);
      return (
        url.origin === courseOrigin &&
        match !== null &&
        match[1] === course.nativeId
      );
    });
    if (link === undefined) continue;

    const nativeId = /\/assignments\/(\d+)/.exec(new URL(link.url).pathname)?.[1];
    if (nativeId === undefined) continue;

    const cells = [...rowHtml.matchAll(CELL_RE)].map((cell) => cell[0]);
    const dueCell =
      cells.find((cell) => /dueDate|due-date|Due Date/i.test(cell)) ?? cells.at(-1) ?? rowHtml;

    const timeTags = collectTimeTags(dueCell);
    const dueTag = timeTags.find((tag) => hasClassSuffix(tag, '--dueDate'));
    const lateTag = timeTags.find((tag) => /late/i.test(tag.classes.join(' ')));
    const reading = readDueCell(dueCell);

    const dueIso =
      dueTag === undefined
        ? (() => {
            const spanText = reading.dueText;
            const fromSpan = parseDateSpanToIso(spanText, dateOptions);
            if (fromSpan !== null) return fromSpan;
            // 页面的 datetime 属性不带类名时，用最后一个非 releaseDate 的机器时间
            const machine = [...timeTags]
              .reverse()
              .find((tag) => !RELEASE_CLASS_RE.test(tag.classes.join(' ')));
            return machine === undefined ? null : parseDateSpanToIso(machine.isoValue, dateOptions);
          })()
        : parseDateSpanToIso(dueTag.isoValue, dateOptions);

    // 迟交只在这两个条件都成立时给：页面**明确写了**迟交日期，且能解析出时刻。
    // 上游用 `times[1]` 兜底 —— 第三个时间标签可能是别的字段，会把迟交日期算错。
    const lateIso =
      reading.hasLate && reading.lateText !== null
        ? (lateTag === undefined
            ? parseDateSpanToIso(reading.lateText, dateOptions)
            : parseDateSpanToIso(lateTag.isoValue, dateOptions)) ??
          parseDateSpanToIso(reading.lateText, dateOptions)
        : null;

    assignments.set(nativeId, {
      id: `${course.id}:assignment:${nativeId}`,
      courseId: course.id,
      nativeId,
      title: (link.text || `Assignment ${nativeId}`).slice(0, MAX_TITLE_LENGTH),
      url: `${courseOrigin}/courses/${course.nativeId}/assignments/${nativeId}`,
      dueAtIso: dueIso,
      dueText: reading.dueText,
      lateDueAtIso: lateIso,
      submission: readSubmissionState(htmlText(rowHtml)),
    });
  }

  if (assignments.size === 0) {
    // 空表格只有在页面明确说「没有作业」时才可信
    if (/assignment(s|[-_]list|[-_]table)|no assignments|暂无作业/i.test(html)) {
      return { ok: true, value: [] };
    }
    return {
      ok: false,
      error: deadlineParseFailure(
        'unrecognized-structure',
        '未识别 Gradescope 作业表，已保留上次数据',
      ),
    };
  }

  return { ok: true, value: [...assignments.values()] };
}
