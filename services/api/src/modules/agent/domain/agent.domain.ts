/**
 * 可达鸭 agent · 领域契约（无框架依赖）。
 *
 * ============================ 设计取舍（重要） ============================
 * 1) **不做"把小程序所有信息都塞进 RAG"**。理由不是成本，是正确性：
 *    · 余额 / 课表 / 实名这类数据是**强一致、分钟级变化**的。把它们做成向量
 *      "快照"，用户问到"我卡里还有多少钱"时，模型会引用一份**过期**的答案 ——
 *      这比不知道更糟（用户会据此决定要不要充钱）。
 *    · 契约 §9 明确：心理、宿舍矛盾数据**不得进入通用画像**；身份/校园卡是 high
 *      敏感。把它们灌进一个共享检索索引，等于给越权留了一扇门。
 *    因此本模块的分工是：
 *      · **RAG 只索引"公共知识"**：模块说明（来自冻结契约 §4）、
 *        使用指南、FAQ（`FaqEntry` 表 + 内置兜底知识库）。白名单在
 *        `agent/domain/agent.domain.ts` 的 `KNOWLEDGE_ALLOW_LIST` 里显式声明。
 *      · **"我的数据"一律走受权限约束的工具（tool）实时取**，绝不进索引。
 * 2) **facts-first，而不是让模型自由调工具**。校园场景里"模型自己决定调哪个
 *    工具"风险太高（越权、幻觉数字、把 A 的数据说成 B 的）。这里的流程是：
 *      规则路由 → 用**服务端权限**取事实（事实里已经带上了 userId 约束）
 *      → 把事实与检索片段交给模型**只负责组织语言**。
 *    模型拿不到任何"自己造数据"的机会；它失败时，规则引擎直接用事实
 *    拼出答案（`degraded: true`），所以**没有 LLM key 也能用**。
 * 3) 每一条回答都必须带 `sources`（可追溯）与 `actions`（可直接跳到对应页面）。
 *    "全局可用性"的落地方式不是"到处放一个聊天框"，而是**不只给答案、还给下一步**。
 */

/* ------------------------------------------------------------------ *
 * 检索（RAG）侧
 * ------------------------------------------------------------------ */

/** 知识来源类型。`live` 表示"实时工具取到的事实"，**不是**检索结果。 */
export type KnowledgeKind = 'module' | 'guide' | 'faq';

export interface KnowledgeDoc {
  /** 稳定 id（`module:schedule` / `guide:wechat-login` / `faq:<rowId>`） */
  id: string;
  title: string;
  body: string;
  /** 关联模块（契约 §4 模块 id），用于按当前页面加权 */
  module: string | null;
  kind: KnowledgeKind;
  updatedAt: string | null;
}

export interface RetrievedDoc {
  doc: KnowledgeDoc;
  score: number;
  /** 命中的关键词，用于向用户解释"为什么给你看这条" */
  matched: string[];
}

export interface KnowledgePort {
  /** 全部可检索文档（已通过白名单校验） */
  all(): Promise<KnowledgeDoc[]>;
}

export const KNOWLEDGE_PORT = Symbol('KEDAYA_KNOWLEDGE_PORT');

/**
 * 允许进入检索索引的**内容来源白名单**（契约 §9 的落地清单）。
 *
 * 这是一条**显式**清单：新增来源必须改这里，避免以后有人图省事
 * 把某张业务表直接丢进索引，从而把敏感数据泄漏到检索结果里。
 */
export const KNOWLEDGE_ALLOW_LIST: readonly string[] = [
  'contracts:MODULES', // 冻结契约 §4 的模块定义（公开）
  'table:FaqEntry', // 帮助中心（公开）
  'builtin:guides', // 仓库内置使用指南（公开、随版本发布）
] as const;

