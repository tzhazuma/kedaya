/**
 * TechPie 整合领域模型（domain 层，零框架依赖 —— 契约 §7）。
 *
 * 规格：`docs/features/techpie-integration.md`
 * 裁决：`docs/architecture/00-FROZEN-CONTRACT.md` §11.18（v1.3.6 · 2026-10-17）
 *
 * **本文件只做 Phase 0**（§9.1）：校园卡走独立 OPENID 通道、WebView 用户自登录、
 * 一级身份用过渡 IdP。**不实现 Phase 1–3**（结构化校园数据 / 场馆预约高级能力 /
 * 自动续期）—— 它们阻塞于信息办与 GeekPie 的书面回复（§11.18-D）。
 *
 * 本端是**客户端**：`targetUrl` 白名单与票据校验的**权威在服务端**
 * （§11.18-B「校验必须在服务端做 —— 客户端传入的 `targetUrl` 一律不可信」）。
 * 本文件里的白名单常量是**客户端侧的纵深防御**（fail-closed），
 * 不是、也不能替代服务端校验。
 */

/* ------------------------------------------------------------------ *
 * 1. 凭证键名禁令（契约 §11.4 I1 / §11.18-H）
 * ------------------------------------------------------------------ */

/**
 * 8 个禁用键名 —— 身份层与绑定摘要里**都不允许出现**（契约 §11.4 I1）。
 *
 * 客户端把它当作**出站/入站数据的负向断言**：任何来自后端的绑定摘要
 * 一旦带上这些键，就说明后端把二级凭证泄漏进了一级通道，
 * 此时必须报 `INTERNAL` 而不是把它渲染到页面上。
 */
export const FORBIDDEN_CREDENTIAL_KEYS: readonly string[] = [
  'cookie',
  'cookies',
  'session',
  'sessionToken',
  'tgc',
  'castgc',
  'ticket',
  'tenant',
];

/**
 * 付款码正文的键名（规格 §3.3 `PaymentCode.payload`）。
 *
 * 它**不在** I1 的 8 个键里（付款码不是校园会话），但同样**绝不进日志/埋点**：
 * `05-security-privacy.md:412`「付款码 `payload` —— 凭证」；
 * `06-roadmap.md:133` A1.6「码值不进日志、不进审计正文」。
 */
export const PAYMENT_CODE_SECRET_KEYS: readonly string[] = ['payload'];

/** 日志/埋点层面一律不得出现的键（I1 的 8 个 + 付款码正文） */
export const LOG_FORBIDDEN_KEYS: readonly string[] = [
  ...FORBIDDEN_CREDENTIAL_KEYS,
  ...PAYMENT_CODE_SECRET_KEYS,
];

/**
 * 递归扫描任意 JSON 形状，返回命中的禁用键名（去重、稳定排序）。
 *
 * 键名比较**大小写不敏感**且忽略 `_` / `-`：`session_token` / `sessionToken` /
 * `SESSION-TOKEN` 都是同一个东西。键名白名单比黑名单安全（§4.2 的手法），
 * 但客户端能做的第一道闸就是把明显违规的响应拦下来。
 */
export function findForbiddenCredentialKeys(
  value: unknown,
  forbidden: readonly string[] = FORBIDDEN_CREDENTIAL_KEYS,
): string[] {
  const normalize = (key: string): string => key.toLowerCase().replace(/[_-]/g, '');
  const wanted = new Map(forbidden.map((key) => [normalize(key), key]));
  const hits = new Set<string>();

  const walk = (node: unknown, depth: number): void => {
    if (depth > 12 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const hit = wanted.get(normalize(key));
      if (hit) hits.add(hit);
      walk(child, depth + 1);
    }
  };

  walk(value, 0);
  return [...hits].sort();
}

/** 出站对象里是否混进了禁用键（`true` = 必须报 INTERNAL，不得渲染） */
export function hasForbiddenCredentialKeys(
  value: unknown,
  forbidden: readonly string[] = FORBIDDEN_CREDENTIAL_KEYS,
): boolean {
  return findForbiddenCredentialKeys(value, forbidden).length > 0;
}

/* ------------------------------------------------------------------ *
 * 2. 校园平台（契约 §11.10-B 冻结枚举）
 * ------------------------------------------------------------------ */

