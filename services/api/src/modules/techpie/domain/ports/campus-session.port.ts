import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../../common/errors/app-error';

/**
 * TechPie 整合 · 第二级（能力层）端口 —— `CampusSessionPort`
 *
 * 规格 `docs/features/techpie-integration.md` §4.3；
 * 契约 `00-FROZEN-CONTRACT.md` §5（两级身份）+ §11.4（不变式 I1–I5）+
 * §11.18 / §11.19 / §11.20 / §11.21 / §11.22（裁决）。
 *
 * ## 为什么这个文件在 `techpie/` 而不是 `auth/`
 *
 * 契约 §5 硬规则 1：`AuthPort` 只认第一级，它**不知道**任何校园系统的 cookie/session。
 * 不变式 **I2** 把这个约束钉成可执行断言：
 * `modules/auth/data/**` **不得** import 本文件。
 * 把端口定义放在能力层（`techpie`），身份层就**在类型上**拿不到它 ——
 * 这比"文档里写一句别用"强得多（ADR 0004 §2.2 的 L2/L3 教训）。
 *
 * ## ⚠️ port 类型与 wire 类型**不得同名**（契约 §11.20-B 的根因裁决）
 *
 * 本轮冲突的**总根源**是：规格 §4.3 把 `CampusBindingSummary` 用作
 * `CampusSessionPort` 的返回类型（**端口**类型），而 §8.1 又让
 * `GET /techpie/links` 返回 `CampusBindingSummary[]`（把它当**wire** 类型），
 * 同时冻结 OpenAPI 里 `CampusBindingSummary` 是 `/auth/campus-bindings` 的
 * **另一个 wire 类型**。**同一个名字跨了两个层、指了两个概念。**
 *
 * 现在三者的名字互不相同：
 * | 名字 | 层 | 形状 |
 * | --- | --- | --- |
 * | `CampusBindingState` | **port**（本文件） | `{id, provider, status, …}`，不出现在任何响应里 |
 * | `TechpieLink` | wire（`/techpie/links`） | 见 `domain/techpie.domain.ts` |
 * | `CampusBindingSummary` | wire（`/auth/campus-bindings`） | 见 `modules/auth/domain/auth.domain.ts` |
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
 * 校园平台（契约 §11.20-C 统一后的**唯一**一套枚举）
 * ------------------------------------------------------------------ */

/**
 * 契约 §11.20-C：**统一后**的校园平台枚举 ——
 * `cas | egate | cpdaily | jwc | ecard | techpie`。
 *
 * ⚠️ 仓库里曾经并存**两套拼法**：
 *   · `/auth` 那套 `egate | cp-daily | academic | campus-card`；
 *   · `/techpie` 那套 `cas | egate | cpdaily | ecard | techpie`。
 * `cp-daily` vs `cpdaily`、`campus-card` vs `ecard`、`academic` vs `jwc` ——
 * **同一概念两种拼法，迟早出现"只匹配到一半"的 bug**（§11.20-C 的原话：
 * `if (p === 'cpdaily')` 会漏掉 `cp-daily`）。
 *
 * 现在只有这一套，`TechpieLink.provider` 与 `/auth/campus-bindings` 的
 * 绑定摘要**共用**它。
 *
 * ⚠️ 规格 §4.3 的草案还列了 `gradescope` / `hydro`（第三方 token）。
 * 它们**不在**冻结枚举里，且属 Phase 1+（U13「建议 M4 再评估」），
 * 因此**不放进类型** —— 加了就等于私自扩枚举。
 */
export type CampusPlatform = 'cas' | 'egate' | 'cpdaily' | 'jwc' | 'ecard' | 'techpie';

export const CAMPUS_PLATFORMS: readonly CampusPlatform[] = [
  'cas',
  'egate',
  'cpdaily',
  'jwc',
  'ecard',
  'techpie',
];

export function isCampusPlatform(value: unknown): value is CampusPlatform {
  return typeof value === 'string' && (CAMPUS_PLATFORMS as readonly string[]).includes(value);
}

/**
 * ⚠️ **Phase 0 唯一允许发起绑定的平台**。
 *
 * 校园卡走独立的 **OPENID 通道**（规格 §2.5），与 CASTGC 完全解耦 ——
 * 这正是 Phase 0 可以零合规风险开工的原因。
 *
 * 其余平台（`cas` / `egate` / `cpdaily` / `jwc` / `techpie`）的绑定需要代持校园会话，
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
 * 绑定状态（契约 §11.19-A：**以冻结 OpenAPI 为准**）
 * ------------------------------------------------------------------ */

