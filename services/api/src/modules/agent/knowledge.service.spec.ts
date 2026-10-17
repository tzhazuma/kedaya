import { describe, expect, it, vi } from 'vitest';
import { KnowledgeService, assertAllowListed, expandQuery, tokenize } from './knowledge.service';
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

/**
 * 相关性回归。
 *
 * 这几条对应的是**真实观测到的**答非所问：用户问「我卡里还有多少钱」，
 * 白名单文档里写的是「余额」「消费」，二元组检索一个都匹配不上，
 * 结果补充内容被一条很长的课表说明（撞上了虚词「还有」）抢走，
 * 于是余额回答后面跟了一句「补充：课表页会…」。
 *
 * 修法不是引入 embedding（那是给 agent 增加一个外部依赖），
 * 而是两层确定性补偿：**口语 → 规范词的查询扩展** + **长度归一**。
 */
describe('检索相关性（口语 ≠ 文档用词）', () => {
  const corpus = [
    doc({
      id: 'guide:card-balance',
      title: '校园卡余额与消费提示',
      body: '校园卡页显示余额与最近消费，余额偏低会提醒；还能按日均消费推算还能撑几天。',
      module: 'campus-card',
    }),
    doc({
      // 故意做得又长又"话多"：不做长度归一时，它靠虚词就能抢到高分
      id: 'guide:schedule-features',
      title: '课表里那些有用的提示',
      body:
        '课表页还会告诉你下一节几点上课还有多久，冲突会明确标出来。还有一点：如果上游系统暂时不可用，' +
        '页面会显示上一次成功同步的结果，不会清空。还有一点：可以在课表页手动加课。',
      module: 'schedule',
    }),
    doc({
      id: 'guide:privacy-consent',
      title: '隐私开关、同意与数据导出',
      body: '敏感模块需要单独同意，随时可以撤回；你的数据可以导出带走。',
      module: 'profile',
    }),
    doc({
      id: 'guide:module-overview',
      title: '小程序里都有哪些模块',
      body: '身份、课表、校园卡、我的，以及跳蚤市场、论坛等业务模块。',
      module: null,
    }),
  ];

  it('「我卡里还有多少钱」命中余额文档，而不是被长文档里的虚词抢走', async () => {
    const service = serviceOf(corpus);
    const hits = await service.retrieve('我卡里还有多少钱？');
    expect(hits[0]?.doc.id).toBe('guide:card-balance');
  });

  it('「我授权了哪些敏感模块」命中隐私文档（「哪些」这种疑问词不算命中信号）', async () => {
    const service = serviceOf(corpus);
    const hits = await service.retrieve('我授权了哪些敏感模块？');
    expect(hits[0]?.doc.id).toBe('guide:privacy-consent');
  });

  it('查询扩展只在有明确线索时才补词（保守，不做泛化联想）', () => {
    expect(expandQuery(tokenize('今天天气不错'), '今天天气不错')).toEqual(tokenize('今天天气不错'));
    expect(expandQuery(tokenize('卡里还剩多少'), '卡里还剩多少')).toContain('余额');
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