/**
 * 契约 §11.10-B：`TechpieLink.provider` 与 `CampusBinding.platform` **同一套枚举**
 * （避免两套平台标识长期漂移）：
 * `'cas' | 'egate' | 'cpdaily' | 'ecard' | 'techpie'`。
 *
 * ⚠️ 规格 §4.3 的 `CampusPlatform` 还列了 `gradescope` / `hydro`（第三方 token）。
 * 那**不在** §11.10-B 的冻结枚举里，且属于 Phase 1+（U13「建议 M4 再评估」），
 * 因此本端**不实现、也不放进类型**——加了就等于私自扩枚举。
 */
export type CampusPlatform = 'cas' | 'egate' | 'cpdaily' | 'ecard' | 'techpie';

export const CAMPUS_PLATFORMS: readonly CampusPlatform[] = [
  'ecard',
  'egate',
  'cpdaily',
  'cas',
  'techpie',
];

export const CAMPUS_PLATFORM_LABELS: Record<CampusPlatform, string> = {
  ecard: '校园一卡通',
  egate: 'eGate 校园门户',
  cpdaily: 'CpDaily 今日校园',
  cas: '统一身份认证（CAS）',
  techpie: 'GeekPie / TechPie 体系',
};

export const CAMPUS_PLATFORM_DESCRIPTIONS: Record<CampusPlatform, string> = {
  ecard: '校园卡余额、流水与付款码。走 eCard 的 OPENID 通道，与 CASTGC 完全解耦。',
  egate: '校园门户（课表 / 通知等入口）。',
  cpdaily: '今日校园（课表 / 考试 / DDL 等结构化数据）。',
  cas: '上科大统一身份认证，决定"你是谁"。',
  techpie: '与 GeekPie / TechPie 体系的互联互通。',
};

/** 接入阶段（§9 的分阶段接入顺序） */
export type TechpiePhase = 'phase0' | 'phase1' | 'phase2';

/**
 * 每个平台属于哪个阶段 —— **这不是排期装饰，而是"能不能点"的依据**。
 * Phase 0 之外的一律**不发起绑定请求**（§11.18-D / E）。
 */
export const CAMPUS_PLATFORM_PHASE: Record<CampusPlatform, TechpiePhase> = {
  // §2.5：校园卡走独立 OPENID 通道，**不需要 CASTGC**，零合规风险
  ecard: 'phase0',
  // §9.2：结构化校园数据阻塞于信息办（U7 / U12）
  egate: 'phase1',
  cpdaily: 'phase1',
  // §9.2 / U6：一级身份对接学校 CAS 未获批
  cas: 'phase1',
  // §9.3 / M4：与 GeekPie 体系互联
  techpie: 'phase2',
};

/** 绑定通道：OPENID（校园卡）或服务端代理会话（其余） */
export type CampusAccessMode = 'openid' | 'server_proxy';

export const CAMPUS_PLATFORM_ACCESS_MODE: Record<CampusPlatform, CampusAccessMode> = {
  ecard: 'openid',
  egate: 'server_proxy',
  cpdaily: 'server_proxy',
  cas: 'server_proxy',
  techpie: 'server_proxy',
};

export const PHASE_LABELS: Record<TechpiePhase, string> = {
  phase0: 'Phase 0 · 零合规风险',
  phase1: 'Phase 1 · 阻塞于信息办',
  phase2: 'Phase 2 · 需先解决模块归属',
};

/**
 * Phase 1+ 的**诚实阻塞说明**（§11.18-D）。
 *
 * 三条都必须说清楚，否则用户会以为"只是还没接线"：
 * 1. 学校是否允许第三方代持校园会话（CASTGC）—— U7，需**书面回复**；
 * 2. 绑定是否必须接受明文密码 —— U12，风险极高，学校若有 OAuth/扫码/SMS 必须优先；
 * 3. 一级身份能否对接学校 CAS —— U6，需正式申请。
 */
export const PHASE_BLOCKED_REASON =
  '本项需要学校信息办的书面确认（是否允许第三方代持校园会话、绑定是否必须使用明文密码），' +
  '以及学校 CAS 对接的正式批准。在拿到书面回复前，可达鸭不会实现该通道的绑定流程 ——' +
  '不是"先做着等批准"，而是根本不做：一旦落库，就产生了一个未经授权的凭证副本。';

