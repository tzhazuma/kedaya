/**
 * 校园服务对接的描述契约 —— **「哪些校内系统已接通」的唯一真相**。
 *
 * ## 为什么需要这个文件
 *
 * 「哪些校园服务是真的接通了」这件事，此前散落在至少四处：
 *   · 后端 `CAMPUS_DATA_MODE` 环境变量（只决定第二级「取数」用 mock 还是 live）；
 *   · `services/api/src/modules/auth/domain/auth.domain.ts` 的大写平台枚举；
 *   · `services/api/src/modules/techpie/domain/ports/campus-session.port.ts` 的小写枚举；
 *   · 各端页面文案（「演示数据」「已上线」）与 `apps/web` 的 `delivery.ts`。
 *
 * 各写一份的后果是可预测的：**后端切了 live，页面还写着「演示数据」**；
 * 或者反过来 —— 页面说「已接通」，后端其实还在 mock。用户看到的是「平台在假装」。
 *
 * 本文件把「服务名 / 平台枚举 / 数据源 / 授权状态 / 当前模式 / 真实对接点 /
 * 是否端到端接线」表达成类型与一张冻结表，供三端与文档共用。
 * **不要在别处另写一份「哪些服务已接通」的判断。**
 *
 * ## 三条诚实约束
 *
 * 1. **授权状态是法律事实，不是技术状态。** `authorization` 与 `mode` 正交：
 *    没有校方书面授权就切 live 是违规；有授权但没接线是未完成。
 * 2. **「有适配器」不等于「已接线」。** `wiring` 只描述**端到端**是否可达：
 *    有 HTTP 适配器但拿不到会话、或没有调用点，一律是 `not-wired` / `partial`。
 * 3. **上游地址未确认时不得编 URL。** 本表只列**环境变量名**（我们预留的名字），
 *    不列具体地址；`upstreamConfirmed: false` 表示仓库里没有校方正式文档。
 *
 * ## 与后端的现状对齐（2026-10-18 审计）
 *
 * 审计时的仓库基线是 `d8979d4`。详细的文件:行号、四条硬不变式核对与问题清单见
 * `docs/architecture/05-campus-integration-audit.md`。
 * 本文件是**结论**；那份文档是**证据**。两者不一致时，以代码审计证据为准，
 * 并同时修正本文件与文档 —— 不要让「结论」先于「证据」漂移。
 *
 * ## 已知的枚举分裂（本文件不能单方面修掉）
 *
 * 当前仓库里同时存在四套平台拼法：
 *   · 本文件 / techpie 端口：`cas | egate | cpdaily | jwc | ecard | techpie`（契约 §11.20-C）；
 *   · auth 模块：`EGATE | CPDAILY | JWC | CARD`（大写，`CARD` 不是 `ecard`）；
 *   · 小程序 identity 模型：`EGATE | JWC | CPDAILY | CARD`（大写）；
 *   · Web techpie 模型：`cas | egate | cpdaily | ecard | techpie`（**少了 `jwc`**）。
 *
 * 本文件采用**契约 §11.20-C 的六值小写枚举**作为目标态。
 * 在三端与后端都改为从本文件导入之前，跨端比较平台时**必须**先过一层显式映射，
 * 不得用 `toLowerCase()` 猜（`CARD` → `card` 是错的，而且错得静默）。
 */

/* ------------------------------------------------------------------ *
 * 平台枚举（契约 §11.20-C：六值、小写、唯一一套）
 * ------------------------------------------------------------------ */

// 信任/能力正交：`trust` = 敢不敢让它进来，`declaredCapabilities` = 进来能做什么。
// 两者正交，判定见 `campus-service-trust.ts`。
import {
  CAPABILITY_SCOPE_LABELS,
  isCapabilityAllowed,
  TRUST_LEVEL_LABELS,
  type CapabilityScope,
  type TrustLevel,
} from './campus-service-trust';

export const CAMPUS_PLATFORMS = ['cas', 'egate', 'cpdaily', 'jwc', 'ecard', 'techpie'] as const;

export type CampusPlatform = (typeof CAMPUS_PLATFORMS)[number];

export const CAMPUS_PLATFORM_LABELS: Readonly<Record<CampusPlatform, string>> = {
  cas: '统一身份认证（CAS）',
  egate: 'eGate 校园门户',
  cpdaily: '今日校园 / CQMobile',
  jwc: '教务处（JWC）',
  ecard: '校园卡（Ecard）',
  techpie: '技术服务目录（TechPie）',
};