/**
 * `PENDING | ACTIVE | EXPIRED | REVOKED | FAILED`（契约 §11.19-A）。
 *
 * ⚠️ 规格 §2.9 那套 `UNLINKED | LINKING | LINKED | EXPIRED | REVOKED` **作废**。理由：
 *   · 规格那套**无法表达失败** —— 只能把失败塞进 `UNLINKED`，于是
 *     "从没绑过"与"绑过但失败了"不可区分，而这两种状态对用户的意义完全不同
 *     （前者引导绑定，后者要显示失败原因）；
 *   · `UNLINKED` 是**冗余**的：没有 link 记录本身就是"未绑定"，
 *     不需要一个专门的记录状态来表达它。
 *
 * 归一化：`LINKING` → `PENDING`，`LINKED` → `ACTIVE`。
 */
export type TechpieLinkStatus = 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'FAILED';

export const TECHPIE_LINK_STATUSES: readonly TechpieLinkStatus[] = [
  'PENDING',
  'ACTIVE',
  'EXPIRED',
  'REVOKED',
  'FAILED',
];

/**
 * 判定"这条绑定当前可用"的**唯一**谓词。
 *
 * 存在的意义是让 `=== 'LINKED'` 这种**旧拼法**无处可藏 ——
 * 它只在这一个文件里出现一次，改枚举时编译器会指向这里。
 */
export function isActiveLinkStatus(status: string): boolean {
  return status === 'ACTIVE';
}

/** 绑定阶段（能力清单与 UI 的"能不能点"依据） */
export type TechpiePhase = 'phase0' | 'phase1' | 'phase2';

/** 平台 → 阶段。**这不是排期装饰，而是"能不能点"的依据**（裁决 §11.18-E）。 */
export const CAMPUS_PLATFORM_PHASE: Readonly<Record<CampusPlatform, TechpiePhase>> = {
  // §2.5：校园卡走独立 OPENID 通道，**不需要 CASTGC**，零合规风险
  ecard: 'phase0',
  // §9.2：结构化校园数据阻塞于信息办（U7 / U12）
  egate: 'phase1',
  cpdaily: 'phase1',
  // §11.20-C：旧拼法 `academic` 统一为 `jwc`（教务）—— 与课表同一条会话通道
  jwc: 'phase1',
  // §9.2 / U6：一级身份对接学校 CAS 未获批
  cas: 'phase1',
  // §9.3 / M4：与 GeekPie 体系互联
  techpie: 'phase2',
};

/* ------------------------------------------------------------------ *
 * 端口类型 CampusBindingState —— **业务层唯一能拿到的形状**
 * ------------------------------------------------------------------ */

/**
 * 绑定状态（**port 类型**，契约 §11.20-B）。
 *
 * ⚠️ 它**不是** wire 契约、**不出现在任何响应里**。
 *   · `/techpie/links` 的元素是 `TechpieLink`（`domain/techpie.domain.ts`）；
 *   · `/auth/campus-bindings` 的元素是 `CampusBindingSummary`
 *     （`modules/auth/domain/auth.domain.ts`）。
 *
 * 三者形状不同、名字不同 —— 这是 §11.20 根因裁决的直接结果。
 *
 * **严禁出现** `cookie` / `cookies` / `session` / `sessionToken` / `tgc` /
 * `castgc` / `ticket` / `tenant`（契约 §11.4 I1 的镜像断言）。
 *
 * 该约束由三层手段保证（不是文档警告）：
 *   1. 类型上没有这些字段；
 *   2. `assertNoCredentialKeys()` 运行时兜底；
 *   3. `test/techpie-arch.spec.ts` 对**真实 HTTP 响应体**做递归键名扫描。
 */
export interface CampusBindingState {
  id: string;
  /** 契约 §11.20-A：字段用 `provider`（不是 `platform`）—— 与 `TechpieLink.provider` 同名同义 */
  provider: CampusPlatform;
  status: TechpieLinkStatus;
  /** 对端标识（校园卡的 OPENID / 学号）。**不是**凭证。 */
  externalUserId: string | null;
  expiresAt: string | null;
  lastSyncAt: string | null;
  /** 该绑定属于哪个接入阶段；`phase1` 在信息办回复前不可用 */
  phase: TechpiePhase;
}

