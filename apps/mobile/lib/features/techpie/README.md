# feature: `techpie`（TechPie 整合）· Phase 0

契约 §4.1 的 `techpie`（敏感级：**中**，**无同意门**）与 §4.2 的 `campus-card`（敏感级 **高**，
同样**无同意门** —— 登录/开卡这个行为本身就是同意，契约 §9）。
规格文档：`docs/features/techpie-integration.md`（§2.5 校园卡 OPENID / §4 两级身份 /
§8 API / §9.1 Phase 0 / §10.3 日志脱敏）。
Lead 裁决：`docs/architecture/00-FROZEN-CONTRACT.md` §11.18（TechPie 整合裁决）。

> **本轮只做 Phase 0。** Phase 1（结构化校园数据）阻塞于信息办书面回复；
> Phase 2（场馆预约 / 会话注入）依赖 Phase 1；Phase 3（自动续期）依赖 GeekPie 确认。
> **尤其：在信息办书面批准前，不实现任何校园会话（CASTGC）落库路径。**
> 这不是"先做着等批准"—— 一旦落库，就有了一个未经授权的凭证副本，
> 事后清理无法消除已经发生的风险（契约 §11.18-D）。

---

## 1. 该模块的 ports（以及**三个不属于它**的 port）

| 端口 | 位置 | 层级 | 说明 |
| --- | --- | --- | --- |
| `TechpiePort` | `lib/domain/ports/techpie_port.dart` | 第二级 · 能力层 | 绑定元数据 / 能力清单 / 一次性 WebView 票据 |
| `CampusCardPort` | `lib/domain/ports/campus_card_port.dart` | 第二级 · 能力层（**另一条通道**） | 校园卡的 OPENID 通道（规格 §2.5） |
| `WebViewPort` | `lib/domain/ports/webview_port.dart` | 平台适配 | **只接受一个 URL** 的 WebView 宿主 |

**刻意不放在本模块的三个端口**（边界本身就是交付物）：

| 端口 | 为什么不在这里 |
| --- | --- |
| `AuthPort`（一级身份） | 契约 §5 硬规则 1：它**不知道**任何校园会话/绑定。绑定管理页只从 `sessionControllerProvider` 读"有没有登录"这一个布尔 |
| `CampusSessionPort`（既有二级端口） | 它是**校园会话代持链路**的端口（含 `cookieHeaderFor`）。本模块的 Phase 0 **不接触**会话，因此不复用它、也不扩展它 |
| `ConsentPort` | `techpie` 敏感级是**中**，契约 §9 的同意门只适用于 `wellbeing` / `dorm-harmony` / `ai-portrait`。因此本模块**不会**返回 `CONSENT_REQUIRED` |

实现（适配器）：

| 实现 | 位置 | 用途 |
| --- | --- | --- |
| `RemoteTechpieRepository` | `lib/data/repositories/remote_techpie_repository.dart` | `/api/v1/techpie/*`；写操作带 `Idempotency-Key` |
| `MockTechpieRepository` | `lib/data/mock/mock_techpie_repository.dart` | 内存实现，**默认装配**，无后端可跑 |
| `RemoteCampusCardRepository` | `lib/data/repositories/remote_campus_card_repository.dart` | `/api/v1/campus-card/*`（**形状是客户端侧假设**，见 §7） |
| `MockCampusCardRepository` | `lib/data/mock/mock_campus_card_repository.dart` | 内存实现，**默认装配** |
| `MethodChannelWebView` | `lib/platform/method_channel_webview.dart` | 原生宿主（channel `kedaya/webview`；**原生侧未实现**，返回 false 并降级） |
| `InMemoryWebViewPort` | `lib/data/mock/mock_webview_port.dart` | mock 运行时的宿主（记录被要求打开的 URL，供测试断言） |

端口方法 ↔ HTTP：

