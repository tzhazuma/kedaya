import type { ResourceRepository } from '../../../common/crud/resource';
import { ForbiddenError } from '../../../common/errors/app-error';

/**
 * AI 校园画像 · ai-portrait（契约 §4.1，敏感级 **high**、`requiresConsent: true`）
 *
 * 这个模块的产品定位**不是**"AI 比你更懂你"，而是：
 *   **把你自己的在校内使用行为聚合成一份统计画像，并让每一条结论都可解释、可关闭、可撤回。**
 * 因此这里的领域规则不是"能增删改查"，而是四条**合规护栏**（改本文件前请先读完）：
 *
 *   1. **数据最小化**（契约 §9）：`wellbeing`（心理支持）与 `dorm-harmony`（宿舍矛盾）
 *      的数据**禁止**进入画像 —— `assertAllowedSources` 是**可执行**的断言，
 *      不是文档约定（白名单之外也一律拒绝：默认拒绝，而不是默认允许）。
 *   2. **归属只来自 JWT**：画像行按 `userId` 唯一，`Create/Update` 输入里**没有**
 *      `userId`，落库归属由服务层用登录主体补全（见 `ai-portrait.service.ts`）。
 *      请求体里塞 `userId` 不会生效 —— 否则任何人都能读到别人的画像。
 *   3. **可解释**：`explain` 与 `traits` 一起落库，且服务层强制把用到的
 *      `sources` 写进 `explain`；说不清来源的标签既不该写入、也不该展示。
 *   4. **不做推断**：本模块**不做**任何"根据行为推测心理状态"的推断
 *      —— 那正是契约 §9 要禁止的事，也是心理支持数据被排除的原因。
 */

export const AI_PORTRAIT_MODULE_ID = 'ai-portrait';

/** 契约 §9：这些模块的数据**禁止**被画像读取 */
export const FORBIDDEN_PORTRAIT_SOURCES: readonly string[] = ['wellbeing', 'dorm-harmony'];

/** 允许作为画像输入的低/中敏感模块 */
export const ALLOWED_PORTRAIT_SOURCES: readonly string[] = [
  'groupbuy',
  'errand',
  'flea-market',
  'canteen',
  'forum',
  'schedule',
  'lost-found',
  'buddy',
  'wildlife',
  'faq',
];

/**
 * 画像来源清单里的一项（`GET /sources` 返回给用户看的那张表）。
 *
 * `connected` 刻意声明成字面量 `false`：**现在没有任何一类数据被接入**。
 * 将来真要接入某类数据时，必须连同"数据怎么用、用户怎么撤回"一起改这里，
 * 而不可能"顺手把它标成 true"—— 类型会直接报错，逼一次显式决策。
 */
export interface PortraitSourceDescriptor {
  /** 模块 id（契约 §4） */
  id: string;
  nameZh: string;
  allowed: boolean;
  /** 这类数据**可以**用来说明什么（仅在接入之后才有意义；现在一律未接入） */
  usage: string;
  /** 仅禁止来源有：为什么被排除在画像之外 */
  exclusionReason?: string;
  connected: false;
}

/**
 * 画像可用的数据来源清单 —— 页面「来源与开关」直接渲染它，
 * 用户看到的"哪类数据用在哪"与后端白名单**同源**，不会各写一份后漂移。
 *
 * 顺序刻意与 `ALLOWED_PORTRAIT_SOURCES` + `FORBIDDEN_PORTRAIT_SOURCES`
 * 拼接后完全一致：这样"清单 ↔ 白名单"的顺序一致性是一条能被单测断言的性质，
 * 而不是靠人肉比对（`ai-portrait.service.spec.ts` 里就 check 了这件事）。
 */
export const PORTRAIT_SOURCE_CATALOG: readonly PortraitSourceDescriptor[] = [
  {
    id: 'groupbuy',
    nameZh: '拼单',
    allowed: true,
    usage: '常拼的品类与时段（例如「常在二食堂附近拼早餐」）',
    connected: false,
  },
  {
    id: 'errand',
    nameZh: '跑腿',
    allowed: true,
    usage: '常见的代取 / 代送类型与活跃时段',
    connected: false,
  },
  {
    id: 'flea-market',
    nameZh: '跳蚤市场',
    allowed: true,
    usage: '常浏览或交易的商品类别',
    connected: false,
  },
  {
    id: 'canteen',
    nameZh: '食堂营养',
    allowed: true,
    usage: '常去的食堂与用餐时段',
    connected: false,
  },
  {
    id: 'forum',
    nameZh: '论坛',
    allowed: true,
    usage: '常参与的版块',
    connected: false,
  },
  {
    id: 'schedule',
    nameZh: '课表',
    allowed: true,
    usage: '有课 / 空闲的时间分布（用于判断"什么时候活跃"）',
    connected: false,
  },
  {
    id: 'lost-found',
    nameZh: '失物招领',
    allowed: true,
    usage: '常出现的活动区域（图书馆 / 教学楼 / 生活区）',
    connected: false,
  },
  {
    id: 'buddy',
    nameZh: '找搭子',
    allowed: true,
    usage: '常找的活动类型（自习 / 运动 / 拼车）',
    connected: false,
  },
  {
    id: 'wildlife',
    nameZh: '猫鸟黑天鹅',
    allowed: true,
    usage: '常去观察的校园点位',
    connected: false,
  },
  {
    id: 'faq',
    nameZh: '常见问题',
    allowed: true,
    usage: '常查询的主题（用于把帮助入口排得更顺手）',
    connected: false,
  },
  {
    id: 'wellbeing',
    nameZh: '心理支持',
    allowed: false,
    usage: '不参与画像。',
    exclusionReason:
      '这类数据一旦参与画像，会让人不敢使用心理支持服务 —— 代价远大于任何"更懂你"的收益，因此整类排除。',
    connected: false,
  },
  {
    id: 'dorm-harmony',
    nameZh: '宿舍矛盾',
    allowed: false,
    usage: '不参与画像。',
    exclusionReason:
      '宿舍矛盾是匿名提交、只给调解员看的敏感内容；参与画像等于把它与本人重新关联起来，因此整类排除。',
    connected: false,
  },
];

