/**
 * 课程 DDL · Blackboard（上科大 elearning，端口 8443）页面解析（三端共用）
 *
 * ## 出处（合并声明）
 *
 * 移植自 **秦QIN** 的 `src/plugins/builtin/academic/parsers.ts`
 * （`blackboardCourses` / `blackboardModule` / `blackboardCurrentCourses` /
 * `blackboardAssignment` / `blackboardPending`）。来源项目：秦QIN
 * （`dev.matrix.shell`，2026 上海科技大学黑客松参赛组）。
 * 合并授权：项目负责人唐志昊确认三个参赛项目已同意合并。
 *
 * 按我们的标准重写：类型化返回值、失败带 code、去掉 `try/catch` 控制流、
 * 模块定位与空列表判定分开测。全部行为见 `deadline-parse-blackboard.test.ts`。
 *
 * ## Blackboard 的三个坑（每个都对应一段被保留的逻辑）
 *
 * 1. **同名文字不只出现一次**。「未完成课程列表」「待完成作业」这些字符串既是模块标题，
 *    也可能出现在模块排序控件、总课程列表、已完成列表里。所以不能全文搜标题，
 *    必须**从 `.moduleTitle` 这个真实的模块标题元素**往下切出模块区块
 *    （到下一个 `.portlet` 或下一个模块标题为止）。
 * 2. **空列表 ≠ 解析失败**。门户在「本学期没有课」时会渲染一个空的
 *    `<ul class="courseListing">`。把它当失败会让用户看到红错，而不是「没有课」。
 *    反过来，模块还没加载完（`正在加载`）也不能当空列表 —— 那就是漏报。
 * 3. **目录页也会出现「提交作业」**。只有 URL 形如
 *    `/webapps/assignment/uploadAssignment` 且带 `content_id` / `assign_group_id`
 *    的页面才是作业，其余一律返回 `null`（合法但不是作业）。
 *
 * ## 边界
 *
 * - 纯函数：无网络、无凭据、不提交作业、不发帖；
 * - 只产出平台课程/作业；`DeadlineItem` 的 `courseName`/`kind` 由聚合层补；
 * - `lateDueAtIso` 恒为 `null`：BB 的作业页不区分「迟交截止」，我们不编。
 */

import {
  collectAnchors,
  deadlineParseFailure,
  htmlText,
  inspectPlatformPage,
  parseDateSpanToIso,
  pickDateSpanText,
  readSubmissionState,
  readTagAttribute,
  type DateSpanParseOptions,
  type DeadlineParseResult,
  type SubmissionState,
} from './deadline-parse-html';

/* ------------------------------------------------------------------ *
 * 类型
 * ------------------------------------------------------------------ */

/** 标题上限，同 Gradescope 模块 */
const MAX_TITLE_LENGTH = 200;

/** Blackboard 门户里的一门课 */
export interface BlackboardCourse {
  /** 稳定 ID：`blackboard:<course_id>` */
  readonly id: string;
  /** 平台原生的 `course_id`（URL 查询参数里那个） */
  readonly nativeId: string;
  readonly title: string;
  readonly url: string;
}

/** 一条作业 */
export interface BlackboardAssignment {
  /** 稳定 ID：`<courseId>:assignment:<content_id|assign_group_id>` */
  readonly id: string;
  readonly courseId: string;
  /** 平台原生 ID（`content_id` 优先，其次 `assign_group_id`） */
  readonly nativeId: string;
  readonly title: string;
  readonly url: string;
  /** 截止时刻（ISO-8601 UTC）；缺时间/认不出为 `null` */
  readonly dueAtIso: string | null;
  /** 截止原文（只保留日期那一段） */
  readonly dueText: string;
  /** BB 作业页没有独立的迟交截止，恒为 `null` */
  readonly lateDueAtIso: null;
  readonly submission: SubmissionState;
}

/** 门户「待完成作业」模块里的一条入口 */
export interface BlackboardPendingLink {
  readonly url: string;
  readonly title: string;
  readonly courseId: string;
}

/** 「待完成作业」模块的读取结果 */
export interface BlackboardPendingModule {
  readonly links: readonly BlackboardPendingLink[];
  /** 模块明确写了「您目前没有未完成的作业」。`links` 非空时恒为 `false` */
  readonly empty: boolean;
}

/* ------------------------------------------------------------------ *
 * 模块定位
 * ------------------------------------------------------------------ */

