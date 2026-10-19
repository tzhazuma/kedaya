/**
 * 课程 DDL · 粘贴内容 HTML 预处理层（三端共用）
 *
 * `deadline-paste` 只认纯文本。用户从浏览器「另存为网页」或复制富文本时，
 * 剪贴板里拿到的却是 HTML：`<div class="assignment">Homework 1</div>`。
 * 直接喂给 paste 解析器，标签本身会被当成标题的一部分。本模块负责把 HTML
 * 压成「保留结构的文本行」，调用方再过一遍 paste 解析器：
 *
 * ```ts
 * const region = extractDeadlineBlock(pageHtml, ['#assignments', '.assignment-list']);
 * const lines = htmlToLines(region);
 * const result = parsePastedDeadlines(lines.join('\n'), options);
 * ```
 *
 * ## 边界（产品约束，不是待办）
 *
 * - **不做网络请求**：只处理用户已经拿到的 HTML（剪贴板 / 另存为文件），
 *   不抓取、不登录、不访问任何平台。与 `deadline-paste` 一样是纯函数。
 * - **不做安全清洗**：本模块只产出**纯文本**，不产出 HTML。XSS 清洗是渲染层
 *   的责任；把这里的输出当文本渲染是安全的，但**不要**把它拼回 HTML。
 * - **不追求完整 DOM 解析**：没有引入 cheerio 等第三方库，只用字符串扫描 +
 *   少量正则做保守切分。HTML5 的隐式闭合、错误恢复、命名空间、`<pre>` 空白
 *   保留都不模拟；把 HTML 当「标签 + 文本」的线性流处理。
 * - **不因畸形输入抛异常**：未闭合标签、孤立 `<`、坏实体、没有 `>` 的标签
 *   一律降级为文本或忽略；最坏情况是少几行，而不是让粘贴流程崩掉。
 * - **保守提取**：`extractDeadlineBlock` 找不到提示区域时退化成整页，宁可多带
 *   一点导航栏噪声，也不返回空让用户以为「没有作业」。
 */

/* ------------------------------------------------------------------ *
 * 常量
 * ------------------------------------------------------------------ */

/**
 * 会结束当前文本行的标签。`td` / `th` 不在此列 —— 它们用制表符分隔单元格，
 * 这样 `<tr><td>CS101</td><td>Homework 1</td></tr>` 仍然是一行。
 */
const LINE_BREAK_TAGS: ReadonlySet<string> = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'caption',
  'colgroup',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'tfoot',
  'thead',
  'tr',
  'ul',
]);

/** 内容整体丢弃的「原始文本」标签（亮出标签后的内容不是页面可见文字） */
const RAW_TEXT_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'svg',
  'noscript',
]);

/** HTML 的 void 元素：没有闭合标签，也不可能有 innerHTML */
const VOID_TAGS: ReadonlySet<string> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** 文本节点里的空白（含换行；`&nbsp;` 已提前解码成普通空格） */
const SPACE_RUN_RE = /[ \t\n\r\f\v]+/g;
const LEADING_SPACE_RE = /^[ \t\n\r\f\v]+/;

/**
 * 常见命名实体。任务只要求 `amp/lt/gt/quot/#39/nbsp`，这里额外收几个
 * 中文平台页面里常见的排版实体；**不认识的实体原样保留**，避免猜错。
 */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  times: '×',
  divide: '÷',
};

/* ------------------------------------------------------------------ *
 * HTML 实体
 * ------------------------------------------------------------------ */

/**
 * 解码 HTML 实体。
 *
 * 覆盖：
 * - 命名实体：`&amp; &lt; &gt; &quot; &apos; &nbsp;` 及 NAMED_ENTITIES 里的常见项；
 * - 十进制数字实体：`&#123;`；
 * - 十六进制数字实体：`&#x4E2D;` / `&#X4E2D;`（大小写 x 都接受）。
 *
 * 保守之处：
 * - **要求分号**。没有分号的 `&#39` 不猜（可能只是普通文本里的片段）；
 * - 非法码点（0、代理区、超出 Unicode）与不认识的命名实体**原样保留**；
 * - `&nbsp;` / `&#160;` 解码成普通空格，交给后面的空白折叠；
 * - 控制字符（`&#10;` 等）解码成空格 —— 结构换行只能由标签产生，避免文本
 *   节点里的数字实体偷偷把一行劈成两行。
 */