export function isPhase0Platform(platform: CampusPlatform): boolean {
  return CAMPUS_PLATFORM_PHASE[platform] === 'phase0';
}

/* ------------------------------------------------------------------ *
 * 3. 绑定摘要（契约 §8.3 / §11.4 I1）
 * ------------------------------------------------------------------ */

/**
 * 绑定状态机（契约 §2.9 冻结）。
 * `LINKING` 是**合法的中间态**：发起绑定后上游还没确认（规格 F11 要求不留悬挂态，
 * 所以服务端必须在失败时回到 `UNLINKED`）。
 */
export type TechpieLinkStatus = 'UNLINKED' | 'LINKING' | 'LINKED' | 'EXPIRED' | 'REVOKED';

export const TECHPIE_LINK_STATUSES: readonly TechpieLinkStatus[] = [
  'UNLINKED',
  'LINKING',
  'LINKED',
  'EXPIRED',
  'REVOKED',
];

export const TECHPIE_LINK_STATUS_LABELS: Record<TechpieLinkStatus, string> = {
  UNLINKED: '未绑定',
  LINKING: '绑定中',
  LINKED: '已绑定',
  EXPIRED: '已过期',
  REVOKED: '已解绑',
};

/**
 * 绑定摘要 —— **业务层唯一能拿到的形状**（规格 §4.3）。
 * 严禁出现 `cookie` / `cookies` / `session` / `sessionToken` / `tgc` / `castgc` /
 * `ticket` / `tenant`（契约 §11.4 I1）。客户端用 `findForbiddenCredentialKeys` 兜底。
 */
export interface CampusBindingSummary {
  id: string;
  platform: CampusPlatform;
  status: TechpieLinkStatus;
  externalUserId: string | null;
  expiresAt: string | null;
  lastSyncAt: string | null;
}

/** 语义别名：绑定资源本身（`GET /techpie/links` 的条目） */
export type TechpieLink = CampusBindingSummary;

/* ------------------------------------------------------------------ *
 * 3b. WebView 一次性票据（规格 §8.4）
 * ------------------------------------------------------------------ */

/**
 * `POST /techpie/webview-session` 的响应（规格 §8.4 已冻结）。
 *
 * ⚠️ `ticket` 是**凭证**：绝不缓存、绝不进 URL 历史、绝不进日志/埋点
 * （规格 §10.3 把 `ticket` 与 CASTGC 并列在"绝对不进日志"里）。
 */
export interface TechpieWebviewTicket {
  ticket: string;
  /** 30 秒（规格 §8.4：只需覆盖"换取 → 打开 WebView"） */
  expiresInSec: number;
  /** 票据绑定的目标 host（防票据被用于其它域名） */
  targetUrl: string;
}

/**
 * 用票据换到的**一次性打开地址**（规格 §8.4「换取方式」行）。
 *
 * Phase 0 采用 **W4**：不做 cookie 注入，让用户在学校页面自己登录
 * （§8.4 的方案表：W4「可行且零合规风险」）。
 */
export interface TechpieWebviewLaunch {
  /** 最终要打开的地址（服务端签发；客户端不得改写） */
  url: string;
  targetUrl: string;
  /** `direct` = 用户自登录（Phase 0）；`injected` = 服务端注入 cookie（Phase 2，未实现） */
  mode: 'direct' | 'injected';
  /** 该打开地址自身的有效期（若服务端给） */
  expiresAt: string | null;
}

/** 是否是一个"可用的绑定"（只有 `LINKED` 才算） */
export function isActiveLink(link: Pick<TechpieLink, 'status'>): boolean {
  return link.status === 'LINKED';
}

/** 已绑定（或绑定中）的平台集合 —— 能力清单用它推导 `CAMPUS_BINDING_REQUIRED` */
export function boundPlatforms(links: readonly TechpieLink[]): ReadonlySet<CampusPlatform> {
  const set = new Set<CampusPlatform>();
  for (const link of links) {
    if (link.status === 'LINKED' || link.status === 'LINKING') set.add(link.platform);
  }
  return set;
}

/* ------------------------------------------------------------------ *
 * 4. 校园能力清单（§8.1 端点 6 / §3.1 映射表）
 * ------------------------------------------------------------------ */

