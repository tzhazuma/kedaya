# 05 · 校内服务对接审计

> **审计日期**：2026-10-18（Asia/Shanghai）
> **审计基线**：`d8979d4`（审计期间仓库继续前进到 `bce3101`；已核对
> `git diff d8979d4..HEAD -- services/api/src/modules/{auth,schedule,campus-card,techpie}` 无变化，
> 新增的是 facility / group-bot / 契约文件。因此本文的行号仍以 `d8979d4` 的 campus 文件为准）
> **审计方式**：只读代码 + grep + 运行既有架构/HTTP 测试；**未改 `apps/`、`services/api/src/`**
> **结论文件**：`packages/contracts/src/campus-services.ts`（本文的「结论」；本文是「证据」）

---

## 0. 一页结论

### 0.1 总判断

**架构方向是对的，接线是不完整的。**

「两级身份 + 端口/适配器 + Phase 门 + 诚实错误」这套骨架值得保留，TechPie
的端口/能力目录/守卫/票据模式也是这个仓库里最值得复用的部分。但就「现在能不能
连上校内服务」这个问题，答案是：

> **6 个校园服务里，0 个达到端到端 `end-to-end`，1 个 `partial`（校园卡绑定），
> 5 个 `not-wired`。当前不具备切 `CAMPUS_DATA_MODE=live` 的条件。**

原因不是「还差一个 URL」，而是三类硬缺口：

1. **两套 `CampusSessionPort` / 两张表 / 两套平台枚举并存**（I2 的实质回退）。
   绑定写的是 `TechpieLink` / `CampusSession`，而课表、实名、`/auth/me` 读的是旧的
   `CampusBinding` 表。旧表**没有任何写入者**，于是这些读路径恒为「未绑定」。
2. **Phase 0 只允许绑定 `ecard`，但 `schedule` 的类级守卫要求 `cpdaily`**。
   真实后端下所有课表端点恒 409（包括「今日课表」和「手动加课」）。
3. **`CAMPUS_DATA_MODE=live` 只切换第二级取数适配器**，不切换第一级 CAS，
   也不会自动补齐会话/写入路径；而校园卡的 `fetchCard` 没有任何调用点。

### 0.2 五件必须先解决的事

| # | 问题 | 影响 | 证据 |
| --- | --- | --- | --- |
| 1 | 两套 session port / 两张表并存 | 绑定成功后 `/auth/me`、`/auth/campus/overview`、`/auth/campus-identity`、`/schedule/sync` 仍显示未绑定 | `auth.module.ts:80`、`techpie.module.ts:27-32`、`prisma-campus-session.adapter.ts:25`、`campus-identity.service.ts:94`、`schedule.service.ts:233` |
| 2 | schedule 类级守卫 `cpdaily` vs Phase 0 只允许 `ecard` | 真实后端所有 `/schedule/*` 恒 409 | `schedule.controller.ts:52-53`、`campus-session.port.ts:110` |
| 3 | Mock CAS 登录无 `simulated`，且生产门只看 `NODE_ENV` | `NODE_ENV` 未设/拼错时任何人可用 `mock-<学号>` 冒充；开发期假身份与真实身份不可区分 | `mock-campus-auth.provider.ts:52,82-90`、`account-session.ts:13-31` |
| 4 | 校园卡服务端与三端 wire 全错位 | 客户端 404；503「不给假码」的诚实提示根本到不了用户 | `campus-card.controller.ts:81,116,132`、`httpCampusCardRepository.ts:16,22`、`techpie.http.ts:243-257` |
| 5 | 「有适配器」被误当成「已接通」 | 切 live 后仍不工作，且错误是 500/静默 0，不是优雅降级 | `http-campus-data.adapter.ts:74-84`、`local-development.md:250` |

### 0.3 读法

- **平台枚举**：契约 §11.20-C 的**目标态**是六值小写
  `cas | egate | cpdaily | jwc | ecard | techpie`（`00-FROZEN-CONTRACT.md:1117`）。
  实现里仍有多套拼法；本文同时标「契约值 / 实现值」。
- **「已接线」**：本文只认**端到端**（绑定 → 取数 → 投影）。
  「有适配器」「有端点」都不算。
- **行号**：均以审计基线 `d8979d4` 为准。行号会漂，优先按文中给出的符号名搜索。
- **URL**：凡是仓库里已有的地址，本文都标注「仓库既有值，未经校方确认」；
  查不到的写「未确认，需要校方提供」，**不编地址**。

---

## 1. 审计范围与方法

### 1.1 看了什么

| 层 | 文件 |
| --- | --- |
| 契约 | `docs/architecture/00-FROZEN-CONTRACT.md` §5 / §11.4 / §11.9 / §11.10-B / §11.18 / §11.19 / §11.20 / §11.21 / §11.22 |
| 第一级身份 | `modules/auth/data/mock-campus-auth.provider.ts`、`modules/auth/auth.service.ts`、`modules/auth/domain/auth.domain.ts` |
| 第二级取数 | `modules/auth/domain/campus-data.domain.ts`、`modules/auth/data/mock-campus-data.adapter.ts`、`modules/auth/data/http-campus-data.adapter.ts` |
| 第二级会话（旧） | `modules/auth/domain/auth.domain.ts`、`modules/auth/data/prisma-campus-session.adapter.ts` |
| 第二级会话（新） | `modules/techpie/domain/ports/campus-session.port.ts`、`modules/techpie/data/campus-session.service.ts` |
| 能力/守卫/票据 | `modules/techpie/domain/capabilities.ts`、`modules/techpie/data/campus-binding.guard.ts`、`modules/techpie/data/webview-session/*` |
| 业务模块 | `modules/schedule/*`、`modules/campus-card/*`、`modules/agent/agent-tools.service.ts` |
| 客户端 wire | `apps/miniapp/src/data/repositories/{httpCampusCardRepository,httpTechpieRepository,httpIdentityRepository,httpScheduleRepository}.ts`、`apps/web/src/data/repositories/techpie.http.ts`、`apps/mobile/lib/data/repositories/remote_campus_card_repository.dart` |
| 测试 | `test/techpie-arch.spec.ts`、`test/techpie-http.spec.ts` |

### 1.2 跑了什么

```text
cd services/api && npx vitest run test/techpie-arch.spec.ts test/techpie-http.spec.ts
→ 2 files / 83 tests passed（含 I2 的「已知偏离」断言、I3 的全仓扫描、I5 的 <50ms 与零上游读取）

npm run typecheck -w @kedaya/contracts
→ 0 errors

npm test -w @kedaya/contracts
→ 6 files / 55 tests passed
```

### 1.3 没做什么

- 没有真实校方凭据，**没有对任何校内上游发过请求**。
- 没有改功能代码、没有 commit / push。
- 没有验证数据库里实际的行（本机没有跑 Prisma 迁移/种子）。
- 没有在真机/开发者工具里点小程序；客户端结论来自 wire 路径与端点的静态比对。

---

## 2. 六个系统现状总表

> 「当前模式」按仓库默认 `CAMPUS_DATA_MODE=mock` 描述。
> 「是否已接线」= 端到端可达，不是「有没有适配器」。

| 系统 | 平台枚举值（契约 / 实现） | 当前模式 | 真实对接点（文件:行） | 需要的凭据 / 授权 | 是否已接线 |
| --- | --- | --- | --- | --- | --- |
| **CAS**（统一身份认证） | `cas` / `SHTU_CAS`（auth 内部） | `mock`；生产默认 401，`CAMPUS_CAS_MOCK_ALLOWED=true` 可临时打开 | `mock-campus-auth.provider.ts:43` `authenticateTicket`；接线 `auth.module.ts:78`；mock 票据 `:52-62` | `CAMPUS_CAS_URL`、`CAMPUS_SSO_CLIENT_ID`、`CAMPUS_SSO_CLIENT_SECRET`、回调 `service`；校方 CAS/OAuth 书面批准 | **否**（只有 Mock，没有真实客户端） |
| **eGate** | `egate` / `EGATE` | `mock`（live 解析器已写，但不可达） | `http-campus-data.adapter.ts:31` `fetchIdentity`；baseUrl `:74-84`；mock `mock-campus-data.adapter.ts:80`；调用 `campus-identity.service.ts:104` | `CAMPUS_EGATE_DATA_URL` + CASTGC/session + 信息办书面同意（U7） | **否**（适配器有，链路断在会话） |
| **CpDaily / 今日校园** | `cpdaily` / `CPDAILY` | `not-wired`（无取数适配器、无绑定路径） | 无适配器；仅枚举 `auth.domain.ts:50`、scopes `auth.service.ts:41`、能力目录 `capabilities.ts:244-275` | `CAMPUS_CPDAILY_DATA_URL`（当前无代码读取）、账号体系授权、U7 | **否**（完全没有代码路径） |
| **JWC**（教务处） | `jwc` / `JWC` | `mock`（live 解析器已写，但不可达） | `http-campus-data.adapter.ts:42` `fetchSchedule`；调用 `schedule.service.ts:241`；会话 `:233` | `CAMPUS_JWC_DATA_URL` + JWC 会话 + 教务处/信息办授权（U7） | **否**（适配器有，链路断在会话 + 守卫平台名） |
| **Ecard**（校园卡） | `ecard` / `CARD` | `mock`（OPENID 绑定可用；取数未接线） | 绑定 `campus-session.service.ts:111`；取数 `http-campus-data.adapter.ts:56` `fetchCard`（**无调用点**）；卡片模块 `campus-card.service.ts:72` | `WECHAT_MINIAPP_APPID/SECRET`、eCard OPENID 授权、`CAMPUS_CARD_DATA_URL`、校方/银行侧授权 | **部分**（绑定已接线，取数未接线） |
| **TechPie** | `techpie` | `not-wired`（纯本地绑定状态机 + 能力目录 + 票据，**没有上游客户端**） | `techpie.service.ts:111` `createLink`、`:168` `capabilities`；票据 `webview-session.service.ts:230` | GeekPie / HeZeBang 书面确认（U8）+ 上游 API 文档/地址（**未确认**） | **否** |

### 2.1 表注

1. **「当前模式」不等于 `CAMPUS_DATA_MODE` 全局生效。**
   `CAMPUS_DATA_MODE` 只决定 `CAMPUS_DATA_PORT` 注入 Mock 还是 Http
   （`auth.module.ts:84-90`）；它**不控制** `AUTH_PORT`（`:78` 永远 Mock），
   也不控制校园卡模块（`campus-card.service.ts:59-62` 根本没注入 `CAMPUS_DATA_PORT`）。
2. **JWC / eGate 是「适配器在，但 live 走不到」**，不是「live 会降级」。
   会话从 auth 的旧 `CampusSessionPort.acquireSession()` 取，而旧表 `CampusBinding`
   没有任何写入者（见 §6 P0-1）。
