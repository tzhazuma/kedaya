import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../../common/errors/app-error';

/**
 * TechPie 整合 · 第二级（能力层）端口 —— `CampusSessionPort`
 *
 * 规格 `docs/features/techpie-integration.md` §4.3；
 * 契约 `00-FROZEN-CONTRACT.md` §5（两级身份）+ §11.4（不变式 I1–I5）+ §11.18（裁决）。
 *
 * ## 为什么这个文件在 `techpie/` 而不是 `auth/`
 *
 * 契约 §5 硬规则 1：`AuthPort` 只认第一级，它**不知道**任何校园系统的 cookie/session。
 * 不变式 **I2** 把这个约束钉成可执行断言：
 * `modules/auth/data/**` **不得** import 本文件。
 * 把端口定义放在能力层（`techpie`），身份层就**在类型上**拿不到它 ——
 * 这比"文档里写一句别用"强得多（ADR 0004 §2.2 的 L2/L3 教训）。
 *
 * ## ⚠️ 关于 `cookieHeaderFor` 的写法（与 I3 的静态扫描有关）
 *
 * 不变式 **I3** 要求：全仓 `cookieHeaderFor` 的**全部调用点**都在
 * `data/webview-session/` 目录内，由架构测试（静态扫描）钉死。
 *
 * 为了让那条扫描可以是最**严格**的形式（裸子串 `cookieHeaderFor`），
 * 本文件**刻意**把端口声明写成「属性 + 函数类型」而不是方法简写：
 *
 * ```ts
 * cookieHeaderFor: (userId: string, platform: CampusPlatform) => Promise<string>;
 * ```
 *
 * 方法简写（`cookieHeaderFor` 后面直接跟参数列表的写法）会让**声明**与**调用**
 * 在文本上无法区分，于是扫描只能退化成启发式规则（"前面有 `.` 才算调用"），
 * 而启发式规则是可以被绕过的（解构、`Reflect.get`、`obj['cookie' + 'HeaderFor']`）。
 * 用属性写法后，「`cookieHeaderFor` 出现」⟺「有人真的在调用它」，
 * 扫描因此是**完备**的：任何一处漏网都会让 CI 失败。
 *
 * 同理，`data/campus-session.service.ts` 里的实现也用属性箭头函数写。
 */

/* ------------------------------------------------------------------ *
 * 校园平台（契约 §11.10-B 冻结枚举）
 * ------------------------------------------------------------------ */

/**
 * 契约 §11.10-B：`TechpieLink.provider` 与 `CampusBinding.platform` **同一套**枚举。
 *
 * ⚠️ 规格 §4.3 的草案还列了 `gradescope` / `hydro`（第三方 token）。
 * 它们**不在** §11.10-B 的冻结枚举里，且属 Phase 1+（U13「建议 M4 再评估」），
 * 因此**不放进类型** —— 加了就等于私自扩枚举。
 */
export type CampusPlatform = 'cas' | 'egate' | 'cpdaily' | 'ecard' | 'techpie';

export const CAMPUS_PLATFORMS: readonly CampusPlatform[] = ['cas', 'egate', 'cpdaily', 'ecard', 'techpie'];

export function isCampusPlatform(value: unknown): value is CampusPlatform {
  return typeof value === 'string' && (CAMPUS_PLATFORMS as readonly string[]).includes(value);
}

/**
 * ⚠️ **Phase 0 唯一允许发起绑定的平台**。
 *
 * 校园卡走独立的 **OPENID 通道**（规格 §2.5），与 CASTGC 完全解耦 ——
 * 这正是 Phase 0 可以零合规风险开工的原因。
 *
 * 其余平台（`cas` / `egate` / `cpdaily` / `techpie`）的绑定需要代持校园会话，
 * **阻塞于信息办对「学校是否允许第三方代持校园会话」的书面回复**
 * （契约 §11.9 第 1 项 / 规格 U7）。裁决 §11.18-D 的原话：
 * **不是"先做着等批准"，而是根本不做** ——
 * 一旦落库就有了未经授权的凭证副本，事后清理无法消除已发生的风险。
 *
 * 本常量是**唯一**的准入闸门，由 `CampusSessionService.bind` 强制执行，
 * 并由 `data/campus-session.service.spec.ts` 的测试钉死。
 */