export function decodeHtmlEntities(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return '';

  return text.replace(
    /&(#(?:[xX][0-9a-fA-F]+|[0-9]+)|[A-Za-z][A-Za-z0-9]+);/g,
    (match: string, body: string): string => {
      if (body.startsWith('#')) {
        const isHex = body[1] === 'x' || body[1] === 'X';
        const digits = isHex ? body.slice(2) : body.slice(1);
        const codePoint = Number.parseInt(digits, isHex ? 16 : 10);

        if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) {
          return match;
        }
        // 代理区不能单独出现在 JS 字符串里
        if (codePoint >= 0xd800 && codePoint <= 0xdfff) return match;
        // 不换行空格当普通空格；控制字符也降级成空格（结构换行只认标签）
        if (codePoint === 0xa0) return ' ';
        if (codePoint < 0x20 || codePoint === 0x7f) return ' ';
        if (codePoint >= 0x80 && codePoint <= 0x9f) return ' ';

        return String.fromCodePoint(codePoint);
      }

      const decoded = NAMED_ENTITIES[body.toLowerCase()];
      return decoded ?? match;
    },
  );
}

/* ------------------------------------------------------------------ *
 * 标签扫描（不建 DOM，只做线性切分）
 * ------------------------------------------------------------------ */

interface RawTag {
  /** 小写标签名 */
  readonly name: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
  /** `<` 的下标 */
  readonly start: number;
  /** `>` 之后的下标 */
  readonly end: number;
  /** 标签名之后、`>`（或 `/`）之前的属性原文 */
  readonly attributes: string;
}

function isAsciiLetter(char: string | undefined): boolean {
  if (char === undefined) return false;
  return (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z');
}

function isTagNameChar(char: string | undefined): boolean {
  if (char === undefined) return false;
  return isAsciiLetter(char) || (char >= '0' && char <= '9') || char === '-' || char === ':' || char === '_';
}

/**
 * 从 `<` 开始读一个标签。读不出合法标签（`<3`、`a < b`、没有 `>` 的残缺标签）
 * 返回 `null`，由调用方当普通文本处理。
 *
 * 属性值里的 `>` 不会提前结束标签 —— 扫描时跟踪引号。
 */
function readTag(html: string, start: number): RawTag | null {
  const length = html.length;
  if (start < 0 || start >= length || html[start] !== '<') return null;

  let index = start + 1;
  let closing = false;
  if (html[index] === '/') {
    closing = true;
    index += 1;
  }

  if (!isAsciiLetter(html[index])) return null;

  const nameStart = index;
  while (index < length && isTagNameChar(html[index])) index += 1;
  const name = html.slice(nameStart, index).toLowerCase();

  let quote: string | null = null;
  let end = -1;
  for (let cursor = index; cursor < length; cursor += 1) {
    const char = html[cursor];
    if (char === undefined) break;
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') {
      end = cursor;
      break;
    }
  }
  if (end === -1) return null;

  let beforeEnd = end - 1;
  while (beforeEnd > index && /\s/.test(html[beforeEnd] ?? '')) beforeEnd -= 1;
  const selfClosing = html[beforeEnd] === '/';
  const attributes = html.slice(index, selfClosing ? beforeEnd : end);

  return { name, closing, selfClosing, start, end: end + 1, attributes };
}

