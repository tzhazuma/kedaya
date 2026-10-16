import { describe, expect, it } from 'vitest';

import { toFaqArticleVM } from './listFaqArticles';
import {
  parseInlineMarkdown,
  parseMarkdownParagraphs,
  stripInlineMarkdown,
} from './markdownSubset';

const NOW = new Date('2026-10-16T10:00:00.000Z');

describe('Markdown 子集行内解析（只产出结构化片段，不产出 HTML）', () => {
  it('解析加粗与行内代码', () => {
    expect(parseInlineMarkdown('确认在 **学校页面** 能登录，再试 `Cookie`。')).toEqual([
      { kind: 'text', text: '确认在 ' },
      { kind: 'bold', text: '学校页面' },
      { kind: 'text', text: ' 能登录，再试 ' },
      { kind: 'code', text: 'Cookie' },
      { kind: 'text', text: '。' },
    ]);
  });

  it('未闭合的标记按普通文本处理，不吞内容', () => {
    expect(parseInlineMarkdown('只有一个 ** 星号')).toEqual([
      { kind: 'text', text: '只有一个 ** 星号' },
    ]);
    expect(parseInlineMarkdown('反引号 ` 没闭合')).toEqual([
      { kind: 'text', text: '反引号 ` 没闭合' },
    ]);
  });

  it('纯文本与空串都退化为单个 text 片段', () => {
    expect(parseInlineMarkdown('普通文本')).toEqual([{ kind: 'text', text: '普通文本' }]);
    expect(parseInlineMarkdown('')).toEqual([{ kind: 'text', text: '' }]);
  });

  it('parseMarkdownParagraphs 按空行切段并丢弃空段', () => {
    const paragraphs = parseMarkdownParagraphs('第一段 **加粗**\n\n\n第二段 `code`\n\n');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toEqual([
      { kind: 'text', text: '第一段 ' },
      { kind: 'bold', text: '加粗' },
    ]);
    expect(paragraphs[1]).toEqual([
      { kind: 'text', text: '第二段 ' },
      { kind: 'code', text: 'code' },
    ]);
  });

  it('stripInlineMarkdown 去掉标记保留内容', () => {
    expect(stripInlineMarkdown('确认在 **学校页面** 能登录，再试 `Cookie`。')).toBe(
      '确认在 学校页面 能登录，再试 Cookie。',
    );
  });

  it('toFaqArticleVM 同时给出纯文本段落与结构化片段', () => {
    const vm = toFaqArticleVM(
      {
        id: 'faq-1',
        slug: 'slug',
        question: '问题',
        answer: '**加粗**的答案。\n\n第二段 `code`。',
        category: 'account',
        status: 'PUBLISHED',
        helpfulCount: 1,
        unhelpfulCount: 0,
        updatedAt: NOW.toISOString(),
      },
      NOW,
    );
    expect(vm.answerParagraphs).toEqual(['加粗的答案。', '第二段 code。']);
    expect(vm.answerSegments[0]).toEqual([
      { kind: 'bold', text: '加粗' },
      { kind: 'text', text: '的答案。' },
    ]);
    expect(vm.answerSegments[1]).toEqual([
      { kind: 'text', text: '第二段 ' },
      { kind: 'code', text: 'code' },
      { kind: 'text', text: '。' },
    ]);
  });
});