3. **CpDaily 的 `cpdaily` 与 JWC 的 `jwc` 在代码里不是同一个 owner。**
   能力目录说课表归 `cpdaily`（`capabilities.ts:244-252`），后端同步用的是 `JWC`
   （`schedule.service.ts:233`）。这是契约 §11.20-C 统一枚举之后仍未收敛的语义分裂。
4. **TechPie 在审计开始时被仓库里已提交的 `campus-services.ts` 标成
   `mode: 'live'` / `authorization: 'granted'` / `upstreamConfirmed: true`。**
   该判断与代码不符（没有上游客户端、`provider: "techpie"` 是 `phase2`、U8 未书面确认）。
   本轮已把结论修正为 `not-wired` / `pending`；详见 §6 P1-5。

---

## 3. 逐系统：现状、mock 边界、切 live 的确切步骤

### 3.1 CAS（统一身份认证）

#### 现在是什么

- 第一级身份端口 `AuthPort` 只有一个方法 `authenticateTicket(ticket)`
  （`auth/domain/auth.domain.ts:36-39`），返回 `CampusIdentity`
  （`provider / externalId / email? / realName? / department?`，`:20-28`）。
- `AUTH_PORT` 被**无条件**绑定到 `MockCampusAuthProvider`
  （`auth.module.ts:78`）。没有 `HttpCampusAuthProvider`，也没有按环境切换的 factory。
- Mock 的语义（`mock-campus-auth.provider.ts:43-63`）：
  - `mock-<8 位学号>` → 直接把学号当 `externalId`（`:52`）；
  - 其它非空 ticket → `sha256(ticket).slice(0,16)` 当 `externalId`（`:53`）；
  - 返回 `email = <externalId>@shanghaitech.edu.cn`、`realName = 同学<后四位>`、
    `department = "未填写（真实实现来自 CAS 返回的院系字段）"`（`:59-61`）。
- 生产门（`:82-90`）：只有 `NODE_ENV === "production"` 且
  `CAMPUS_CAS_MOCK_ALLOWED` 不是真值时才 401。**`NODE_ENV` 未设置时视为非生产，直接放行。**

#### mock 的边界

| 边界 | 位置 |
| --- | --- |
| ticket → 身份的采信 | `mock-campus-auth.provider.ts:43-63` |
| 第一级端口绑定 | `auth.module.ts:78` |
| 生产环境闸门 | `mock-campus-auth.provider.ts:82-90` |
| 身份投影的凭据键断言 | `auth.domain.ts:154-170`（`assertIdentityOnly`）+ `auth.service.ts:113-116` |

#### 真实实现需要什么

- CAS `serviceValidate` 端点（或 OAuth `authorization_code` → `/userinfo`）；
- OAuth/CAS 客户端注册：`CAMPUS_SSO_CLIENT_ID` / `CAMPUS_SSO_CLIENT_SECRET`；
- 回调地址（`service` 参数）必须与校方登记一致；
- **校方书面批准**（本项目是第三方非官方平台，见 Mock 文件头 `:10-26`）；
- 真实返回的字段映射：学号、姓名、院系、邮箱（以及可选校区）。

#### 切到 live 的确切步骤

1. **新增** `services/api/src/modules/auth/data/http-campus-auth.provider.ts`，
   实现 `AuthPort`：后端校验 ticket / 换 token，取到身份后**立即丢弃 ticket/token**。
2. **改** `services/api/src/modules/auth/auth.module.ts:78`：
   把 `{ provide: AUTH_PORT, useClass: MockCampusAuthProvider }`
   换成按 `CAMPUS_AUTH_MODE`（**新变量，当前不存在**）或按 `CAMPUS_CAS_URL`
   是否配置来选 `Mock` / `Http` 的 factory。**不要复用 `CAMPUS_DATA_MODE`**
   —— 它只管第二级取数，混用会让「切数据源」意外改变登录方式。
3. **加环境变量**：`CAMPUS_CAS_URL`、`CAMPUS_SSO_CLIENT_ID`、
   `CAMPUS_SSO_CLIENT_SECRET`、回调地址（建议 `CAMPUS_CAS_SERVICE_URL`）。
   具体路径与字段**未确认，需要校方提供**。
4. **关掉生产 Mock**：删除 `CAMPUS_CAS_MOCK_ALLOWED=true`；并把
   `assertAllowedInProduction()` 改成 **fail closed**（`NODE_ENV` 未设置也拒绝），
   而不是只在 `=== "production"` 时拒绝。
5. **联调**：`POST /auth/login` 用真实 ticket → 断言 `assertIdentityOnly` 通过、
   `AuthIdentity` 只落身份字段、ticket 不落库/不落日志；`GET /auth/session` 仍 <50ms
   且不碰上游。

#### 风险 / 不变量

- **I1 PASS**：`assertIdentityOnly` 的正则含 `tenant`（`auth.domain.ts:154`）；
  登录响应不含任何凭据键（`auth.service.ts:112-134`）。
- **P0-3**：Mock 登录响应**没有 `simulated` 标记**。`AccountSession.simulated`
  只给微信登录用（`account-session.ts:27-31`）；`LoginResult` 里没有它。
  开发期用户看到「同学1234 / 1234@shanghaitech.edu.cn」，无法从响应判断是假身份。
- `.env.example:17` 与 `test/setup.ts:20` 的 `https://cas.shanghaitech.edu.cn/cas`
  是仓库既有值，**未经校方确认**；不能当成真实地址。

---

### 3.2 eGate

#### 现在是什么

- 实名取数只走 `HttpCampusDataAdapter.fetchIdentity(session)`：
  `GET {CAMPUS_EGATE_DATA_URL}/identity`（`http-campus-data.adapter.ts:31-40`）。
- 调用方是 `CampusIdentityService.view()`：先 `campusSession.acquireSession(userId, 'EGATE')`
  （`campus-identity.service.ts:94`），再用 session 取数（`:104`）。
- 这里的 `campusSession` 是 **auth 的旧端口**（`campus-identity.service.ts:5-9`），
  落 `CampusBinding` 表；该表没有写入者。
- Mock 数据来自 `MockCampusDataAdapter.fetchIdentity`（`mock-campus-data.adapter.ts:80-93`）：
  用 `sessionRef` 的 FNV-1a 哈希稳定生成学号/姓名/院系/邮箱/校区。

#### mock 的边界

| 边界 | 位置 |
| --- | --- |
| 取数端口 | `auth/domain/campus-data.domain.ts:62-68` |
| Mock 实现 | `mock-campus-data.adapter.ts:77-144` |
| 真实实现 | `http-campus-data.adapter.ts:26-113` |
| 调用方 | `campus-identity.service.ts:93-132` |
| 会话来源（断点） | `campus-identity.service.ts:94` → auth 的 `CampusSessionPort` |

#### 真实实现需要什么

- `CAMPUS_EGATE_DATA_URL`（具体地址/字段**未确认，需要校方提供**）；
- 可用的 eGate 会话（CASTGC 或等价 cookie）；
- **信息办书面同意第三方代持校园会话**（契约 §11.9 第 1 项 / U7）；
- 字段定义：`studentId / realName / department / email / campus` 的 JSON 形状。

#### 切到 live 的确切步骤

1. **先拿 U7 书面同意**。在此之前不要新增任何 egate 绑定/写会话路径
   （§11.18-D 的原话：不是「先做着等批准」，而是根本不做）。
2. **消除双 port**：把 `CampusIdentityService`（以及 `schedule`）的会话依赖
   从 `../auth/domain/auth.domain` 的 `CampusSessionPort` 切到
   `../techpie/domain/ports/campus-session.port` 的 `CampusSessionPort`；
   并删除 `AuthModule` 里 `CAMPUS_SESSION_PORT → PrismaCampusSessionAdapter`
   的 provider（`auth.module.ts:80`），让全仓只剩 `CampusSessionService`。
3. **新增绑定通道**：在 `CampusSessionService.bind` 的 Phase 0 准入表
   （`campus-session.port.ts:110`，当前只有 `ecard`）之外，按书面同意增加 egate；
   cookie/CASTGC 必须加密落库（`CAMPUS_SESSION_ENC_KEY`），不接受明文密码（U12）。
4. **配置** `CAMPUS_EGATE_DATA_URL`，并按校方文档调整
   `HttpCampusDataAdapter.fetchIdentity` 的路径（当前是占位的 `GET /identity`）
   与字段解析（`http-campus-data.adapter.ts:31-40`）。
5. **联调**：绑定 → `fetchIdentity` → 默认脱敏返回；`reveal=1` 才返回明文并写审计
   （`campus-identity.service.ts:113-121`）。

#### 风险 / 不变量

- **live 路径不可达**：产品路径下 `HttpCampusDataAdapter.fetchIdentity` 不会被调用，
  因为 `acquireSession('EGATE')` 在旧表里恒为 `null` → 409
  （`campus-identity.service.ts:94-100`）。
- **能拿到会话但未配 URL 时是 500**：`baseUrl()` 抛 `InternalError`（`http-campus-data.adapter.ts:74-84`），
  不是 `UPSTREAM_UNAVAILABLE`（503）。客户端会把「配置缺失」当成「服务坏了」。
- **`simulated` 标了**：`CampusIdentityView.simulated = dataMode === 'mock'`
  （`campus-identity.service.ts:127`），这一点是诚实的；但它标的是「当前全局模式」，
  不是「这一条身份数据来自 mock」。

---

### 3.3 CpDaily / 今日校园

#### 现在是什么

**没有任何取数路径。** 具体来说：

- `CampusDataPort` 只有 `fetchIdentity / fetchSchedule / fetchCard` 三个方法
  （`campus-data.domain.ts:62-68`），没有 CpDaily 的课表/通知方法。
- `HttpCampusDataAdapter` 只有 `EGATE /identity`、`JWC /schedule`、`CARD /snapshot`
  三个分支（`:31-70`），没有 `CPDAILY`。
- `CAMPUS_CPDAILY_DATA_URL` **没有任何代码读取**（全仓 grep 只出现在
  `docs/` 与本审计文档里；`.env.example` 也没有它）。
- `CPDAILY` 在**可执行路径**里只出现在：平台枚举（`auth.domain.ts:50`）、
  `DEFAULT_SCOPES`（`auth.service.ts:41`）、能力目录（`capabilities.ts:244-275`）、
  agent 的 `platformLabel`（`agent-tools.service.ts:457`）；其余只有注释、
  日志脱敏正则（`common/logging/redact.ts:62`）与内置知识文案。
- Phase 0 的绑定闸门只允许 `ecard`（`campus-session.port.ts:110`），
  所以 `cpdaily` 连绑定都建不了。

