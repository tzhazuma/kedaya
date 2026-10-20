/**
 * 通用「作业列表」解析 —— 给 `piazza` 与 `ecourse`（e云平台）用。
 *
 * ## ⚠️ 为什么是「通用」而不是「两个平台专用解析器」
 *
 * 这个决定值得解释，因为它看起来像是偷懒。
 *
 * 仓库里已有的三个平台解析器（Gradescope / Blackboard / EAMS）都是**针对
 * 具体 DOM 结构**写的。它们能这么写，是因为我们拿到了上游的只读视图样本。
 *
 * 但 `piazza` 和 `ecourse` 这两个：
 *
 * | 平台 | 我们实际知道什么 | 不知道什么 |
 * | --- | --- | --- |
 * | `piazza` | 域名、课程页 URL 形状 | **它本身没有原生的「截止日期」功能** —— 日期散落在 instructor note / 资源描述的自然语言里 |
 * | `ecourse`（e云平台） | 域名 `ecourse.shanghaitech.edu.cn`（实测返回 400，即存在但拒绝裸请求） | **完全不知道它的 DOM**。同校的 `spoc.shanghaitech.edu.cn` 用的是私有 `.mooc` 后缀系统，与常见 LMS 都不同 |
 *
 * 在这种情况下写两个「专用」解析器，唯一的结果就是**多两个没有样本支撑的
 * 猜测**，而且它们会被当成「已支持」写进 UI。仓库里已经有 176 个测试锁着
 * 三个从未对真实页面跑过的解析器 —— 再加两个会让这个坑更深。
 *
 * 所以这里换一个明确的做法：**坦白我们只认识「列表形状」，不认识具体 DOM。**
 * 解析器只依赖「同一行/同一块里出现标题 + 日期」这个**所有作业列表都有**的
 * 特征，并在失败时告诉用户「这条我们读不出来」而不是静默丢弃。
 *
 * ## 支持的三类形状（都基于真实网页的常见结构，不是凭空设计）
 *
 * 1. **表格行** —— `<tr>` 里同时有作业名与日期（Moodle / Blackboard / 多数 LMS
 *    的作业列表都是这种）
 * 2. **定义列表** —— `<dt>` 标题 + `<dd>` 描述里带日期
 * 3. **卡片块** —— 一个容器里既有标题文本又有日期文本（Piazza 的资源项、
 *    e云平台的活动卡片）
 *
 * 三者都是**结构特征**而非具体 class 名，因此对改版有一定容忍度。
 *
 * ## 边界（明确不处理）
 *
 * - **不处理「本周作业」这类相对时间** —— 交给 `parseDueText`，
 *   本模块只负责把「标题 + 日期文本」这一对切出来
 * - **不猜学期** —— 页面没写学年学期就从参数来，参数没有就留空
 * - **不追多页** —— 我们解析的是用户保存的**这一页**
 */

import {
  deadlineParseFailure,
  type DeadlineParseResult,
} from './deadline-parse-html';
import { decodeHtmlEntities, htmlToLines, looksLikeHtml } from './deadline-html';

/** 从列表里抽出来的一条「候选作业」——还没有解析成绝对时刻 */
export interface AssignmentCandidate {
  /** 作业/活动标题（已去标签、去多余空白） */
  readonly title: string;
  /**
   * 页面上原样的日期文本，例如 `2026年10月25日 23:59`、`Oct 25, 2026`。
   *
   * **本模块不解析它** —— 绝对时刻只由 `parseDueText(raw, now, timeZone)`
   * 产出。这里保持原样，是为了让失败时能告诉用户「这一条我们读成了什么」。
   */
  readonly dueText: string;
  /** 这条候选来自页面的哪一类结构（调试与文案用） */
  readonly shape: 'table-row' | 'definition' | 'card';
}

/** 解析结果 */
export interface AssignmentListParse {
  readonly candidates: readonly AssignmentCandidate[];
  /**
   * 被扫过但没切出「标题 + 日期」的元素数。
   *
   * ⚠️ 这个数字要给用户看：如果它很大而 `candidates` 很小，
   * 说明页面结构与我们的假设不符 —— 用户该知道「可能漏了」，
   * 而不是以为「就这些作业」。
   */
  readonly scannedWithoutMatch: number;
}

