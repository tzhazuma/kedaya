import { describe, expect, it, vi } from 'vitest';
import { AgentService, composeDeterministic } from './agent.service';
import { KnowledgeService } from './knowledge.service';
import { AgentToolsService } from './agent-tools.service';
import type {
  AgentLlmPort,
  AgentTool,
  KnowledgeDoc,
  KnowledgePort,
  RetrievedDoc,
} from './domain/agent.domain';

/**
 * agent 编排测试。
 *
 * 三条必须成立的可用性性质：
 *   ① **没有大模型也完全可用**（规则回答 + 真实事实）；
 *   ② 模型失败自动降级，用户仍能看到数据（不是一句"服务不可用"）；
 *   ③ 工具失败不拖垮整轮问答。
 */

const NOW = new Date(2026, 9, 17, 10, 0, 0);

function doc(id: string, title: string, body: string): RetrievedDoc {
  return {
    doc: { id, title, body, module: null, kind: 'guide', updatedAt: null },
    score: 3,
    matched: ['课表'],
  };
}

const scheduleTool: AgentTool = {
  name: 'schedule.today',
  description: '查今天的课程',
  requiresAuth: true,
  keywords: ['课表', '有课'],
  run: vi.fn().mockResolvedValue({
    facts: [{ tool: 'schedule.today', label: '今日课表', value: '08:15 数据结构 @ 信息楼 305', simulated: true }],
    actions: [{ type: 'navigate' as const, label: '打开课表', path: '/presentation/pages/schedule/index' }],
  }),
};

function build(options: {
  tools?: AgentTool[];
  llm?: AgentLlmPort | null;
} = {}) {
  const knowledgePort: KnowledgePort = {
    all: vi.fn().mockResolvedValue([
      { id: 'guide:schedule-sync', title: '课表怎么同步', body: '整体覆盖本地课表。', module: 'schedule', kind: 'guide', updatedAt: null },
      { id: 'guide:schedule-day', title: '今天有课吗', body: '课表页会显示今天和本周的全部课程。', module: 'schedule', kind: 'guide', updatedAt: null },
    ]),
  };
  const knowledge = new KnowledgeService(knowledgePort);

  const tools = {
    matchTools: vi.fn().mockImplementation((_q: string, _limit?: number) => options.tools ?? [scheduleTool]),
    tools: vi.fn().mockReturnValue(options.tools ?? [scheduleTool]),
  } as unknown as AgentToolsService;

  const service = new AgentService(knowledge, tools, () => NOW, options.llm ?? null);
  return { service, knowledge, tools };
}

describe('AgentService.chat（无模型 · 规则回答）', () => {
  it('用真实事实作答，并带上来源、动作与模拟标注', async () => {
    const { service } = build();
    const reply = await service.chat({ question: '今天有课吗', module: 'schedule' }, 'user-1');

    expect(reply.usedModel).toBeNull();
    expect(reply.answer).toContain('今日课表');
    expect(reply.answer).toContain('信息楼 305');
    expect(reply.answer).toContain('演示数据');
    expect(reply.simulated).toBe(true);
    expect(reply.actions[0]?.path).toBe('/presentation/pages/schedule/index');
    expect(reply.sources.length).toBeGreaterThan(0);
    expect(reply.steps).toEqual([{ tool: 'schedule.today', ok: true }]);
    expect(reply.degraded).toBe(false);
  });

  it('没有任何事实与知识时，引导用户换个问法（而不是空白回答）', async () => {
    const { service } = build({ tools: [] });
    const reply = await service.chat({ question: '讲个笑话' }, null);

    expect(reply.facts).toEqual([]);
    expect(reply.answer).toContain('换个说法');
  });

  it('工具失败：整轮问答仍然成功，并如实说明哪一项没查到', async () => {
    const failing: AgentTool = {
      name: 'card.overview',
      description: '查校园卡余额',
      requiresAuth: true,
      keywords: ['余额'],
      run: vi.fn().mockRejectedValue(new Error('校园卡系统 502')),
    };
    const { service } = build({ tools: [failing] });

    const reply = await service.chat({ question: '我卡里还有多少钱' }, 'user-1');

    expect(reply.degraded).toBe(true);
    expect(reply.steps[0]?.ok).toBe(false);
    expect(reply.answer).toContain('暂时查不到');
  });
});