#### 真实实现需要什么

- 先回答一个契约问题：**课表到底归 `cpdaily` 还是 `jwc`？**
  当前能力目录写 `cpdaily`（`capabilities.ts:244-252`），代码用 `JWC`
  （`schedule.service.ts:233`）。不先收敛，接哪边都会留下另一个 owner。
- CpDaily 的账号体系/会话获取方式、API 地址、JSON 形状：
  **未确认，需要校方提供**。
- 信息办对代持会话的书面同意（U7）。

#### 切到 live 的确切步骤

1. **先收敛 owner**：二选一，并同步改能力目录、守卫、服务、文档：
   - A. 课表归 `cpdaily`：`schedule.controller.ts:53` 保持 `cpdaily`；
     `schedule.service.ts:233` 改为 `acquireSession(userId, 'cpdaily')`；
     新增 CpDaily 取数方法。
   - B. 课表归 `jwc`：把能力目录 `schedule.*` 的 `requiredProvider` 改为 `jwc`；
     守卫与 service 统一 `jwc`。
2. **扩展端口**：在 `CampusDataPort` 增加 `fetchTimetable` / `fetchNotices`
   （或明确只做课表），在 `MockCampusDataAdapter` 与 `HttpCampusDataAdapter` 各实现一份。
3. **新增绑定通道**：同 eGate，U7 书面同意前不实现。
4. **配置** `CAMPUS_CPDAILY_DATA_URL`（当前是预留名，无代码读取），
   按校方文档填路径与 JSON 形状。
5. **联调**：绑定 → 取课表 → 落 `ScheduleCourse` 缓存；同步失败不清空本地课表
   （`schedule.service.ts:222-274` 已实现这个保护）。

#### 风险 / 不变量

- **「CpDaily 课表」目前是文档里的能力，不是代码里的能力。** 任何端上如果按
  `cpdaily` 显示「课表已绑定/已同步」，都是在展示一个不存在的数据源。
- `DEFAULT_SCOPES.CPDAILY = ["notice:read"]`（`auth.service.ts:41`）只是旧 auth
  路径的注释性常量；techpie 的 `bind()` 根本不读 `scopes`。

---

### 3.4 JWC（教务处）

#### 现在是什么

- 课表同步：`ScheduleCourseService.syncFromCampus()`
  - `acquireSession(userId, 'JWC')`（`schedule.service.ts:233`，**auth 的旧端口**）；
  - `campusData.fetchSchedule(session, term)`（`:241`）→
    `GET {CAMPUS_JWC_DATA_URL}/schedule?term=...`（`http-campus-data.adapter.ts:42-54`）；
  - 清洗非法节次 → `replaceTerm`（`:242-261`）；失败不清空旧数据。
- 读侧：`today()/week()/nextClass()` 只读本地 `ScheduleCourse`
  （`schedule.service.ts:149-220`），但控制器给整个类加了
  `@UseGuards(AuthGuard, CampusBindingGuard)` + `@RequireCampusBinding('cpdaily')`
  （`schedule.controller.ts:52-53`）。
- **结果**：真实后端下，任何 `/schedule/*` 请求（包括 `GET /schedule/today`、
  `GET /schedule/week`、`POST /schedule/items`）都先被守卫按 `cpdaily` 拦成 409。
  而 `cpdaily` 在 Phase 0 不可绑定（`campus-session.port.ts:110`）。

#### mock 的边界

| 边界 | 位置 |
| --- | --- |
| 取数 | `http-campus-data.adapter.ts:42-54`（live）/ `mock-campus-data.adapter.ts:95-101`（mock） |
| 调用 | `schedule.service.ts:241` |
| `simulated` 标记 | `schedule.service.ts:170,200,271`（`campusData.mode === 'mock'`） |
| HTTP 守卫 | `schedule.controller.ts:52-53` |

#### 真实实现需要什么

- `CAMPUS_JWC_DATA_URL`（地址/字段**未确认，需要校方提供**）；
- JWC 会话（CASTGC 或等价凭据）；
- U7 书面同意；
- **统一平台名**（守卫 `cpdaily` vs service `JWC`）。

#### 切到 live 的确切步骤

1. **统一平台名**：`schedule.controller.ts:53` 的 `@RequireCampusBinding(...)`
   与 `schedule.service.ts:233` 的 `acquireSession(...)` 必须用同一个值。
2. **切会话实现**：把 `ScheduleCourseService` 注入的 `CAMPUS_SESSION_PORT`
   从 auth 的端口改到 techpie 的端口（`schedule.module.ts` 已 import `TechpieModule`，
   但 `ScheduleCourseService` 仍从 `../auth/domain/auth.domain` 取 token）。
3. **新增 jwc 绑定通道**：U7 书面同意后，在 `CampusSessionService.bind` 的
   准入表里增加 jwc；cookie/CASTGC 加密落库。
4. **配置** `CAMPUS_JWC_DATA_URL`，按教务文档调整 `GET /schedule?term=`
   的路径与 JSON 形状（当前是占位约定）。
5. **联调**：`POST /schedule/sync` → 清洗 → 落库；`GET /schedule/today|week`
   在未绑定时应返回 409（`CAMPUS_BINDING_REQUIRED`），而不是 500。

#### 风险 / 不变量

- **P0-2**：schedule 全端点恒 409（除非手工往 `TechpieLink` 插一条
  `cpdaily` + `ACTIVE` 的行；那不是产品路径）。
- `HttpCampusDataAdapter.fetchSchedule` 的 live 路径在产品路径下走不到：会话断在 `schedule.service.ts:233` 的 `acquireSession("JWC")`（旧表无写入者）。
- **P1-6**：`today/week` 的 `simulated` 取全局模式，不是行来源。mock 模式同步进来的
  行没有 `sourceMode` 列；切到 live 后这些行会被标成 `simulated: false`。
- `apps/web/src/domain/models/delivery.ts:57-60` 把 schedule 标成「小程序已上线」，
  但真实后端下它不可用；
  只有 mock 仓储（`TARO_APP_USE_MOCK` 默认 true）能跑。这是一条需要在
  「已上线」措辞里补 caveat 的诚实问题。

---

### 3.5 Ecard（校园卡）

#### 现在是什么

- 绑定：`CampusCardService.activate()` → techpie 的 `CampusSessionPort.bind()`
  （`campus-card.service.ts:95-106`）→ `CampusSessionService.bind()`
  （`campus-session.service.ts:111-204`）。Phase 0 只允许 `ecard`
  （`campus-session.port.ts:110`），所以这条是**真的能走通**的。
- 绑定内容：`EcardOpenIdSecret = { channel: 'wechat', authCode, cookieHeader: null }`
  （`campus-session.service.ts:66-72`）；加密落 `CampusSession.sessionCipher`，
  同时 `externalUserId: authCode` 明文落 `TechpieLink` 与 `CampusSession`
  （`:169,189`）。
- 读侧：`account()` 只从本地 `CampusCardTransaction` 最新一条推导余额
  （`campus-card.service.ts:72-83`）；`transactions()` 只读本地表（`:128-135`）。
  **`CampusDataPort.fetchCard` 没有任何调用点**（全仓 grep 只有定义/实现）。
- 付款码：`paymentCode()` 先 `requireActiveBinding`，然后**永远**抛
  `UPSTREAM_UNAVAILABLE` 503（`campus-card.service.ts:149-162`），
  `CAMPUS_CARD_PAYMENT_CODE_UPSTREAM_READY = false`（`domain/campus-card.domain.ts:107`）。
- 端点：`GET /campus-card/account`、`POST /account/activate`、`DELETE /account`、
  `GET /transactions`、`GET /payment-code`（`campus-card.controller.ts:81,92,105,116,132`）。

#### mock 的边界

| 边界 | 位置 |
| --- | --- |
| 绑定闸门 | `campus-session.port.ts:110`、`campus-session.service.ts:116-128` |
| authCode 占位存储 | `campus-session.service.ts:66-72,154-157,169,189` |
| 取数适配器（未接） | `http-campus-data.adapter.ts:56-70`、`mock-campus-data.adapter.ts:103-144` |
| 卡片用例 | `campus-card.service.ts:72-185` |
| 付款码 503 | `campus-card.service.ts:149-162` |

#### 真实实现需要什么

- `WECHAT_MINIAPP_APPID` / `WECHAT_MINIAPP_SECRET`（`code2session` 换 openid）；
- eCard 的 OPENID 授权流程与 API 地址（**未确认，需要校方提供**）；
- 注意 `HttpCampusDataAdapter.getJson()` 目前把所有平台都当成 cookie 认证
  （`Cookie: session.sessionRef`，`http-campus-data.adapter.ts:90-95`）；
  eCard OPENID / OAuth 很可能需要 `Authorization: Bearer`，当前没有分支。
- `CAMPUS_CARD_DATA_URL` + 余额/流水 JSON 形状；
- 校方与银行侧对「校园卡余额/流水/付款码」的授权。

#### 切到 live 的确切步骤

1. **把 authCode 换成 openid**：在 `CampusSessionService.bind()` 里用
   `WECHAT_MINIAPP_APPID/SECRET` 走 `code2session`，拿到 openid 后
   **立即丢弃 authCode**；不要把 authCode 写进 `externalUserId` 明文列
   （当前 `:169,189` 是缺陷）。
2. **实现 eCard OPENID 客户端**：余额/流水；地址与字段**未确认，需要校方提供**。
   仓库里的 `https://ecard.shanghaitech.edu.cn` 只是
   `target-url.ts:44-54` 的占位白名单条目，未经确认。
3. **接 `fetchCard`**：把 `CampusDataPort.fetchCard` 同步上游快照 → 落
   `CampusCardTransaction`（或新增独立余额端点，但要先登记契约）。
   在此之前 `account` 的 0 只能解释为「没有账单记录」，不能解释为「卡里没钱」
   （`local-development.md:250` 已承认）。
4. **补 `simulated` / `dataAsOf`**：`CampusCardAccount` 只有
   `{activated, balanceFen, updatedAt?}`（`campus-card.domain.ts:67-74`），
   没有真假/新鲜度标记；`GET /transactions` 也没有。客户端无法判断数据来源。
5. **付款码方法统一**：契约登记的是 `GET /campus-card/payment-code`
   （`00-FROZEN-CONTRACT.md:1185`），服务端也是 `GET`；但 Web / 小程序 / Flutter
   都调 `POST`。三端会先得到 404，根本走不到那句「不会返回假付款码」的 503。
6. **配置** `CAMPUS_CARD_DATA_URL`（注意：`CARD` 不是 `ecard`，见 §6 P1-4），
   按校方文档填路径与字段。

#### 风险 / 不变量