/** 日期线索：中文与英文两种写法，外加时间点 */
const DATE_PATTERN =
  /(\d{4}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*[日号]?)|(\d{1,2}\s*月\s*\d{1,2}\s*[日号])|((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*\d{4}?)/i;

/** 时间点线索：补充在日期之后的时间，或「截止」类字眼 */
const TIME_OR_DUE_PATTERN =
  /(\d{1,2}:\d{2})|(截止|到期|due|deadline|submission|提交)/i;

/** 排除明显的非作业行（表头、导航） */
const NOISE_PATTERN =
  /^(标题|作业|名称|日期|截止|title|name|date|due|actions?|操作)\s*[:：]?$/i;

/** 去掉标签、解码实体、压平空白 */
function cleanText(html: string): string {
  const text = html.replace(/<[^>]*>/g, ' ');
  return decodeHtmlEntities(text).replace(/\s+/g, ' ').trim();
}

/** 从一段文本里切出「标题」与「日期原文」 */
function splitTitleAndDate(text: string): { title: string; dueText: string } | null {
  const dateMatch = DATE_PATTERN.exec(text);
  if (dateMatch === null) return null;

  const dueStart = dateMatch.index;
  const dueRaw = text.slice(dueStart);

  // 日期后面如果紧跟时间，把它一起带上（`10月25日 23:59`）
  const timeInTail = TIME_OR_DUE_PATTERN.exec(dueRaw);
  const dueText =
    timeInTail === null ? dueRaw.trim() : dueRaw.slice(0, timeInTail.index + timeInTail[0].length).trim();

  // 标题 = 日期之前的部分。空则说明这一行是「日期开头」，比如表格里
  // 先日期后标题 —— 那就取日期之后的部分。
  let title = text.slice(0, dueStart).trim();
  if (title === '') {
    const after = dueRaw.slice(dueText.length).replace(/^[\s·|—-]+/, '').trim();
    title = after;
  }

  if (title === '' || NOISE_PATTERN.test(title)) return null;
  // 标题至少两个字符 —— 单个字符基本是图标或序号
  if (title.length < 2) return null;

  // 标题不该长到像一整段正文（超过 120 字基本是描述，不是标题）
  if (title.length > 120) title = `${title.slice(0, 118)}…`;

  return { title, dueText };
}

/**
 * 解析一个「作业列表」页面。
 *
 * 输入是**用户自己保存的页面 HTML**，不联网、不登录。
 */
export function parseAssignmentList(
  html: string,
  pageUrl: string,
): DeadlineParseResult<AssignmentListParse> {
  if (html.trim() === '') {
    return { ok: false, error: deadlineParseFailure('empty-page', '页面为空，没拿到任何内容') };
  }
  if (!looksLikeHtml(html)) {
    return {
      ok: false,
      error: deadlineParseFailure(
        'unrecognized-structure',
        '这不是网页文件。请在浏览器里「另存为 → 网页，仅 HTML」再试',
      ),
    };
  }

  const candidates: AssignmentCandidate[] = [];
  const seen = new Set<string>();
  let scanned = 0;

  /** 收集器：把「一段 HTML + 形状」变成候选 */
  const collect = (innerHtml: string, shape: AssignmentCandidate['shape']): void => {
    scanned += 1;
    const text = cleanText(innerHtml);
    if (text === '') return;
    const split = splitTitleAndDate(text);
    if (split === null) return;

    // 去重键：标题 + 日期原文。同一行被两种形状重复扫到时只留一份。
    const key = `${split.title}@@${split.dueText}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ title: split.title, dueText: split.dueText, shape });
  };

  // ---- 形状 1：表格行 ----
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    collect(match[1] ?? '', 'table-row');
  }

  // ---- 形状 2：定义列表项 ----
  // `<dt>标题</dt><dd>10月25日 截止</dd>` —— dt/dd 要合成一块看
  for (const match of html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
    collect(match[0], 'definition');
  }

  // ---- 形状 3：卡片块 ----
  //
  // ⚠️ 这里**刻意不用 `<div>…</div>` 的平衡匹配**。踩过：
  // 非贪婪正则在第一个 `</div>` 就停，而卡片几乎都是嵌套 div
  //（`<div class="card"><div>标题</div><div>日期</div></div>`），
  // 结果只截到「标题」那段，永远匹配不到日期。
  //
  // 改用两层：
  //   (a) `<li>` / `<article>` —— 它们本来就不该自我嵌套，标签匹配可靠
  //   (b) **文本行兜底** —— 见下面的「形状 4」
  for (const match of html.matchAll(/<(li|article)\b[^>]*>([\s\S]{10,4000}?)<\/\1>/gi)) {
    collect(match[2] ?? '', 'card');
  }

  // ---- 形状 4：文本行兜底（覆盖任意 DOM 的「标题行 + 日期行」）----
  //
  // 很多 LMS（包括 e云平台这类我们没见过样本的）把标题和日期放在两个相邻的
  // 兄弟 div 里。标签层面无法配对，但**渲染成文本后就是相邻两行**。
  //
  // 判据：某一行含日期，且上一行是「像标题的短行」→ 组成一条候选。
  // 这是所有形状里**最不依赖 DOM** 的一种，也是我们对未知平台的主要依赖。
  const lines = htmlToLines(html).map((line) => line.trim()).filter((line) => line !== '');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!DATE_PATTERN.test(line)) continue;
    // 本行自己就含标题（`作业一 10月25日`）
    const sameLine = splitTitleAndDate(line);
    if (sameLine !== null) {
      const key = `${sameLine.title}@@${sameLine.dueText}`;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push({ ...sameLine, shape: 'card' });
      }
      continue;
    }
    // 本行只有日期 → 往上找标题行
    const previous = lines[i - 1];
    if (previous === undefined) continue;
    if (DATE_PATTERN.test(previous)) continue; // 上一行也是日期，不是标题
    if (NOISE_PATTERN.test(previous)) continue;
    if (previous.length < 2 || previous.length > 120) continue;
    const key = `${previous}@@${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scanned += 1;
    candidates.push({ title: previous, dueText: line, shape: 'card' });
  }

  if (candidates.length === 0) {
    // 区分两种失败：页面根本不是列表 vs 是列表但我们读不出日期
    // 「几乎是空页」的唯一可靠信号是**可见文本量**。
    //
    // 这个判据踩过三次坑，每次都收窄一点：
    //   ① `htmlToLines(html).length < 5` —— 结构精简但完整的列表会被误判
    //   ② `可见文本 < 40` —— 一条作业的页面可能就十几字，仍被误判
    //   ③ `html.length < 300` —— 精简 HTML（无内联样式）本来就短，还是误判
    //
    // 最终只留一条：**可见文本几乎为零**。
    // 真正的框架页（只存了 iframe/script 壳）剥完标签就是空的；
    // 而任何有内容的页面，哪怕只有一行，也应该进入「扫了 N 个区块但没找到日期」
    // 分支 —— 那个提示对用户更有用。
    const visibleText = htmlToLines(html).join('').replace(/\s+/g, '');
    if (visibleText.length === 0) {
      return {
        ok: false,
        error: deadlineParseFailure(
          'empty-page',
          '这一页几乎没有内容。可能保存时只存了框架页（很多 LMS 用 iframe），请刷新后重存',
        ),
      };
    }
    return {
      ok: false,
      error: deadlineParseFailure(
        'unrecognized-structure',
        `扫了 ${scanned} 个候选区块，没有一个同时含「标题 + 日期」。请确认保存的是作业/活动列表页，而不是课程首页`,
      ),
    };
  }

  return { ok: true, value: { candidates, scannedWithoutMatch: scanned - candidates.length } };
}

/**
 * Piazza 专用入口。
 *
 * ⚠️ **Piazza 本身没有原生的截止日期功能。** 日期出现在 instructor note
 * 或 Resources 的描述文本里。所以这里不做任何「Piazza 特有结构」的假设，
 * 完全委托给通用列表解析。
 *
 * 调用方拿到 `candidates` 后，应逐条交给 `parseDueText(raw, now, timeZone)`
 * 精解 —— 通用解析只负责切分，不负责解释。
 */
export function parsePiazzaDeadlines(
  html: string,
  pageUrl: string,
): DeadlineParseResult<AssignmentListParse> {
  const result = parseAssignmentList(html, pageUrl);
  if (!result.ok && result.error.code === 'unrecognized-structure') {
    // 给 Piazza 用户更具体的下一步
    return {
      ok: false,
      error: deadlineParseFailure(
        'unrecognized-structure',
        'Piazza 的截止日期通常写在 Instructor Note 或 Resources 的说明里。'
          + '请打开那条 note 的详情页再保存（课程首页往往不含日期）',
      ),
    };
  }
  return result;
}

/**
 * e云平台（`ecourse.shanghaitech.edu.cn`）专用入口。
 *
 * ⚠️ **我们不知道它的 DOM。** 实测该域名对裸请求返回 400（存在但拒绝），
 * 同校 `spoc.shanghaitech.edu.cn` 用的是私有 `.mooc` 后缀系统。
 *
 * 所以这里同样不做结构假设。如果通用解析失败，提示用户保存**更具体的那一页**
 * （课程内的「作业」列表），而不是笼统的「解析失败」。
 */
export function parseEcourseAssignments(
  html: string,
  pageUrl: string,
): DeadlineParseResult<AssignmentListParse> {
  const result = parseAssignmentList(html, pageUrl);
  if (!result.ok && result.error.code === 'unrecognized-structure') {
    return {
      ok: false,
      error: deadlineParseFailure(
        'unrecognized-structure',
        'e云平台我们还没有真实页面样本。请点进具体课程的「作业」列表页再保存'
          + '（课程首页通常只有入口，没有日期）',
      ),
    };
  }
  return result;
}