export const PHASE0_BINDABLE_PLATFORMS: readonly CampusPlatform[] = ['ecard'];

export function isPhase0Bindable(platform: CampusPlatform): boolean {
  return PHASE0_BINDABLE_PLATFORMS.includes(platform);
}

/**
 * Phase 1+ 的**诚实阻塞说明**（裁决 §11.18-D）。
 *
 * 必须原样呈现给用户，不得含糊成「暂不可用」—— 否则用户会以为"只是还没接线"。
 */
export const PHASE1_BINDING_BLOCKED_REASON =
  '该平台的绑定需要代持校园会话（CASTGC），正在等待学校信息办的书面回复' +
  '（契约 §11.9 第 1 项 / 规格 U7）。在回复到达之前，可达鸭不会建立任何校园会话副本 ——' +
  '不是"先做着等批准"，而是根本不做。';

/* ------------------------------------------------------------------ *
 * 绑定状态（契约 §2.9 冻结）
 * ------------------------------------------------------------------ */

/**
 * `UNLINKED | LINKING | LINKED | EXPIRED | REVOKED`（契约 §2.9）。
 *
 * ⚠️ 已登记的跨作用域缺口：`packages/contracts/openapi/kedaya.v1.yaml` 的
 * `TechpieLink.status` 写的是 `PENDING | ACTIVE | EXPIRED | REVOKED | FAILED`。
 * 两者不一致（见交付说明的未决问题）。本实现采用**契约 §2.9 冻结的枚举**，
 * 因为它是领域模型文档里的冻结值，且三端客户端都已做了兼容归一化。
 */
export type TechpieLinkStatus = 'UNLINKED' | 'LINKING' | 'LINKED' | 'EXPIRED' | 'REVOKED';

export const TECHPIE_LINK_STATUSES: readonly TechpieLinkStatus[] = [
  'UNLINKED',
  'LINKING',
  'LINKED',
  'EXPIRED',
  'REVOKED',
];

/** 绑定阶段（能力清单与 UI 的"能不能点"依据） */
export type TechpiePhase = 'phase0' | 'phase1' | 'phase2';