/** 跳过注释 / doctype / CDATA / 处理指令；返回跳过后的下标，不是这类结构返回 `null` */
function skipMarkup(html: string, start: number): number | null {
  if (html.startsWith('<!--', start)) {
    const close = html.indexOf('-->', start + 4);
    return close === -1 ? html.length : close + 3;
  }
  if (html.startsWith('<![CDATA[', start)) {
    const close = html.indexOf(']]>', start + 9);
    return close === -1 ? html.length : close + 3;
  }

  const next = html[start + 1];
  if (next === '!' || next === '?') {
    const close = html.indexOf('>', start + 2);
    return close === -1 ? html.length : close + 1;
  }

  return null;
}

/**
 * 找某个原始文本标签的闭合位置（`</script` 的 `<` 下标）。
 * 大小写不敏感；找不到返回 -1。`</scriptx>` 这种不算闭合。
 */
function findRawTextClose(lowerHtml: string, name: string, from: number): number {
  const needle = `</${name}`;
  let search = from;

  while (search < lowerHtml.length) {
    const index = lowerHtml.indexOf(needle, search);
    if (index === -1) return -1;

    const after = lowerHtml[index + needle.length];
    if (after === undefined || after === '>' || after === '/' || /\s/.test(after)) {
      return index;
    }
    search = index + needle.length;
  }

  return -1;
}

/** 跳过原始文本标签的内容，返回闭合标签的 `<` 下标（没有闭合则跳到文档末尾） */
function skipRawText(html: string, lowerHtml: string, tag: RawTag): number {
  if (tag.selfClosing) return tag.end;
  const close = findRawTextClose(lowerHtml, tag.name, tag.end);
  return close === -1 ? html.length : close;
}

/* ------------------------------------------------------------------ *
 * htmlToLines
 * ------------------------------------------------------------------ */

/**
 * 把 HTML 变成保留结构的纯文本行。
 *
 * 结构规则：
 * - `<br>` / `<p>` / `<div>` / `<li>` / `<tr>` / 标题等块级标签 → 换行；
 * - `<td>` / `<th>` → 制表符（`\t`）分隔。一行三门课/一个作业的表格会得到
 *   `课程名\t作业名\t截止时间`；
 * - 其他标签（`<span>` / `<a>` / `<b>` …）只剥标签，**保留其中的文字**；
 * - `<script>` / `<style>` / `<svg>` / `<noscript>` 的**内容整体丢弃**；
 *   未闭合时按浏览器习惯丢到文档末尾；
 * - HTML 实体统一解码（见 `decodeHtmlEntities`）；
 * - 行内连续空白折叠成一个空格；**行首缩进前缀保留**（Piazza 的层级靠缩进表达），
 *   所以 `&nbsp;&nbsp;Homework 3` 会保留两个前导空格；
 * - 空行丢弃 —— `parsePastedDeadlines` 本来也忽略空行。
 *
 * 畸形输入不抛异常：读不出的 `<` 当普通文本，未闭合标签不退化成吞掉正文。
 *
 * @param html 用户粘贴 / 另存为得到的 HTML 片段或整页
 * @returns 非空文本行（保留行首缩进，去掉行尾空白）
 */