| 方法 | HTTP | 备注 |
| --- | --- | --- |
| `listLinks()` | `GET techpie/links` | 只含元数据；**不含** 8 个凭证键名（规格 §8.3） |
| `bind(platform, credential)` | `POST techpie/links` | 幂等键必需；Phase 0 **只接受免口令凭据** |
| `unbind(linkId)` | `DELETE techpie/links/:id` | 幂等（不存在也算成功） |
| `renew(linkId)` | `POST techpie/links/:id/renew` | **手动**续期（契约 §11.2 的 `techpie.renew`）；F3 时返回 `RENEW_NOT_SUPPORTED` |
| `listCapabilities()` | `GET techpie/capabilities` | 响应形状**未在规格中给出**（见 §7） |
| `createWebViewSession(platform, targetUrl)` | `POST techpie/webview-session` | 一次性票据，30 秒（规格 §8.4） |
| `redeemWebViewTicket(ticket)` | `GET techpie/webview-session/:ticket` | 换一次性中转 URL；票据**只能成功用一次** |
| `CampusCardPort.*` | `campus-card/*` | 余额 / 流水 / 付款码 / 开通 / 解除开通（形状见 §7） |

**`webview-session` 不是领域动作**：它创建的是一个**一次性票据资源**，
因此不是 `POST /techpie/links/:id/<action>` 形状（契约 §11.18-A 接受该形状）。
`techpie` 的领域动作仍然只有 `renew` 一个。

---

## 2. 用例（application 层）

`lib/features/techpie/application/techpie_providers.dart`：

| provider | 作用 |
| --- | --- |
| `techpieLinksControllerProvider` | 我的绑定列表（三态 + 下拉刷新） |
| `campusCapabilitiesProvider` | 能力清单：把**服务端可用性**与**我的绑定情况**合并 |
| `campusCardControllerProvider` | 校园卡：开通状态 + 余额 + 流水（**不含**付款码） |
| `campusPaymentCodeProvider` | 付款码（`autoDispose`：**离开页面即丢弃**） |
| `campusWebEntriesProvider` | Phase 0 的四个直连入口（客户端侧目录） |
| `techpieActionsProvider` | 写操作：绑定 / 解绑 / **手动**续期（不持有 Ref） |
| `techpieWebViewLauncherProvider` | WebView 直连用例（**票据只在栈上**） |

**状态推导是纯函数**（`lib/domain/models/campus_capability.dart` 的
`resolveCampusCapabilities`），规则按优先级：

1. `phase != phase0` → `NOT_IMPLEMENTED`（Phase 1–3 即使上游说可用也**不谎称**已实现）；
2. 服务端显式状态 → 用它；但若它说 `AVAILABLE` 而所需平台**没绑定**，降级为
   `CAMPUS_BINDING_REQUIRED`（让用户看到可行动的出路）；
3. **未登录** → `UNAUTHENTICATED`（这一条**必须**排在绑定判断之前）；
4. 不依赖平台 → `AVAILABLE`；
5. 平台已绑定且未过期 → `AVAILABLE`；
6. 否则 → `CAMPUS_BINDING_REQUIRED`（**已登录但未绑定是合法状态**）。

`TechpieActions` 与 `TechpieWebViewLauncher` 都**不持有 `Ref`**（只拿端口 + 回调），
因此能在测试里直接构造。

---

## 3. 两级身份的边界（**Phase 0 的核心交付**）

契约 §5 / §11.4 的不变式在本端这样落地：

| 不变式 | 本端落点 | 机械验证 |
| --- | --- | --- |
| **I1** 身份层不含 8 个禁用键 | `AuthSession` 与 `CampusBindingSummary` 的 `toJson()` 键名封闭 | `test/domain/auth_session_boundary_test.dart`（既有）+ `techpie_credential_boundary_test.dart`（新增） |
| **I2** 身份层不返回校园凭据 | `techpie_port.dart` **没有**取会话串的方法；`auth_port.dart` 不出现绑定概念 | `techpie_two_tier_boundary_test.dart`（源码扫描） |
| **I3** 校园会话串只有一个受限出口 | 本模块**不新增**任何出口：Phase 0 根本不需要会话串 | `techpie_source_invariants_test.dart`（扫描本模块源码里没有 `cookie` 相关代码） |
| **I4** 已登录但未绑定是**合法状态** | `CAMPUS_BINDING_REQUIRED`(409) 与 `UNAUTHENTICATED`(401) 是**两个不同枚举值**、两套文案、两条出路 | `campus_capability_test.dart` + `mock_campus_card_repository_test.dart` |
| **I5** 同步 hydrate 供首帧 | 本模块**不参与**首帧关键路径（能力清单是首帧之后的二次加载） | 既有 `bootstrap.dart` 时序不变 |