const MODULE_TITLE_RE =
  /<span\b[^>]*class\s*=\s*["'][^"']*\bmoduleTitle\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;

const PORTLET_DIV_RE = /<div\b[^>]*>/gi;

/**
 * 按模块标题切出模块区块的 HTML。
 *
 * @param html  整页 HTML
 * @param title 模块标题的正则（**匹配可见文本**，调用方注意 `^…$`）
 * @returns 区块 HTML；找不到返回 `null`（调用方区分「模块不存在」与「结构不认识」）
 */
export function findBlackboardModule(html: string, title: RegExp): string | null {
  if (typeof html !== 'string' || html.length === 0) return null;

  const headings = [...html.matchAll(MODULE_TITLE_RE)].map((match) => ({
    index: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    text: htmlText(match[1] ?? ''),
  }));

  const heading = headings.find((candidate) => title.test(candidate.text));
  if (heading === undefined) return null;

  const rest = html.slice(heading.end);

  // 区块边界 = 下一个 portlet 容器 或 下一个模块标题，取更近的那个
  PORTLET_DIV_RE.lastIndex = 0;
  let boundary = rest.length;
  for (const match of rest.matchAll(PORTLET_DIV_RE)) {
    const classes = readTagAttribute(match[0], 'class').split(/\s+/);
    if (classes.includes('portlet')) {
      boundary = match.index ?? rest.length;
      break;
    }
  }

  const nextHeading = headings.find((candidate) => candidate.index > heading.index);
  if (nextHeading !== undefined) {
    const nextOffset = nextHeading.index - heading.end;
    if (nextOffset >= 0 && nextOffset < boundary) boundary = nextOffset;
  }

  return rest.slice(0, boundary);
}

/* ------------------------------------------------------------------ *
 * 课程
 * ------------------------------------------------------------------ */

const COURSE_LIST_RE = /<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi;
const EMPTY_COURSE_LIST_RE = /(?:没有|暂无|无)(?:未完成的?|本学期)?课程|no courses/i;
const NO_PENDING_HOMEWORK_RE = /您目前没有未完成的作业/;
const LOADING_RE = /请等待|正在加载|loading/i;
const UNFINISHED_COURSES_TITLE_RE = /未完成课程列表|Uncompleted\s+Course\s+List/i;

/**
 * 从任意一段 HTML 里提取课程入口。
 *
 * 识别两种形态：
 * - 课程主页链接：`?course_id=<id>`；
 * - 门户启动器：`/webapps/blackboard/execute/launcher?type=Course&id=<id>`。
 *
 * 只认同源链接；标题为空的链接（图标、分隔条）丢弃。同一 `course_id` 只留第一次出现
 * 的那条 —— 门户侧栏会重复渲染同一门课。
 */
export function parseBlackboardCourseLinks(
  html: string,
  baseUrl: string,
): DeadlineParseResult<BlackboardCourse[]> {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return { ok: false, error: deadlineParseFailure('invalid-url', 'Blackboard 地址不是合法 URL') };
  }

  const courses = new Map<string, BlackboardCourse>();

  for (const anchor of collectAnchors(html, baseUrl)) {
    const url = new URL(anchor.url);
    if (url.origin !== origin) continue;

    const nativeId =
      (url.searchParams.get('course_id') ?? '').length > 0
        ? url.searchParams.get('course_id')
        : /\/webapps\/blackboard\/execute\/launcher$/i.test(url.pathname) &&
            url.searchParams.get('type') === 'Course'
          ? url.searchParams.get('id')
          : null;

    if (nativeId === null || nativeId.length === 0) continue;
    if (anchor.text.length === 0) continue;

    const id = `blackboard:${nativeId}`;
    if (courses.has(id)) continue;

    courses.set(id, {
      id,
      nativeId,
      title: anchor.text.slice(0, MAX_TITLE_LENGTH),
      url: anchor.url,
    });
  }

  if (courses.size === 0) {
    return {
      ok: false,
      error: deadlineParseFailure(
        'unrecognized-structure',
        'BB 门户没有可识别的课程入口，需检查课程模块',
      ),
    };
  }

  return { ok: true, value: [...courses.values()] };
}

/**
 * 从门户首页的「未完成课程列表」模块读本学期课程。
 *
 * 三种结果要分开，不能合并成一个「空数组」：
 * - 模块不存在 → `module-missing`（用户可能在看别的页面）；
 * - 模块在异步加载 → `module-loading`（重试而不是当作没课）；
 * - 模块在、但没有课程 → 成功 + 空数组。
 */