export function htmlToLines(html: string): string[] {
  if (typeof html !== 'string' || html.length === 0) return [];

  const lowerHtml = html.toLowerCase();
  const lines: string[] = [];
  let current = '';
  let index = 0;

  const breakLine = (): void => {
    lines.push(current);
    current = '';
  };

  const appendSeparator = (): void => {
    // 行首不产生制表符（空的第一格不把整行往右推）
    if (current.trim().length === 0) return;
    if (!current.endsWith('\t')) current += '\t';
  };

  const appendText = (raw: string): void => {
    if (raw.length === 0) return;
    const decoded = decodeHtmlEntities(raw);
    if (decoded.length === 0) return;

    const atLineStart = current.trim().length === 0;

    if (atLineStart && current.length === 0) {
      // 行首：保留缩进的字符数（换行/制表符也折算成一个空格），正文再折叠
      const leading = LEADING_SPACE_RE.exec(decoded);
      if (leading !== null) {
        current += leading[0].replace(/[^ ]/g, ' ');
        current += decoded.slice(leading[0].length).replace(SPACE_RUN_RE, ' ');
        return;
      }
      current += decoded.replace(SPACE_RUN_RE, ' ');
      return;
    }

    if (atLineStart) {
      // 已经有缩进，别把下一个文本节点的缩进再叠上去
      current += decoded.replace(LEADING_SPACE_RE, '').replace(SPACE_RUN_RE, ' ');
      return;
    }

    current += decoded.replace(SPACE_RUN_RE, ' ');
  };

  while (index < html.length) {
    const lt = html.indexOf('<', index);

    if (lt === -1) {
      appendText(html.slice(index));
      break;
    }
    if (lt > index) appendText(html.slice(index, lt));

    const skipped = skipMarkup(html, lt);
    if (skipped !== null) {
      index = skipped;
      continue;
    }

    const tag = readTag(html, lt);
    if (tag === null) {
      // `<3` / `a < b` / 没有 `>` 的残缺标签：`<` 当普通文本，继续往后扫
      appendText('<');
      index = lt + 1;
      continue;
    }

    index = tag.end;

    if (tag.closing) {
      if (tag.name === 'td' || tag.name === 'th') {
        appendSeparator();
      } else if (LINE_BREAK_TAGS.has(tag.name)) {
        breakLine();
      }
      continue;
    }

    if (RAW_TEXT_TAGS.has(tag.name)) {
      index = skipRawText(html, lowerHtml, tag);
      continue;
    }

    if (tag.name === 'td' || tag.name === 'th') {
      appendSeparator();
      continue;
    }

    if (LINE_BREAK_TAGS.has(tag.name)) {
      breakLine();
    }
  }

  breakLine();
  return normalizeLines(lines);
}

/** 行尾去空白；行内空白折叠；`td` 产生的制表符保持为单个 `\t` */
function normalizeLines(rawLines: readonly string[]): string[] {
  const result: string[] = [];

  for (const raw of rawLines) {
    const line = normalizeLine(raw);
    if (line.length > 0) result.push(line);
  }

  return result;
}

function normalizeLine(raw: string): string {
  if (raw.length === 0) return '';

  const indentMatch = /^[ \t]+/.exec(raw);
  const indent = indentMatch === null ? '' : indentMatch[0];
  let body = raw.slice(indent.length);

  // 含制表符的空白段折叠成一个制表符（单元格分隔）；否则折叠成一个空格
  body = body.replace(/[ \t]+/g, (run) => (run.includes('\t') ? '\t' : ' '));
  body = body.replace(/ *\t */g, '\t');
  body = body.replace(/[ \t]+$/, '');

  if (body.length === 0) return '';
  return indent + body;
}

/* ------------------------------------------------------------------ *
 * looksLikeHtml
 * ------------------------------------------------------------------ */

/**
 * 结构标签白名单。
 *
 * 刻意**不**收单字母标签（`a` / `b` / `i` / `u` / `s`）：
 * 纯文本 `a<b and b>c` 会被 `<b ...>` 误伤。段落 `<p>` 仍保留，因为
 * 它在真实 HTML 里足够常见，而 `<p ...>` 出现在数学文本里的概率很低。
 */
const STRUCTURAL_TAG_RE =
  /<(?:!doctype\s+html|html|head|body|table|thead|tbody|tfoot|tr|td|th|div|p|ul|ol|li|dl|dt|dd|h[1-6]|section|article|header|footer|nav|aside|main|form|fieldset|legend|label|button|select|option|textarea|span|strong|em|code|pre|blockquote|figure|figcaption|caption|style|script|noscript|svg|template|meta|link|title|img|input|br|hr)\b[^<>]*>/i;

/** 闭合标签几乎不可能出现在纯文本里；`<p>Hello</p>` 靠它识别 */
const CLOSING_TAG_RE = /<\/[a-z][a-z0-9:-]*\s*>/i;

