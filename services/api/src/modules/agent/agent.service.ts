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

/**
 * 内置指南 id：《可达鸭能做什么》。
 *
 * 用户在**可达鸭页自己**问"这个页面是干什么的"时没有模块上下文
 * （agent 是全局助手，不属于契约里的 20 个模块），这条指南就是那个兜底。
 */
const AGENT_USAGE_GUIDE_ID = 'guide:agent-usage';

/**
 * 是否在问"当前这个页面 / 这个模块是干什么的"。
 *
 * 词表刻意写得**窄**：只认明确指向"当前页面"的说法。
 * 放"是什么""有什么用"这类泛问句进来会把"校园卡是什么"也劫持成页面介绍，
 * 而那些问题本来有更好的答案。
 */
export function asksAboutPage(question: string): boolean {
  return ['这个页面', '这页', '干什么', '做什么'].some((keyword) => question.includes(keyword));
}

/**
 * 是否在问"你还能做什么"。
 *
 * 和 `asksAboutPage` 一样，这句话里不会有任何模块名，检索只能撞上别的指南，
 * 所以也要走上下文补丁（补内置的《可达鸭能做什么》）。
 */
export function asksCapabilities(question: string): boolean {
  return ['哪些功能', '还能用', '有什么功能', '都能做', '能做什么'].some((keyword) =>
    question.includes(keyword),
  );
}

/** 这两类问题都要靠上下文补一条说明，否则检索答非所问 */
function needsContextDoc(question: string): boolean {
  return asksAboutPage(question) || asksCapabilities(question);
}

/**
 * 非契约模块的入口 → 对应的内置指南。
 *
 * 「首页」「服务大厅」是产品入口而不是契约 §4 的模块（它们没有独立 API 路由），
 * 所以没有 `module:<id>` 文档可用。用户站在首页问"这个页面是干什么的"，
 * 答案不该是"我查不到这个页面"，而该是下面这两条指南。
 */
const PAGE_GUIDES: Record<string, string> = {
  home: 'guide:home-page',
  discover: 'guide:service-hall',
};

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
    // 上下文模块：优先客户端上报的 `module`，其次是页面路径推断出来的
    // （悬浮球从某个页面跳过来时会带上两者，但只带 `page` 的调用方也要能用）
    const contextModule = input.module ?? pageToModule(input.page);
    const context: AgentToolContext = {
      userId,
      ...(input.page === undefined ? {} : { page: input.page }),
      ...(contextModule === undefined ? {} : { module: contextModule }),
    };

    const selected = this.tools.matchTools(input.question);
    const { facts, actions, steps, notices, simulated } = await this.runTools(selected, context);

    const retrieved = await this.knowledge.retrieve(input.question, {
      ...(contextModule === undefined ? {} : { module: contextModule }),
      limit: 3,
    });
    const docs = await this.withContextDoc(input.question, contextModule, retrieved);

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
            ...(contextModule === undefined ? {} : { module: contextModule }),
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

  /**
   * 上下文补丁：把「用户现在在哪儿 / 在问哪种能力」需要的那条说明补进知识片段。
   *
   * 触发条件只有两种，都是**这句话检索自己答不上来**的情形：
   *   1. 问的是「这个页面是干什么的」—— 句子里没有任何模块名，
   *      按关键词打分必然召不回那条模块说明（用户点了页面上的建议问题，
   *      得到的却是"我这边查不到，换个模块问我"：既没用，又漏了内部枚举词）；
   *   2. 问的是「我还能用哪些功能」—— 这句话同样没有模块名，
   *      检索会把「还能」「功能」这些碎片词匹配到别的指南上（实测召回了
   *      《微信快捷登录后还要做什么》），答非所问。
   *
   * 刻意**不**无条件注入：那样每问一次余额都会附一段"校园卡是基础能力模块、
   * 敏感级：低"的说明书，答案变长，`sources` 也会挂一条其实没被用上的引用。
   */
  private async withContextDoc(
    question: string,
    contextModule: string | undefined,
    retrieved: RetrievedDoc[],
  ): Promise<RetrievedDoc[]> {
    if (!needsContextDoc(question) && retrieved.length > 0) return retrieved;

    const doc =
      contextModule !== undefined && asksAboutPage(question)
        ? await this.knowledge.byId(PAGE_GUIDES[contextModule] ?? `module:${contextModule}`)
        : null;
    const anchor = doc ?? (await this.knowledge.byId(AGENT_USAGE_GUIDE_ID));
    if (anchor === null || retrieved.some((item) => item.doc.id === anchor.id)) return retrieved;

    /**
     * score 必须 > 0：规则回答器（`composeDeterministic`）是靠 `score > 0`
     * 挑"这条回答的主材料"的。补进来的这条恰恰是答这句话**最直接**的材料
     * （"你所在的模块是什么"），给 0 分等于白补 —— 用户还是会看到那条
     * 关键词撞上来的无关指南。
     */
    return [{ doc: anchor, score: 1, matched: [] }, ...retrieved].slice(0, 3);
  }

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
  const topDoc = docs.find((item) => item.score > 0);

  const factLines = facts.map(
    (fact) => `【${fact.label}】${fact.value}${fact.simulated === true ? '（演示数据）' : ''}`,
  );

  /**
   * 「需要登录」不是回答，而是**门槛说明**。
   *
   * 用户问「校园卡丢了怎么办」时命中了知识条目，同时也命中了校园卡工具的关键词；
   * 匿名状态下如果先输出「要查校园卡需要先登录」，用户会以为可达鸭答非所问。
   * 所以：命中知识条目 + 出现登录门槛时，**先给做法，再补门槛与登录入口**。
   */
  const loginGated = facts.some((fact) => fact.tool === 'auth.required');

  if (loginGated && topDoc !== undefined) {
    lines.push(topDoc.doc.body);
    lines.push(...factLines);
  } else {
    lines.push(...factLines);
    if (topDoc !== undefined) {
      lines.push(facts.length > 0 ? `补充：${topDoc.doc.body}` : topDoc.doc.body);
    }
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
