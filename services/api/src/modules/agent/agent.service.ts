/**
 * 可达鸭 agent · 编排层。
 *
 * ## 一次问答的完整流程（facts-first）
 * ```
 *   用户提问
 *     ├─ ① 规则路由：按关键词挑出 1–2 个工具（确定性、零依赖）
 *     ├─ ② 并行执行工具 → 拿到**事实**（已受 userId 权限约束、已由服务端格式化）
 *     ├─ ③ 检索公共知识（RAG，白名单语料）
 *     ├─ ④ 若配置了模型：把「事实 + 知识片段」交给模型，仅让它组织语言
 *     │     （模型失败 / 未配置 → 用 ⑤ 拼答案，degraded=true）
 *     └─ ⑤ 规则拼装：把事实与知识片段拼成一段人话（**永远可用**）
 * ```
 * 为什么不是"让模型自己决定调工具"：模型一旦能自由调工具，就等于把
 * 「调用哪个工具、传什么参数」的决策权交给了一个可能被提示注入的组件。
 * 在校园场景里（余额、实名、心理数据同时存在）这个风险不可接受。
 * 这里由**服务端**决定调哪个工具，模型只能看到已经取好的事实。
 *
 * ## 可用性
 *   · 没配 LLM：完全可用（更简洁的规则回答）；
 *   · LLM 超时 / 报错：自动降级，`degraded: true`，用户仍能看到真实数据；
 *   · 上游（教务 / 校园卡）不可用：工具内部已降级成"人话 + 下一步"，不会让整轮问答失败。
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK } from '../auth/domain/local-account.domain';
import { AgentToolsService } from './agent-tools.service';
import { KnowledgeService } from './knowledge.service';
import {
  AGENT_LLM_PORT,
  type AgentAction,
  type AgentChatInput,
  type AgentFact,
  type AgentLlmPort,
  type AgentReply,
  type AgentSource,
  type AgentStep,
  type AgentTool,
  type AgentToolContext,
  type RetrievedDoc,
} from './domain/agent.domain';

/** 回答长度上限：聊天框不是文档页，超过就该改成"打开对应页面" */
const MAX_ANSWER_CHARS = 420;

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly tools: AgentToolsService,
    @Inject(CLOCK) private readonly clock: () => Date,
    @Inject(AGENT_LLM_PORT) private readonly llm: AgentLlmPort | null,
  ) {}

  /** 当前是否能用到模型（用于 `capabilities` 与埋点） */
  get llmModel(): string | null {
    return this.llm?.model ?? null;
  }

  /**
   * 一次问答。
   *
   * @param userId 已登录用户；`null` 表示匿名 —— 需要登录的工具会明确拒答并引导登录，
   *               而**不会**退回"通用答案"假装知道。
   */
  async chat(input: AgentChatInput, userId: string | null): Promise<AgentReply> {
    const startedAt = this.clock().getTime();
    const context: AgentToolContext = {
      userId,
      ...(input.page === undefined ? {} : { page: input.page }),
      ...(input.module === undefined ? {} : { module: input.module }),
    };

    const selected = this.tools.matchTools(input.question);
    const { facts, actions, steps, notices, simulated } = await this.runTools(selected, context);

    const docs = await this.knowledge.retrieve(input.question, {
      ...(input.module === undefined ? {} : { module: input.module }),
      limit: 3,
    });

    let answer: string;
    let usedModel: string | null = null;
    let degraded = notices.length > 0;

    if (this.llm !== null) {
      try {
        answer = await this.llm.compose({
          question: input.question,
          facts,
          docs,
          context: {
            ...(input.page === undefined ? {} : { page: input.page }),
            ...(input.module === undefined ? {} : { module: input.module }),
          },
        });
        usedModel = this.llm.model;
      } catch (error) {
        this.logger.warn(
          `模型组织语言失败，已降级为规则回答: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        answer = composeDeterministic(facts, docs, notices);
        degraded = true;
      }
    } else {
      answer = composeDeterministic(facts, docs, notices);
    }

    return {
      answer: clampAnswer(answer),
      sources: toSources(docs),
      actions: dedupeActions(actions),
      facts,
      steps,
      usedModel,
      degraded,
      simulated,
      latencyMs: Math.max(0, this.clock().getTime() - startedAt),
    };
  }

  /**
   * 建议问题（随页面变化）。
   *
   * 「全局可用」不只是"哪里都能打开"，还要**打开就知道能问什么**：
   * 在课表页给课表相关的问题，在校园卡页给余额相关的问题。
   */
  suggestions(page?: string, module?: string): string[] {
    const byModule: Record<string, string[]> = {
      schedule: ['今天还有课吗？', '下一节课在哪上？', '课表怎么同步？'],
      'campus-card': ['我卡里还有多少钱？', '这个月花了多少？', '校园卡丢了怎么办？'],
      auth: ['我绑定了哪些校园系统？', '实名信息为什么要打码？', '怎么绑定教务系统？'],
      profile: ['我授权了哪些敏感模块？', '怎么撤回同意？', '怎么导出我的数据？'],
      groupbuy: ['拼单怎么发起？', '拼单成团后会怎样？'],
      errand: ['跑腿怎么下单？', '跑腿费用怎么算？'],
      'lost-found': ['捡到东西怎么发布？', '失物招领怎么联系失主？'],
      forum: ['论坛发帖要注意什么？'],
    };

    const key = module ?? pageToModule(page);
    const specific = key === undefined ? [] : (byModule[key] ?? []);
    const common = ['这个页面是干什么的？', '我还能用哪些功能？', '我的数据安全吗？'];

    return [...specific, ...common].slice(0, 5);
  }

  /** agent 能力清单（如实列出"能做什么、用没用模型、哪些数据没索引"） */
  capabilities() {
    return {
      persona: '可达鸭',
      model: this.llmModel,
      /** 无模型时也能用（规则回答），这里如实说明当前模式 */
      mode: this.llmModel === null ? 'rules' : 'model',
      tools: this.tools.tools().map((tool) => ({
        name: tool.name,
        description: tool.description,
        requiresAuth: tool.requiresAuth,
      })),
      /** 检索范围（白名单）—— 让用户/审计知道"哪些内容进了索引" */
      knowledgeSources: ['模块说明（冻结契约 §4）', '内置使用指南', '帮助中心 FAQ'],
      /** 明确不进索引的内容（契约 §9） */
      notIndexed: ['个人课表', '校园卡流水', '实名信息', '心理与宿舍矛盾记录', '账号凭据'],
    };
  }

  /* ---------------- 内部 ---------------- */

  private async runTools(
    selected: AgentTool[],
    context: AgentToolContext,
  ): Promise<{
    facts: AgentFact[];
    actions: AgentAction[];
    steps: AgentStep[];
    notices: string[];
    simulated: boolean;
  }> {
    if (selected.length === 0) {
      return { facts: [], actions: [], steps: [], notices: [], simulated: false };
    }

    const results = await Promise.allSettled(selected.map((tool) => tool.run(context)));

    const facts: AgentFact[] = [];
    const actions: AgentAction[] = [];
    const steps: AgentStep[] = [];
    const notices: string[] = [];
    let simulated = false;

    results.forEach((result, index) => {
      const tool = selected[index] as AgentTool;
      if (result.status === 'fulfilled') {
        facts.push(...result.value.facts);
        actions.push(...(result.value.actions ?? []));
        if (result.value.notice !== undefined) notices.push(result.value.notice);
        if (result.value.facts.some((fact) => fact.simulated === true)) simulated = true;
        steps.push({ tool: tool.name, ok: true });
        return;
      }

      // 工具失败不能让整轮问答失败：记一步失败，继续用其他工具/知识回答
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      this.logger.warn(`agent 工具 ${tool.name} 执行失败（已降级）: ${reason}`);
      steps.push({ tool: tool.name, ok: false, error: reason.slice(0, 120) });
      notices.push(`「${tool.description}」暂时查不到（${reason.slice(0, 40)}），下面是我能确定的部分。`);
    });

    return { facts, actions, steps, notices, simulated };
  }
}

/* ================================================================== *
 * 规则回答（无模型时的拼装器；也是模型失败时的兜底）
 * ================================================================== */

export function composeDeterministic(
  facts: readonly AgentFact[],
  docs: readonly RetrievedDoc[],
  notices: readonly string[],
): string {
  const lines: string[] = [];

  if (facts.length > 0) {
    for (const fact of facts) {
      lines.push(`【${fact.label}】${fact.value}${fact.simulated === true ? '（演示数据）' : ''}`);
    }
  }

  // 有事实时只补一条最相关的说明；没有事实时用检索结果作答
  const topDoc = docs.find((item) => item.score > 0);
  if (topDoc !== undefined) {
    lines.push(facts.length > 0 ? `补充：${topDoc.doc.body}` : topDoc.doc.body);
  }

  for (const notice of notices) lines.push(notice);

  if (lines.length === 0) {
    return (
      '这个问题我还不太会答。可以试着问我：今天有哪些课、校园卡还剩多少钱、' +
      '怎么绑定校园系统、我授权了哪些模块 —— 或者换个说法再问我一次。'
    );
  }

  return lines.join('\n');
}

function clampAnswer(answer: string): string {
  const trimmed = answer.trim();
  if (trimmed.length <= MAX_ANSWER_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_ANSWER_CHARS - 1)}…`;
}

function toSources(docs: readonly RetrievedDoc[]): AgentSource[] {
  return docs.map((item) => ({
    id: item.doc.id,
    title: item.doc.title,
    kind: item.doc.kind,
    updatedAt: item.doc.updatedAt,
  }));
}

function dedupeActions(actions: readonly AgentAction[]): AgentAction[] {
  const seen = new Set<string>();
  const unique: AgentAction[] = [];
  for (const action of actions) {
    if (seen.has(action.path)) continue;
    seen.add(action.path);
    unique.push(action);
  }
  return unique.slice(0, 3);
}

/** 页面路径 → 模块 id（契约 §4），用于在没上报 module 时兜底猜上下文 */
function pageToModule(page?: string): string | undefined {
  if (page === undefined) return undefined;
  const segments = page.split('/').filter((segment) => segment.length > 0);
  // `/presentation/pages/<module>/...` → `<module>`
  const index = segments.indexOf('pages');
  const candidate = index >= 0 ? segments[index + 1] : undefined;
  if (candidate === undefined) return undefined;
  if (candidate === 'campusCard') return 'campus-card';
  if (candidate === 'fleaMarket') return 'flea-market';
  if (candidate === 'lostFound') return 'lost-found';
  if (candidate === 'profile') return 'profile';
  return candidate;
}