/**
 * 判断一段文本是不是 HTML（用于决定要不要先过 `htmlToLines`）。
 *
 * 保守判据，必须**同时**满足「像标签」和「是结构」：
 * 1. 出现结构标签：`<html>` / `<body>` / `<table>` / `<div>` / `<td>` /
 *    `<span>` / `<script>` …（见 STRUCTURAL_TAG_RE），且标签必须以 `>` 收尾，
 *    `<` 后不能有空格（`< div>` 在 HTML 里本来也只是文本）；
 * 2. 或者出现任意闭合标签 `</...>`（纯文本极少写这个）。
 *
 * 因此：
 * - `I <3 you` → **false**（`<` 后不是字母）；
 * - `a < b` → **false**（`<` 后有空格，且没有 `>`）；
 * - `a<b and b>c` → **false**（`b` 不在结构标签白名单里，也没有闭合标签）；
 * - `<div class="x">Homework</div>` / `<table>…` / `<!DOCTYPE html>` → **true**；
 * - `<div`（没有 `>`）→ **false**，交给调用方按纯文本处理，不会丢正文。
 */
export function looksLikeHtml(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  return STRUCTURAL_TAG_RE.test(text) || CLOSING_TAG_RE.test(text);
}

/* ------------------------------------------------------------------ *
 * extractDeadlineBlock
 * ------------------------------------------------------------------ */

interface HintSelector {
  readonly tag: string | null;
  readonly id: string | null;
  readonly className: string | null;
}

/**
 * 解析调用方给的简单选择器提示。
 *
 * 只支持 `tag` / `#id` / `.class` / `tag#id` / `tag.class` / `#id.class`。
 * 后代选择器、属性选择器、伪类一律返回 `null`（保守跳过），不猜。
 */
function parseHint(hint: string): HintSelector | null {
  const value = hint.trim();
  if (value.length === 0) return null;
  // 空格 / 组合符 / 属性 / 伪类：不在支持范围内
  if (/[\s>+~,[\]()]/.test(value)) return null;

  const match = /^([a-zA-Z][a-zA-Z0-9-]*)?(?:#([A-Za-z_][A-Za-z0-9_-]*))?(?:\.([A-Za-z_][A-Za-z0-9_-]*))?$/.exec(
    value,
  );
  if (match === null) return null;

  const tag = match[1]?.toLowerCase() ?? null;
  const id = match[2] ?? null;
  const className = match[3] ?? null;
  if (tag === null && id === null && className === null) return null;

  return { tag, id, className };
}

const ATTRIBUTE_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** 读标签属性（小写名，值已去引号；重复属性取第一个） */
function readAttributes(raw: string): Map<string, string> {
  const attributes = new Map<string, string>();
  ATTRIBUTE_RE.lastIndex = 0;

  let match: RegExpExecArray | null = ATTRIBUTE_RE.exec(raw);
  while (match !== null) {
    const name = match[1]?.toLowerCase();
    if (name !== undefined && name.length > 0 && !attributes.has(name)) {
      attributes.set(name, match[2] ?? match[3] ?? match[4] ?? '');
    }
    match = ATTRIBUTE_RE.exec(raw);
  }

  return attributes;
}

function matchesHint(tag: RawTag, selector: HintSelector): boolean {
  if (tag.closing) return false;
  if (selector.tag !== null && tag.name !== selector.tag) return false;

  // 纯 tag 提示（如 `table`）不需要读属性
  if (selector.id === null && selector.className === null) return true;

  const attributes = readAttributes(tag.attributes);
  if (selector.id !== null && attributes.get('id') !== selector.id) return false;

  if (selector.className !== null) {
    const classes = (attributes.get('class') ?? '').split(/\s+/);
    if (!classes.includes(selector.className)) return false;
  }

  return true;
}