export function parseBlackboardCurrentCourses(
  html: string,
  baseUrl: string,
): DeadlineParseResult<BlackboardCourse[]> {
  const blocked = inspectPlatformPage({ html, url: baseUrl });
  if (blocked !== null) return { ok: false, error: blocked };

  const block = findBlackboardModule(html, UNFINISHED_COURSES_TITLE_RE);
  if (block === null) {
    return {
      ok: false,
      error: deadlineParseFailure(
        'module-missing',
        '未识别 BB 未完成课程列表，请打开门户课程模块后重试',
      ),
    };
  }

  if (LOADING_RE.test(htmlText(block))) {
    return {
      ok: false,
      error: deadlineParseFailure('module-loading', 'BB 本学期课程模块尚未加载，请稍后重试'),
    };
  }

  const parsed = parseBlackboardCourseLinks(block, baseUrl);
  if (parsed.ok) return parsed;

  // 课程链接一条都没有：只有在页面明确「没有课程」或列表确实为空时才算空
  const lists = [...block.matchAll(COURSE_LIST_RE)].filter((match) =>
    readTagAttribute(`<ul ${match[1] ?? ''}>`, 'class').split(/\s+/).includes('courseListing'),
  );
  const everyListEmpty = lists.every(
    (match) => htmlText(match[2] ?? '').length === 0 && !/<a\b/i.test(match[2] ?? ''),
  );

  if (EMPTY_COURSE_LIST_RE.test(htmlText(block)) || (lists.length > 0 && everyListEmpty)) {
    return { ok: true, value: [] };
  }

  return {
    ok: false,
    error: deadlineParseFailure('unrecognized-structure', 'BB 未完成课程列表结构未识别，已保留上次数据'),
  };
}

/* ------------------------------------------------------------------ *
 * 作业
 * ------------------------------------------------------------------ */

const ASSIGNMENT_PATH_RE = /\/webapps\/assignment\/uploadAssignment(?:\.jsp)?$/i;
const DUE_RAW_RE = /(?:截止日期|到期日期|Due Date)\s*[:：]?\s*(.{0,100})/i;
const ASSIGNMENT_PAGE_RE =
  /截止日期|Due Date|提交作业|Upload Assignment|作业信息|Assignment Information/i;

/** 作业页标题栏 */
const PAGE_TITLE_RE = /<h[12]\b([^>]*)>([\s\S]*?)<\/h[12]>/gi;

/** 标题前缀：BB 用页面标题当前缀，会变成「复查提交历史记录: 作业 1」 */
const TITLE_PREFIX_RE =
  /^(?:复查提交历史记录|上传作业|提交作业|Review Submission History|Upload Assignment)\s*[:：]\s*/i;

/** `parseBlackboardAssignmentPage` 的输入 */
export interface BlackboardAssignmentPageInput {
  readonly html: string;
  /** 作业页地址（解析 `content_id` 与判断「是不是作业页」都靠它） */
  readonly url: string;
  readonly course: BlackboardCourse;
  /** 页面没给出标题时的兜底（通常是课程列表里那条链接的文本） */
  readonly fallbackTitle: string;
  readonly term?: string | null;
  readonly timeZone: string;
  readonly now: Date;
}

/**
 * 解析一个 Blackboard 作业页。
 *
 * 返回值三态：
 * - `ok: true, value: <作业>` —— 是作业页且解析出实体；
 * - `ok: true, value: null` —— **不是**作业页（目录页、成绩页、公告页）；
 * - `ok: false` —— 像作业页但读不出来（登录过期、结构不认识）。
 *
 * 「不是作业页」不返回失败，是因为调用方会整站遍历课程内容，遇到非作业页是常态。
 */
