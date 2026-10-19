/**
 * 校园服务的两道**互相独立**的闸门：**信任**（敢不敢让代码进来）与
 * **能力**（进来之后能碰什么）。
 *
 * ## 为什么需要这个文件
 *
 * `campus-services.ts` 已经把 `authorization`（法律事实）与 `mode`（技术现状）
 * 分成了两个正交维度。这是同一类错误的第二个例子：
 *
 * > 我们很容易把「这段代码是我们自己写的」直接推导成「它可以读用户数据、
 * > 可以联网、可以碰登录凭据」。每一步推导都没有经过一次**显式的授予**。
 *
 * 一家校园服务适配器来自哪里，和它能碰什么，**没有必然关系**：
 *
 *   · 第一方代码也可能有 bug，也会被供应链投毒；
 *   · 经过审核的外部代码只应拿到它真正需要的**最小**能力；
 *   · 没有审核的代码，无论它自称多无害，都不该先跑起来再补票。
 *
 * 所以本文件把两件事拆成两个维度，再用一张**显式矩阵**逐格决定：
 *
 *   `TrustLevel`（来源可信度） × `CapabilityScope`（能做什么）
 *
 * 矩阵里没有任何一格是「从信任推导出来的」。每一格都是写死的政策；
 * 要放开某一格，必须改这张表、改测试、并在
 * `docs/architecture/10-trust-vs-capability.md` 里说明理由。
 *
 * ## 三条硬规则
 *
 * 1. **信任不隐含能力。** `first-party` 也只拿到矩阵里明确写出的三项能力，
 *    不是「默认全开」。
 * 2. **`credential-access` 永久禁止。** 任何信任等级都不允许，包括第一方。
 *    校园登录凭据（CASTGC / ticket / cookie）只能留在用户自己的设备上，
 *    见 `services/api/src/modules/techpie/domain/ports/egate-locality.spec.ts`。
 * 3. **默认拒绝。** `unverified` / `blocked` 一个能力都没有；未知的信任等级
 *    或未知的能力，在运行时也一律按「不允许」处理（fail closed）。
 *
 * ## 与 `campus-services.ts` 的关系
 *
 * 本文件**不修改** `campus-services.ts`，也不替它做决定。它只提供一套可复用的
 * 判定，供将来给 `CampusServiceDescriptor` 增加 `trust` / `capabilities` 字段时
 * 使用（设计见文档 §4）。在字段真正落地之前，这份契约不应被说成「已经在跑」。
 *
 * ## 版权边界
 *
 * 「信任与能力正交」这个**思想**来自我们对另一个参赛组 APK 的架构阅读
 * （`docs/architecture/09-qin-apk-analysis.md`）。对方的代码没有许可证，
 * 本文件**没有**复制、翻译或逐行改写其任何源码，也**没有** import
 * `/tmp/qin-src`；类型名、函数名、注释与判定表都是我们自己的。
 */

/* ------------------------------------------------------------------ *
 * 两个维度（冻结枚举；新增取值必须同时补标签、矩阵与测试）
 * ------------------------------------------------------------------ */

/** 代码 / 数据来源的可信度 —— 「敢不敢让它进来」 */
export const TRUST_LEVELS = [
  'first-party',
  'audited-third-party',
  'unverified',
  'blocked',
] as const;

export type TrustLevel = (typeof TRUST_LEVELS)[number];

/** 它能做什么 —— 「进来之后能碰到什么」 */
export const CAPABILITY_SCOPES = [
  'read-public',
  'read-personal',
  'write-personal',
  'network-egress',
  'credential-access',
] as const;

export type CapabilityScope = (typeof CAPABILITY_SCOPES)[number];

/** 给用户看的来源说明（不出现内部枚举名） */
export const TRUST_LEVEL_LABELS: Readonly<Record<TrustLevel, string>> = {
  'first-party': '我们自己维护的代码',
  'audited-third-party': '已经通过安全检查的外部代码',
  unverified: '还没有通过安全检查的外部代码',
  blocked: '已经被禁止使用的代码',
};

/** 给用户看的能力说明（用日常说法，不用「权限域」「scope」这类词） */
export const CAPABILITY_SCOPE_LABELS: Readonly<Record<CapabilityScope, string>> = {
  'read-public': '查看公开信息',
  'read-personal': '查看你的个人数据',
  'write-personal': '修改你的个人数据',
  'network-egress': '把数据发到校外',
  'credential-access': '接触你的校园账号密码',
};

export function isTrustLevel(value: unknown): value is TrustLevel {
  return typeof value === 'string' && (TRUST_LEVELS as readonly string[]).includes(value);
}