/**
 * 能力可用状态。
 *
 * ⚠️ `CAMPUS_BINDING_REQUIRED` **不是错误**（契约 §5 硬规则 3、ADR §5.4）：
 * 它是「已登录但未绑定」这一**合法状态**的呈现，UI 必须给**引导**而不是报错。
 * 这与 `ApiErrorCode` 里的同名错误码是**同一个语义**，因此字符串刻意保持一致。
 */
export type TechpieCapabilityStatus =
  | 'AVAILABLE'
  | 'CAMPUS_BINDING_REQUIRED'
  | 'EXPIRED'
  | 'PHASE_BLOCKED'
  | 'UPSTREAM_UNAVAILABLE';

export const TECHPIE_CAPABILITY_STATUS_LABELS: Record<TechpieCapabilityStatus, string> = {
  AVAILABLE: '可用',
  CAMPUS_BINDING_REQUIRED: '需先绑定校园系统',
  EXPIRED: '绑定已过期',
  PHASE_BLOCKED: '尚未开放',
  UPSTREAM_UNAVAILABLE: '上游暂不可用',
};

/** 能力的访问方式（决定 UI 给"去绑定"还是"打开校园系统"） */
export type TechpieCapabilityAccess = 'openid' | 'webview' | 'server_proxy';

export interface TechpieCapability {
  /** 冻结能力 id，如 `ecard.balance`（§3.1 的能力行） */
  id: string;
  /** 归属的契约模块 id（`campus-card` / `schedule` / ...） */
  moduleId: string;
  nameZh: string;
  summary: string;
  phase: TechpiePhase;
  access: TechpieCapabilityAccess;
  /** 需要哪个平台的绑定（`null` = 不需要绑定） */
  platform: CampusPlatform | null;
  /**
   * WebView 能力的**目标地址**。
   *
   * ⚠️ 契约 §11.18-B：它**必须来自服务端白名单**，客户端**不得自行拼接任意 URL**。
   * 客户端只把这个值**原样**透传给 `POST /techpie/webview-session`。
   */
  targetUrl: string | null;
  /** 服务端判定的状态（客户端不自己推导，只做降级展示） */
  status: TechpieCapabilityStatus;
  /** 服务端可覆盖的引导文案 */
  guidance: string | null;
}

/** `GET /techpie/capabilities` 的响应（含白名单占位标记，§11.18-B 第 2 条） */
export interface TechpieCapabilitiesResponse {
  items: TechpieCapability[];
  /**
   * 校园域名白名单**内容仍为占位**（§11.18-B）。
   * 必须机器可见，UI 也要如实告诉用户，而不是假装它已经完整。
   */
  allowlistPlaceholder: boolean;
}

/** 未绑定时的引导文案（**不是报错**，§8.1 端点 6 / F1） */
export function bindingRequiredGuidance(platform: CampusPlatform): string {
  return `该能力需要先绑定「${CAMPUS_PLATFORM_LABELS[platform]}」。绑定是可选的一步：不绑定也能正常使用可达鸭的全部自有功能。`;
}

/** 已过期时的引导文案（F2：不导致登出，只要求重新绑定） */
export function expiredGuidance(platform: CampusPlatform): string {
  return `「${CAMPUS_PLATFORM_LABELS[platform]}」的绑定已过期，需要重新绑定。你的可达鸭登录状态不受影响——校园会话失效与登录过期是两件事。`;
}

/**
 * 能力 → 引导（纯函数，UI 直接渲染）。
 *
 * 关键：`CAMPUS_BINDING_REQUIRED` / `EXPIRED` 返回的是**下一步该做什么**，
 * 而不是错误信息。这是 ADR §5.4 的落地。
 */
export interface CapabilityGuidance {
  /** 是否需要用户先去绑定 */
  needsBinding: boolean;
  /** 中文引导（可直接渲染） */
  text: string;
  /** 绑定页锚点（需要绑定时的去处） */
  bindHref: string | null;
}

export const TECHPIE_BIND_HREF = '/techpie';