export function parseBlackboardAssignmentPage(
  input: BlackboardAssignmentPageInput,
): DeadlineParseResult<BlackboardAssignment | null> {
  const { html, url, course, fallbackTitle, timeZone, now } = input;

  const blocked = inspectPlatformPage({ html, url });
  if (blocked !== null) return { ok: false, error: blocked };

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, error: deadlineParseFailure('invalid-url', 'BB 作业页地址不是合法 URL') };
  }

  // 目录页也可能出现「提交作业」等文字；只有实际的作业页才产生作业实体
  if (!ASSIGNMENT_PATH_RE.test(parsedUrl.pathname)) return { ok: true, value: null };

  const words = htmlText(html);
  if (!ASSIGNMENT_PAGE_RE.test(words)) return { ok: true, value: null };

  const nativeId =
    parsedUrl.searchParams.get('content_id') ?? parsedUrl.searchParams.get('assign_group_id');
  if (nativeId === null || nativeId.length === 0) return { ok: true, value: null };

  // 两步是分开的：`pickDateSpanText` 只留「日期那一段」给界面显示；
  // 解析绝对时刻时用它，而不是整页 100 字窗口 —— 否则按钮文案会被当成日期原文。
  const dueRaw = DUE_RAW_RE.exec(words)?.[1] ?? '';
  const dueText = pickDateSpanText(dueRaw, 'first');
  const dateOptions: DateSpanParseOptions = { timeZone, now, term: input.term ?? null };
  const dueAtIso = parseDateSpanToIso(dueText, dateOptions);

  return {
    ok: true,
    value: {
      id: `${course.id}:assignment:${nativeId}`,
      courseId: course.id,
      nativeId,
      title: readAssignmentTitle(html, fallbackTitle),
      url,
      dueAtIso,
      dueText,
      lateDueAtIso: null,
      submission: readSubmissionState(words),
    },
  };
}

/**
 * 作业标题。
 *
 * 优先 `id="pageTitleHeader"`（BB 的作业页标题），否则第一个**不是隐藏/快捷链接**的
 * `h1`/`h2`。再剥掉「上传作业:」这类前缀。
 */
function readAssignmentTitle(html: string, fallbackTitle: string): string {
  const headings = [...html.matchAll(PAGE_TITLE_RE)].map((match) => ({
    attributes: match[1] ?? '',
    text: htmlText(match[2] ?? ''),
  }));

  const byId = headings.find((heading) => readTagAttribute(`<h1 ${heading.attributes}>`, 'id') === 'pageTitleHeader');
  const visible = headings.find(
    (heading) =>
      !/hideoff|hideFromQuickLinks/i.test(readTagAttribute(`<h1 ${heading.attributes}>`, 'class')) &&
      heading.text.length > 0,
  );

  const title = (byId ?? visible)?.text ?? fallbackTitle;
  return title.replace(TITLE_PREFIX_RE, '').trim().slice(0, MAX_TITLE_LENGTH);
}

/* ------------------------------------------------------------------ *
 * 待完成作业模块
 * ------------------------------------------------------------------ */

/**
 * 读门户首页的「待完成作业」模块。
 *
 * 返回三态（与上游一致，但显式化）：
 * - 模块不存在 → `ok: true, value: null`（用户可能在看别的页面，不是错误）；
 * - 模块存在但列表为空 → `{ links: [], empty: true }`；
 * - 模块存在且有链接 → `{ links, empty: false }`；
 * - 模块在但既没写「没有作业」也没有可用链接 → `null`（结构不认识，不敢当空）。
 */
export function parseBlackboardPendingAssignments(
  html: string,
  baseUrl: string,
  courses: readonly BlackboardCourse[],
): DeadlineParseResult<BlackboardPendingModule | null> {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return { ok: false, error: deadlineParseFailure('invalid-url', 'Blackboard 地址不是合法 URL') };
  }

  const block = findBlackboardModule(html, /^待完成作业$/);
  if (block === null) return { ok: true, value: null };

  const empty = NO_PENDING_HOMEWORK_RE.test(htmlText(block));
  const links: BlackboardPendingLink[] = [];

  for (const anchor of collectAnchors(block, baseUrl)) {
    const url = new URL(anchor.url);
    if (url.origin !== origin) continue;
    if (!ASSIGNMENT_PATH_RE.test(url.pathname)) continue;

    const nativeCourseId = url.searchParams.get('course_id');
    const course = courses.find((candidate) => candidate.id === `blackboard:${nativeCourseId ?? ''}`);
    if (course === undefined) continue;

    const hasAssignmentId =
      url.searchParams.has('content_id') || url.searchParams.has('assign_group_id');
    if (!hasAssignmentId) continue;

    links.push({ url: anchor.url, title: anchor.text.slice(0, MAX_TITLE_LENGTH), courseId: course.id });
  }

  if (empty && links.length === 0) return { ok: true, value: { links: [], empty: true } };
  if (links.length > 0) return { ok: true, value: { links, empty: false } };
  return { ok: true, value: null };
}