export function isCapabilityScope(value: unknown): value is CapabilityScope {
  return typeof value === 'string' && (CAPABILITY_SCOPES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ *
 * 判定矩阵（每一格都是显式政策，不是从信任推导出来的）
 * ------------------------------------------------------------------ */

/**
 * `TrustLevel × CapabilityScope` 的完整判定表。
 *
 * | 信任 \ 能力        | read-public | read-personal | write-personal | network-egress | credential-access |
 * | ------------------ | :---------: | :-----------: | :------------: | :------------: | :---------------: |
 * | `first-party`      |     ✅      |      ✅       |      ✅        |       ❌       |        ❌         |
 * | `audited-third-party` |  ✅      |      ❌       |      ❌        |       ❌       |        ❌         |
 * | `unverified`       |     ❌      |      ❌       |      ❌        |       ❌       |        ❌         |
 * | `blocked`          |     ❌      |      ❌       |      ❌        |       ❌       |        ❌         |
 *
 * 两个「全列 ❌」不是遗漏，而是两条不同的政策：
 *
 *   · **`credential-access`**：无论信任多高都**永久禁止**。它不是「还没批」，
 *     而是「不存在可批准它的流程」。
 *   · **`network-egress`**：信任等级**无权**授予数据出口。要不要把数据发到
 *     校外，必须另走一次面向用户的单独确认（本文件不实现那条流程）。
 *     这也与 `docs/architecture/06-prior-art-and-reuse.md` 的
 *     「只进不出（inbound ingest）」原则一致。
 */
export const TRUST_CAPABILITY_MATRIX = {
  'first-party': {
    'read-public': true,
    'read-personal': true,
    'write-personal': true,
    'network-egress': false,
    'credential-access': false,
  },
  'audited-third-party': {
    'read-public': true,
    'read-personal': false,
    'write-personal': false,
    'network-egress': false,
    'credential-access': false,
  },
  unverified: {
    'read-public': false,
    'read-personal': false,
    'write-personal': false,
    'network-egress': false,
    'credential-access': false,
  },
  blocked: {
    'read-public': false,
    'read-personal': false,
    'write-personal': false,
    'network-egress': false,
    'credential-access': false,
  },
} as const satisfies Readonly<Record<TrustLevel, Readonly<Record<CapabilityScope, boolean>>>>;

/**
 * 这个来源能不能拥有这项能力。
 *
 * 运行时遇到未知取值一律返回 `false`：类型系统拦不住来自 JSON / 远端配置的
 * 字符串，所以这里必须 fail closed。
 */
export function isCapabilityAllowed(trust: TrustLevel, capability: CapabilityScope): boolean {
  if (!isTrustLevel(trust) || !isCapabilityScope(capability)) return false;
  return TRUST_CAPABILITY_MATRIX[trust][capability];
}

/** 该来源被允许的全部能力（顺序与枚举一致，便于 UI 稳定渲染） */
export function allowedCapabilitiesFor(trust: TrustLevel): readonly CapabilityScope[] {
  if (!isTrustLevel(trust)) return [];
  return CAPABILITY_SCOPES.filter((capability) => isCapabilityAllowed(trust, capability));
}

/* ------------------------------------------------------------------ *
 * 拒绝理由（面向用户；不出现枚举名与技术黑话）
 * ------------------------------------------------------------------ */

/** 为什么这一格是「不允许」—— 一句话说清缺什么、下一步是什么 */
function explainCapabilityDenial(
  trust: TrustLevel,
  capability: CapabilityScope,
): string {
  if (!isTrustLevel(trust)) {
    return '我们无法确认这段代码来自哪里，因此不能让它接触任何数据。';
  }
  if (!isCapabilityScope(capability)) {
    return '这项操作不在我们认可的范围内，因此不能执行。';
  }

  const capabilityLabel = CAPABILITY_SCOPE_LABELS[capability];

  // 硬底线优先：不看信任等级。
  if (capability === 'credential-access') {
    return '校园账号密码永远不能交给任何代码，哪怕是我们自己写的代码；它只能留在你自己的设备上。';
  }

  if (trust === 'blocked') {
    return `这段代码已经被我们禁止使用，不能${capabilityLabel}。`;
  }

  if (trust === 'unverified') {
    return `这段代码还没有通过我们的安全检查，不能${capabilityLabel}；请先完成检查。`;
  }

  if (capability === 'network-egress') {
    return '信任这段代码，不等于允许它把数据发到校外；数据是否离开校园，需要单独征得你的同意。';
  }

  // 走到这里只剩「已审核的外部代码」申请个人数据 / 写能力。
  return `这段代码来自外部，只通过了公开信息的检查，不能${capabilityLabel}。`;
}

/**
 * 断言某项能力可以授予；不允许时抛错。
 *
 * 与 [validateServiceCapabilities] 的分工：本函数用于**代码路径上已经认定
 * 不该继续**的场合（fail fast）；需要把多条问题逐条展示给用户时，用后者
 * （它返回列表，不抛异常）。
 */
export function assertCapabilityAllowed(
  trust: TrustLevel,
  capability: CapabilityScope,
): void {
  if (isCapabilityAllowed(trust, capability)) return;

  // 未知取值：错误信息也要说清是哪一边不认识，别只抛一个「不允许」。
  if (!isTrustLevel(trust)) {
    throw new Error(`未知的来源可信度：${String(trust)}；出于安全考虑，一律不允许。`);
  }
  if (!isCapabilityScope(capability)) {
    throw new Error(`未知的能力：${String(capability)}；出于安全考虑，一律不允许。`);
  }

  throw new Error(
    `${TRUST_LEVEL_LABELS[trust]}不能${CAPABILITY_SCOPE_LABELS[capability]}。` +
      explainCapabilityDenial(trust, capability),
  );
}

/* ------------------------------------------------------------------ *
 * 组合判定（返回违规列表，不抛异常）
 * ------------------------------------------------------------------ */

/** 一份「这段代码是谁的 + 它声明要哪些能力」的申报 */
export interface ServiceCapabilityDeclaration {
  readonly trust: TrustLevel;
  readonly capabilities: readonly CapabilityScope[];
}

export type CapabilityViolationCode =
  /** 该信任等级不允许这项能力（普通违规） */
  | 'capability-denied'
  /** 申请了永远禁止的校园凭据能力（硬红线，单独成码便于 UI 强调） */
  | 'credential-access-forbidden';

export interface CapabilityViolation {
  readonly code: CapabilityViolationCode;
  readonly trust: TrustLevel;
  readonly capability: CapabilityScope;
  /** 给用户看的一句话；调用方应原样展示，不要自己改写 */
  readonly message: string;
}

export interface CapabilityValidationResult {
  readonly ok: boolean;
  readonly violations: readonly CapabilityViolation[];
}

function violationOf(
  trust: TrustLevel,
  capability: CapabilityScope,
): CapabilityViolation {
  return {
    code: capability === 'credential-access' ? 'credential-access-forbidden' : 'capability-denied',
    trust,
    capability,
    message: explainCapabilityDenial(trust, capability),
  };
}

/**
 * 校验一组能力申报，**返回违规列表而不是抛异常**。
 *
 * 理由与 `validatePoiSupplement` 相同：安装 / 接入页面需要把问题**逐条**
 * 展示给用户。一个异常只能给出一句话；一个问题列表能同时说清
 * 「申请了三项、其中两项不行、分别为什么」。
 *
 * 本函数不修改申报、不自动删掉违规项、也不「先放行再补审」：
 * 调用方拿到 `ok: false` 后应当拒绝接入（或降级到允许的子集并重新申报），
 * 而不是忽略 `violations`。
 */
export function validateServiceCapabilities(
  declaration: ServiceCapabilityDeclaration,
): CapabilityValidationResult {
  const { trust, capabilities } = declaration;
  const violations: CapabilityViolation[] = [];

  for (const capability of capabilities) {
    if (!isCapabilityAllowed(trust, capability)) {
      violations.push(violationOf(trust, capability));
    }
  }

  return { ok: violations.length === 0, violations };
}

/* ------------------------------------------------------------------ *
 * 给用户的一句话
 * ------------------------------------------------------------------ */

/**
 * 「这段代码来自哪里，能碰什么」—— 一句中文人话。
 *
 * 四个等级的描述**不是从矩阵自动拼出来的**：拼出来的句子会变成
 * 「允许：查看公开信息、查看你的个人数据……」这种列表腔。这里按等级
 * 手写整句，再用测试保证每句话与矩阵不矛盾（允许的要说、禁止的也要说）。
 */
export const TRUST_BOUNDARY_DESCRIPTIONS: Readonly<Record<TrustLevel, string>> = {
  'first-party':
    '这段代码由我们自己维护：可以查看公开信息，查看和修改你的个人数据；但不会把数据发到校外，也不会接触你的校园账号密码。',
  'audited-third-party':
    '这段代码来自外部，已经通过我们的安全检查：只能查看公开信息，不能查看或修改你的个人数据，也不会把数据发到校外或接触你的校园账号密码。',
  unverified:
    '这段代码来自外部，还没有通过我们的安全检查：在检查完成之前，它不能查看或修改任何数据，也不能把数据发到校外，更不会接触你的校园账号密码。',
  blocked:
    '这段代码已经被我们禁止使用：它不会运行，不能查看或修改任何数据，也不会接触你的校园账号密码。',
};

/**
 * 给用户看的一句话：这段代码来自哪里、能碰什么。
 *
 * 未知信任等级按最严格的 `blocked` 描述处理（fail closed）。
 */
export function describeTrustBoundary(trust: TrustLevel): string {
  if (!isTrustLevel(trust)) return TRUST_BOUNDARY_DESCRIPTIONS.blocked;
  return TRUST_BOUNDARY_DESCRIPTIONS[trust];
}