export function capabilityGuidance(capability: TechpieCapability): CapabilityGuidance {
  if (capability.status === 'PHASE_BLOCKED') {
    return {
      needsBinding: false,
      text: `${PHASE_LABELS[capability.phase]}：${PHASE_BLOCKED_REASON}`,
      bindHref: null,
    };
  }

  if (capability.status === 'CAMPUS_BINDING_REQUIRED' && capability.platform) {
    return {
      needsBinding: true,
      text: capability.guidance ?? bindingRequiredGuidance(capability.platform),
      bindHref: TECHPIE_BIND_HREF,
    };
  }

  if (capability.status === 'EXPIRED' && capability.platform) {
    return {
      needsBinding: true,
      text: capability.guidance ?? expiredGuidance(capability.platform),
      bindHref: TECHPIE_BIND_HREF,
    };
  }

  if (capability.status === 'UPSTREAM_UNAVAILABLE') {
    return {
      needsBinding: false,
      text:
        capability.guidance ??
        '上游校园系统暂时不可用。可达鸭不会谎称数据是最新的——请稍后重试，或直接打开校园系统。',
      bindHref: null,
    };
  }

  return { needsBinding: false, text: capability.guidance ?? '', bindHref: null };
}

/* ------------------------------------------------------------------ *
 * 5. 校园域名白名单（契约 §11.18-B）
 * ------------------------------------------------------------------ */

/**
 * 校园系统域名白名单 —— ⚠️ **内容是占位，待信息办/技术调研确认后替换**
 * （未决问题 U11：需列举 `*.shanghaitech.edu.cn` 下的实际域名）。
 *
 * 契约 §11.18-B 的三条硬要求：
 * 1. **fail-closed**：不在名单里一律拒绝；**不允许**通配整个 `shanghaitech.edu.cn`
 *    （那等于没有白名单，还会放行任意子域，包括被攻陷的子域）；
 * 2. 名单内容标注为**占位**，在代码常量 / 响应字段 / 文档里**机器可见**；
 * 3. **只允许 `https`**；禁止 `http`、禁止 IP 字面量、禁止非 443 端口、
 *    禁止 `@` 形式的 userinfo（`https://shanghaitech.edu.cn@evil.com` 是经典绕过）；
 * 4. 校验必须在**服务端**做 —— 客户端传入的 `targetUrl` 一律不可信。
 *
 * 本常量是客户端侧的**纵深防御**（fail-closed），不是权威来源。
 */
export const CAMPUS_TARGET_ALLOWLIST: readonly string[] = [
  // 占位：以下域名来自规格 §8.4 / §11 对 `*.shanghaitech.edu.cn` 的举例，
  // 真实名单仍需信息办确认（U11）。
  'ecourse.shanghaitech.edu.cn',
  'egate.shanghaitech.edu.cn',
  'ecard.shanghaitech.edu.cn',
  'elrc.shanghaitech.edu.cn',
  'oa.shanghaitech.edu.cn',
  'acm.shanghaitech.edu.cn',
];

/** 白名单是否为占位内容（§11.18-B 第 2 条：必须机器可见） */
export const CAMPUS_TARGET_ALLOWLIST_IS_PLACEHOLDER = true;

export const CAMPUS_TARGET_ALLOWLIST_NOTE =
  '白名单内容是占位值：真实域名列表待信息办/技术调研确认（规格 U11）。' +
  '校验 fail-closed —— 不在名单里一律拒绝，且不允许通配 *.shanghaitech.edu.cn。';

/** IPv4 字面量（`127.0.0.1` / `10.0.0.1` / 十六进制 / 十进制写法都拒绝） */
const IPV4_LITERAL = /^(?:\d{1,3})(?:\.\d{1,3}){3}$/;

export interface CampusTargetCheck {
  allowed: boolean;
  /** 拒绝原因（机器可读，便于测试与 UI 提示） */
  reason:
    | 'OK'
    | 'MALFORMED'
    | 'NOT_HTTPS'
    | 'HAS_USERINFO'
    | 'NON_DEFAULT_PORT'
    | 'IP_LITERAL'
    | 'NOT_ALLOWLISTED';
}

/**
 * 客户端侧白名单校验（fail-closed）。
 *
 * **它不是服务端校验的替代品** —— 服务端必须独立再校验一次（§11.18-B 第 4 条）。
 * 客户端这道闸的作用是：绝不把用户可控的任意 URL 发到票据端点，
 * 也绝不用一个"看起来像校园域名"的地址去开 WebView。
 */