**"两个独立 port"的机械保证**：除装配层 `lib/app/` 外，
**没有任何文件同时 import `auth_port.dart` 与 `techpie_port.dart`** ——
因此 presentation 层拿不到任何"同时持有两级身份"的对象。
测试：`test/domain/techpie_two_tier_boundary_test.dart`。

---

## 4. 凭证、票据与日志（规格 §10.3 的落点）

| 内容 | 处理 |
| --- | --- |
| 绑定响应 | 只解析白名单键（`platform` / `status` / `externalUserId` / `expiresAt` / `lastSyncAt` / `id`）。服务端即使多返回 `sessionCipher`，客户端也**不读取** |
| `BindCredential` | `sealed`，**只有** `OAuthCodeCredential` 与 `OpenIdCredential` 两个子类 —— **没有口令变体**，因此"写一条明文口令绑定路径"在类型上做不到（契约 §11.18-D / U12） |
| 凭据的 `toString()` | 全部脱敏（`<redacted>`），因此"顺手打一行日志"也不会泄漏 |
| OPENID | 只在 `connect(openId:)` 的入参里出现一次；模型里只留脱敏尾巴（`CampusCardLink.tailOf`） |
| 一次性票据 | `WebViewTicket` / `WebViewHandoff` 的 `toString()` 脱敏；`WebViewLaunchOutcome` **刻意没有**票据与 URL 字段，因此 UI 状态不可能缓存它 |
| 付款码 | `CampusPaymentCode.toString()` 脱敏；`autoDispose` provider，离开页面即丢弃；mock 实现现取现给、不落字段 |
| 日志 | 本模块（domain / data / application / presentation / platform）**零** `print` / `debugPrint` / `developer.log` |
| 持久化 | 本模块**零** `SharedPreferences` / `FlutterSecureStorage` / 文件写入 —— 因此不存在任何落库/落盘路径 |

以上每一条都有 `test/domain/techpie_source_invariants_test.dart` 的**源码机械扫描**兜底。

---

## 5. 页面（presentation）

| 路由 | 页面 | 内容 |
| --- | --- | --- |
| `/techpie` | `TechpieHomePage` | 两级身份概览（登录态 + 绑定概况）+ 四个入口 + 本轮范围与阻塞项 |
| `/techpie/bindings` | `TechpieBindingsPage` | 绑定列表（三态）+ 解绑 + **手动**续期 + 发起绑定面板（**免口令**） |
| `/techpie/capabilities` | `TechpieCapabilitiesPage` | 能力清单（按 Phase 分组）+ 概览计数 + **两种不同的出路**（去绑定 / 去登录） |
| `/techpie/webview` | `TechpieWebViewPage` | 四个直连入口 + 白名单占位提示 + 票据语义说明 + 打开结果（不含票据） |
| `/campus-card` | `CampusCardPage` | 未登录 → 去登录；已登录未开通 → OPENID 开通引导；已开通 → 余额 / 付款码 / 流水 |

组件：`techpie_cards.dart`（状态徽章 / 绑定卡 / 能力卡 / 余额卡 / 流水行 / 付款码卡 /
「不含凭证」说明 / 「两级身份」说明）。

### 三态

所有列表/详情走 `AsyncStateView`（loading / error / empty / data）。
mock 运行时时右上角 🧪 菜单可切换 **正常 / 空列表 / 上游故障**。

### 亮暗主题

