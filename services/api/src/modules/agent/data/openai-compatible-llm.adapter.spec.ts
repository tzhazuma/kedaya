import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT, buildUserMessage } from './openai-compatible-llm.adapter';

/**
 * 提示词组装的两个**必须成立**的性质。
 *
 * 都来自真实事故：
 *   · 早先这里把 `context.module` 原样塞进提示词（`campus-card`），
 *     模型很自然地把它当成一个词念给用户听：'我查不到 campus-card 模块的说明'。
 *     内部枚举词不该出现在对用户的回答里。
 *   · 数据不足时模型会反问"你问的是哪个页面" —— 而那正是客户端建议问题里的原话，
 *     用户点下去得到的是一句追问，等于没回答。
 */
describe('buildUserMessage', () => {
  const base = { question: '这个页面是干什么的？', facts: [], docs: [] };

  it('模块上下文用中文名，绝不出内部模块 id', () => {
    const message = buildUserMessage({ ...base, context: { module: 'campus-card' } });

    expect(message).toContain('校园卡');
    expect(message).not.toContain('campus-card');
  });

  it('认不出来的模块 key（首页这类非契约入口）只字不提，不硬塞一串 id', () => {
    const message = buildUserMessage({ ...base, context: { module: 'home', page: '/presentation/pages/home/index' } });

    expect(message).not.toContain('home');
    expect(message).toContain('这个页面是干什么的？');
  });

  it('没有上下文时不加任何"当前页面"的说明', () => {
    const message = buildUserMessage({ ...base, context: {} });
    expect(message).not.toContain('用户当前在');
  });

  it('系统提示词明确禁止"反问用户是哪个页面"', () => {
    expect(SYSTEM_PROMPT).toContain('不要反问用户');
  });
});
