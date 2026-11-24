# 校园真实能力 · 现状与卡点

> 2026-11-24。这份文档只写**已验证的事实**和**明确的卡点**，不写"预计"。

## 1. 已经打通的

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| CAS 服务端校验 | ✅ | `HttpCampusAuthProvider`（`/serviceValidate` XML 解析），5 例单测 |
| CAS 回调换票 | ✅ | `GET /auth/cas/callback`（ticket → 30s 单次 code）+ `POST /auth/cas/exchange`；服务器实测：无 ticket → 400，伪造码 → 401 |
| CAS 登录页 | ✅ | `/campus-login`：取 `login-url` → 浏览器登录 → 粘贴 code → 换令牌 |
| WebView 同源桥 | ✅ | `/campus-web`，`kedayaRequest` 带 id、支持 JSON 与表单；脚本不读 `document.cookie` |
| ELRC 录播 | ✅（移动端） | 课程 → 课次 → 机位 → `video_player` 播 HLS；11 例单测 |
| OA 场馆空闲 | ✅（只读，移动端） | 两级树解析，4 例单测 |
| 校园服务直达 | ✅ | E云课堂 / ELRC / EAMS / 请假 / 活动 / 场馆 |

## 2. 卡点：CAS 密码登录失败

2026-11-24 用学校账号做了一次脚本登录（`ids.shanghaitech.edu.cn` 标准表单流程：取 `execution` → POST 用户名/密码/`_eventId=submit`），结果：

- HTTP 200，但被退回 `/authserver/login`
- 没有 `ticket`
- 页面是错误页

没有重试（避免账号被风控/锁定）。可能原因：密码不一致、IDS 有验证码/设备校验、账号需二次验证。

**这条不通，后面所有"真数据"都起不来**：

| 依赖链 | 为什么 |
| --- | --- |
| OA 预约提交 | 表单要 `loginidweaver`（HttpOnly cookie），桥读不到；需要 Dart 侧持有 OA 会话 |
| 校园卡余额/流水/付款码 | 需要校园卡自己的 token，来自一次已登录的会话 |
| Gradescope 同步 | 需要 Gradescope 会话 |
| Passkey | 与校园系统无关，但它只是登录方式，不解决数据访问 |

## 3. 已选架构：A（客户端/内嵌浏览器持有会话）

2026-11-24 项目负责人确定走 A。实现方式是**内嵌 WebView 持有会话**：
cookie 留在 WebView 里，Dart 不读取；所有校园请求通过 `kedayaRequest` /
`kedayaEval` 在页面内发出（同源自动带 HttpOnly cookie）。

代价与配套：
- `techpie_source_invariants_test.dart` 里"源码不得出现 cookie"的断言仍然成立
  （我们确实不读 cookie），但要接受"会话由页面持有"这一事实；
- 需要用户在应用内登录一次，会话随 WebView 生命周期存在；
- 桌面/鸿蒙没有 WebView 插件，相关真实能力仅移动端可用。

已在此架构下完成：ELRC 全链路、OA 场馆空闲查询、**OA 场馆预约提交**
（`OaGymClient.book`：读 `loginidweaver` → POST 工作流 14862 → 按 `wfforward(`
判定成功；提交超时**不重试**，提示先去 OA 核对）。

### 3.1 两条备选架构（历史记录）

### A. 客户端持有会话（TechPie 的做法）

CAS 登录后用 Dart HTTP 客户端跟随跳转、在内存/加密存储里保存各站 cookie，直接请求接口。

- 优点：预约、校园卡、Gradescope 都能做；桌面端也能用
- 代价：**推翻了本仓库"凭证只进 techpie 端口、不落库"的约束**，需要改
  `techpie_source_invariants_test.dart` 与相关文档；必须配套加密存储、切号清空、审计

### B. 服务端代持（本仓库原本的方向）

服务端用用户 ticket/密码建立会话，客户端只调我们自己的 API。

- 优点：客户端零凭证，桌面/鸿蒙也能用；密钥集中在服务端
- 代价：服务端要能访问校园系统（5090 服务器可以）；需要 CAS 回调注册与用户授权；仍要解决"密码登录失败"

两条都需要先解决第 2 节的登录问题。建议先用浏览器手动确认账号在 IDS 可用：
`https://ids.shanghaitech.edu.cn/authserver/login?service=https://egate.shanghaitech.edu.cn/login`。

## 3.2 校园卡：WebView 桥做不到的部分（2026-11-24 核实）

校园卡的线上接口（`ecard.shanghaitech.edu.cn`）有两条硬约束，浏览器 `fetch` 满足不了：

1. **GET 带请求体**：`/selftrade/queryCardSelfTradeList` 用 GET，但参数放在
   `{"datajson": 密文}` 的 body 里；`fetch` 对 GET/HEAD 明确禁止 body
   （`TypeError: Request with GET/HEAD method cannot have body`）。
2. **自定义头**：`session-type: uniapp`、`isWechatApp: true` 等，浏览器预检会拦。

TechPie 能这么做是因为它用 Dio（原生 HTTP）直接发请求，会话 cookie 由它自己持有。
也就是说：**校园卡必须走"Dart 侧持有会话"的 A 方案**，而不是我们现在的
"WebView 持有会话"。同一结论大概率适用于 Gradescope。

已完成的地基：`EcardCipher`（AES-ECB/PKCS7 + 头变换，9 例测试）。
下一步需要先解决 CAS 登录（拿到各站 cookie），再实现加密存储的 cookie vault。

## 3.3 校园卡绑定依赖外部服务（2026-11-24 核实）

读完 TechPie 的绑定链路后确认：`openid` 不是它自己算的，而是来自一个
**第三方绑定服务**：

- 端点：`https://ecard.shanghaitech.edu.cn/__ecard_bind/exchange`
- 请求要带一个写死在客户端里的共享密钥（`bindToken`）
- 该端点由 GeekPie 自己的部署提供（TLS 固定 + Android 隧道镜像指向它）
- 小程序里展示一次性绑定码，客户端拿码去 exchange 换 `openid`

也就是说，**校园卡真实绑定不能靠移植代码独立完成**，需要以下之一：

1. GeekPie 授权我们访问他们的 `/__ecard_bind` 服务（并接受共用那份密钥）；
2. 我们自己实现同等的绑定后端（微信小程序 + WeChat OAuth + 他们的换码协议）；
3. 校园卡系统提供对第三方开放的正式 OAuth/OPENID 接入。

在此之前，我们已完成且可验证的是：`EcardCipher`、`CampusCookieVault`、
`EcardApiClient`（账户/流水，7 例测试）。**不会**用 mock 数据冒充真实余额。

## 4. 现在就能做的（不依赖登录）

- 课表 / 考试 / DDL / ICS 导出 / 场馆本机演示 / 营养 / 失物 / 跳蚤 等本机功能
- 校园服务直达（手动登录后即用）
- 公众号单篇导入、校园邮箱活动识别（服务端只读 IMAP，独立于 CAS）

## 5. 下一步顺序（登录问题解决后）

1. 服务端代持 OA 会话 → 场馆预约提交（带"提交超时先查记录"的防重复逻辑）
2. 校园卡只读（余额/流水）→ 付款码（最后，且需校方书面确认）
3. Gradescope 同步
4. Passkey（服务端 WebAuthn）与 E2E 同步各自单独立项