/** 找第一个匹配标签的 innerHTML；自闭合/void/未闭合都返回 null */
function readElementInner(html: string, lowerHtml: string, open: RawTag): string | null {
  if (open.selfClosing || VOID_TAGS.has(open.name)) return null;

  let depth = 1;
  let index = open.end;

  while (index < html.length) {
    const lt = html.indexOf('<', index);
    if (lt === -1) return null;

    const skipped = skipMarkup(html, lt);
    if (skipped !== null) {
      index = skipped;
      continue;
    }

    const tag = readTag(html, lt);
    if (tag === null) {
      index = lt + 1;
      continue;
    }

    if (!tag.closing && RAW_TEXT_TAGS.has(tag.name)) {
      index = skipRawText(html, lowerHtml, tag);
      continue;
    }

    if (tag.name === open.name) {
      if (tag.closing) {
        depth -= 1;
        if (depth === 0) return html.slice(open.end, lt);
      } else if (!tag.selfClosing && !VOID_TAGS.has(tag.name)) {
        depth += 1;
      }
    }

    index = tag.end;
  }

  return null;
}

/** 按提示选择器找第一个「有可见文字」的匹配元素，返回它的 innerHTML */
function findHintInner(html: string, lowerHtml: string, selector: HintSelector): string | null {
  let index = 0;

  while (index < html.length) {
    const lt = html.indexOf('<', index);
    if (lt === -1) return null;

    const skipped = skipMarkup(html, lt);
    if (skipped !== null) {
      index = skipped;
      continue;
    }

    const tag = readTag(html, lt);
    if (tag === null) {
      index = lt + 1;
      continue;
    }

    index = tag.end;

    if (tag.closing) continue;

    if (RAW_TEXT_TAGS.has(tag.name)) {
      // 脚本/样式里出现的 `<div id="assignments">` 是字符串，不是页面结构
      index = skipRawText(html, lowerHtml, tag);
      continue;
    }

    if (!matchesHint(tag, selector)) continue;

    const inner = readElementInner(html, lowerHtml, tag);
    if (inner !== null && htmlToLines(inner).length > 0) return inner;
  }

  return null;
}

/**
 * 从整页 HTML 里保守地切出「作业列表区域」的 HTML 片段。
 *
 * 为什么需要它：整页另存为的 HTML 带导航栏、页脚、版权声明、甚至课程目录。
 * 把这些都喂给 paste 解析器会产生大量 `unparsed` 噪声。调用方可以给几个
 * 选择器提示（如 `['#assignments', '.assignment-list']`），本函数按顺序找
 * 第一个命中且**含可见文字**的区域，返回它的 innerHTML 交给 `htmlToLines`。
 *
 * 实现说明：**不追求完整 DOM 解析**，只做保守的区块切分 —— 线性扫描标签、
 * 按同名标签配平深度，支持上面那几种简单选择器。没有引入第三方 HTML 库。
 *
 * 退化行为（重要）：
 * - 没有 hints、hints 全为空、选择器语法不支持、找不到匹配、匹配区域为空、
 *   容器未闭合 —— 一律返回**原始整页 HTML**，绝不给空字符串；
 * - 提示按数组顺序尝试，第一个命中且非空的生效；
 * - 畸形 HTML 不抛异常。
 *
 * @param html 整页或片段 HTML
 * @param hints 简单选择器提示数组（`tag` / `#id` / `.class` 及其组合）
 * @returns 命中的 innerHTML；否则原样返回 `html`
 */
export function extractDeadlineBlock(html: string, hints?: readonly string[]): string {
  if (typeof html !== 'string' || html.length === 0) return '';

  const lowerHtml = html.toLowerCase();
  const safeHints: readonly unknown[] = Array.isArray(hints) ? hints : [];

  for (const hint of safeHints) {
    if (typeof hint !== 'string') continue;

    const selector = parseHint(hint);
    if (selector === null) continue;

    const inner = findHintInner(html, lowerHtml, selector);
    if (inner !== null) return inner;
  }

  // 退化：整页。调用方至少还能从导航栏之外捡到作业条目
  return html;
}
