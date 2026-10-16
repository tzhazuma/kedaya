/**
 * Markdown 子集的行内解析（application 层，纯函数）。
 *
 * 契约 §2.8 说 `FaqArticle.answer` 是「Markdown 子集」，论坛正文同理。
 * 但我们**不引入** markdown 渲染库（体积 + XSS 面），只支持真正用到的两种行内标记：
 * `**加粗**` 与 `` `行内代码` ``。
 *
 * 安全边界：本函数**只产出结构化片段**，绝不产出 HTML 字符串 ——
 * 渲染层用 React 元素（自动转义），因此不存在 `dangerouslySetInnerHTML` 注入面。
 */

export type InlineSegmentKind = 'text' | 'bold' | 'code';

export interface InlineSegment {
  kind: InlineSegmentKind;
  text: string;
}

/** 未闭合的标记按普通文本处理（例如只写了一个 `**`），不吞掉内容 */
const INLINE_PATTERN = /\*\*([^*]+)\*\*|`([^`]+)`/g;

export function parseInlineMarkdown(input: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let cursor = 0;

  for (const match of input.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ kind: 'text', text: input.slice(cursor, index) });
    }
    const bold = match[1];
    const code = match[2];
    if (bold !== undefined) segments.push({ kind: 'bold', text: bold });
    else if (code !== undefined) segments.push({ kind: 'code', text: code });
    cursor = index + match[0].length;
  }

  if (cursor < input.length) {
    segments.push({ kind: 'text', text: input.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ kind: 'text', text: input }];
}

/** 段落列表 → 每个段落的行内片段列表（空段落被丢弃） */
export function parseMarkdownParagraphs(answer: string): InlineSegment[][] {
  return answer
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(parseInlineMarkdown);
}

/** 去掉所有行内标记（列表摘要、纯文本导出用） */
export function stripInlineMarkdown(input: string): string {
  return input.replace(INLINE_PATTERN, (_all, bold: string | undefined, code: string | undefined) =>
    bold ?? code ?? '',
  );
}