- **P0-4**：客户端 wire 全错位：
  - Web：`POST /campus-card/payment-code` + `DELETE .../current`
    （`apps/web/src/data/repositories/techpie.http.ts:243-257`）；
  - 小程序：`GET /campus-card/overview`、`GET /lost-report`、`GET /items`
    （`httpCampusCardRepository.ts:16,22`、`httpTechpieRepository.ts:176`）；
  - Flutter：`POST campus-card/payment-code`（`remote_campus_card_repository.dart:92`）；
  - 服务端只有 `GET /account|transactions|payment-code` 与 `POST /account/activate`。
- **P1-3**：一次性 `authCode` 明文落库（两条 `externalUserId` 列）。
- **付款码 503 的语义本身是对的**：不给假码、`Cache-Control: no-store`、
  `details.upstreamReady=false` 机器可见。注意它与 `CAMPUS_DATA_MODE` **无关** ——
  只看 `ecard` 绑定是否 `ACTIVE`，mock 模式下同样是 503。
- **用户实际会看到什么**（按当前代码）：

  | 场景 | 用户看到 |
  | --- | --- |
  | 未绑定 `ecard` | 409 `CAMPUS_BINDING_REQUIRED`，引导「去开通校园卡」 |
  | 已绑定 + 按契约发 `GET /payment-code` | 503 `UPSTREAM_UNAVAILABLE`，文案「校园卡付款码通道尚未打通……不会返回一个假的付款码」，`details.upstreamReady=false` |
  | 已绑定 + 按三端现状发 `POST /payment-code` | **404 `NOT_FOUND`**（路由/方法不存在），那条诚实的 503 文案根本看不到 |

- 小程序 `CAMPUS_CARD_PAYMENT_CODE_REGISTERED = false`
  （`apps/miniapp/src/domain/models/campusCard.ts:217`）与契约 §11.21-B
  「登记后置 true」的裁决（`00-FROZEN-CONTRACT.md:1196-1199`）不一致，
  UI 会继续按「端点未登记」处理。
- **`CAMPUS_CARD_DATA_URL` 命名**：`HttpCampusDataAdapter.fetchCard` 用
  `CAMPUS_${platform}_DATA_URL`，platform 是 `CARD`
  （`http-campus-data.adapter.ts:57,74-84`），所以变量是 `CAMPUS_CARD_DATA_URL`；
  按统一枚举配 `CAMPUS_ECARD_DATA_URL` 不会生效。

---

### 3.6 TechPie（技术服务目录 / GeekPie 互联）

#### 现在是什么

- 它**不是**一个「从 TechPie 上游拉数据」的适配器。当前 `modules/techpie/` 是：
  - `TechpieLink` 绑定状态机（本地 Prisma 表）；
  - `GET /techpie/capabilities` 能力目录（纯本地数据 + 纯函数判定，
    `capabilities.ts:160-312,333-396`）；
  - `POST /techpie/webview-session` 一次性票据（`webview-session.service.ts:230-323`）；
  - 解绑/续期（续期永远 `RENEW_NOT_SUPPORTED`，`techpie.service.ts:149-156`）。
- `provider: 'techpie'` 在 `CAMPUS_PLATFORM_PHASE` 里是 `phase2`
  （`campus-session.port.ts:166-178`），绑定会被 `PHASE_BLOCKED` 拒绝
  （`campus-session.service.ts:116-128`）。
- 没有 `CAMPUS_TECHPIE_*` 环境变量，没有 HTTP 客户端，没有上游地址。
- 能力目录里与 TechPie 相关的能力是 `techpie.auto_renew`（`phase2`，
  `capabilities.ts:300-311`），其 `blockedReason` 明确写「无法假定它对我们开放」。

#### 真实实现需要什么

- GeekPie / HeZeBang 的**书面确认**（规格 U8），明确允许哪些能力
  （自动续期 / 场馆预约 / 服务目录）；
- 上游 API 文档、地址、认证方式（**全部未确认**）；
- 一条真实的 token/凭据通道（`TechpieLink.tokenCipher` 字段已存在，
  但 Phase 0 没有任何写入者，`techpie.domain.ts:53-60`）。

#### 切到 live 的确切步骤

1. 拿 U8 书面确认。
2. 新增 `TechpieUpstreamClient`（`modules/techpie/data/`），**不要**把本地
   `TechpieService` 的绑定状态机当上游客户端。
3. 把 `provider: 'techpie'` 从 `phase2` 的 `PHASE_BLOCKED` 迁到可绑定阶段，
   并补 token 通道（`tokenCipher` 加密落库；只用于上游，不进任何响应）。
4. 配置上游地址/凭据（变量名待定；**不要在代码里编 URL**）。
5. 联调：能力清单 → 绑定 → 上游取数/续期；失败模式按 F3/F4 返回明确错误，
   不谎称成功。

#### 风险 / 不变量

- **不要把 TechPie 标成「已接通」。** 当前没有上游同步；把它标成
  `mode: 'live'` / `authorization: 'granted'` 会让三端和文档同时说谎。
- `CAMPUS_PLATFORM_LABEL.techpie = "GeekPie / TechPie 体系"`
  （`campus-session.port.ts:216-223`），语义是「互联互通」，不是「技术服务目录
  已经有数据」。新契约文件把它写成「技术服务目录（TechPie）」，并在
  `provides` 里明确「本地绑定/能力清单/票据」；这是刻意的措辞收敛。

---

## 4. 四条硬不变式核对

> 任务给了四条：I1 / I2 / I3 / I5。这里按**字面检查**与**实质检查**分开给结论，
> 避免「扫描过了 = 不变式成立」的假象。I4 不在任务清单里，但它是理解
> 「已登录但未绑定」的关键，附在最后。

### 4.1 I1 —— 身份投影不得出现凭据键

**结论：PASS。**

| 检查点 | 证据 |
| --- | --- |
| 词形正则含 `tenant` | `services/api/src/modules/auth/domain/auth.domain.ts:154`：`/(cookie|session|tgc|ticket|token|credential|password|secret|tenant)/i` |
| 运行时断言 | `auth.domain.ts:156-170` `assertIdentityOnly`；调用点 `auth.service.ts:113-116`、`wechat-auth.service.ts:180` |
| `/auth/session` 只回 4 个字段 | `auth.controller.ts:122-145`（`userId / name / avatarUrl / department`，显式逐字段组装） |
| `/auth/campus-bindings` wire 键 | `campus-binding-summary.ts:46-53`（`platform / bound / expiresAt?`） |
| `/auth/campus-identity` 键 | `campus-identity.service.ts:156-164`（`platform / masked / identity / simulated / dataMode / fetchedAt / audited`） |
| 架构测试 | `test/techpie-arch.spec.ts:80-160`（含 8 键覆盖 + 运行时抛错 + wire 键集合） |
| HTTP 测试 | `test/techpie-http.spec.ts:357-373`（`/auth/session` 递归键名扫描） |

**边界说明（§11.22-A）**：`POST /techpie/webview-session` 的 `ticket` 是合法领域字段，
不在 I1 的禁令范围内；它有自己的约束（不缓存/不进日志/不进 URL/用后即焚）。
`FORBIDDEN_IDENTITY_KEY` 是**身份侧**的词形护栏，不是全仓禁用词。

### 4.2 I2 —— `modules/auth/data/**` 不得 import campus-session port

**结论：字面 PASS；实质 FAIL（仓库自己已登记为「已知偏离」）。**

| 层次 | 结果 | 证据 |
| --- | --- | --- |
| 字面扫描 | **PASS** | `modules/auth/data/**` 里没有任何 `from '...campus-session.port'`；`test/techpie-arch.spec.ts:178-186` 扫描通过 |
| 实质 | **FAIL** | `modules/auth/data/prisma-campus-session.adapter.ts:25` 仍 `implements CampusSessionPort`；`auth/domain/auth.domain.ts:86-92` 仍声明独立端口；`auth.service.ts:340-349` 仍有 `requireCampusSession()` / `acquireSession()` |
| 仓库自认 | **已知偏离** | `test/techpie-arch.spec.ts:189-219` 的用例名就是「[已知偏离] 合并同学分支后 I2/I3 在 auth 模块内被回退 —— 记录而非掩盖」，并断言 `auth/data` 仍含 `prisma-campus-session.adapter.ts`、`auth.service` 仍含 `acquireSession` |

**为什么字面会过**：auth 的适配器 import 的是**自己**的
`../domain/auth.domain` 里的 `CampusSessionPort`，不是 techpie 的
`domain/ports/campus-session.port`。扫描按路径匹配，自然扫不到。
但不变式的**目的**是「防止两级身份在实现层被悄悄耦合」，目的没有达到。

**后果（P0-1）**：

- `AuthModule` 自己的 `CAMPUS_SESSION_PORT` provider（`auth.module.ts:80`）
  在 Nest 的解析顺序里**优先于**它 import 的 `TechpieModule`；
  `TechpieModule` 的 `useExisting` 别名（`techpie.module.ts:50`）只在
  TechpieModule 内部生效，且**没有 export**（`exports` 列表 `:63-71` 不含 auth 的符号）。
- 于是 `AuthService.me()`（`auth.service.ts:265-276`）、
  `CampusIdentityService.overview()/view()`（`campus-identity.service.ts:56-132`）、
  `ScheduleCourseService.syncFromCampus()`（`schedule.service.ts:233`）
  全部读 `CampusBinding` 表（大写平台、小写 `'active'`）。
- 而所有绑定端点（`/auth/campus-bindings`、`/techpie/links`、`/campus-card/account/activate`）
  写的是 `TechpieLink` + `CampusSession`（小写平台、大写 `'ACTIVE'`）。
- `CampusBinding` 表**唯一**的写入者是 `AuthService.bindCampus()`
  （`auth.service.ts:287-301`），而它**没有任何控制器调用**（全仓 grep 只有定义）。
  所以正常产品路径下旧表是空的（只有手工插行才会有数据）。

**结论**：I2 不能按「扫描过了」算通过。修复目标是把两套 port 合并成
techpie 那一套，并删掉 `auth/data/prisma-campus-session.adapter.ts` 与
`auth/domain/auth.domain.ts` 的 `CampusSessionPort`；届时
`test/techpie-arch.spec.ts:189-219` 应当失败，再把它改成断言「没有这两个文件」。

### 4.3 I3 —— `cookieHeaderFor(` 只允许出现在 `webview-session/` 内

**结论：PASS。**