describe('AgentService.chat（有模型）', () => {
  it('模型可用时用它的回答，并标出 usedModel', async () => {
    const llm: AgentLlmPort = { model: 'test-model', compose: vi.fn().mockResolvedValue('你今天 08:15 有数据结构课。') };
    const { service } = build({ llm });

    const reply = await service.chat({ question: '今天有课吗' }, 'user-1');

    expect(reply.usedModel).toBe('test-model');
    expect(reply.answer).toBe('你今天 08:15 有数据结构课。');
    expect(reply.degraded).toBe(false);
    // 事实仍然原样返回给客户端（前端可以渲染成卡片，不依赖模型的转述）
    expect(reply.facts).toHaveLength(1);
  });

  it('模型失败 → 自动降级为规则回答，用户依然拿到真实数据', async () => {
    const llm: AgentLlmPort = { model: 'test-model', compose: vi.fn().mockRejectedValue(new Error('模型超时')) };
    const { service } = build({ llm });

    const reply = await service.chat({ question: '今天有课吗' }, 'user-1');

    expect(reply.usedModel).toBeNull();
    expect(reply.degraded).toBe(true);
    expect(reply.answer).toContain('信息楼 305');
  });
});

describe('AgentService.suggestions / capabilities', () => {
  it('当前模块不同，建议问题不同', () => {
    const { service } = build();
    expect(service.suggestions(undefined, 'schedule')).toContain('下一节课在哪上？');
    expect(service.suggestions(undefined, 'campus-card')).toContain('我卡里还有多少钱？');
  });

  it('页面路径能反推出模块（客户端没上报 module 时的兜底）', () => {
    const { service } = build();
    expect(service.suggestions('/presentation/pages/campusCard/index')).toContain('我卡里还有多少钱？');
  });

  it('能力清单如实说明"哪些内容没有进检索索引"', () => {
    const { service } = build();
    const capabilities = service.capabilities();
    expect(capabilities.notIndexed).toContain('校园卡流水');
    expect(capabilities.mode).toBe('rules');
  });
});