export function checkCampusTargetUrl(raw: string): CampusTargetCheck {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { allowed: false, reason: 'MALFORMED' };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { allowed: false, reason: 'MALFORMED' };
  }

  if (url.protocol !== 'https:') return { allowed: false, reason: 'NOT_HTTPS' };
  // `https://shanghaitech.edu.cn@evil.com` → username 非空
  if (url.username !== '' || url.password !== '') {
    return { allowed: false, reason: 'HAS_USERINFO' };
  }
  // 非默认端口一律拒绝（`https://ecourse.shanghaitech.edu.cn:8443/`）
  if (url.port !== '') return { allowed: false, reason: 'NON_DEFAULT_PORT' };

  const host = url.hostname.toLowerCase();
  if (host.startsWith('[') || IPV4_LITERAL.test(host)) {
    return { allowed: false, reason: 'IP_LITERAL' };
  }

  // 精确匹配 —— **不做后缀通配**
  if (!CAMPUS_TARGET_ALLOWLIST.includes(host)) {
    return { allowed: false, reason: 'NOT_ALLOWLISTED' };
  }

  return { allowed: true, reason: 'OK' };
}

export function isAllowedCampusTargetUrl(raw: string): boolean {
  return checkCampusTargetUrl(raw).allowed;
}

/* ------------------------------------------------------------------ *
 * 6. 校园卡（规格 §2.5 OPENID 通道 / §3.3 领域模型）
 * ------------------------------------------------------------------ */

/** 校园卡状态（契约 `02-domain-model.md` §3.3） */
export type CampusCardStatus = 'ACTIVE' | 'FROZEN' | 'LOST' | 'CLOSED';

export const CAMPUS_CARD_STATUS_LABELS: Record<CampusCardStatus, string> = {
  ACTIVE: '正常',
  FROZEN: '已冻结',
  LOST: '已挂失',
  CLOSED: '已销户',
};

/** ⚠️ 只存掩码（`****1234`）—— 完整卡号不进客户端模型 */
export interface CampusCard {
  cardNoMasked: string;
  balanceFen: number;
  status: CampusCardStatus;
  syncedAt: string;
}

export type CardTransactionKind = 'meal' | 'shop' | 'recharge' | 'refund' | 'other';

export const CARD_TRANSACTION_KIND_LABELS: Record<CardTransactionKind, string> = {
  meal: '餐饮',
  shop: '商户消费',
  recharge: '充值',
  refund: '退款',
  other: '其它',
};

export interface CardTransaction {
  id: string;
  occurredAt: string;
  /** 负数 = 支出（契约 §3.3） */
  amountFen: number;
  merchant: string | null;
  kind: CardTransactionKind;
}

/**
 * 付款码。
 *
 * 硬规则（`02-domain-model.md:1040`）：付款码**不进日志、不进审计正文**，
 * 审计只记 `ISSUED` / `REVOKED` 动作。60 秒 TTL 且一次性
 * （`06-roadmap.md:133` A1.6「旧码立即失效」）。
 *
 * ⚠️ 客户端**不得缓存**付款码：`application` 层的 `PaymentCodeHolder` 是唯一持有者，
 * 它不写 TanStack Query 缓存、不写 URL、不写 storage、不写日志。
 */
export interface PaymentCode {
  /** 码值 —— 凭证，绝不进日志/埋点/URL */
  payload: string;
  issuedAt: string;
  expiresAt: string;
  /** 服务端给的 TTL（秒），默认 60 */
  ttlSec: number;
}

/** 付款码 TTL（规格 §3.3 / `06-roadmap.md:103`：60s） */
export const PAYMENT_CODE_TTL_SEC = 60;

/** 付款码是否已过期（纯函数，UI 用倒计时判定，不信任本地时钟的绝对精度） */
export function isPaymentCodeExpired(code: Pick<PaymentCode, 'expiresAt'>, now: Date): boolean {
  const expiry = Date.parse(code.expiresAt);
  if (Number.isNaN(expiry)) return true;
  return expiry <= now.getTime();
}

/** 剩余秒数（>=0；已过期返回 0） */
export function paymentCodeRemainingSec(
  code: Pick<PaymentCode, 'expiresAt'>,
  now: Date,
): number {
  const expiry = Date.parse(code.expiresAt);
  if (Number.isNaN(expiry)) return 0;
  return Math.max(0, Math.ceil((expiry - now.getTime()) / 1000));
}