| 检查点 | 证据 |
| --- | --- |
| 唯一生产调用点 | `modules/techpie/data/webview-session/webview-session.service.ts:321` |
| 端口声明 | `campus-session.port.ts:366`：`cookieHeaderFor: (userId, platform) => Promise<string>`（属性写法，不含 `(`） |
| 实现 | `campus-session.service.ts:257`：`readonly cookieHeaderFor = async (...) =>`（属性写法） |
| 静态扫描 | `test/techpie-arch.spec.ts:231-305`：全仓 `.ts` 裸子串扫描，豁免面**恰好** `*.spec.ts`；同时断言端口/实现文本不含 `cookieHeaderFor(` |
| 产物排除 | `services/api/tsconfig.build.json` 的 `exclude` 含 `src/**/*.spec.ts`（由 `techpie-arch.spec.ts:290-296` 钉死） |
| 小程序端 | `apps/miniapp/src/__tests__/techpie-no-cookie-injection.test.ts:174-176` 断言生产源码没有该出口 |

**边界说明**：Phase 0 的 `DisabledCookieDelivery.enabled === false`
（`webview-session.service.ts:146-161`），`redeem()` 在**读取凭证之前**就短路
（`:302-311`），所以 `cookieHeaderFor` 在 Phase 0 **根本不会被执行**。
它仍然保留为唯一出口，是为了让 I3 的扫描「非空且可审计」。

### 4.4 I5 —— `GET /auth/session` < 50ms，且不得触达上游

**结论：PASS（结构性 + 测试）。**

| 检查点 | 证据 |
| --- | --- |
| 只读自有账户 | `auth.controller.ts:129-145`：`users.findById(userId)`，显式 4 字段；不调用 `authService.me()` |
| 不碰 `CampusSessionPort` | 同文件 `:130-133` 的注释与实现；架构测试 `techpie-arch.spec.ts:163-168` 断言方法体不含 `campusSession.` / `authPort.` |
| 因果判据 | `test/techpie-http.spec.ts:390-401`：调用前后 `upstreamAuthCalls.count` 与 `campusSessionReads.count` 都不变 |
| 计时 | `test/techpie-http.spec.ts:403-415`：5 次取最优，`best < 50ms` |
| 上游全超时环境 | `test/techpie-http.spec.ts:182-190`：`hangingAuthPort` 永远超时；对照组 `POST /auth/login` 被拖慢 ≥300ms（`:417-429`） |

**caveat**：50ms 是在内存夹具（fake Prisma）下的测量；生产 DB 延迟不在
这条不变式的范围内。I5 真正要求的是「不触达上游」，这一点是结构性成立的。

### 4.5 I4（附加）—— 已登录但未绑定 → 409，不是 401

**结论：HTTP 路径 PASS；存在一个「service 直调」旁路（P2-1）。**

| 检查点 | 证据 |
| --- | --- |
| 守卫 | `modules/techpie/data/campus-binding.guard.ts:68-96`；默认平台 `cpdaily`（`:73`），fail closed |
| 状态判定 | `isActiveLinkStatus()`（`campus-session.port.ts:158-160`）只认 `ACTIVE` |
| 错误形状 | `CampusBindingRequiredError`（`app-error.ts:90-97`）→ 409（`ERROR_HTTP_STATUS` `:23`）；`details = { provider, status: 'UNBOUND', next: 'GO_BIND' }`（guard `:87-93`） |
| 测试 | `test/techpie-http.spec.ts:435-442`（`/schedule/items` → 409 `CAMPUS_BINDING_REQUIRED`，不是 401） |
| 旁路 | `agent-tools.service.ts:101,146` 直接调 `ScheduleCourseService.nextClass()/today()`，**不经过 HTTP 守卫**；已登录但未绑定的用户仍可从 agent 拿到本地课表 |

### 4.6 不变式汇总

| 不变式 | 字面 | 实质 | 一句话 |
| --- | --- | --- | --- |
| I1 | PASS | PASS | 正则含 `tenant`，运行时断言 + `/auth/*` 键扫描都在 |
| I2 | PASS | **FAIL** | 两套 port/两张表仍在；仓库自己的测试把这条标成「已知偏离」 |
| I3 | PASS | PASS | 唯一调用点在 `webview-session.service.ts:321`；豁免面恰好 `*.spec.ts` |
| I5 | PASS | PASS | 纯本地读 + 因果判据 + <50ms；50ms 是夹具测量 |
| I4（附加） | PASS | 部分 | HTTP 409 正确；agent 直调 service 绕过守卫 |

---

## 5. TechPie 的做法：哪些值得复用

> 用户说「可以多参考 techpie 上的方式」。这一节回答：TechPie 到底做对了什么，
> 哪些可以直接搬到其他校园服务，哪些**不能**照抄。

### 5.1 它是怎么表达「两级身份」的

TechPie 的端口文件头（`modules/techpie/domain/ports/campus-session.port.ts:14-20`）
把边界说得很清楚：

- **第一级**：`AuthPort` 只回答「你是谁」，返回 `CampusIdentity`，
  **类型上**没有 session/cookie 字段（`auth/domain/auth.domain.ts:20-39`）。
- **第二级**：`CampusSessionPort` 在 `techpie/domain/ports/`，负责
  「你能访问哪些校园系统」。实现放在 `techpie/data/`，**物理上**不在 `auth/`。
- **为什么放 techpie 而不是 auth**：如果端口在 auth，
  `modules/auth/data/**` 就能 import 它，I2 只能靠「没写 import」通过；
  搬走之后，身份层在**类型上**拿不到能力层。

**这套表达值得复用**，但当前有一个反例：auth 自己还留着一套同名端口
（`auth/domain/auth.domain.ts:86-92`）和实现（`prisma-campus-session.adapter.ts:25`），
导致 I2 字面过、实质不过。**复用 TechPie 的第一步，是先把 auth 那一套删掉。**

### 5.2 `toTechpieLink` / `CampusBindingGuard` 怎么处理「已登录但未绑定」

这两者分工不同，不要混为一谈：

**`toTechpieLink` 是投影，不处理绑定状态。** 它只把一条**已存在**的
`TechpieLinkModel` / `CampusBindingState` 投影成 wire 类型
（`techpie/domain/techpie.domain.ts:168-183`）：

- 输入是窄类型 `TechpieLinkViewInput`（`id / provider / status / boundAt /
  expiresAt / lastSyncAt`），有两个适配器：读库 `linkModelToViewInput`（`:186-195`）
  和绑定/续期刚返回 `bindingStateToViewInput`（`:198-208`）；
- 输出逐字段挑选，`tokenCipher` / `externalUserId` **没有出口**；
- 可空字段为空时**省略键**（`withOptional`，`:119-124`），不下发 `null`；
- 端口类型 `CampusBindingState` 在投影前跑 `assertNoCredentialKeys`
  （`toCampusBindingState`，`:133-145`），I1 的镜像断言。

**「未绑定」由守卫处理。** `CampusBindingGuard`（`data/campus-binding.guard.ts:68-96`）：

1. 从 `@RequireCampusBinding(platform)` 取平台，**未声明时默认 `cpdaily`**
   （`:69-73`）——fail closed，比「忘了标注就放行」安全；
2. 只调 `getBinding()`（状态查询），**不调** `acquireSession()`（避免把明文拉进
   请求路径，`:82-84`）；
3. 没有绑定、或状态不是 `ACTIVE` → `CampusBindingRequiredError`，
   `details = { provider, status: 'UNBOUND', next: 'GO_BIND' }`（`:87-93`）；
4. 错误码 409，不是 401（`app-error.ts:23,90-97`）——客户端据此跳绑定页，
   而不是跳登录页。

**能力清单走另一条路**：`TechpieService.capabilities()`（`techpie.service.ts:168-178`）
把未绑定项投影成 `available: false` + `blockedReason` + `unboundCount`，
**不抛错**。这是对的：能力清单是「告诉你还缺什么」，不是「拒绝你」。

### 5.3 `acquireSession` 的契约（注意：有两个版本）

这是本次审计里最容易混淆的点。仓库里有两个 `CampusSessionPort`，
`acquireSession` 只存在于**旧的那个**：

**旧（auth）端口** —— `auth/domain/auth.domain.ts:86-92`：

```ts
acquireSession(userId: string, platform: CampusPlatform): Promise<CampusSession | null>;
```

实现 `prisma-campus-session.adapter.ts:82-101`：

- 查 `CampusBinding`（`userId + platform`）；
- 没有行 / `status !== 'active'` / `expiresAt <= now` → 返回 `null`；
- 否则更新 `lastUsedAt`，**解密** `encryptedSession`，返回
  `{ platform, sessionRef, expiresAt }`；
- 它是全仓**唯一**解密校园会话明文的方法（`prisma-campus-session.adapter.ts:20-22`）。
- 调用方：`AuthService.me()` 不调，但 `campusCapability()` / `requireCampusSession()`
  （`auth.service.ts:328-349`）、`CampusIdentityService`（`:66,94`）、
  `ScheduleCourseService`（`:233`）调。

**新（techpie）端口** —— `techpie/domain/ports/campus-session.port.ts:330-367`：
**故意没有 `acquireSession`**。读侧只有：

- `listBindings(userId)` → `CampusBindingState[]`（只含状态，无凭证）；
- `getBinding(userId, platform)` → `CampusBindingState | null`；
- `cookieHeaderFor: (userId, platform) => Promise<string>` → **完整 header 串**，
  唯一出口，只允许 `webview-session/` 调用（I3）。

**这个设计是更好的契约**，理由是：

1. 守卫只需要「有没有 ACTIVE 绑定」，不需要明文；`getBinding()` 足够。
2. 业务模块（课表/校园卡）如果要取数，应该拿 `CampusSession` 交给
   `CampusDataPort`，但**不应该**自己解密；把解密收口在 `campus-session.service.ts`
   或一个专门的取数适配器里。
3. `cookieHeaderFor` 返回完整 header 串（不是 cookie 对象），调用方在**类型上**
   就无法挑出单个 `CASTGC` 单独使用（ADR 0004 §2.3）。
4. 全仓只有 `webview-session/` 能调用它，静态扫描完备（I3）。

**这就是 P0-1 的修复方向**：让所有业务模块依赖 techpie 的端口，
删掉 auth 的 `acquireSession`。如果某个模块确实需要「取数用的 session」，
在 techpie 端口上加一个**内部**方法（例如 `sessionForData()`），
但不要恢复公开的 `acquireSession` 明文出口。

### 5.4 值得复用的 7 个模式