export function isCampusPlatform(value: unknown): value is CampusPlatform {
  return typeof value === 'string' && (CAMPUS_PLATFORMS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ *
 * 四个正交的状态
 * ------------------------------------------------------------------ */

/**
 * 技术上「现在跑的是什么」。
 *
 * - `mock`：确定性模拟数据，响应**应当**标 `simulated: true`（是否真的标了见
 *   `simulatedDisclosure`）；
 * - `live`：真的打校方接口；
 * - `not-wired`：连适配器都没有（调用会抛错，而不是返回空）。
 */
export type CampusServiceMode = 'mock' | 'live' | 'not-wired';

/**
 * 授权状态 —— **法律事实，不是技术事实**。
 *
 * - `none`：没有授权；
 * - `pending`：正在申请 / 等待书面回复；
 * - `granted`：已获**书面**授权（口头同意不算）；
 * - `unknown`：未确认（默认值，fail closed）。
 */
export type CampusAuthorization = 'none' | 'pending' | 'granted' | 'unknown';

/**
 * 端到端接线程度。
 *
 * - `not-wired`：没有可达的真实路径；
 * - `partial`：链路的一部分可用（例如「能绑定，但不能取数」）；
 * - `end-to-end`：绑定 → 取数 → 投影 全部可达，且经过真实的凭据校验。
 */
export type CampusWiring = 'not-wired' | 'partial' | 'end-to-end';

/** 当前数据实际从哪来（可以有多项：例如「OPENID 绑定 + 本地流水表」） */
export type CampusDataSourceKind =
  /** `MockCampusDataAdapter`：确定性本地模拟数据 */
  | 'local-simulator'
  /** `HttpCampusDataAdapter`：真实上游 HTTP */
  | 'http-upstream'
  /** 校园卡 OPENID 通道（`authCode` → openid） */
  | 'openid-channel'
  /** 用户自登录的 WebView 直连（W4，我们不接触 cookie） */
  | 'webview-direct'
  /** 本地库（课表缓存 / 校园卡流水） */
  | 'local-database'
  /** 本地能力目录 / 绑定状态机（没有上游同步） */
  | 'local-catalog'
  | 'none';

/**
 * `simulated: true` 是否真的出现在响应里。
 *
 * - `response-field`：响应带机器可读的 `simulated`；
 * - `none`：**没有标**（这是缺陷，不是选择）；
 * - `not-applicable`：没有校园数据响应（纯本地功能）。
 */
export type CampusSimulatedDisclosure = 'response-field' | 'none' | 'not-applicable';

/** 真实对接点。`adapterFile: null` = 没有真实适配器。 */
export interface CampusIntegrationPoint {
  /** 适配器文件路径（相对仓库根） */
  readonly adapterFile: string | null;
  /** 稳定的符号锚点（函数 / 类 / 方法名；行号会漂，符号不会） */
  readonly adapterSymbol: string | null;
  /** 切 live 需要配置的环境变量**名**（不是值，也不是校方给的名字） */
  readonly envKeys: readonly string[];
  /** 上游地址 / 字段定义是否已由校方确认（当前全部为 false） */
  readonly upstreamConfirmed: boolean;
  /** 未决问题编号（U7 / U8 / U11 / U12 …）；没有阻塞时为空数组 */
  readonly blockedBy: readonly string[];
  /** 一句话说明为什么还没接通（没有阻塞时为 null） */
  readonly blockedReason: string | null;
}

/** 一条校园服务的完整描述（**结论**；证据见审计文档） */
export interface CampusServiceDescriptor {
  readonly platform: CampusPlatform;
  readonly label: string;
  /** 技术上现在跑的（仓库默认 `CAMPUS_DATA_MODE=mock` 下的现状） */
  readonly mode: CampusServiceMode;
  /** 授权状态（法律事实，默认 fail closed） */
  readonly authorization: CampusAuthorization;
  /** 授权状态的一句话依据；不要写「应该快了」这种无法举证的话 */
  readonly authorizationNote: string;
  /** 当前数据实际来源 */
  readonly dataSources: readonly CampusDataSourceKind[];
  /** 端到端是否可达（**不是**「有没有适配器」） */
  readonly wiring: CampusWiring;
  /** `simulated: true` 是否真的标了 */
  readonly simulatedDisclosure: CampusSimulatedDisclosure;
  /** 这个服务提供哪类数据 / 能力（能力未接线时也要如实写） */
  readonly provides: readonly string[];
  /** 真实对接点 */
  readonly integration: CampusIntegrationPoint;
  /** 切到 live 的**确切步骤**（改哪个文件、加什么环境变量） */
  readonly switchToLive: readonly string[];
  /** 当前已知的缺口 / 陷阱（不要只写好消息） */
  readonly caveats: readonly string[];
  /**
   * 用户在端上会看到什么 —— **这句必须与 `mode` / `wiring` 一致**。
   * `mode: 'mock'` 时不能写「已同步」；`wiring: 'not-wired'` 时不能写「点击查看」。
   */
  readonly userFacingNote: string;

  /**
   * 这条链路的**可信度** —— 「敢不敢让它进来」。
   *
   * ⚠️ 与 `authorization` 是**两件事**：
   * - `authorization` 是**法律事实**（校方有没有书面授权）
   * - `trust` 是**技术可信度**（这段代数据流程有没有被审过、来源可不可查）
   *
   * 当前 6 个服务全部是 `unverified`：没有书面授权、没有真实对接、
   * 凭据流向也没有经过第三方审计。等真实适配器上线并审过之后才能升级。
   *
   * 判定逻辑见 `campus-service-trust.ts` 的 `isCapabilityAllowed`。
   */
  readonly trust: TrustLevel;

  /**
   * 它**声明需要**什么能力（不代表已授予）。
   *
   * ⚠️ 与 `trust` **正交**：声明了不等于允许。真正的判定是
   * `isCapabilityAllowed(trust, capability)` —— 而 `credential-access`
   * 对**任何** trust 都不允许（凭据只能留在用户设备上）。
   *
   * 这条「声明 / 授予」分离是从另一参赛组的插件 API 学来的：
   * 把「代码能不能进来」（trust）与「进来能做什么」（capability）混为一谈，
   * 结果就是「信任了这段代码」被误读成「授权它访问一切」。
   */
  readonly declaredCapabilities: readonly CapabilityScope[];
}

/* ------------------------------------------------------------------ *
 * 当前真相（2026-10-18 · 基线 d8979d4）
 * ------------------------------------------------------------------ */

/**
 * ⚠️ **改这里之前先读 `docs/architecture/05-campus-integration-audit.md`。**
 *
 * 这张表的结论是：**6 个服务里 0 个达到 `end-to-end`，1 个 `partial`（校园卡绑定），
 * 5 个 `not-wired`。** 全部上游地址未确认，全部授权状态为 `pending`。
 *
 * 这不是「悲观」，而是把「架构上留了接口」与「现在真的能用」分开：
 * 前者是代码事实，后者需要校方授权 + 真实凭据 + 端到端联调。
 */
export const CAMPUS_SERVICES = [
  /* ------------------------------------------------------------------ *
   * CAS —— 第一级身份
   * ------------------------------------------------------------------ */
  {
    platform: 'cas',
    label: CAMPUS_PLATFORM_LABELS.cas,
    mode: 'mock',
    authorization: 'pending',
    authorizationNote:
      '仓库里没有任何校方书面授权；Mock 适配器的错误文案写的是「仍在向校方申请对接中」。',
    dataSources: ['local-simulator'],
    wiring: 'not-wired',
    simulatedDisclosure: 'response-field',
    provides: ['第一级身份：学号 / 姓名 / 院系 / 邮箱（真实实现应由 CAS 返回）'],
    integration: {
      adapterFile: 'services/api/src/modules/auth/data/mock-campus-auth.provider.ts',
      adapterSymbol: 'MockCampusAuthProvider.authenticateTicket',
      envKeys: [
        'CAMPUS_CAS_URL',
        'CAMPUS_SSO_CLIENT_ID',
        'CAMPUS_SSO_CLIENT_SECRET',
        'CAMPUS_CAS_MOCK_ALLOWED',
      ],
      upstreamConfirmed: false,
      blockedBy: ['U6'],
      blockedReason:
        '真实 CAS / OAuth 客户端需要向学校信息化办申请；仓库里只有 Mock 实现，`CAMPUS_CAS_URL` 等变量只被 `describeUpstream()` 读取，没有真实客户端。',
    },
    switchToLive: [
      '新增 `HttpCampusAuthProvider`（`modules/auth/data/`），实现 `AuthPort.authenticateTicket`：后端校验 service ticket（`/serviceValidate`）或走 OAuth authorization_code → `/userinfo`。',
      '**不要**复用 `CAMPUS_DATA_MODE` 控制第一级身份：`CAMPUS_DATA_MODE` 只管第二级取数。为 CAS 单独加 `CAMPUS_AUTH_MODE=mock|live`（或按 `CAMPUS_CAS_URL` 是否配置切换），在 `auth.module.ts` 的 `AUTH_PORT` provider 处换实现。',
      '配置 `CAMPUS_CAS_URL`（serviceValidate 端点）、`CAMPUS_SSO_CLIENT_ID`、`CAMPUS_SSO_CLIENT_SECRET`、回调地址（`service` 参数）。具体地址与字段**未确认，需要校方提供**。',
      '删除生产环境的 `CAMPUS_CAS_MOCK_ALLOWED=true`；mock 实现必须在 `NODE_ENV` **未设置**时也 fail closed（当前只在 `NODE_ENV === "production"` 时拒绝，见审计文档 P0-3）。',
      '联调：`POST /auth/login` 用真实 ticket → 断言 `assertIdentityOnly` 通过、只落身份映射、ticket 不落库/不落日志。',
    ],
    caveats: [
      '`POST /auth/login` 的响应**没有** `simulated` 标记（`AccountSession` 的 `simulated` 只给微信登录用），开发期的假身份在响应里与真实身份不可区分。',
      'Mock 直接采信 `mock-<8 位学号>` 形式的票据：`NODE_ENV` 未设/拼错时，任何人都能冒充任意学号。',
      '`.env.example` 与 `test/setup.ts` 里有一个 `https://cas.shanghaitech.edu.cn/cas`；它是仓库既有值，**未经校方确认**，不能当作真实地址使用。',
    ],
    userFacingNote: '演示期：CAS 登录为模拟身份（响应带 simulated: true），不是真实学号',
    // 无可信授权 → unverified；声明需要读个人数据，但**没有** credential-access
    trust: 'unverified',
    declaredCapabilities: ['read-personal'],
  },

  /* ------------------------------------------------------------------ *
   * eGate —— 第二级实名取数
   * ------------------------------------------------------------------ */
  {
    platform: 'egate',
    label: CAMPUS_PLATFORM_LABELS.egate,
    mode: 'mock',
    authorization: 'pending',
    authorizationNote:
      '需要信息办书面确认「是否允许第三方代持校园会话（CASTGC）」（契约 §11.9 第 1 项 / U7）。',
    dataSources: ['local-simulator'],
    wiring: 'not-wired',
    simulatedDisclosure: 'response-field',
    provides: ['实名身份：学号 / 姓名 / 院系 / 邮箱 / 校区'],
    integration: {
      adapterFile: 'services/api/src/modules/auth/data/http-campus-data.adapter.ts',
      adapterSymbol: 'HttpCampusDataAdapter.fetchIdentity',
      envKeys: ['CAMPUS_EGATE_DATA_URL', 'CAMPUS_UPSTREAM_TIMEOUT_MS'],
      upstreamConfirmed: false,
      blockedBy: ['U7'],
      blockedReason:
        'JSON 形状与地址都未确认；更关键的是没有合法会话来源：`CampusIdentityService` 从 auth 的 `CampusSessionPort.acquireSession("EGATE")` 取会话，而该表没有任何写入路径。',
    },
    switchToLive: [
      '先拿到信息办对「代持 CASTGC」的书面同意；在此之前**不要**为 egate 增加任何绑定/写会话的路径（§11.18-D）。',
      '把 `CampusIdentityService` / `schedule` 的会话依赖从 auth 的 `CampusSessionPort` 切到 techpie 的 `CampusSessionPort`（唯一实现 `CampusSessionService`），并让 `AuthModule` **不再**提供自己的 `CAMPUS_SESSION_PORT`。',
      '在 `CampusSessionService.bind` 的 Phase0 准入表之外，按书面同意新增 egate 的绑定通道（cookie/CASTGC 加密落库）；不要接受明文密码（U12）。',
      '配置 `CAMPUS_EGATE_DATA_URL`，并按校方文档调整 `fetchIdentity` 的路径（当前是占位的 `GET /identity`）与字段解析。',
      '联调：绑定 → `fetchIdentity` → 默认脱敏返回；`reveal=1` 才返回明文并写审计。',
    ],
    caveats: [
      '`HttpCampusDataAdapter.fetchIdentity` 已经写好，但产品路径下走不到：会话在 auth 的旧表里，而旧表没有写入者。',
      '在能拿到会话的前提下，`CAMPUS_DATA_MODE=live` 且未配 `CAMPUS_EGATE_DATA_URL` 时抛的是 `InternalError`（HTTP 500），不是可重试的 `UPSTREAM_UNAVAILABLE`（503）——语义上像「服务坏了」。',
    ],
    userFacingNote: '演示期：实名信息为模拟生成（响应标 simulated），真实 eGate 未接通。',
    // 无可信授权 → unverified；声明需要读个人数据，但**没有** credential-access
    trust: 'unverified',
    declaredCapabilities: ['read-personal'],
  },

  /* ------------------------------------------------------------------ *
   * CpDaily / 今日校园
   * ------------------------------------------------------------------ */
  {
    platform: 'cpdaily',
    label: CAMPUS_PLATFORM_LABELS.cpdaily,
    mode: 'not-wired',
    authorization: 'pending',
    authorizationNote:
      '需要账号体系授权 + 信息办书面确认；仓库里没有 CpDaily 的取数适配器，也没有绑定路径。',
    dataSources: ['none'],
    wiring: 'not-wired',
    simulatedDisclosure: 'not-applicable',
    provides: ['课表 / 通知（**当前没有任何代码路径**）'],
    integration: {
      adapterFile: null,
      adapterSymbol: null,
      envKeys: ['CAMPUS_CPDAILY_DATA_URL'],
      upstreamConfirmed: false,
      blockedBy: ['U7'],
      blockedReason:
        '`CampusDataPort` 没有 CpDaily 方法；`HttpCampusDataAdapter` 没有 cpdaily 分支；`CAMPUS_CPDAILY_DATA_URL` 也没有任何代码读取。',
    },
    switchToLive: [
      '先在契约层决定「课表到底归 cpdaily 还是 jwc」——当前能力目录写 cpdaily（`capabilities.ts` 的 `schedule.courses`），代码却用 `JWC` 同步（`schedule.service.ts:233`）。**一个概念只能有一个 owner。**',
      '若归 cpdaily：在 `CampusDataPort` 增加 `fetchTimetable` / `fetchNotices`，在 `MockCampusDataAdapter` 与 `HttpCampusDataAdapter` 各实现一份，并让 `schedule` 调用它。',
      '新增 cpdaily 的会话获取与绑定通道；在 U7 书面同意前不实现（同 eGate）。',
      '配置 `CAMPUS_CPDAILY_DATA_URL`（当前只是预留名，无代码读取），按校方文档填路径与 JSON 形状。',
      '联调：绑定 → 取课表 → 落 `ScheduleCourse` 缓存；同步失败不清空本地课表。',
    ],
    caveats: [
      '能力目录把 `schedule.courses` 的 `requiredProvider` 写成 `cpdaily`，但后端同步用的是 `JWC`；两边都自称课表的 owner。',
      '`DEFAULT_SCOPES.CPDAILY = ["notice:read"]` 只是注释性常量，techpie 的 `bind()` 根本不读 `scopes`。',
    ],
    userFacingNote: 'CpDaily 尚未接入：课表目前没有真实数据源。',
    // 无可信授权 → unverified；声明需要读个人数据，但**没有** credential-access
    trust: 'unverified',
    declaredCapabilities: ['read-personal'],
  },

  /* ------------------------------------------------------------------ *
   * JWC / 教务处
   * ------------------------------------------------------------------ */
  {
    platform: 'jwc',
    label: CAMPUS_PLATFORM_LABELS.jwc,
    mode: 'mock',
    authorization: 'pending',
    authorizationNote:
      '教务处未对外开放接口；需要信息办/教务处授权与会话来源（U7）。',
    dataSources: ['local-simulator', 'local-database'],
    wiring: 'not-wired',
    simulatedDisclosure: 'response-field',
    provides: ['课表（学期 / 课程 / 时间地点）'],
    integration: {
      adapterFile: 'services/api/src/modules/auth/data/http-campus-data.adapter.ts',
      adapterSymbol: 'HttpCampusDataAdapter.fetchSchedule',
      envKeys: ['CAMPUS_JWC_DATA_URL', 'CAMPUS_UPSTREAM_TIMEOUT_MS'],
      upstreamConfirmed: false,
      blockedBy: ['U7'],
      blockedReason:
        '会话从 auth 的旧表取（`schedule.service.ts:233` 的 `acquireSession("JWC")`），旧表无写入者；同时控制器按 `cpdaily` 做守卫（`schedule.controller.ts:53`），平台名不一致。',
    },
    switchToLive: [
      '统一平台名：守卫的 `@RequireCampusBinding(...)` 与 `syncFromCampus` 的 `acquireSession(...)` 必须用**同一个**平台值；当前是 `cpdaily` vs `JWC`。',
      '把会话依赖切到 techpie 的 `CampusSessionPort`，并先拿到 U7 书面同意再新增 jwc 绑定通道。',
      '配置 `CAMPUS_JWC_DATA_URL`，按教务文档调整 `GET /schedule?term=` 的路径与 JSON 形状（当前是占位约定，未确认）。',
      '联调：`POST /schedule/sync` → 清洗非法节次 → `replaceTerm` 只有在拿到数据后才执行（失败不清空旧课表）。',
    ],
    caveats: [
      '`GET /schedule/*` 全部挂在类级 `@RequireCampusBinding("cpdaily")` 下，而 Phase 0 只允许绑定 `ecard`（`campus-session.port.ts:110`）——因此**真实后端下所有 schedule 端点恒 409**，包括手动加课与今日课表。小程序「课表已上线」只在 mock 仓储下成立。',
      '`HttpCampusDataAdapter.fetchSchedule` 的 live 路径在产品路径下走不到（会话断在 `acquireSession("JWC")`）。',
      '`schedule.today/week` 的 `simulated` 取的是**当前全局模式**（`schedule.service.ts:170,200`），不是行的来源；mock→live 切换后，旧 mock 行会被标成真实数据。',
    ],
    userFacingNote: '演示期课表来自本地模拟/缓存；真实教务同步未接通。',
    // 无可信授权 → unverified；声明需要读个人数据，但**没有** credential-access
    trust: 'unverified',
    declaredCapabilities: ['read-personal'],
  },

  /* ------------------------------------------------------------------ *
   * Ecard / 校园卡
   * ------------------------------------------------------------------ */
  {
    platform: 'ecard',
    label: CAMPUS_PLATFORM_LABELS.ecard,
    mode: 'mock',
    authorization: 'pending',
    authorizationNote:
      'OPENID 通道本身不需要 CASTGC，但真实 `code2session` / eCard OPENID 授权与 AppSecret 都未取得；仓库里没有书面授权。',
    dataSources: ['openid-channel', 'local-database'],
    wiring: 'partial',
    simulatedDisclosure: 'none',
    provides: [
      '校园卡绑定（OPENID 通道，已接线到本地绑定表）',
      '余额 / 流水（**未接上游**，只读本地 `CampusCardTransaction`）',
      '付款码（**未接通**，服务端返回 503）',
    ],
    integration: {
      adapterFile: 'services/api/src/modules/techpie/data/campus-session.service.ts',
      adapterSymbol: 'CampusSessionService.bind',
      envKeys: [
        'CAMPUS_SESSION_ENC_KEY',
        'WECHAT_MINIAPP_APPID',
        'WECHAT_MINIAPP_SECRET',
        'CAMPUS_CARD_DATA_URL',
      ],
      upstreamConfirmed: false,
      blockedBy: [],
      blockedReason:
        '绑定只把一次性 `authCode` 当占位标识存起来，没有 `code2session` 换取 openid；`CampusDataPort.fetchCard` 已实现但没有任何调用点，卡片模块只读本地流水表。',
    },
    switchToLive: [
      '把「存 authCode」换成真正的 `code2session`：用 `WECHAT_MINIAPP_APPID/SECRET` 换 openid，**立即丢弃 authCode**，openid 加密落库；不得把 authCode 写进 `externalUserId` 明文列。',
      '实现 eCard OPENID 客户端（余额 / 流水），地址与字段**未确认，需要校方提供**；仓库里的 `https://ecard.shanghaitech.edu.cn` 只是占位白名单条目，未经确认。',
      '把 `CampusDataPort.fetchCard` 接进写入路径：同步上游快照 → 落 `CampusCardTransaction`（或新增独立的余额端点，但要先登记契约）。',
      '给 `GET /campus-card/account` 与 `/transactions` 加 `simulated` / `dataAsOf`（当前响应没有这两个字段，客户端无法判断数据新旧与真假）。',
      '付款码：先统一 HTTP 方法。契约登记的是 `GET /campus-card/payment-code`（`00-FROZEN-CONTRACT.md:1185`），三端却都调 `POST`；在真实通道打通前，服务端应继续返回 503，而不是假码。',
    ],
    caveats: [
      '`CampusCardService` 不注入 `CAMPUS_DATA_PORT`，所以 `fetchCard`（mock/live 校园卡快照）**没有任何调用点**；`account` 永远从本地流水推导，没有流水时是 0（`docs/local-development.md:250` 已承认）。',
      '`CampusSessionService.bind` 把 `authCode` 同时存进加密密文和 **明文** `TechpieLink.externalUserId` / `CampusSession.externalUserId`（`:154-157,169,189`），违反 §11.19-B「立即用掉并丢弃」。',
      '付款码 503 的语义是对的（不给假码），但客户端方法不匹配会先得到 404；用户根本看不到那句「不会返回假付款码」。',
      '`CAMPUS_CARD_DATA_URL` 的 `CARD` 与统一枚举 `ecard` 不一致；按枚举配 `CAMPUS_ECARD_DATA_URL` 不会生效。',
    ],
    userFacingNote:
      '演示期：绑定可用，但余额/流水来自本地记录（不是上游），付款码不可用且不会给假码。',
    // 无可信授权 → unverified；声明需要读个人数据，但**没有** credential-access
    trust: 'unverified',
    declaredCapabilities: ['read-personal'],
  },

  /* ------------------------------------------------------------------ *
   * TechPie —— 技术服务目录 / GeekPie 互联
   * ------------------------------------------------------------------ */
  {
    platform: 'techpie',
    label: CAMPUS_PLATFORM_LABELS.techpie,
    mode: 'not-wired',
    authorization: 'pending',
    authorizationNote:
      '上游能力（续期 / 场馆预约 / 技术服务目录）需要 GeekPie / HeZeBang 的书面确认（规格 U8）；当前只有本地的绑定状态机与能力目录。',
    dataSources: ['local-catalog'],
    wiring: 'not-wired',
    simulatedDisclosure: 'not-applicable',
    provides: [
      '本地绑定状态机（`TechpieLink`）',
      '能力目录（`/techpie/capabilities`，纯本地计算）',
      'WebView 一次性票据（`/techpie/webview-session`，Phase 0 不注入 cookie）',
    ],
    integration: {
      adapterFile: null,
      adapterSymbol: null,
      envKeys: [],
      upstreamConfirmed: false,
      blockedBy: ['U8'],
      blockedReason:
        '仓库里没有 TechPie 上游 HTTP 客户端、没有 API 地址、没有凭据；`provider: "techpie"` 在 `CAMPUS_PLATFORM_PHASE` 里是 `phase2`，绑定会被 `PHASE_BLOCKED` 拒绝。',
    },
    switchToLive: [
      '先拿到 GeekPie / HeZeBang 的书面确认（U8），确认允许调用哪些上游能力（自动续期 / 场馆预约 / 服务目录）。',
      '新增 `TechpieUpstreamClient`（`modules/techpie/data/`），不要复用本地 `TechpieService` 的绑定状态机当上游客户端。',
      '把 `provider: "techpie"` 从 `phase2` 的 `PHASE_BLOCKED` 迁到可绑定阶段，并补一条真实的凭据 / token 通道（`tokenCipher` 字段已有，但 Phase 0 没有写入者）。',
      '配置上游地址与凭据环境变量（**名字待定，地址未确认**）；不要在代码里编 URL。',
      '联调：能力清单 → 绑定 → 上游取数 / 续期；失败模式按 F3/F4 返回明确错误，不谎称成功。',
    ],
    caveats: [
      '**不要把 TechPie 标成 `live` / `authorization: granted`。** 当前的 `techpie` 模块是本地状态机 + 能力目录 + 票据服务，没有从 TechPie 上游同步任何数据；把它说成「已接通」正是本契约要消灭的「平台在假装」。',
      '`/techpie/links` 的 `POST` 只接受 `ecard`（Phase 0 闸门），其余平台一律 403 `PHASE_BLOCKED`（`campus-session.port.ts:110`）。',
      'WebView 票据是进程内 Map，多实例/重启会丢；生产要换 Redis（已被 `ticket.store.ts:13-17` 如实标注）。',
    ],
    userFacingNote:
      '本地绑定与能力清单；没有从 TechPie 上游同步任何数据（不是「已接通」）。',
    // 无可信授权 → unverified；声明需要读个人数据，但**没有** credential-access
    trust: 'unverified',
    declaredCapabilities: ['read-personal'],
  },
] as const satisfies readonly CampusServiceDescriptor[];

/* ------------------------------------------------------------------ *
 * 审计基线（让「结论」可追溯）
 * ------------------------------------------------------------------ */

export const CAMPUS_SERVICE_AUDIT = {
  /** 审计日期（Asia/Shanghai） */
  auditedAt: '2026-10-18',
  /** 审计起点 commit（期间仓库前进到 bce3101，但 campus 相关实现未变） */
  auditedCommit: 'd8979d4',
  /** 证据文档（文件:行号、不变式核对、问题清单） */
  evidenceDoc: 'docs/architecture/05-campus-integration-audit.md',
} as const;

/* ------------------------------------------------------------------ *
 * 派生的判断（三端共用，不要各写一份）
 * ------------------------------------------------------------------ */

/** 取一条服务的描述；未登记直接抛错（fail closed，不返回 undefined） */
export function campusServiceOf(platform: CampusPlatform): CampusServiceDescriptor {
  const found = CAMPUS_SERVICES.find((service) => service.platform === platform);
  if (found === undefined) {
    throw new Error(`未登记的校园服务：${platform}`);
  }
  return found;
}

/** 该服务当前是否在跑模拟数据（决定要不要显示「演示」字样） */
export function isSimulated(platform: CampusPlatform): boolean {
  return campusServiceOf(platform).mode === 'mock';
}

/**
 * 该服务是否可以安全地展示为「真实数据」。
 *
 * 四个条件**全部**成立才行：真实模式 + 端到端接线 + 已获书面授权 + 上游地址已确认。
 * 缺一个都只能按「演示 / 未接通」展示 —— 这是 fail closed，不是保守。
 */
export function canShowAsReal(platform: CampusPlatform): boolean {
  const service = campusServiceOf(platform);
  return (
    service.mode === 'live' &&
    service.wiring === 'end-to-end' &&
    service.authorization === 'granted' &&
    service.integration.upstreamConfirmed
  );
}

/** 该服务是否端到端可用（不看授权；授权是另一条正交判断） */
export function isCampusServiceWired(platform: CampusPlatform): boolean {
  return campusServiceOf(platform).wiring === 'end-to-end';
}

/**
 * 三端统一的「演示 / 未接通」提示文案。
 *
 * 存在意义：`simulated: true` 是**接口字段**，普通用户看不到；
 * 用户需要一句人话。这句话不能各端各写（措辞漂移会让「到底哪些是假的」变模糊）。
 */
export function simulatedNotice(platform: CampusPlatform): string {
  const service = campusServiceOf(platform);
  if (canShowAsReal(platform)) return '';
  if (service.wiring === 'not-wired' && service.mode === 'not-wired') {
    return `${service.label}尚未接入，当前没有真实数据。`;
  }
  return `${service.label}当前为演示数据，与真实数据无关。`;
}

/** 按接线程度筛选（运营 / 文档用：`end-to-end` 才是真正「已接通」） */
export function campusServicesByWiring(wiring: CampusWiring): readonly CampusServiceDescriptor[] {
  return CAMPUS_SERVICES.filter((service) => service.wiring === wiring);
}

/* ------------------------------------------------------------------ *
 * 信任 / 能力审计
 * ------------------------------------------------------------------ */

/** 一条服务的信任-能力审计结果 */
export interface CampusServiceCapabilityAudit {
  readonly platform: CampusPlatform;
  readonly trust: TrustLevel;
  /** 声明需要、但**当前 trust 不允许**的能力 */
  readonly blockedCapabilities: readonly CapabilityScope[];
  /** 是否声明了 `credential-access`（**任何** trust 都不允许） */
  readonly declaresCredentialAccess: boolean;
  /** 给用户看的一句话 */
  readonly note: string;
}

/**
 * 对全部校园服务跑一遍「信任 × 能力」矩阵。
 *
 * ## 为什么需要它
 *
 * 加了 `trust` / `declaredCapabilities` 两个字段之后，最容易发生的事是
 * **字段填了但没人检查**. 一个服务可以声明需要 `read-personal`、
 * 同时 trust 是 `unverified` —— 这在类型上完全合法，在语义上却是矛盾的。
 *
 * 这个函数把矛盾**显式列出来**，而不是靠人去读 6 个条目。
 *
 * ## 它不 block 任何东西
 *
 * 返回的是**审计结论**，不是闸门 —— 当前 6 个服务全部 `unverified`，
 * 所以全部都会报"需要 read-personal 但未获准"。这是**正确的现状**：
 * 它们确实都还没接通，也都没有书面授权。
 *
 * 等某个服务真实对接并审过之后，把它的 `trust` 升到 `audited-third-party`
 * 或 `first-party`，这条审计里它就会自然消失 —— 不需要改这个函数。
 */
export function campusServiceCapabilityAudit(): readonly CampusServiceCapabilityAudit[] {
  return CAMPUS_SERVICES.map((service) => {
    const blocked = service.declaredCapabilities.filter(
      (capability) => !isCapabilityAllowed(service.trust, capability),
    );
    // ⚠️ 必须显式收窄：6 个服务当前都只声明 `['read-personal']`，
    // 于是 `declaredCapabilities` 被推断成 `readonly 'read-personal'[]`，
    // 直接 `.includes('credential-access')` 会报「不可赋值」。
    // 这是好事 —— 它说明**现在没有任何服务声明 credential-access**。
    const declaresCredentialAccess = (
      service.declaredCapabilities as readonly CapabilityScope[]
    ).includes('credential-access');

    const note =
      declaresCredentialAccess
        ? '⚠️ 声明了 credential-access —— 这条能力对任何 trust 都不允许（凭据只能留在用户设备上）'
        : blocked.length === 0
          ? '声明的能力与 trust 一致'
          : `需要 ${blocked.map((c) => CAPABILITY_SCOPE_LABELS[c]).join('、')}，但当前 trust「${TRUST_LEVEL_LABELS[service.trust]}」不允许`;

    return {
      platform: service.platform,
      trust: service.trust,
      blockedCapabilities: blocked,
      declaresCredentialAccess,
      note,
    };
  });
}

/** 全部服务是否都通过了矩阵（当前必然为 `false` —— 6 个都是 unverified） */
export function allCampusServicesCapabilityClean(): boolean {
  return campusServiceCapabilityAudit().every(
    (row) => row.blockedCapabilities.length === 0 && !row.declaresCredentialAccess,
  );
}
