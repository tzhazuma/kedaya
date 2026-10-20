/**
 * 课程 DDL 导入 · 纯逻辑层
 *
 * ## 为什么这个页面在 Web 而不在小程序
 *
 * 合并进来的三个解析器（Gradescope / Blackboard / EAMS）都需要**完整页面的 HTML**。
 * 小程序**没有文件选择器**，用户没法把「另存为网页」的文件喂进来。
 *
 * 浏览器有 `<input type="file">`。所以导入流程放 Web：
 * 用户在电脑上另存页面 → 拖进来 → 我们解析 → 导出 ICS / JSON → 手机上导入。
 *
 * **这条路径不需要服务端存任何凭据**，也不需要后端抓取 —— 页面的 HTML
 * 是用户的浏览器给我们的，不经过任何登录。
 *
 * ## 两步流程（Gradescope / Blackboard）
 *
 * 这两家的作业列表挂在**课程**下面，所以必须先有课程：
 *   1. 粘贴/拖入**课程列表页**（Gradescope Dashboard / Blackboard 门户）
 *   2. 选一门课，再粘贴/拖入**该课程的作业页**
 *
 * EAMS 的课表页是自包含的，一步就够。
 */

import {
  buildDeadlineIcs,
  parseBlackboardAssignmentPage,
  parseBlackboardCourseLinks,
  parseDueText,
  parseEamsTimetable,
  parseEcourseAssignments,
  parseGradescopeAssignments,
  parseGradescopeCourseList,
  parsePiazzaDeadlines,
  sanitizeSourceUrl,
  type BlackboardAssignment,
  type BlackboardCourse,
  type DeadlineParseFailure,
  type EamsTimetable,
  type GradescopeAssignment,
  type GradescopeCourse,
} from '@kedaya/shared';

/**
 * 学校时区。解析原始文本时**必须显式传**，不能依赖浏览器本地时区 ——
 * 契约 `deadlines.ts` 的注释写明了这一点（跨时区会让学生看到早 8 小时的截止）。
 */
export const SCHOOL_TIME_ZONE = 'Asia/Shanghai';

export type ImportPlatform = 'gradescope' | 'blackboard' | 'eams' | 'piazza' | 'ecourse';

export const IMPORT_PLATFORMS: readonly { id: ImportPlatform; label: string; hint: string }[] = [
  {
    id: 'gradescope',
    label: 'Gradescope',
    hint: '先打开 Dashboard 另存为网页，再打开某门课的 Assignments 页另存',
  },
  {
    id: 'blackboard',
    label: 'Blackboard',
    hint: '先打开课程列表另存为网页，再打开某门课的作业内容区另存',
  },
  {
    id: 'piazza',
    label: 'Piazza',
    // ⚠️ Piazza 本身**没有**原生截止日期功能 —— 日期写在 Instructor Note /
    // Resources 的说明文本里，课程首页通常一个日期都没有。所以提示要指到具体页面。
    hint: 'Piazza 的截止日期不在课程首页，而在 Instructor Note 或 Resources 的详情页 —— 打开那一页再另存',
  },
  {
    id: 'ecourse',
    label: 'e云平台',
    // ⚠️ 我们对 e云平台的 DOM **没有真实样本**，所以只给「进到具体页面」的指引，
    // 不承诺能读出什么。诚实比乐观有用。
    hint: '点进具体课程的「作业」列表页再另存（课程首页通常只有入口，没有日期）',
  },
  {
    id: 'eams',
    label: '教务 EAMS',
    hint: '打开课表页另存为网页即可，一步完成',
  },
];

/** 一条归一后的待导入截止日期 */
export interface ImportedDeadline {
  readonly id: string;
  readonly title: string;
  readonly courseName: string;
  /** 绝对时刻（ISO-8601 UTC）。认不出时为 `null` —— **不编造** */
  readonly dueAt: string | null;
  /** 截止原文，给用户核对 */
  readonly dueText: string;
  /** 回源链接（**已清洗会话参数**） */
  readonly sourceUrl: string;
  readonly submitted: boolean;
}

export type ParseStepResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: DeadlineParseFailure };

/**
 * 归一后的课程。
 *
 * ⚠️ 上游两个平台**字段名不一样**：Gradescope 是 `name`，Blackboard 是 `title`。
 * 在这里归一，而不是让 UI 去 `'name' in course ? … : …` ——
 * 那种写法每加一个平台就要再改一次 UI。
 */