| # | 模式 | 位置 | 为什么值得复用 |
| --- | --- | --- | --- |
| 1 | **port 类型与 wire 类型不同名、不同层** | `CampusBindingState`（port）vs `TechpieLink` / `CampusBindingSummary`（wire） | 同名跨层是契约缺陷的根源（§11.20-B）；不同名让「这个字段按哪个算」不再需要猜 |
| 2 | **单一投影函数 + 窄输入** | `toTechpieLink` / `toCampusBindingSummary` | 逐字段挑选，新增 DB 字段默认不会进响应；`tokenCipher` 结构上不可能泄漏 |
| 3 | **单一状态谓词** | `isActiveLinkStatus()`（`campus-session.port.ts:158-160`） | 全仓只有一处 `=== 'ACTIVE'`；旧拼法 `LINKED` 无处可藏 |
| 4 | **能力目录 = 纯数据 + 纯函数** | `capabilities.ts:160-312,333-396` | 不碰 DB/网络，天然满足「启动不被上游拖死」；phase 判定先于 binding 判定 |
| 5 | **守卫 + metadata + fail-closed 默认** | `campus-binding.guard.ts:58-96` | 「这个模块依赖哪个平台」在代码里可见；忘了标注默认 `cpdaily`，不是放行 |
| 6 | **一次性票据 + 精确 origin 白名单** | `webview-session.service.ts:230-323`、`target-url.ts:44-135`、`ticket.store.ts` | 服务端校验、peek→consume 原子、用后即焚、绑定 origin、`cookieInjected:false` 机器可见 |
| 7 | **诚实常量** | `PHASE0_BINDABLE_PLATFORMS`（`campus-session.port.ts:110`）、`CAMPUS_CARD_PAYMENT_CODE_UPSTREAM_READY`、`CAMPUS_TARGET_ALLOWLIST_IS_PLACEHOLDER`、`blockedReason` | 「没接通」不是一句注释，而是可断言的布尔/常量；UI 能如实告知 |

### 5.5 不要照抄的 3 个东西

| # | 不要抄 | 原因 |
| --- | --- | --- |
| 1 | **两套 `CampusSessionPort` / 两张表** | 这正是 P0-1。TechPie 的端口设计是对的，auth 的遗留实现是错的；抄「两套并存」等于抄 bug |
| 2 | **把 TechPie 标成 `live` / `granted`** | 当前 `techpie` 没有上游客户端；`provider: "techpie"` 是 `phase2`。把它说成「已接通」违背本契约的目的 |
| 3 | **进程内票据 Map 直接上生产** | `ticket.store.ts:13-17` 自己承认单实例可用；多实例/重启会丢票。生产要换 Redis，接口不变 |

---

## 6. 问题清单（按严重度排序）

> 每条都给「现象 / 证据 / 影响 / 修复」。P0 = 阻断 live 或安全风险；
> P1 = 真实但可绕过/可延迟；P2 = 一致性/运维/文档债务。

### 6.1 P0

#### P0-1 两套 `CampusSessionPort` / 两张表 / 两套枚举，读写分裂

**现象**：绑定端点写 `TechpieLink` + `CampusSession`（小写平台、`ACTIVE`）；
课表/实名/`/auth/me` 读 `CampusBinding`（大写平台、`active`）。旧表没有写入者。

**证据**：

- `auth.module.ts:80` 仍把 auth 的 `CAMPUS_SESSION_PORT` 绑定到
  `PrismaCampusSessionAdapter`；
- `techpie.module.ts:27-32` 的注释自己承认「auth 与 techpie 各有一套
  `CAMPUS_SESSION_PORT` 符号……根治办法是统一两套 port 与枚举（记录为待办）」；
- `prisma-campus-session.adapter.ts:25` 实现旧端口；`auth.domain.ts:86-92` 声明旧端口；
- `AuthService.bindCampus()`（`auth.service.ts:287-301`）是旧表唯一写入者，
  但**没有任何控制器调用**；
- 读侧：`auth.service.ts:269-275`（`me`）、`campus-identity.service.ts:57,94`
  （overview/view）、`schedule.service.ts:233`（sync）全部注入旧端口；
- `test/techpie-arch.spec.ts:189-219` 把这条登记为「已知偏离」。

**影响**：

- 用户通过 `/auth/campus-bindings` 或 `/techpie/links` 成功绑定 `ecard` 后，
  `/auth/me` 仍返回 `campusBound: false`、`campusBindings: []`；
- `/auth/campus/overview` 四个平台全 `available: false`；
- `/auth/campus-identity` 恒 409；
- `/schedule/sync` 恒 409。

**修复**：删掉 auth 的 `CampusSessionPort` 与 `PrismaCampusSessionAdapter`；
`AuthModule` 改为 import/export techpie 的唯一实现；`AuthService.me()`、
`CampusIdentityService`、`ScheduleCourseService` 全部改用 techpie 端口。
迁移期间如需兼容旧表，写一个一次性数据迁移，不要长期双写。

#### P0-2 真实后端下所有 `/schedule/*` 恒 409

**现象**：类级 `@RequireCampusBinding('cpdaily')`，但 Phase 0 只允许绑定 `ecard`。

**证据**：`schedule.controller.ts:52-53`；`campus-session.port.ts:110`；
`techpie-http.spec.ts:435-442`（测试本身就断言「未绑定 → 409」）。

**影响**：`GET /schedule/today`、`GET /schedule/week`、`POST /schedule/items`
全部不可用；小程序页面只有在 mock 仓储下能跑（agent 直调 service 绕过守卫，见 P2-1）。
`delivery.ts` 的「schedule 小程序已上线」在真实后端下不成立。

**修复**：短期把 `today/week/next` 与 `items`（本地数据）移出类级守卫，
只给 `sync` 加 `@RequireCampusBinding`；长期按 P0-1 修好会话后，
再决定课表到底归 `cpdaily` 还是 `jwc`，并让守卫与 service 用同一个平台值。

#### P0-3 Mock CAS 登录无 `simulated`，且生产门对 `NODE_ENV` fail-open

**现象**：

- `AUTH_PORT` 永远 `MockCampusAuthProvider`；`mock-<8 位学号>` 直接采信（`:52`）；
- 生产门只在 `NODE_ENV === "production"` 时拒绝（`:82-90`）；
  `NODE_ENV` 未设置/拼错 → 视为非生产 → 放行；
- `AccountSession.simulated` 只给微信登录（`account-session.ts:27-31`）；
  `POST /auth/login` 的 CAS 响应里没有这个字段。

**影响**：部署时忘设 `NODE_ENV`，任何人可 `curl` 一个学号拿到该校学生的令牌；
开发期用户也无法从响应判断「这是模拟身份」。

**修复**：

1. `assertAllowedInProduction()` 改为 fail closed：只有显式
   `CAMPUS_CAS_MOCK_ALLOWED=true` **且** `NODE_ENV !== 'production'` 才允许；
   `NODE_ENV` 未设置按 production 处理。
2. 给 `LoginResult` 加 `simulated: boolean`（CAS mock 恒 true），
   或至少在 `MockCampusAuthProvider` 返回的身份里带一个不会进 I1 的
   `provider: 'SHTU_CAS'` + 独立响应字段（不要叫 `session`/`token`）。
3. 客户端在 `simulated` 时显著标注「演示身份」。

#### P0-4 校园卡服务端与三端 wire 全错位

**现象**：契约/服务端是 `GET /campus-card/account|transactions|payment-code`；
三端调的是别的路径/方法。

**证据**：

| 端 | 调用的路径 | 服务端实际 |
| --- | --- | --- |
| Web | `POST /campus-card/payment-code`、`DELETE /payment-code/current`（`techpie.http.ts:243-257`） | 只有 `GET /payment-code`（`campus-card.controller.ts:132`） |
| 小程序 | `GET /campus-card/overview`、`GET /lost-report`（`httpCampusCardRepository.ts:16,22`） | 没有这两个路由 |
| 小程序 | `GET /campus-card/items`（`httpTechpieRepository.ts:176`） | 只有 `GET /transactions`（`:116`） |
| Flutter | `POST campus-card/payment-code`（`remote_campus_card_repository.dart:92`） | 只有 `GET` |

**影响**：真实后端下校园卡页面 404；付款码的诚实 503 到不了三端用户（它们发的是 POST）。

**修复**：以契约为准（`00-FROZEN-CONTRACT.md:1180-1187`）统一为
`GET /account`、`POST /account/activate`、`DELETE /account`、
`GET /transactions`、`GET /payment-code`；三端改路径/方法。
如果业务上确实需要 `POST`（创建付款码资源），先改契约并登记，不要三端各写一套。

### 6.2 P1

#### P1-1 `CAMPUS_DATA_MODE=live` 不等于「真的 live」

**证据**：

- `auth.module.ts:84-90` 只切换 `CAMPUS_DATA_PORT`；`AUTH_PORT` 在 `:78` 不变；
- live 取数仍然要 `acquireSession()`，而旧表没有写入者（P0-1）；
- `CampusCardService` 不注入 `CAMPUS_DATA_PORT`（`campus-card.service.ts:59-62`），
  `fetchCard` 没有调用点；
- 未配 `CAMPUS_*_DATA_URL` 时 `baseUrl()` 抛 `InternalError`（500），
  不是 `UPSTREAM_UNAVAILABLE`（503）（`http-campus-data.adapter.ts:74-84`）。

**影响**：运维按文档切 `live` 后，身份/课表仍 409，校园卡静默返回 0，
配错 URL 则 500。用户看到的是「服务坏了」或「我没课/没钱」。

**修复**：把「live」拆成可观测的就绪检查：启动时校验所需 env + 会话路径，
缺失则 fail fast（或 `/health` 里给出明确的 `campusReady: false`），
不要等到用户请求才 500；`baseUrl` 缺配置改为 503 `UPSTREAM_UNAVAILABLE` +
`details.missingEnv`。

#### P1-2 mock 数据可能被当成真实数据展示

**证据**：

- `schedule.today/week/sync` 的 `simulated = campusData.mode === 'mock'`
  （`schedule.service.ts:170,200,271`），**不是**行的来源；`ScheduleCourse`
  没有 `sourceMode` 列。mock 模式同步进来的行，切 live 后会以 `simulated: false` 展示。
- `CampusCardAccount` / `CampusCardTransaction` 没有 `simulated` / `dataMode`
  （`campus-card.domain.ts:67-74`；`campus-card.service.ts:72-83,128-135`）。
- `HttpCampusDataAdapter.fetchCard` 的 `dataAsOf: new Date()`（`:61`）是
  **服务端当前时间**，不是上游时间；如果将来接上，会谎报新鲜度。
- `CampusIdentityService.overview` 的 `simulated` 取「session 是不是 demo 凭据」
  （`:77`），不是 `dataMode`；有真实绑定但数据模式是 mock 时，会显示成真实。

**影响**：这正是「mock 假装真实」的典型路径；切换模式后旧数据会「洗白」。

**修复**：给持久化的校园数据加 `sourceMode`（`mock | live`）与
`fetchedAt`；投影时按行标注，不按全局模式。校园卡响应补 `simulated` / `dataAsOf`。
`fetchCard` 的 `dataAsOf` 必须来自上游，取不到就省略键。