/** 平台 → 阶段。**这不是排期装饰，而是"能不能点"的依据**（裁决 §11.18-E）。 */
export const CAMPUS_PLATFORM_PHASE: Readonly<Record<CampusPlatform, TechpiePhase>> = {
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

/* ------------------------------------------------------------------ *
 * 绑定摘要 —— 业务层唯一能拿到的形状
 * ------------------------------------------------------------------ */

/**
 * 绑定摘要（规格 §4.3 / §8.3）。
 *
 * **严禁出现** `cookie` / `cookies` / `session` / `sessionToken` / `tgc` /
 * `castgc` / `ticket` / `tenant`（契约 §11.4 I1 的镜像断言）。
 *
 * 该约束由三层手段保证（不是文档警告）：
 *   1. 类型上没有这些字段；
 *   2. `assertBindingSummaryHasNoCredentialKeys()` 运行时兜底；
 *   3. `test/techpie-arch.spec.ts` 对**真实 HTTP 响应体**做递归键名扫描。
 */
export interface CampusBindingSummary {
  id: string;
  platform: CampusPlatform;
  status: TechpieLinkStatus;
  /** 对端标识（校园卡的 OPENID / 学号）。**不是**凭证。 */
  externalUserId: string | null;
  expiresAt: string | null;
  lastSyncAt: string | null;
  /** 该绑定属于哪个接入阶段；`phase1` 在信息办回复前不可用 */
  phase: TechpiePhase;
}

/** 绑定摘要里绝不允许出现的 8 个键名（契约 §11.4 I1） */
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
 * 运行时兜底：绑定摘要（及其嵌套结构）里一旦出现禁用键名就抛 `INTERNAL`。
 *
 * 键名比较**大小写不敏感**且忽略 `_` / `-`：`session_token` / `sessionToken` /
 * `SESSION-TOKEN` 是同一个东西。这比黑名单过滤安全（规格 §4.2 的手法）。
 */
export function assertBindingSummaryHasNoCredentialKeys(value: unknown, where = 'CampusBindingSummary'): void {
  const normalize = (key: string): string => key.toLowerCase().replace(/[_-]/g, '');
  const wanted = new Set(FORBIDDEN_CREDENTIAL_KEYS.map(normalize));

  const walk = (node: unknown, depth: number): void => {
    if (depth > 8 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (wanted.has(normalize(key))) {
        // 注意：错误信息里**不能**回显键名之外的内容，也绝不回显值（规格 §10.3）
        throw new Error(`${where} 违反契约 §11.4 I1：出现了被禁的凭据键名（已脱敏）`);
      }
      walk(child, depth + 1);
    }
  };

  walk(value, 0);
}

/* ------------------------------------------------------------------ *
 * 绑定凭证（Phase 0 只允许 OPENID）
 * ------------------------------------------------------------------ */

/**
 * 绑定凭证。
 *
 * ⚠️ **Phase 0 只允许 `openid`**（校园卡，规格 §2.5）。
 *
 * `password` 变体**刻意留在类型里但服务端拒绝**：
 * 规格 §11.18-D / U12 —— 绑定时接受明文密码**风险极高**，
 * 若学校提供 OAuth / 扫码 / SMS，**必须优先**。在信息办回复前，
 * Phase 1 的绑定流程**不实现**（服务端直接 `403 FORBIDDEN`，
 * 且明文密码**绝不落库、绝不落日志**）。
 */
export type BindCredential =
  | { kind: 'openid'; channel: 'wechat'; openId: string }
  | { kind: 'password'; studentId: string; password: string };

/** 端口调用时的错误原因（服务层翻译成契约错误码，见 §8.5 / §8.6） */
export type CampusSessionFailure =
  | 'PHASE_BLOCKED'
  | 'PLAIN_PASSWORD_REFUSED'
  | 'ALREADY_LINKED'
  | 'INVALID_CREDENTIAL'
  | 'RENEW_NOT_SUPPORTED'
  | 'NOT_FOUND';

/** 端口层抛出的领域错误（**不含任何凭证**，规格 §10.3） */
export class CampusSessionError extends Error {
  constructor(
    readonly reason: CampusSessionFailure,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CampusSessionError';
  }
}

/* ------------------------------------------------------------------ *
 * 端口
 * ------------------------------------------------------------------ */

/**
 * 第二级 · 能力层端口（规格 §4.3 + 契约 §11.4）。
 *
 * 契约 §11.4 的能力集：列出绑定 / 取得绑定 / 绑定 / 解绑 / 续期 / **取得 cookie 注入串**。
 */
export interface CampusSessionPort {
  /** 列出我的全部绑定 —— 只含状态，**绝不含凭证** */
  listBindings(userId: string): Promise<CampusBindingSummary[]>;
  /** 取单个绑定；不存在返回 `null` */
  getBinding(userId: string, platform: CampusPlatform): Promise<CampusBindingSummary | null>;

  /**
   * 发起绑定。
   *
   * Phase 0 **只接受 `ecard` + `openid`**。其余组合一律
   * `CampusSessionError('PHASE_BLOCKED' | 'PLAIN_PASSWORD_REFUSED')` ——
   * 也就是说，**需要 CASTGC 的绑定路径在代码里根本不存在**。
   */
  bind(userId: string, platform: CampusPlatform, credential: BindCredential): Promise<CampusBindingSummary>;

  /** 解绑。必须**硬删**凭证副本（`CampusSession` 整行），不是只标记失效。 */
  unbind(userId: string, platform: CampusPlatform): Promise<void>;

  /**
   * 手动续期（契约 §11.2 冻结 action `renew`）。
   *
   * Phase 0 下上游**没有**续期能力（规格 §6.3 R4：`/auth/renew` 是 TechPie 自建后端的能力，
   * 我们无法假定它对我们开放）→ 抛 `RENEW_NOT_SUPPORTED`，
   * **绝不谎称"已续期"**（失败模式 F3）。
   */
  renew(userId: string, platform: CampusPlatform): Promise<CampusBindingSummary>;

  /**
   * 契约 §11.4 **I3** —— 校园 cookie 的唯一受限出口，**仅供 WebView 注入使用**。
   *
   * 返回**完整 header 串**而不是 cookie 对象是刻意的：调用方在**类型上**
   * 就无法挑选出单个 cookie（例如 CASTGC）单独使用（ADR 0004 §2.3）。
   *
   * ⚠️ 全仓**唯一**的调用点在 `data/webview-session/` 内，由架构测试钉死。
   * 写法见本文件头部说明（属性 + 函数类型，让静态扫描可以是完备的裸子串匹配）。
   */
  cookieHeaderFor: (userId: string, platform: CampusPlatform) => Promise<string>;
}

export const CAMPUS_SESSION_PORT = Symbol('KEDAYA_CAMPUS_SESSION_PORT');

/* ------------------------------------------------------------------ *
 * 端口错误 → 契约错误码（**唯一**的翻译实现，auth 与 techpie 共用）
 * ------------------------------------------------------------------ */

/**
 * 把端口层抛出的 `CampusSessionError` 翻译成契约错误码（规格 §8.5 / §8.6 的表）。
 *
 * | 端口原因 | HTTP | `code` | `details.reason` |
 * | --- | --- | --- | --- |
 * | `PHASE_BLOCKED` | 403 | `FORBIDDEN` | `PHASE_BLOCKED` |
 * | `PLAIN_PASSWORD_REFUSED` | 403 | `FORBIDDEN` | `PLAIN_PASSWORD_REFUSED` |
 * | `ALREADY_LINKED` | 409 | `CONFLICT` | `ALREADY_LINKED` |
 * | `INVALID_CREDENTIAL` | 409 | `CONFLICT` | `INVALID_CREDENTIAL` |
 * | `RENEW_NOT_SUPPORTED` | 409 | `CONFLICT` | `RENEW_NOT_SUPPORTED` |
 * | `NOT_FOUND` | 404 | `NOT_FOUND` | — |
 *
 * ⚠️ **必须只有这一份实现**。曾经 `/auth/campus-bindings` 忘了翻译，
 * 于是 `PHASE_BLOCKED` 变成了 **500 INTERNAL** —— 那会让客户端以为"服务坏了"，
 * 而真实语义是"这条路本轮不开放"。这个缺陷由 `test/techpie-http.spec.ts` 抓出来。
 *
 * `details` 里只放端口给的机器可读原因，绝不放凭证
 * （`CampusSessionError` 本身已经保证了这一点）。
 */
export function translateCampusSessionError(error: unknown): Error {
  if (!(error instanceof CampusSessionError)) {
    return error instanceof Error ? error : new Error('未知的校园会话错误');
  }
  const details = { reason: error.reason, ...(error.details ?? {}) };

  switch (error.reason) {
    case 'PHASE_BLOCKED':
    case 'PLAIN_PASSWORD_REFUSED':
      return new ForbiddenError(error.message, details);
    case 'ALREADY_LINKED':
    case 'INVALID_CREDENTIAL':
    case 'RENEW_NOT_SUPPORTED':
      return new ConflictError(error.message, details);
    case 'NOT_FOUND':
      return new NotFoundError(error.message);
    default:
      return new ConflictError(error.message, details);
  }
}
