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

## 3.3 校园卡绑定：官方域名下的 `/__ecard_bind` 端点（2026-11-24 修正）

**上一版这里写错了**：曾把 `https://ecard.shanghaitech.edu.cn/__ecard_bind/exchange`
判成「GeekPie 私有服务」。项目负责人更正：这个端点是**学校官方**的接入方式，
学校允许第三方客户端按此绑定校园卡。按更正重写如下。

事实（读 TechPie 源码 + 本机实测）：

- 端点在**校园卡域名**下：`/__ecard_bind/exchange`、`/__ecard_bind/health`
- 交换请求带 `X-Bind-Token` 共享密钥头，body 是 `{"code":"<6 位绑定码>"}`
- 成功返回 `{ok: true, openid, usertype, orgid}`；`usertype` 决定渠道，缺省 `wechat`
- 绑定码由**学校一卡通小程序**首页的「绑定码」入口一次性展示
- 该域名在校园网外解析不到，TechPie 用**系统级 DNS 覆盖**把它指到
  `119.78.254.196`（只劫持 DNS，不代理 TCP，Android/iOS/鸿蒙各一套原生实现）

本机实测（校外网络，2026-11-24）：`nslookup ecard.shanghaitech.edu.cn` 无响应；
`--resolve` 强制指向 `119.78.254.196` 后 `/__ecard_bind/health` 返回 HTTP 000
（TLS 未建立）。**结论：校外当前打不通，需校园网或镜像主机在线才能端到端验证。**

已落地（可验证）：

| 组件 | 路径 | 状态 |
| --- | --- | --- |
| 换码客户端 | `lib/data/campus/ecard_bind_client.dart` | ✅ 11 例单测（状态码映射、200 但非本服务、超时、空码不发请求） |
| 构建期配置 | `lib/data/campus/ecard_bind_config.dart` | ✅ `KEDAYA_ECARD_BIND_TOKEN` / `KEDAYA_ECARD_BIND_BASE_URL` |

两条刻意的取舍：

1. **密钥不进仓库**。`EcardBindClient` 构造时要求非空 token，未配置就抛
   `ArgumentError`；`EcardBindConfig.isConfigured` 让 UI 显示「本构建未启用绑定」，
   而不是让用户点进去等超时。
2. **200 不等于成功**。落到同一 host 的强制门户、别的服务也回 200，所以只认
   `ok == true` 且 `openid` 非空，否则报「绑定服务返回异常」。这条有单测守着。

还没做的：DNS 覆盖的原生实现（`EcardBindHijackPort` 的 Android `VpnService` /
iOS `NEPacketTunnelProvider` / 鸿蒙 `VpnExtensionAbility`）。这一步需要真机 + 校园网
才能验证，没有证据前不写「已实现」。

## 4. 现在就能做的（不依赖登录）

- 课表 / 考试 / DDL / ICS 导出 / 场馆本机演示 / 营养 / 失物 / 跳蚤 等本机功能
- 校园服务直达（手动登录后即用）
- 公众号单篇导入、校园邮箱活动识别（服务端只读 IMAP，独立于 CAS）

## 5. 下一步顺序（登录问题解决后）

1. 服务端代持 OA 会话 → 场馆预约提交（带"提交超时先查记录"的防重复逻辑）
2. 校园卡只读（余额/流水）→ 付款码（最后，且需校方书面确认）
3. Gradescope 同步
4. Passkey（服务端 WebAuthn）与 E2E 同步各自单独立项