describe('AgentService 上下文补丁（"这个页面是干什么的"必须答得出来）', () => {
  /**
   * 这几条锁的是一个真实事故：页面上把「这个页面是干什么的？」摆在建议问题里，
   * 用户点下去却得到"我这边查不到 campus-card 模块的说明，换个模块问我" ——
   * 既没用，又把内部枚举词(tool: campus-card)漏给了用户。
   *
   * 根因是检索按关键词打分，"这个页面是干什么的"里没有任何模块名，
   * 必然召不回那条模块说明。修法：命中这类问句时，由服务端**精确补一条**
   * 上下文说明（模块说明 / 首页与服务大厅指南 / 《可达鸭能做什么》）。
   */
  function buildWith(docs: KnowledgeDoc[]) {
    const knowledge = new KnowledgeService({ all: vi.fn().mockResolvedValue(docs) });
    const tools = {
      matchTools: vi.fn().mockReturnValue([]),
      tools: vi.fn().mockReturnValue([]),
    } as unknown as AgentToolsService;
    return new AgentService(knowledge, tools, () => NOW, null);
  }

  const corpus = [
    {
      id: 'module:campus-card',
      title: '校园卡 · Campus Card',
      body: '校园卡模块：余额、流水与付款码。',
      module: 'campus-card',
      kind: 'module' as const,
      updatedAt: null,
    },
    {
      id: 'guide:agent-usage',
      title: '可达鸭能做什么',
      body: '可达鸭是内置在小程序里的助手，任何页面都能唤起。',
      module: null,
      kind: 'guide' as const,
      updatedAt: null,
    },
    {
      id: 'guide:home-page',
      title: '首页与「凑凑」',
      body: '首页分三块：问候、我的常用宫格、常驻的心理支持出口。',
      module: null,
      kind: 'guide' as const,
      updatedAt: null,
    },
    {
      id: 'guide:service-hall',
      title: '服务大厅：找入口的地方',
      body: '服务大厅把全部服务按场景分组，顶上可以搜索模块名。',
      module: null,
      kind: 'guide' as const,
      updatedAt: null,
    },
  ];

  it('在校园卡页问"这个页面是干什么的"→ 用模块说明作答，并把它列为首要来源', async () => {
    const service = buildWith(corpus);
    const reply = await service.chat({ question: '这个页面是干什么的？', module: 'campus-card' }, null);

    expect(reply.sources[0]?.id).toBe('module:campus-card');
    expect(reply.answer).toContain('余额、流水与付款码');
    expect(reply.answer).not.toContain('campus-card');
  });

  it('没有模块上下文时（可达鸭页自己）→ 答《可达鸭能做什么》而不是"查不到"', async () => {
    const service = buildWith(corpus);
    const reply = await service.chat({ question: '这个页面是干什么的？' }, null);

    expect(reply.sources[0]?.id).toBe('guide:agent-usage');
    expect(reply.answer).toContain('任何页面都能唤起');
  });

  it('首页 / 服务大厅不是契约模块，但同样有说明可答', async () => {
    const service = buildWith(corpus);
    const home = await service.chat({ question: '这个页面是干什么的？', module: 'home' }, null);
    const hall = await service.chat({ question: '这个页面是干什么的？', module: 'discover' }, null);

    expect(home.sources[0]?.id).toBe('guide:home-page');
    expect(hall.sources[0]?.id).toBe('guide:service-hall');
  });

  it('问"我还能用哪些功能"→ 补《可达鸭能做什么》（这句话里也没有模块名）', async () => {
    const service = buildWith(corpus);
    const reply = await service.chat({ question: '我还能用哪些功能？' }, null);

    expect(reply.sources[0]?.id).toBe('guide:agent-usage');
  });

  it('普通问题**不**注入上下文说明（否则每次回答都多一段没用的模块介绍）', async () => {
    const service = buildWith(corpus);
    const reply = await service.chat({ question: '校园卡余额怎么算异常扣款？', module: 'campus-card' }, null);

    expect(reply.sources.some((source) => source.id === 'guide:agent-usage')).toBe(false);
  });
});

describe('composeDeterministic', () => {
  it('事实优先；没有事实时用知识片段作答', () => {
    expect(composeDeterministic([{ tool: 't', label: '余额', value: '¥23.50' }], [], [])).toContain('¥23.50');
    expect(composeDeterministic([], [doc('guide:x', '课表同步', '整体覆盖本地课表')], [])).toBe('整体覆盖本地课表');
  });

  it('匿名问"怎么做"时先给做法再给登录门槛（不要答非所问）', () => {
    const answer = composeDeterministic(
      [{ tool: 'auth.required', label: '需要先登录', value: '要查校园卡需要先登录' }],
      [doc('guide:lost', '校园卡丢了怎么办', '到自助终端办理挂失')],
      [],
    );
    expect(answer.startsWith('到自助终端办理挂失')).toBe(true);
    expect(answer).toContain('需要先登录');
  });

  it('其余情况下"需要登录"仍作为首条事实（没有知识条目可答时它就是回答本身）', () => {
    const answer = composeDeterministic(
      [{ tool: 'auth.required', label: '需要先登录', value: '要查课表需要先登录' }],
      [],
      [],
    );
    expect(answer.startsWith('【需要先登录】')).toBe(true);
  });
});