export interface ImportCourse {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  /** 学期标签（Gradescope 有，Blackboard 通常为空串） */
  readonly term: string;
}

/** 第 1 步：解析课程列表（Gradescope / Blackboard），返回**归一后**的课程 */
export function readCourseList(
  platform: 'gradescope' | 'blackboard',
  html: string,
  pageUrl: string,
): ParseStepResult<readonly ImportCourse[]> {
  if (html.trim() === '') {
    return { ok: false, failure: failureOf('empty-page') };
  }

  if (platform === 'gradescope') {
    const result = parseGradescopeCourseList(html, pageUrl);
    if (!result.ok) return { ok: false, failure: result.error };
    return {
      ok: true,
      value: result.value.map((c) => ({ id: c.id, title: c.name, url: c.url, term: c.term })),
    };
  }

  const result = parseBlackboardCourseLinks(html, pageUrl);
  if (!result.ok) return { ok: false, failure: result.error };
  return {
    ok: true,
    value: result.value.map((c) => ({ id: c.id, title: c.title, url: c.url, term: '' })),
  };
}

/** 第 2 步：解析作业页 */
export function readAssignments(
  platform: 'gradescope' | 'blackboard',
  html: string,
  course: ImportCourse,
  options: { readonly now: Date; readonly timeZone?: string },
): ParseStepResult<readonly ImportedDeadline[]> {
  if (html.trim() === '') {
    return { ok: false, failure: failureOf('empty-page') };
  }
  const timeZone = options.timeZone ?? SCHOOL_TIME_ZONE;

  if (platform === 'gradescope') {
    const result = parseGradescopeAssignments(html, course as unknown as GradescopeCourse, {
      now: options.now,
      timeZone,
    });
    if (!result.ok) return { ok: false, failure: result.error };
    return { ok: true, value: result.value.map(fromGradescope) };
  }

  const bbCourse = course as unknown as BlackboardCourse;
  const result = parseBlackboardAssignmentPage({
    html,
    url: bbCourse.url,
    course: bbCourse,
    fallbackTitle: bbCourse.title,
    timeZone,
    now: options.now,
  });
  if (!result.ok) return { ok: false, failure: result.error };
  // ⚠️ 可能是 `null`：目录页也会出现「提交作业」等文字，只有真正的作业页
  // 才产生作业实体。返回 null 不是失败 —— 要如实告诉用户"这不是作业页"。
  if (result.value === null) {
    return { ok: false, failure: failureOf('unrecognized-structure') };
  }
  return { ok: true, value: [fromBlackboard(result.value)] };
}

/** EAMS：一步解析课表 */
export function readEamsTimetable(
  html: string,
  /** 学期标签，如 `2026-2027-1`。页面本身可能读得出，读不出就由调用方给 */
  semester: string,
): ParseStepResult<readonly ImportedDeadline[]> {
  if (html.trim() === '') {
    return { ok: false, failure: failureOf('empty-page') };
  }
  const result = parseEamsTimetable(html, semester);
  if (!result.ok) return { ok: false, failure: result.error };
  return { ok: true, value: eamsToDeadlines(result.value) };
}

function fromGradescope(item: GradescopeAssignment): ImportedDeadline {
  return {
    id: item.id,
    title: item.title,
    courseName: '',
    dueAt: item.dueAtIso,
    dueText: item.dueText,
    sourceUrl: sanitizeSourceUrl(item.url) ?? '',
    submitted: item.submission === 'submitted' || item.submission === 'graded',
  };
}

function fromBlackboard(item: BlackboardAssignment): ImportedDeadline {
  return {
    id: item.id,
    title: item.title,
    courseName: '',
    dueAt: item.dueAtIso,
    dueText: item.dueText,
    sourceUrl: sanitizeSourceUrl(item.url) ?? '',
    submitted: item.submission === 'submitted' || item.submission === 'graded',
  };
}

/**
 * EAMS 课表 → 截止日期。
 *
 * ⚠️ 课表**不是**截止日期 —— 它是上课时间。这里只把「有明确日期的课」
 * 当成日程条目（`kind: 'class'`），**不编造作业**。真正的作业来自
 * 教师在其他平台发的通知。
 *
 * 当前实现刻意只返回**课程的基本信息**，因为把每节课展开成一堆日历事件
 * 会让用户的日历爆炸。等有了明确的「要不要导出课表」需求再展开。
 */
