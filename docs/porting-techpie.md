# TechPie 真实校园能力移植计划

> 2026-11-24。上游：`HeZeBang/TechPie-flutter`（无 LICENSE 文件；据项目负责人转述，
> GeekPie 同学已口头允许复用其实现，校方也认可这种接入方式）。
>
> 本文件只记录**技术事实与依赖**，不是"已完成"的声明。

## 1. 已完成的地基（本轮）

| 组件 | 位置 | 作用 |
| --- | --- | --- |
| `CampusCookieJar` | `lib/data/campus/campus_cookie_jar.dart` | host 作用域的内存 cookie；支持 Max-Age/Expires、过期清理、`clear()`、toString 不泄露值 |
| `CampusHttpClient` | `lib/data/campus/campus_http_client.dart` | 自动带 Cookie 头、吸收 `Set-Cookie`；不打印头与响应体 |
| `parseCasServiceValidate` | `lib/data/campus/cas_ticket_client.dart` | 解析 CAS `/serviceValidate` 的 XML（成功取 `cas:user`，失败取 `errorCode` 属性） |

测试：`test/campus_cookie_test.dart` 9 例（隔离、过期、清空、不泄露；CAS 成功/失败/非 CAS/URL 拼装）。

### 1.1 内嵌浏览器 + 同源抓取桥（2026-11-24 新增）

`webview_flutter ^4.13.1`（最后一代支持 Flutter 3.32–3.35 的版本）+
`/campus-web?url=` 页面：加载校园页面后注入 `window.kedayaFetch`，
它用 `credentials: 'include'` 在**页面内**发请求，把 `{status, body}` 通过
`KedayaBridge` 通道回传给 Dart。

为什么不在 Dart 侧读 cookie：`CASTGC`/`JSESSIONID` 是 HttpOnly，Dart 读不到，
也不该读；只有同源页面的 fetch 会自动携带。脚本里**没有** `document.cookie`，
有单测守着这条边界。

平台：Android / iOS 可用；Windows / Linux / macOS / 鸿蒙自动降级为
「复制链接到系统浏览器」。OHOS 包在加入该依赖后仍能正常打出 25 MB HAP（插件未注册）。

## 2. 每个能力还需要什么

| 能力 | 上游实现 | 我们缺的前置条件 |
| --- | --- | --- |
| CAS 登录 | `uni_auth_service.dart` + WebView 登录 | 服务端已完成：`/auth/cas/login-url`、`/auth/cas/callback`（ticket→30s 单次 code）、`/auth/cas/exchange`；客户端已完成 `/campus-login` 页与 `AuthPort.signInWithCasCode`。**仍缺**：校方注册的回调 URL（`CAMPUS_CAS_SERVICE`）与 `CAMPUS_CAS_MODE=live` |
| 场馆预约 | `oa_gym_service.dart` + `oa_gym_local_client.dart`（OA 表单 + HTML 表格解析） | WebView 层已就位；还需要 OA 页面内的表单提交与表格解析（桌面端仍走系统浏览器） |
| ELRC 录播 | `elrc_client.dart`（5 个 JSON 端点） | ✅ WebView 层已就位（`/campus-web` + `kedayaFetch` 同源桥，Android/iOS）；**下一步**：把 5 个端点的解析搬到桥的回传上 |
| Gradescope | `assignment_service.dart` `_fetchGradescope` | Gradescope 会话（第三方登录） |
| E云课堂 / 请假 / 活动 | URL 直达 | 已做：`/campus-services` 页面（不代持 cookie） |
| 校园卡 | `features/campus_card/*`（含付款码、账单） | 校园卡协议 + 密钥；资金相关必须校方书面确认 |
| Passkey | 上游无（其 Passkey 为自有实现） | 服务端 WebAuthn（`services/api`）+ 各平台凭证配置 |
| E2E 云同步 | `sync_service.dart` | 密钥派生、冲突合并、服务端存储；建议单独 ADR |
| 桌面小组件 | `apple/` WidgetKit + Android/OHOS 原生 | 原生工程，无法在本机验证 |

## 3. 为什么不能"一次搬完"

1. **WebView 依赖**：我们的 `WebViewPort` 目前只接受一次性 URL，不接受 cookie 注入；
   上游的实现依赖 `webview_flutter` + `desktop_webview_window`，并要处理 OHOS 的 ArkWeb。
   这会改变 `test/domain/techpie_source_invariants_test.dart` 守的边界，必须显式改契约与测试。
2. **没有真实账号**：本机无法登录 IDS/ELRC/OA，任何"跑通"的断言都只能是单测 + 假服务端。
3. **资金与隐私**：付款码、账单、画像这类能力，代码之外的合规确认比代码更重要。

## 4. 建议的落地顺序

1. CAS 真实校验（后端）：`CAMPUS_CAS_SERVICE` + `parseCasServiceValidate` + 会话签发；
2. 引入 WebView 依赖与 cookie 注入，先做 ELRC 只读；
3. 场馆预约（OA 表单）；
4. 校园卡只读（余额/流水），付款码最后；
5. Passkey（服务端 WebAuthn）与 E2E 同步各开一个 ADR。