#### P1-3 一次性 `authCode` 明文落库

**证据**：`campus-session.service.ts:154-157` 把 `authCode` 放进 `EcardOpenIdSecret`
（加密），`:169` / `:189` 又把它明文写进 `TechpieLink.externalUserId` 与
`CampusSession.externalUserId`。文件头 `:57-64` 自己承认「Phase 0 存的是
一次性 authCode 本身，仅作为占位标识」。

**影响**：违反 §11.19-B「服务端必须立即用掉并丢弃该 code」；一次性 code 在
5 分钟有效期内是可重放的凭据。数据库备份/只读账号/运维查询都可能看到它。

**修复**：真实通道下 `code2session` 换 openid，authCode 不落库；
Phase 0 如果一定要占位，存 `sha256(authCode)` 或随机 UUID，不存原值；
`externalUserId` 只放 openid/学号，不放任何一次性码。

#### P1-4 平台枚举 / 环境变量命名分裂

**证据**：

| 位置 | 枚举 |
| --- | --- |
| 契约 §11.20-C / techpie 端口 / 新契约 | `cas \| egate \| cpdaily \| jwc \| ecard \| techpie` |
| auth 模块 | `EGATE \| CPDAILY \| JWC \| CARD`（`auth.domain.ts:50`） |
| 小程序 identity | `EGATE \| JWC \| CPDAILY \| CARD`（`apps/miniapp/src/domain/models/identity.ts:12`） |
| Web techpie | `cas \| egate \| cpdaily \| ecard \| techpie`（**少 `jwc`**，`techpie.ts:107`） |
| 环境变量 | `CAMPUS_CARD_DATA_URL`（`CARD`）vs `ecard`；`CAMPUS_CPDAILY_DATA_URL` 无代码读取 |

**影响**：跨端比较平台名会静默漏配；按契约配 `CAMPUS_ECARD_DATA_URL` 不生效；
Web 收到 `jwc` 会当成未知平台。

**修复**：以 `packages/contracts/src/campus-services.ts` 的
`CampusPlatform` 为唯一类型；三端与后端都从 `@kedaya/contracts` 导入，
删除本地枚举。环境变量统一为 `CAMPUS_<PLATFORM>_DATA_URL`，对 `CARD` 做一次
显式别名 + 弃用日志（不要静默双读）。

#### P1-5 审计开始时的契约文件把 TechPie 标成 live / granted

**证据**：`git show e6193f3:packages/contracts/src/campus-services.ts` 里
`platform: 'techpie'` 的 `mode: 'live'`、`authorization: 'granted'`、
`upstreamConfirmed: true`、`adapterFile: '.../techpie.service.ts'`，
提交说明还声称它的 `POST /items/:id/sync` 只是把 status 写成 synced（提交说明的说法，不是文件里的字段）。
但当前 `techpie.controller.ts` **没有** `items` 路由，`techpie.service.ts`
**没有**上游 HTTP 客户端，`provider: 'techpie'` 是 `phase2`。

**影响**：如果三端开始消费这张表，会把「没有上游的本地状态机」显示成「已接通」。

**修复**：本轮已改写为 `mode: 'not-wired'`、`authorization: 'pending'`、
`adapterFile: null`、`blockedBy: ['U8']`，并把「本地绑定/能力/票据」写进
`provides`。如果未来真的接了 TechPie 上游，再按 `switchToLive` 逐步改。

#### P1-6 付款码的「登记状态」三方不一致

**证据**：

- 契约 §11.21-B 在登记端点后要求把 `CAMPUS_CARD_PAYMENT_CODE_REGISTERED`
  置为 `true`（`00-FROZEN-CONTRACT.md:1196-1199`）；
- 小程序仍是 `false`（`apps/miniapp/src/domain/models/campusCard.ts:217`），
  并在 UI/用例里据此告知「端点尚未登记」；
- 服务端已有 `GET /payment-code`（`campus-card.controller.ts:132`），
  返回 503 而不是假码；
- 契约正文 `:1185` 登记了 `GET`，但 `:1196` 又写「契约里没有付款码端点」——
  同一份文档自相矛盾。

**影响**：小程序可能隐藏/禁用付款码入口，Web 却显示一个必然 404 的按钮；
维护者不知道该信哪一句。

**修复**：契约删除 `:1196` 的旧表述；小程序把常量改为 `true`（端点已登记），
UI 文案改为「通道未接通」而不是「端点未登记」；三端 HTTP 方法统一为 `GET`。

### 6.3 P2

#### P2-1 agent 直调 service，绕过 `CampusBindingGuard`

**证据**：`agent-tools.service.ts:101`（`schedule.nextClass`）、`:146`
（`schedule.today`）直接调 `ScheduleCourseService`；HTTP 守卫在 controller 上，
agent 不经过它。

**影响**：已登录但未绑定的用户，从页面进 `/schedule/today` 得到 409，
从 agent 问「今天有课吗」却能得到本地/ mock 课表。两条路径的「未绑定」语义不一致。

**修复**：在 agent tool 里显式做一次绑定检查（复用 `CampusBindingGuard` 的判定
或 `campusSession.getBinding`），或在 service 层加一个可选的 `requireBinding` 参数。
不要让「HTTP 守卫」成为唯一的权限边界。

#### P2-2 `TechpieSyncJob.lastError` 没有脱敏强制

**证据**：`techpie.domain.ts:245-247` 注释要求「必须脱敏，不得含 cookie/token/密码」；
`techpie.service.ts:183-185` 的 `listSyncJobs()` 直接返回 `TechpieSyncJobModel`，
没有投影/扫描。Phase 0 没有写入者，但接口已经暴露。

**影响**：未来接上游后，如果把原始错误（含 cookie/Authorization）写进
`lastError`，会随 `GET /techpie/sync-jobs` 原样下发并可能进日志。

**修复**：参考 `toTechpieLink` 做一层 `toSyncJobWire`，白名单字段；
写入前用 `redactSecrets()`（`common/logging/redact.ts`）处理 `lastError`；
架构测试断言 `lastError` 不含 8 个禁用键。

#### P2-3 `CampusBindingState.externalUserId` 是潜在的泄漏面

**证据**：`campus-session.port.ts:202-213` 的 port 类型含 `externalUserId`；
`toCampusBindingState` 原样带出（`techpie.domain.ts:139`）。
当前 `TechpieLink` / `CampusBindingSummary` 的投影都没有它（安全），
但 port 类型在进程内可被任何注入者读到。

**影响**：如果将来有人「图省事」把 port 对象直接 `JSON.stringify` 或展开进响应，
会把 openid/学号（Phase 0 是 authCode）带出去。

**修复**：把 `externalUserId` 从 port 类型移到内部模型；如果业务确实需要，
用 `maskStudentId` / `maskOpenId` 后再投影。保持「wire 类型逐字段挑选」的纪律。

#### P2-4 票据存储/限流是进程内 Map

**证据**：`ticket.store.ts:13-17,47-49`（内存 Map）、
`webview-session.service.ts:163-171`（`hits` Map）。

**影响**：多实例部署时，A 实例签发的票据在 B 实例兑换会 404；限流按实例计数，
可被绕过。单实例重启丢票。

**修复**：生产换 Redis（接口不变），并给票据加 `singleUse` 的原子 `DEL`/`GETDEL`；
限流用 Redis 滑动窗口或集中式计数器。

#### P2-5 文档/注释里的过期事实

**证据**：

- `docs/architecture/05-security-privacy.md` 的保留期表还写
  `CampusBinding` / `PaymentCode`，代码实际是 `CampusSession` / `TechpieLink`
  + 无 `PaymentCode` 表；
- `docs/local-development.md:246` 写付款码 `GET`，客户端却是 `POST`；
- `deploy.md:619` 明确「真实校园系统对接（live）未验证」——这与本审计一致，
  但 `delivery.ts` 的「已上线」措辞没有同步这个 caveat。

**影响**：维护者按文档操作会踩空；「已上线」与「未验证」在同一仓库里并存。

**修复**：把本文作为校园对接的单一证据文档；`delivery.ts` 的校园模块
note 加一句「真实校园系统未接通，当前为 mock」；保留期表按实际模型更新。

---

## 7. `CampusServiceDescriptor` 契约

### 7.1 路径与形状

**路径**：`packages/contracts/src/campus-services.ts`（已由
`packages/contracts/src/index.ts` 的 `export * from './campus-services'` 导出；
该导出行在 `e6193f3` 已存在，本轮未改 `index.ts`）。

```ts
export type CampusPlatform =
  | 'cas' | 'egate' | 'cpdaily' | 'jwc' | 'ecard' | 'techpie';

export type CampusServiceMode = 'mock' | 'live' | 'not-wired';
export type CampusAuthorization = 'none' | 'pending' | 'granted' | 'unknown';
export type CampusWiring = 'not-wired' | 'partial' | 'end-to-end';
export type CampusDataSourceKind =
  | 'local-simulator' | 'http-upstream' | 'openid-channel'
  | 'webview-direct' | 'local-database' | 'local-catalog' | 'none';
export type CampusSimulatedDisclosure =
  | 'response-field' | 'none' | 'not-applicable';

export interface CampusServiceDescriptor {
  readonly platform: CampusPlatform;
  readonly label: string;
  readonly mode: CampusServiceMode;
  readonly authorization: CampusAuthorization;
  readonly authorizationNote: string;
  readonly dataSources: readonly CampusDataSourceKind[];
  readonly wiring: CampusWiring;
  readonly simulatedDisclosure: CampusSimulatedDisclosure;
  readonly provides: readonly string[];
  readonly integration: {
    readonly adapterFile: string | null;
    readonly adapterSymbol: string | null;
    readonly envKeys: readonly string[];
    readonly upstreamConfirmed: boolean;
    readonly blockedBy: readonly string[];
    readonly blockedReason: string | null;
  };
  readonly switchToLive: readonly string[];
  readonly caveats: readonly string[];
  readonly userFacingNote: string;
}

export const CAMPUS_SERVICES =
  [ /* 6 条，见 7.2 */ ] as const satisfies readonly CampusServiceDescriptor[];

export const CAMPUS_SERVICE_AUDIT = {
  auditedAt: '2026-10-18',
  auditedCommit: 'd8979d4',
  evidenceDoc: 'docs/architecture/05-campus-integration-audit.md',
} as const;

export function campusServiceOf(platform: CampusPlatform): CampusServiceDescriptor;
export function isSimulated(platform: CampusPlatform): boolean;
export function canShowAsReal(platform: CampusPlatform): boolean;
export function isCampusServiceWired(platform: CampusPlatform): boolean;
export function simulatedNotice(platform: CampusPlatform): string;
export function campusServicesByWiring(wiring: CampusWiring): readonly CampusServiceDescriptor[];
```