/**
 * 画像生成能力的**现状**（如实写在代码里，供 `GET /sources` 原样返回）。
 *
 * 为什么要把"还没做"写进领域：不写的话，客户端只能猜 —— 要么画一个假画像，
 * 要么把"接口通但没数据"当成故障。写下来之后，两端对"现在还没有画像数据"
 * 这件事有同一个真相，空态文案也就有了依据。
 */
export const AI_PORTRAIT_GENERATION = {
  /** 是否已有真实的画像生成逻辑 */
  implemented: false,
  /** 已接入的行为数据来源个数 */
  connectedSources: 0,
  note: '后端尚未接入任何一类行为数据，也还没有画像生成逻辑：没有画像行时 GET /me 返回 null，小程序据此显示「尚无画像数据」空态，不会在客户端编造标签。',
} as const;

/** 可解释性规则（`GET /sources` 一并返回，页面据此解释"每条标签为什么长这样"） */
export const AI_PORTRAIT_EXPLAINABILITY_RULE =
  '每条标签都必须能说明来源：服务层会把本次用到的数据来源写进 explain.sources；说不清来源的标签既不会写入，也不会展示。';

export interface AiPortraitProfileModel {
  id: string;
  /** 归属。永远等于登录主体，且按它唯一（`userId` 上有唯一索引） */
  userId: string;
  /** 画像标签（可解释） */
  traits: unknown;
  /** 每个标签的推导来源，供用户查看"为什么给我推这个" */
  explain: unknown;
  /** 用户可关闭（契约 §9）。关闭后客户端不再展示标签，服务端保留数据以便重新开启 */
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** 写入输入：**没有** `userId` —— 归属由服务层从 JWT 取 */
export interface CreateAiPortraitProfileInput {
  traits: unknown;
  explain: unknown;
  enabled?: boolean;
}

/** 更新输入：同样没有 `userId`（归属不可变） */
export interface UpdateAiPortraitProfileInput {
  traits?: unknown;
  explain?: unknown;
  enabled?: boolean;
}

/**
 * 仓储端口。
 *
 * 通用 `ResourceRepository` 的方法保留在基类上（`buildWhere` / `buildOrderBy` 已显式收窄，
 * 见 `data/ai-portrait.repository.ts`），但本模块**只走**下面两个按主体寻址的方法：
 * 画像永远是"本人的"，没有"按 id 看别人的画像"这种合法路径，
 * 因此 HTTP 层也不存在任何接受画像 id / 用户 id 的端点。
 */
export type AiPortraitProfileRepository = ResourceRepository<
  AiPortraitProfileModel,
  CreateAiPortraitProfileInput,
  UpdateAiPortraitProfileInput
> & {
  findByUserId(userId: string): Promise<AiPortraitProfileModel | null>;
  upsertForUser(
    userId: string,
    input: { traits: unknown; explain: unknown; enabled: boolean },
  ): Promise<AiPortraitProfileModel>;
};

export const AI_PORTRAIT_PROFILE_REPOSITORY = Symbol('KEDAYA_AI_PORTRAIT_PROFILE_REPOSITORY');

/**
 * 契约 §9 的运行时护栏：任何把禁读域当作画像来源的请求都会被拒绝。
 * 这是**可执行**的合规断言，而不是文档约定。
 */
export function assertAllowedSources(sources: readonly string[]): void {
  const forbidden = sources.filter((source) => FORBIDDEN_PORTRAIT_SOURCES.includes(source));
  if (forbidden.length > 0) {
    throw new ForbiddenError(
      `契约 §9 数据最小化：ai-portrait 不得读取 [${forbidden.join(', ')}] 的数据`,
      { forbidden, rule: 'data-minimization' },
    );
  }

  const unknown = sources.filter((source) => !ALLOWED_PORTRAIT_SOURCES.includes(source));
  if (unknown.length > 0) {
    throw new ForbiddenError(`以下模块不在画像允许的数据来源白名单内：[${unknown.join(', ')}]`, {
      unknown,
      allowed: ALLOWED_PORTRAIT_SOURCES,
    });
  }
}