组件颜色**全部**来自 `KedaYaColors`（生成的设计令牌），因此亮暗两套自动可用；
源码里没有任何硬编码色值（`tool/selfcheck.py` 的 `hardcoded-color` 检查兜底）。

---

## 6. 已实现 / 未实现

**已实现（Phase 0）**：

- `TechpiePort` 的 7 个方法 + `CampusCardPort` 的 6 个方法 + `WebViewPort`；
- 两套适配器（远端 / mock）+ 平台 WebView 适配（MethodChannel，原生侧未实现）；
- 5 个页面 / 5 条路由 + 组件；
- 能力清单的**纯函数**状态推导（含 Phase 1–3 的诚实标注）；
- 目标地址的 **fail-closed** 客户端校验（https / 精确白名单 / 无 IP 字面量 /
  443 端口 / 无 userinfo）。

**未实现（如实列出，没有用 TODO 占位）**：

| 项 | 说明 |
| --- | --- |
| Phase 1：课表 / 考试 / DDL 聚合 | **阻塞于信息办书面回复**（U7）。不实现任何会话落库路径 |
| Phase 2：场馆预约、WebView 会话注入（W3） | 依赖 Phase 1 + W3 可行性实测 + 信息办确认 |
| Phase 3：自动续期 | 依赖 GeekPie / HeZeBang 确认（U8）。本端口**只有手动续期** |
| 绑定用的授权码获取流程 | 需要原生侧（或小程序宿主）拉起校园系统授权页；**原生侧未实现**。mock 运行时有一个明确标注"（mock）"的模拟按钮 |
| 校园卡的 OPENID 获取流程 | 同上：真实 OPENID 必须来自 eCard 官方授权流程。**本端不伪造 OPENID**（真实运行时按钮不可用） |
| `webview-session` 的限流（10 次/分钟） | 服务端职责；客户端不假装实现 |
| 同步任务列表（`GET /techpie/sync-jobs`） | 规格 §8.1 有该端点，但 Phase 0 没有同步任务（Phase 1 才有），因此**不建假页面** |

---

## 7. 与规格的偏离 / 需要裁定（**本端没有改 `docs/` 与 `packages/`**）

> 下面几条在**读取 `services/api` 的实现后**做过一轮对齐（§9），
> 因此"形状假设"的范围比初版小得多；剩下的差异都写明了**是谁的哪一行**。

1. **校园卡的 HTTP 端点没有任何规格定义**，两边也**不一致**：
   `services/api` 的 `campus-card` 是脚手架生成的通用 CRUD
   （`items` / `summary`，且 `summary` 是汇总不是余额），
   而本端需要的是"开通 / 余额 / 流水 / 付款码"。
   校园卡的**开通**在后端走 `POST /techpie/links` + `platform=ecard` +
   `credential.kind=openid`（本端的 `CampusCardPort.connect` 与之不同）。
   **这是一处需要 Lead 收敛的真实缺口**（§9.4–9.6），本端不假装它已对齐。
2. **`GET /techpie/capabilities` 的响应形状**规格未给出；`services/api` 实现为
   `{ items, capabilities, allowlistPlaceholder, unboundCount }`，条目是**两套客户端形状的并集**
   （`id`/`key`、`nameZh`/`title`、`status`/`state`、`blockedReason`/`reason`）。
   本端**两套键名都接受**（`CampusCapability.fromJson`）。
3. **`POST /techpie/webview-session/:ticket`**：规格 §8.4 写 `GET`，`services/api` 用 `POST`。
   本端**跟随实现**（跨端能跑通优先）。
4. **规格 §8.4 的示例地址 `https://ecourse.shanghaitech.edu.cn:8080/` 与契约
   §11.18-B 第 3 条冲突**（后者明确禁止非 443 端口）。裁决晚于规格，本端**以裁决为准**：
   该示例地址会被客户端直接拒绝（`services/api` 的 `checkCampusTargetUrl` 同样拒绝）。
