import { describe, expect, it, vi } from 'vitest';
import { AgentService, composeDeterministic } from './agent.service';
import { KnowledgeService } from './knowledge.service';
import { AgentToolsService } from './agent-tools.service';
import type {
  AgentLlmPort,
  AgentTool,
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

describe('composeDeterministic', () => {
  it('事实优先；没有事实时用知识片段作答', () => {
    expect(composeDeterministic([{ tool: 't', label: '余额', value: '¥23.50' }], [], [])).toContain('¥23.50');
    expect(composeDeterministic([], [doc('guide:x', '课表同步', '整体覆盖本地课表')], [])).toBe('整体覆盖本地课表');
  });
});
