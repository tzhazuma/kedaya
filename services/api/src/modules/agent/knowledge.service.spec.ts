import { describe, expect, it, vi } from 'vitest';
import { KnowledgeService, assertAllowListed, tokenize } from './knowledge.service';
import type { KnowledgeDoc, KnowledgePort } from './domain/agent.domain';

/**
 * 检索（RAG）测试。
 *
 * 重点不是"能不能搜到"，而是两条**安全/可用性**性质：
 *   ① 白名单之外的内容**进不来**（哪怕有人往仓储里塞了业务表）；
 *   ② 库里没有任何数据时，内置指南仍然能被检索到（空库可用）。
 */

function doc(partial: Partial<KnowledgeDoc> & { id: string; title: string; body: string }): KnowledgeDoc {
  return {
    module: null,
    kind: 'guide',
    updatedAt: null,
    ...partial,
  };
}

function serviceOf(docs: KnowledgeDoc[]): KnowledgeService {
  const port: KnowledgePort = { all: vi.fn().mockResolvedValue(docs) };
  return new KnowledgeService(port);
}

describe('tokenize（无分词器的中文切分）', () => {
  it('连续汉字切成二元组，去掉常见虚词', () => {
    const tokens = tokenize('校园卡怎么挂失');
    expect(tokens).toContain('校园');
    expect(tokens).toContain('园卡');
    expect(tokens).toContain('挂失');
    expect(tokens).not.toContain('怎么');
  });

  it('英文与数字整词保留，标点丢弃', () => {
    const tokens = tokenize('FAQ 在哪里？campus-card！');
    expect(tokens).toContain('faq');
    expect(tokens).toContain('campus-card');
    expect(tokens).not.toContain('？');
  });
});

describe('KnowledgeService.retrieve', () => {
  const corpus = [
    doc({ id: 'guide:campus-card-lost', title: '校园卡丢了怎么办', body: '先挂失，再到服务中心补办。', module: 'campus-card' }),
    doc({ id: 'guide:schedule-sync', title: '课表怎么同步', body: '点同步会去教务系统拉取并整体覆盖本地课表。', module: 'schedule' }),
    doc({ id: 'module:campus-card', title: '校园卡 · Campus Card', body: '余额、流水与付款码。', module: 'campus-card', kind: 'module' }),
  ];

  it('按标题/正文命中排序，标题命中权重更高', async () => {
    const service = serviceOf(corpus);
    const hits = await service.retrieve('课表怎么同步');

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.doc.id).toBe('guide:schedule-sync');
    expect(hits[0]?.matched.length).toBeGreaterThan(0);
  });

  it('当前模块的文档会被加权（在校园卡页问"怎么弄"更可能命中校园卡）', async () => {
    const service = serviceOf(corpus);
    const hits = await service.retrieve('校园卡怎么挂失', { module: 'campus-card', limit: 3 });

    expect(hits[0]?.doc.module).toBe('campus-card');
  });

  it('完全不相关的问题不返回噪声（宁可空，也不要答非所问）', async () => {
    const service = serviceOf(corpus);
    const hits = await service.retrieve('zzzzzzzz');
    expect(hits).toEqual([]);
  });

  it('空语料也能工作（空库部署时 agent 不应崩）', async () => {
    const service = serviceOf([]);
    await expect(service.retrieve('课表')).resolves.toEqual([]);
  });
});

describe('白名单护栏（契约 §9）', () => {
  it('模块说明 / 内置指南 / FAQ 三类来源放行', () => {
    expect(() =>
      assertAllowListed([
        doc({ id: 'module:schedule', title: '课表', body: '' }),
        doc({ id: 'guide:agent-usage', title: '用法', body: '' }),
        doc({ id: 'faq:abc', title: '问题', body: '' }),
      ]),
    ).not.toThrow();
  });

  it('个人数据一旦被塞进语料库，直接报错（而不是悄悄检索出去）', () => {
    expect(() =>
      assertAllowListed([doc({ id: 'campus-card-txns:user-1', title: '我的消费', body: '第一食堂 15 元' })]),
    ).toThrow(/白名单/);
  });

  it('KnowledgeService 在加载阶段就会拦下越界语料', async () => {
    const service = serviceOf([doc({ id: 'schedule:user-1:2026-2027-1', title: '我的课表', body: '数据结构' })]);
    await expect(service.all()).rejects.toThrow(/白名单/);
  });
});