5. **`credential.kind` 的取值**：规格 §8.5 只举了 `password`（Phase 1，未实现；
   `services/api` 会在 Phase 0 拒绝它）。本端的 `openid` 与 `services/api` 的
   `{ kind: 'openid', channel: 'wechat', openId }` **逐字一致**；`oauth_code`
   是本端为将来的免口令通道预留的形态，**后端尚未登记**。
6. **`CampusPlatform` 与既有 `CampusSystem` 是两套枚举**：
   `campus_binding.dart` 的 `CampusSystem`（`egate` / `cpdaily` / `academic` / `ecard`）
   是早期骨架，与契约 §11.10-B 裁决后的
   `cas | egate | cpdaily | ecard | techpie` 不一致。本端按**裁决**实现新枚举，
   没有改动既有的 `CampusSystem`（它被 `CampusSessionPort` 使用）。
   **两套枚举的合并需要 Lead 裁决。**
7. **校园卡页面按任务要求落在 `lib/features/techpie/` 下**，而 `lib/features/README.md`
   硬规则 1 要求 feature 目录名等于模块 id（`campus-card` 应自成目录）。
   本端保证该页面**只依赖 `CampusCardPort`**（不 import `TechpiePort`），
   因此整目录平移是安全的；已在交付说明里登记该偏离。
8. **`mockCampusCapabilityCatalog` 是客户端侧的阶段标注**（Phase 0 的 6 项 +
   Phase 1–3 的 6 项）。真实运行时目录来自服务端；客户端只负责**阶段判定**
   （不把 Phase 1+ 显示成可用）。
9. **白名单与入口地址是占位**：`campusDomainAllowlistIsPlaceholder` 与
   `phase0CampusWebEntriesArePlaceholder` 是**机器可见**的占位标记
   （契约 §11.18-B 第 2 条），确认实际域名后必须同时改为 `false`。

---

## 9. 与 `services/api` 的对齐（读实现后的核对结果，**只读，没有改后端**）

> 本节是"三端 wire 一致性"的实测记录。**读的是同一仓库里 `services/api` 的实现**，
> 因此它比"按规格猜"可靠；但它**不是**运行验证（本机没有后端也没有 Flutter）。

| # | 项 | `services/api` 的实际形状 | 本端 |
| --- | --- | --- | --- |
| 9.1 | 平台枚举 | `'cas' \| 'egate' \| 'cpdaily' \| 'ecard' \| 'techpie'` | ✅ 逐字一致 |
| 9.2 | 能力清单条目 | `id` / `nameZh` / `phase: 'phase0'…` / `status` / `blockedReason` / `requiredProvider` | ✅ 两套键名都接受；`phase0`（小写无下划线）与 `PHASE_0` 都能解析；`EXPIRED` → 需绑定、`PHASE_BLOCKED` → 未实现 |
| 9.3 | 能力清单的 **13 条 id** | `ecard.*` / `webview.*` / `schedule.*` / `auth.school_cas` / `facility.reservation` / `techpie.auto_renew` | ✅ mock 目录**逐字镜像**这 13 条（否则按 id 匹配的服务端状态覆盖会静默失效） |
| 9.4 | 校园卡数据端点 | ⚠️ `services/api` 的 `campus-card` 目前是 **`scaffold.mjs` 生成的通用 CRUD**：`GET items` + `GET summary`（返回 `{totalOutFen, totalInFen, count}` —— 是**汇总**不是**余额**），字段名 `happenedAt` / `direction: 'out'\|'in'` | ⚠️ **两边都还不是契约**：本端保留 `campus-card/{link,account,transactions,payment-code}` 作为**提案**（已在文档里标明），但把解析写成容错（`happenedAt`/`occurredAt`、`out`/`in`/`DEBIT`/`CREDIT` 都能读）。**需要后端给出真正的校园卡契约** |
| 9.5 | 校园卡**开通** | `POST techpie/links`（`platform=ecard` + `credential.kind=openid`） | ⚠️ 本端用 `CampusCardPort.connect`（`POST campus-card/link`）—— **后端没有该路由**，需要收敛 |
| 9.6 | 付款码 | `services/api` 里**没有**付款码路由（通用 CRUD 覆盖不到短时效凭据） | ⚠️ 本端假设 `POST campus-card/payment-code`，需要后端确认 |
| 9.7 | 票据兑换 | `POST /webview-session/:ticket` | ✅ 已跟随（规格写的是 GET） |
| 9.8 | 票据不指定平台 | `resolvePlatform()` 返回 null 时**不要求绑定**（W4 直连） | ✅ `createWebViewSession(platform: null)` + `CampusWebEntry.requiresBinding=false` |
| 9.9 | 兑换响应 | `{ url, targetUrl, mode, expiresAt: null, cookieInjected: false, reason }` | ✅ 只读 `url`/`targetUrl`/`expiresAt`；`expiresAt: null` 时用票据时效兜底；`mode`/`cookieInjected` 等键**不读取**（Phase 0 不注入会话） |
| 9.10 | 绑定凭据 | `{ kind: 'openid', channel: 'wechat', openId }`（另有 Phase 1 的 `password`，Phase 0 拒绝） | ✅ `OpenIdCredential.toWire()` 逐字一致；本端**没有**口令变体 |
| 9.11 | 8 个禁用键名 | `FORBIDDEN_CREDENTIAL_KEYS` | ✅ 本端 `techpie_credential_boundary_test.dart` 对键名做同样的递归断言 |