### 7.2 六条服务的登记结论

| 平台 | `mode` | `authorization` | `wiring` | `simulatedDisclosure` | 一句话 |
| --- | --- | --- | --- | --- | --- |
| `cas` | `mock` | `pending` | `not-wired` | `none`（**缺陷**） | 只有 Mock，真实 CAS 未实现；登录响应不标 simulated |
| `egate` | `mock` | `pending` | `not-wired` | `response-field` | 实名适配器有，会话表无写入者 |
| `cpdaily` | `not-wired` | `pending` | `not-wired` | `not-applicable` | 完全没有取数路径 |
| `jwc` | `mock` | `pending` | `not-wired` | `response-field` | 课表适配器有，会话/守卫平台名不一致 |
| `ecard` | `mock` | `pending` | `partial` | `none`（**缺陷**） | 绑定能走通；余额/流水未接上游 |
| `techpie` | `not-wired` | `pending` | `not-wired` | `not-applicable` | 本地状态机/能力目录/票据，没有上游 |

**`canShowAsReal()` 对当前 6 条全部返回 `false`** ——这是正确结果，不是悲观。
它要求四个条件同时成立：`live` + `end-to-end` + `granted` +
`upstreamConfirmed`。

### 7.3 为什么是这几个字段

| 字段 | 回答的问题 | 为什么不能省 |
| --- | --- | --- |
| `platform` | 哪个系统 | 与契约 §11.20-C 共用枚举，避免第四套拼法 |
| `mode` | 现在跑的是 mock / live / 没有 | 直接决定 UI 是否显示「演示」 |
| `authorization` | 有没有**法律**授权 | 与 `mode` 正交；没有授权切 live 是违规 |
| `authorizationNote` | 授权结论的依据 | 防止「应该快了」这种不可举证的判断 |
| `dataSources` | 数据实际从哪来 | 区分「本地模拟」「上游 HTTP」「OPENID」「本地库」 |
| `wiring` | 端到端是否可达 | 把「有适配器」与「已接通」分开 |
| `simulatedDisclosure` | `simulated` 真的标了吗 | 这是本次审计发现的真实缺陷（CAS/校园卡没标） |
| `provides` | 能提供什么 | 能力未接线时也要如实写，防止 UI 提前点亮 |
| `integration` | 改哪里、配什么、被什么阻塞 | 给维护者的行动清单；`adapterSymbol` 比行号稳定 |
| `switchToLive` | 怎么切 | 避免每个端各写一份切换步骤 |
| `caveats` | 已知坑 | 不是只写好消息；本文 P0/P1 的浓缩 |
| `userFacingNote` | 用户看到什么 | 强制与 `mode`/`wiring` 一致，防止文案漂移 |

### 7.4 三端 + 后端的接入方式（建议，需 Lead 批准）

| 端 | 现在 | 建议 |
| --- | --- | --- |
| Web | `domain/models/delivery.ts` 管模块交付；`domain/models/techpie.ts` 管平台枚举 | 平台枚举改为从 `@kedaya/contracts` 导入 `CampusPlatform`；校园服务状态从 `CAMPUS_SERVICES` 读，不再各写一份 |
| 小程序 | `domain/models/identity.ts` 用大写四值 | 同上；`WIRE_PROVIDER` 映射表（`httpIdentityRepository.ts:25-30`）可以保留到后端统一枚举为止，但映射的**目标值**应来自 `CAMPUS_PLATFORMS` |
| Flutter | `CampusPlatform` 枚举 | 同上；`paymentCode()` 的 `POST` 与契约的 `GET` 二选一，先改契约或先改端，不要两边都声称对 |
| 后端 | 两套枚举（`auth.domain.ts:50` / `campus-session.port.ts:80`） | `techpie/domain/ports/campus-session.port.ts` 改为
`import type { CampusPlatform } from '@kedaya/contracts'`，删除本地 `CampusPlatform` / `CAMPUS_PLATFORMS`；`auth.domain.ts` 的旧枚举随 P0-1 一起删 |

**依赖方向**：`packages/contracts` 是纯类型/常量包，`campus-services.ts`
**零 import**，不会引入 Nest/Prisma/客户端依赖；`services/api` 已经依赖
`@kedaya/contracts`（`modulePath` 等），因此后端导入不会新增循环。

**注意**：本文件目前**没有被任何端消费**（全仓 grep 只命中定义自身）。
在三端真正接入之前，它只是「文档 + 类型」，不会自动修正任何页面文案。

### 7.5 维护规则

1. **改服务状态必须同时改两处**：`packages/contracts/src/campus-services.ts`
   与本文；其他任何地方（页面文案、`delivery.ts`、README）不得再写一份
   「哪些服务已接通」。
2. **`mode` 是快照**：它描述审计基线 `d8979d4` + 默认 `CAMPUS_DATA_MODE=mock`。
   运维切 live 后必须更新它，否则三端会继续显示「演示」。
3. **`authorization: 'granted'` 必须能指向书面文件**（邮件/批复编号/日期），
   写进 `authorizationNote`；口头同意不算。
4. **`wiring: 'end-to-end'` 必须有 e2e 测试**；没有测试就只能是 `partial`。
5. **不写 URL、不写密钥值**：`envKeys` 只放变量名；值放环境变量/密钥管理。
6. **不把 TechPie 标成 live**：除非真的接了上游客户端并有 e2e；
   本地绑定状态机不是「上游已接通」。

---

## 8. 附录

### 8.1 校园相关环境变量总表

| 变量 | 读取处 | 作用 | 现状 |
| --- | --- | --- | --- |
| `CAMPUS_DATA_MODE` | `auth.module.ts:90` | 第二级取数选 Mock / Http | 默认 `mock`；**不控制第一级 CAS** |
| `CAMPUS_SESSION_ENC_KEY` | `prisma-campus-session.adapter.ts:32`、`campus-session.service.ts:288` | 校园会话/凭据的 AES-256-GCM 密钥 | 必填；缺失抛错 |
| `CAMPUS_UPSTREAM_TIMEOUT_MS` | `http-campus-data.adapter.ts:87` | 上游超时（默认 6000） | 可用 |
| `CAMPUS_EGATE_DATA_URL` | `http-campus-data.adapter.ts:74-84` | eGate 取数 base URL | 空；**地址未确认** |
| `CAMPUS_JWC_DATA_URL` | 同上 | JWC 取数 base URL | 空；**地址未确认** |
| `CAMPUS_CARD_DATA_URL` | 同上（platform=`CARD`） | 校园卡快照 base URL | 空；`fetchCard` 无调用点；**地址未确认** |
| `CAMPUS_CPDAILY_DATA_URL` | **没有代码读取** | 预留的 CpDaily 地址 | 不存在于 `.env.example`；**未确认** |
| `CAMPUS_CAS_URL` | `mock-campus-auth.provider.ts:68`（仅 `describeUpstream()`） | CAS serviceValidate / 登录地址 | `.env.example:17` 有仓库既有值，**未经校方确认**；`describeUpstream()` 在生产代码中无调用方 |
| `CAMPUS_SSO_CLIENT_ID` | 同上 `:69` | OAuth/CAS 客户端 id | `.env.example:18` 有占位值；未使用 |
| `CAMPUS_SSO_CLIENT_SECRET` | **没有代码读取** | OAuth/CAS 客户端 secret | `.env.example:19` 有占位值；真实客户端不存在 |
| `CAMPUS_CAS_MOCK_ALLOWED` | `mock-campus-auth.provider.ts:84` | 生产环境临时打开 Mock CAS | 默认未配；**不要在生产配** |
| `WECHAT_MINIAPP_APPID` / `WECHAT_MINIAPP_SECRET` | `wechat-miniprogram.adapter.ts` | 微信 `code2session`（校园卡 OPENID 真实通道需要） | 空；未配时走 `dev:` 模拟 |
| `CAMPUS_AUTH_MODE` | **不存在（建议新增）** | 第一级 CAS mock/live 切换 | 当前没有；`AUTH_PORT` 恒 Mock |
| `CAMPUS_TECHPIE_*` | **不存在** | TechPie 上游地址/凭据 | 没有上游客户端 |

### 8.2 未确认 / 需要校方或对方提供的清单

| # | 未确认项 | 影响 | 找谁 |
| --- | --- | --- | --- |
| 1 | 学校是否允许第三方代持校园会话（CASTGC） | 阻塞 eGate / CpDaily / JWC 的绑定与会话来源（U7） | 学校信息化办 |
| 2 | CAS `serviceValidate` / OAuth 端点、字段、客户端注册流程 | 阻塞第一级真实登录 | 信息化办 / CAS 管理员 |
| 3 | eGate 数据接口地址与 JSON 形状 | 阻塞实名取数 | 信息化办 / eGate 管理员 |
| 4 | CpDaily 课表/通知接口地址、字段、账号体系 | 阻塞课表/通知 | 信息化办 / CpDaily 管理员 |
| 5 | JWC 课表接口地址、字段、学期编码 | 阻塞教务同步 | 教务处 / 信息化办 |
| 6 | eCard OPENID 授权流程、余额/流水 API、付款码通道 | 阻塞校园卡取数与付款码 | 校园卡中心 / 信息化办 |
| 7 | TechPie / GeekPie 上游 API、续期能力、场馆预约能力 | 阻塞 TechPie 互联（U8） | GeekPie / HeZeBang |
| 8 | 校园域名白名单的真实 host/port 列表 | 阻塞 WebView 直连（U11） | 信息化办 / 技术调研 |

> 以上 **全部未确认**。本文不提供猜测地址；仓库里已有的
> `https://cas.shanghaitech.edu.cn/cas`、`https://ecard.shanghaitech.edu.cn`、
> `https://ecourse.shanghaitech.edu.cn[:8080]` 等是**既有占位/参考值**，
> 不构成授权或确认。

### 8.3 本次审计的边界（再强调一次）

- **没有真实凭据**，所以「live 能不能通」只能从代码路径判断，不能从联调判断。
- **没有改功能代码**；`packages/contracts/src/campus-services.ts` 是本文的结论文件。
- **没有 commit / push**；改动留工作区。
- **没有碰 `apps/` 与 `services/api/src/`**。
- **没有编校方地址**；所有未知项都写「未确认，需要校方提供」。

### 8.4 一句话给决策者

> 现在**不要**把 `CAMPUS_DATA_MODE` 切成 `live`。先把 P0-1（两套 session port/表）
> 和 P0-2（schedule 守卫平台）修掉，再拿 U7/U8 的书面授权，按 §3 的逐系统步骤
> 一个一个接；每接一个，就把 `CAMPUS_SERVICES` 里对应条目的
> `mode` / `wiring` / `authorization` 改一次，并用 e2e 测试钉住。