/** 绑定状态里绝不允许出现的 8 个键名（契约 §11.4 I1） */
export const CAMPUS_PLATFORM_LABEL: Readonly<Record<CampusPlatform, string>> = {
  ecard: '校园一卡通',
  egate: 'eGate 校园门户',
  cpdaily: 'CpDaily 今日校园',
  jwc: '教务系统',
  cas: '统一身份认证（CAS）',
  techpie: 'GeekPie / TechPie 体系',
};

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
 * 运行时兜底：绑定状态（及其嵌套结构）里一旦出现禁用键名就抛错。
 *
 * 键名比较**大小写不敏感**且忽略 `_` / `-`：`session_token` / `sessionToken` /
 * `SESSION-TOKEN` 是同一个东西。这比黑名单过滤安全（规格 §4.2 的手法）。
 *
 * ⚠️ 契约 §11.22-A 已把 I1 的**措辞精确化**：它约束的对象是
 * `KedaYaIdentitySession` 及 `/auth/*` 的全部响应，**不是全仓每一个叫
 * `ticket` 的字段**。本函数因此只用于**身份侧投影**（`/auth/*` 与绑定摘要），
 * **不**用于 `POST /techpie/webview-session` 的票据响应 ——
 * 那里的 `ticket` 是合法领域字段（见 `webview-session.service.ts`）。
 */
export function assertNoCredentialKeys(value: unknown, where = 'CampusBindingState'): void {
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
 * 绑定凭证（Phase 0 只允许 OPENID 通道的一次性 authCode）
 * ------------------------------------------------------------------ */

/**
 * 绑定凭证。
 *
 * ⚠️ 字段叫 **`authCode`**（契约 §11.19-B），**不是** `openid`。
 *
 * 理由（§11.19-B 的原话）：小程序在**密码学上拿不到 openid** ——
 * openid 需要服务端用 AppSecret 走 `code2session` 换取，客户端能拿到的只有
 * `wx.login()` 的**一次性 code**。**命名会塑造行为**：叫 `openid` 会诱导客户端
 * 把某个**长期标识**填进去（甚至缓存复用），而它应该是一次性的。
 * 服务端必须**立即用掉并丢弃**该 code，且**不得**把 code 或换来的 openid 写进日志（§10.3）。
 *
 * ⚠️ **Phase 0 只允许 `authCode`**（校园卡，规格 §2.5）。
 *
 * `password` 变体**刻意留在类型里但服务端拒绝**：
 * 规格 §11.18-D / U12 —— 绑定时接受明文密码**风险极高**，
 * 若学校提供 OAuth / 扫码 / SMS，**必须优先**。在信息办回复前，
 * Phase 1 的绑定流程**不实现**（服务端直接 `403 FORBIDDEN`，
 * 且明文密码**绝不落库、绝不落日志**）。
 */
export type BindCredential =
  | { kind: 'openid'; channel: 'wechat'; authCode: string }
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
 *
 * ⚠️ 返回类型是 **port 类型 `CampusBindingState`**（§11.20-B），
 * 两个 wire 类型（`TechpieLink` / `CampusBindingSummary`）在各自的投影函数里生成。
 */
export interface CampusSessionPort {
  /** 列出我的全部绑定 —— 只含状态，**绝不含凭证** */
  listBindings(userId: string): Promise<CampusBindingState[]>;
  /** 取单个绑定；不存在返回 `null` */
  getBinding(userId: string, platform: CampusPlatform): Promise<CampusBindingState | null>;

  /**
   * 发起绑定。
   *
   * Phase 0 **只接受 `ecard` + `authCode`**。其余组合一律
   * `CampusSessionError('PHASE_BLOCKED' | 'PLAIN_PASSWORD_REFUSED')` ——
   * 也就是说，**需要 CASTGC 的绑定路径在代码里根本不存在**。
   */
  bind(userId: string, platform: CampusPlatform, credential: BindCredential): Promise<CampusBindingState>;

  /** 解绑。必须**硬删**凭证副本（`CampusSession` 整行），不是只标记失效。 */
  unbind(userId: string, platform: CampusPlatform): Promise<void>;

  /**
   * 手动续期（契约 §11.2 冻结 action `renew`）。
   *
   * Phase 0 下上游**没有**续期能力（规格 §6.3 R4：`/auth/renew` 是 TechPie 自建后端的能力，
   * 我们无法假定它对我们开放）→ 抛 `RENEW_NOT_SUPPORTED`，
   * **绝不谎称"已续期"**（失败模式 F3）。
   */
  renew(userId: string, platform: CampusPlatform): Promise<CampusBindingState>;

  /**
   * ⚠️ **服务端内部方法**：取可用于代用户请求上游的会话。
   *
   * 返回值**绝不能**序列化进任何 API 响应 —— 它是凭证。
   * 只允许 `modules/<模块>/data/` 下的数据适配器调用（由 `p0-1-session-port.spec.ts` 约束）。
   *
   * 未绑定 / 已过期返回 `null`（调用方据此抛 `CAMPUS_BINDING_REQUIRED`，**不是** 401）。
   */
  acquireSession(
    userId: string,
    platform: CampusPlatform,
  ): Promise<{ platform: CampusPlatform; sessionRef: string; expiresAt: Date | null } | null>;

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