---

## 8. 测试

| 文件 | 覆盖 |
| --- | --- |
| `test/domain/techpie_link_test.dart` | 平台/状态枚举 wire 映射、未知值抛错、`isUsableAt`/`needsRebind`、`toJson` 键名封闭、`toString` 脱敏 |
| `test/domain/campus_capability_test.dart` | **`CAMPUS_BINDING_REQUIRED` 与 `UNAUTHENTICATED` 是两种不同状态**、6 条推导规则逐条、Phase 1–3 不谎称可用、`fromApiError` 的 F3 映射 |
| `test/domain/campus_web_entry_test.dart` | fail-closed 校验：非白名单域名 / 子域通配 / `http` / IP 字面量 / 非 443 端口 / userinfo / 畸形 URL；占位标记可见 |
| `test/domain/techpie_credential_boundary_test.dart` | 8 个禁用键名断言（递归键名扫描）、`BindCredential` 无口令变体、凭据 `toString` 脱敏、票据/付款码/中转 URL 脱敏 |
| `test/domain/techpie_two_tier_boundary_test.dart` | **类型层面**：二级实现不是一级端口；**源码层面**：`lib/app/` 之外没有文件同时 import 两个 port |
| `test/domain/techpie_source_invariants_test.dart` | **源码机械扫描**：零 cookie 注入、零日志调用、零持久化、零 CASTGC、零 Phase 1–3 能力、零自动续期 |
| `test/data/mock_techpie_repository_test.dart` | 列表/绑定/解绑/续期（含 F3）、白名单 403、未绑定 409（不是 401）、票据一次性与 30 秒时效、凭据不留在仓库 |
| `test/data/mock_campus_card_repository_test.dart` | 未开通 → 409 `CAMPUS_BINDING_REQUIRED`（**不是** 401）、开通后余额/流水/付款码、游标分页、OPENID 不留在仓库、付款码不落字段 |
| `test/application/techpie_controller_test.dart` | 三态、绑定/解绑/续期后的 provider 失效、能力清单的两种出路、校园卡控制器 |
| `test/application/techpie_webview_launcher_test.dart` | 票据流程（创建 → 兑换 → 交给宿主）、票据**不进** outcome、单次使用、超时、宿主不可用降级 |
| `test/presentation/techpie_widget_test.dart` | 亮/暗主题渲染、`CAMPUS_BINDING_REQUIRED` 显示引导而**不是**错误、`UNAUTHENTICATED` 显示登录引导、页面文案不含凭证 |

> ⚠️ **全部用例都没有在本机执行过**（本机没有 Flutter SDK）。
> 见 `apps/mobile/README.md` §6/§8 与本次交付说明的"未验证项"。