/** 明确**禁止**进入索引的内容（写下来是为了让 code review 有据可依） */
export const KNOWLEDGE_DENY_LIST: readonly string[] = [
  'wellbeing', // 心理：契约 §9 禁止进入通用画像
  'dorm-harmony', // 宿舍矛盾：同上
  'ai-portrait', // 画像本身
  'CampusIdentity', // 实名信息（学号/姓名）
  'CampusCardTransaction', // 校园卡流水
  'ScheduleCourse', // 个人课表（实时工具取，不索引）
  'AuthIdentity', // 登录身份
  'UserCredential', // 凭据
] as const;

/* ------------------------------------------------------------------ *
 * 工具（实时事实）侧
 * ------------------------------------------------------------------ */

export interface AgentToolContext {
  /** 未登录为 null —— 需要登录的工具会据此明确拒答并引导登录 */
  userId: string | null;
  /** 当前页面路径（客户端上报），用于把"这个页面"讲清楚 */
  page?: string;
  /** 当前所在模块 id（契约 §4） */
  module?: string;
}

export interface AgentFact {
  /** 工具名，如 `schedule.today` */
  tool: string;
  /** 面向用户的一行标签，如「今日课表」 */
  label: string;
  /** 已经格式化好的值（**服务端格式化**，避免模型改写数字） */
  value: string;
  /** 事实是否来自模拟上游（必须如实透传） */
  simulated?: boolean;
}

export interface AgentToolResult {
  facts: AgentFact[];
  /** 工具也可以直接带上"下一步"（例如"去绑定教务系统"） */
  actions?: AgentAction[];
  /** 工具失败但已被优雅降级时的说明（例如"上游不可用，展示缓存"） */
  notice?: string;
}

export interface AgentTool {
  name: string;
  /** 供模型/日志理解用途 */
  description: string;
  requiresAuth: boolean;
  /** 规则路由的关键词（中文为主，大小写不敏感） */
  keywords: readonly string[];
  run(context: AgentToolContext): Promise<AgentToolResult>;
}

/* ------------------------------------------------------------------ *
 * 回复侧
 * ------------------------------------------------------------------ */

export interface AgentSource {
  id: string;
  title: string;
  kind: KnowledgeKind | 'live';
  updatedAt: string | null;
}

export interface AgentAction {
  type: 'navigate';
  label: string;
  /** 小程序页面路径（`PAGE_PATHS` 的值），由客户端执行跳转 */
  path: string;
}

/** 工具调用过程的可解释记录（"我知道你问的是课表，所以我去查了课表"） */
export interface AgentStep {
  tool: string;
  ok: boolean;
  /** 失败原因（已脱敏，不含上游凭据） */
  error?: string;
}

export interface AgentReply {
  answer: string;
  sources: AgentSource[];
  actions: AgentAction[];
  facts: AgentFact[];
  steps: AgentStep[];
  /** 实际使用的模型；`null` = 规则引擎（无模型可用/模型失败） */
  usedModel: string | null;
  /** true = 已降级（模型不可用或上游失败），回答仍可用但请用户知晓 */
  degraded: boolean;
  /** 回答中是否含模拟数据 */
  simulated: boolean;
  latencyMs: number;
}

export interface AgentChatInput {
  question: string;
  page?: string;
  module?: string;
}

export interface AgentLlmComposeInput {
  question: string;
  /** 已由受权限约束的工具取到的**事实**（模型只允许据此作答） */
  facts: AgentFact[];
  /** 检索到的公共知识片段 */
  docs: RetrievedDoc[];
  /** 当前页面/模块（可能为空） */
  context: { page?: string; module?: string };
}

/**
 * 大模型端口（可选实现）。
 *
 * 刻意只有**一个**方法：`compose`。模型不被允许调用工具、不允许访问数据库，
 * 只把已经取好的事实组织成人话。这样即使换了模型 / 模型被提示注入，
 * 也**不可能**读到它不该读的数据。
 */
export interface AgentLlmPort {
  /** 模型标识（用于 `usedModel` 与埋点） */
  readonly model: string;
  compose(input: AgentLlmComposeInput): Promise<string>;
}

export const AGENT_LLM_PORT = Symbol('KEDAYA_AGENT_LLM_PORT');