function eamsToDeadlines(timetable: EamsTimetable): readonly ImportedDeadline[] {
  return (timetable.courses ?? []).map((course) => ({
    id: `eams-${course.id}`,
    // 课表条目用「课程名 + 课程号」，重复的课名才区分得开
    title: course.code === '' ? course.title : `${course.title}（${course.code}）`,
    courseName: course.title,
    dueAt: null, // 课表没有"截止时间"，留空而不是编一个
    dueText: course.term,
    sourceUrl: sanitizeSourceUrl(course.url) ?? '',
    submitted: false,
  }));
}

/** 生成 ICS（复用已有的 `buildDeadlineIcs`） */
export function toIcs(items: readonly ImportedDeadline[], calendarName: string, now: Date): string {
  return buildDeadlineIcs(
    items
      .filter((item) => item.dueAt !== null)
      .map((item) => ({
        id: item.id,
        title: item.title,
        courseName: item.courseName === '' ? null : item.courseName,
        // 上面 filter 已保证非 null
        dueAt: item.dueAt as string,
        sourceLabel: '导入',
        submitted: item.submitted,
      })),
    { calendarName, now },
  );
}

/**
 * 清洗后的错误文案（中文，能照着做）。
 *
 * `DeadlineParseFailure` 有 code + message，直接显示 message 就够 ——
 * 但我们要把 code 也带上，方便用户报问题时贴给我们。
 */
export function describeFailure(failure: DeadlineParseFailure): string {
  return `${failure.message}（${failure.code}）`;
}

/** 内部用：构造一个最小失败对象（不 import 内部构造函数，避免耦合） */
function failureOf(code: DeadlineParseFailure['code']): DeadlineParseFailure {
  return {
    code,
    message:
      code === 'empty-page' ? '内容为空，请先粘贴或选择网页文件' : '解析失败，请确认选对了页面',
  } as DeadlineParseFailure;
}

/**
 * 第 1 步（Piazza / e云平台版）：解析**作业列表页**，切出「标题 + 日期原文」。
 *
 * ## 为什么这两个平台走的是另一条路
 *
 * Gradescope / Blackboard / EAMS 都有确定的 DOM 结构，我们为它们各写了一个
 * 专用解析器。但：
 *
 * - **Piazza 没有原生的截止日期功能**，日期散在说明文本里；
 * - **e云平台我们连 DOM 样本都没有**（`ecourse.shanghaitech.edu.cn` 对裸请求
 *   返回 400，同校 SPOC 用的还是私有 `.mooc` 后缀系统）。
 *
 * 给这两个写「专用解析器」只会得到两个没有样本支撑的猜测，还会被当成
 * 「已支持」写进 UI。所以改用通用列表解析：只依赖「同一行/相邻行里出现
 * 标题 + 日期」这个所有列表都有的特征。
 *
 * ## ⚠️ 这条路径只切分，**不解释**
 *
 * `dueText` 是页面原文（`2026年10月25日 23:59`）。绝对时刻必须由
 * `parseDueText(raw, now, timeZone)` 产出 —— 本函数不猜。
 * 这也是为什么返回值叫「候选」而不是「截止日期」。
 */
export function readGenericAssignmentList(
  platform: 'piazza' | 'ecourse',
  html: string,
  pageUrl: string,
): ParseStepResult<readonly ImportedDeadline[]> {
  if (html.trim() === '') {
    return { ok: false, failure: failureOf('empty-page') };
  }

  const result =
    platform === 'piazza'
      ? parsePiazzaDeadlines(html, pageUrl)
      : parseEcourseAssignments(html, pageUrl);
  if (!result.ok) return { ok: false, failure: result.error };

  // 逐条把日期原文交给唯一的时间入口。解析不出来的保留 `dueAt: null`
  // 并原样展示 `dueText` —— 让用户自己判断，比丢掉更好。
  const now = new Date();
  const items: ImportedDeadline[] = result.value.candidates.map((candidate, index) => {
    const parsedAt = parseDueText(candidate.dueText, now, SCHOOL_TIME_ZONE);
    return {
      id: `${platform}-${index}-${candidate.title.slice(0, 20)}`,
      title: candidate.title,
      courseName: '',
      // `parseDueText` 直接返回 ISO 字符串（不是 Date）—— 它内部已经把
      // 时区处理完了，这里不能再 toISOString 一次。
      dueAt: parsedAt,
      dueText: candidate.dueText,
      sourceUrl: '',
      submitted: false,
    };
  });

  return { ok: true, value: items };
}
