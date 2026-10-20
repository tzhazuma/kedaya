# 功能评估 · 校园卡付款码在原生端（Flutter / Android）的可行方案 · 含鸿蒙评估

| 项 | 值 |
| --- | --- |
| 文档 | `docs/features/techpie-native-payment-code.md`（新建，v1 · 2026-10-20） |
| 模块归属 | `campus-card`（契约 §4.2）、能力来源参考 `techpie`（§4.1） |
| 上游文档 | [`techpie-integration.md`](./techpie-integration.md) §2.5 / §6.5 / §10.3；[`00-FROZEN-CONTRACT.md`](../architecture/00-FROZEN-CONTRACT.md) §1 / §11.19-B / §11.21-B；[ADR 0003](../adr/0003-mobile-framework.md) |
| 本轮性质 | **设计与可行性评估**。不联网、不做 DNS 操作、不写任何会实际发请求的代码路径 |
| 落地物 | 一个**纯 domain 层**的三态骨架（`apps/mobile/lib/features/techpie/domain/`），25 条测试 |
| 不做什么 | 不实现 TechPie 的 DNS 隧道；不实现"原生直连 eCard"；不改 `apps/miniapp` / `services/api` / `packages/`；不落盘任何凭据、Cookie、CASTGC |

---

## 0. 结论速览

| # | 问题 | 结论 | 依据 |
| --- | --- | --- | --- |
| 1 | Android 上做 DNS 拦截需要什么权限？ | 只有 **`VpnService`** 这一条现实路径；改系统 DNS 普通应用**做不到**。`VpnService` 不需要运行时权限，但需要 **service 声明 + `BIND_VPN_SERVICE` + 用户一次性系统授权 + 前台服务**，且设备上只能同时有一条 VPN | §3 |
| 2 | TechPie 的「仅 DNS 隧道」在 Android 上怎么实现？ | 原生 Kotlin `VpnService` + 自己解析/构造 DNS 报文（UDP 53），Dart 侧只能经 `MethodChannel`/FFI 调用。**我们的仓库里连 `android/` 工程都只是生成物**（§2.2），等于从零写一个 VPN 应用 | §3.2 |
| 3 | 这在合规上是什么性质？ | **绕过学校系统设计意图的技术措施**：在用户设备上改写对学校域名的解析，用它去兑换学校签发的绑定码。风险等级按既有清单是**高**，且**能力的存在不等于授权的存在** | §4 |
| 4 | 有不劫持的替代路径吗？ | 有：① 走**正式接口/书面授权**（唯一能到 `available` 的路）；② WebView 打开 eCard 官方页面（用户自登录）；③ 只做余额/流水；④ 维持现状（服务端 503，机器可见 `upstreamReady: false`） | §5 |
| 5 | 原生端现在能拿到真付款码吗？ | **不能**。服务端对 `/campus-card/payment-code` 直接返回 `503 UPSTREAM_UNAVAILABLE`，`details.upstreamReady = false`，常量 `CAMPUS_CARD_PAYMENT_CODE_UPSTREAM_READY = false` | §2.1 |
| 6 | 鸿蒙（HarmonyOS NEXT）？ | Flutter 侧**有** fork 路径（OHOS `flutter_flutter` + `flutter build hap`），但**本项目未实测**；Android 的 `VpnService` 在 NEXT 上**不存在**，DNS 隧道方案在鸿蒙**没有已知可行路径**，且本就不推荐 | §7 |

> **一句话**：技术上天花板是"能写，但不该写"；产品上唯一的正路是**拿到学校正式接口**。
> 本轮把"为什么现在不能做"写成了**类型**（三态 + 只有一个 Ok 来源），而不是注释。

---

## 1. 这份文档的边界

1. **没有 TechPie 源码可读**：`/tmp/techpie-ref` 在本机**不存在**
   （`ls /tmp/techpie-ref` 返回非零）。因此本文对 TechPie 内部机制的一切描述
   都是**转引**规格 §2.5 已记录的行号引用，**未经我独立核实**。凡涉及它的
   具体实现，文中一律标注「转引，未核实」。
2. **只读代码，不发请求**：本文没有访问 `ecard.shanghaitech.edu.cn`，也没有
   建立任何隧道。所有 Android/鸿蒙 API 的描述都标注了「确认 / 未验证」。
3. **不改他人作用域**：`apps/miniapp`、`services/api`、`packages/` 一行未改。
4. **不落盘凭据**：本轮的代码里没有任何存储调用（有源码扫描测试兜底）。

---

## 2. 现状核查（我们手上到底有什么）

### 2.1 已有的付款码链路（已接线，但不会给出码）

| 层 | 位置 | 现状 |
| --- | --- | --- |
| 端口 | `apps/mobile/lib/domain/ports/campus_card_port.dart:48` | `Future<Result<CampusPaymentCode>> paymentCode()` |
| 模型 | `apps/mobile/lib/domain/models/campus_card.dart`（`CampusPaymentCode`） | `code` / `expiresAt` / `refreshAfterSec`；`toString` 脱敏 |
| 远端实现 | `apps/mobile/lib/data/repositories/remote_campus_card_repository.dart:97-110` | `GET campus-card/payment-code`（注释记录：服务端只注册了 GET，POST 会 405） |
| 用例 | `apps/mobile/lib/features/techpie/application/techpie_providers.dart:209-217` | `campusPaymentCodeProvider`，`autoDispose`（离开页面即丢弃） |
| 服务端 | `services/api/src/modules/campus-card/campus-card.service.ts:141-170` | 校验 eCard 绑定后**直接抛 503**：`reason: 'CAMPUS_CARD_PAYMENT_CODE_NOT_WIRED'`、`upstreamReady: false`、`blockedBy: ['U7','U11']` |
| 机器可见开关 | `services/api/src/modules/campus-card/domain/campus-card.domain.ts:121` | `CAMPUS_CARD_PAYMENT_CODE_UPSTREAM_READY = false` |

**裁决依据**：契约 §11.21-B（`00-FROZEN-CONTRACT.md:1177-1200`）明确
"**在真实校园卡通道打通前，服务端返回 `UPSTREAM_UNAVAILABLE` 而不是假数据**"。

所以：**今天原生端不存在任何"能拿到真付款码"的路径**。谁在 APK 里让付款码显示出来，
谁就是在显示 mock 数据 —— 这一点必须在 UI 上继续如实标注。

> ⚠️ 一个**需要 Lead 裁决的小矛盾**：服务端把付款码阻塞项写成 `blockedBy: ['U7','U11']`，
> 而客户端 `campus_capability.dart` 里 `U7` 的注释是"学校是否允许第三方**代持校园会话**"。
> 付款码**不需要** CASTGC（规格 §2.5），用 U7 描述它会让"缺什么"变得含糊。
> 建议登记一个专门的阻塞项（例如"U14 · 校园卡付款码正式接口"），而不是复用 U7。

### 2.2 平台与工程现状

| 端 | 契约要求（`00-FROZEN-CONTRACT.md:20`） | 实际交付 | 本机可验证 |
| --- | --- | --- | --- |
| 微信小程序 | 主端 | ✅ 完整（AGENTS.md 列的 20 个模块） | ✅ |
| Web | ✅ | ✅ 拼单切片 + 管理后台占位 | ✅ |
| Flutter · Android | ✅ | Dart 侧代码完整（680 例测试）；`apps/mobile/android/` 是 `flutter create` 的**生成物**，`apps/mobile/README.md:25-37` 明确"**原生工程目录没有提交**" | ⚠️ 只有 `android/` 在磁盘上，`ios/`、`ohos/` **均不存在** |
| Flutter · iOS | ✅ | 同上，`ios/` 目录不存在 | ❌ |
| Flutter · 鸿蒙 | ✅ | 同上，`ohos/` 目录不存在 | ❌ |

`pubspec.yaml:3` 的 description 写着"Flutter 原生端 iOS / Android / 鸿蒙"，
`lib/platform/platform_info.dart:4-47` 也预留了 `harmony` 分支（按 `TargetPlatform.name == 'ohos'` 判定）。
**这是"设计上支持"，不是"已经能跑"。** 本文按后者写。

### 2.3 Android 清单现状（做 DNS 拦截要从这里"从无到有"）

`apps/mobile/android/app/src/main/AndroidManifest.xml`（45 行）：

- 没有任何 `<uses-permission>`；`INTERNET` 只出现在 `debug/` 与 `profile/` 的清单里（开发用）；
- 没有 `<service>` 节点，**更没有** `android.permission.BIND_VPN_SERVICE`；
- SDK 级别来自 Flutter 默认值（`android/app/build.gradle.kts:27-28` 用
  `flutter.minSdkVersion` / `flutter.targetSdkVersion`；本机 Flutter 3.35.1 的默认值是
  `minSdk = 24` / `targetSdk = 36` / `compileSdk = 36`，见
  `$HOME/toolchains/flutter/packages/flutter_tools/gradle/src/main/kotlin/FlutterExtension.kt:26,34`）。

**含义**：`targetSdk = 36` 意味着 Android 14/15 的前台服务与后台限制**全部适用**
（见 §3.1 的用户可见成本）。

---

## 3. 问题一：Android 上做 DNS 拦截需要什么

### 3.1 三条可能的技术路径（逐条给"用户看得见的成本"）

| 路径 | 需要什么 | 用户可见成本 | 能做到"仅 DNS"吗 | 结论 |
| --- | --- | --- | --- | --- |
| **A. `VpnService`** | ① 一个 `Service` 子类，声明 `android:permission="android.permission.BIND_VPN_SERVICE"`；② 首次使用调 `VpnService.prepare()` → **系统弹窗**"允许 XXX 设置 VPN 连接"；③ 前台服务 + 常驻通知；④ 自己读写 tun 的文件描述符 | **钥匙图标常驻通知栏**；设备上**同时只能有一条 VPN**（用户若已开校园 VPN/代理，必须二选一）；部分 ROM 会在每次重连时再弹一次；企业/MDM 设备可能被策略禁用；应用商店对 VPN 类应用有额外审核 | ✅ 技术上可以（见 §3.2），代价是**实现必须完全正确** | **唯一可行路径**，但用户成本最高 |
| **B. 改系统 DNS** | 普通 APK **没有**任何 API 能改全局 DNS。`Settings.Global` 的 DNS 设置写入需要 `WRITE_SECURE_SETTINGS`（`signature\|privileged`，只有系统应用/ADB 能拿到）；Wi-Fi 静态 DNS 要用户手改每一条网络、且 Android 10+ 的"私人 DNS"设置会覆盖 | 需要用户手动进设置逐网络修改，离开该 Wi-Fi 就失效 | 可以，但**不是我们的应用能做到的** | ❌ **不可行**（不是权限问题，是根本不允许） |
| **C. 应用内自定义解析（不建 tun）** | Dart 的 `HttpClient` / `dio` **不支持**自定义 DNS；要自己实现 DNS 查询再直连 IP，同时在 TLS 层保留 SNI/证书校验。Dart 侧 `HttpClient` 的 `connectionFactory` 是否足以承载"自行解析 + 保留主机名校验"，**我未在本机验证** | 用户**看不到**任何成本（也不需要授权） | ✅ 不需要隧道 | ⚠️ **只绕过"DNS"这一环**，在合规上并不比 A 更干净（§4 同样的性质），且技术不确定性高 |

> **关键点**：路径 B 之所以写出来，是因为"改系统 DNS"是很多人第一反应。
> 它**在 Android 上对普通应用不成立** —— 这正好说明 `VpnService` 是唯一通道，
> 而它恰恰是用户成本与合规成本最高的那一条。

### 3.2 TechPie 那条「仅 DNS 隧道」在 Android 上具体怎么实现

先说**我们知道的**（转引规格 §2.5，未核实）：

> `ecard_bind_hijack.dart:52`：`static const host = 'ecard.shanghaitech.edu.cn'`；
> `:41-47` 注释：**仅 DNS**，TCP 不走隧道，所以不代理任何流量。

再说**要把它在 Android 上做出来，必须自己写的东西**（这部分是 Android 平台事实，可确认）：

1. **一个原生 `VpnService`**（Kotlin/Java）。`android.net.VpnService` 是 framework 类，
   **不需要引入任何第三方依赖**；但它给到你的是 `ParcelFileDescriptor` —— 一个装着
   **原始 IP 包**的 tun 设备。
2. **自己解析并构造 DNS 报文**。tun 里出来的是 IP 包，你要：剥 IP/UDP 头 → 解析查询的
   域名 → 决定返回哪个 A/AAAA 记录 → 构造响应包写回 tun。`VpnService` **不提供**任何
   DNS 帮助类。要么自己写一个最小 DNS 编解码（A/AAAA/CNAME + TCP 截断处理），
   要么引入 dnsjava 之类的库（这会新增一个原生依赖）。
3. **"仅 DNS" 的路由写法**：典型做法是给 tun 配一个私有地址、把
   `addDnsServer()` 指向自己、只把**该地址**的路由 `addRoute()` 进 tun。
   这样只有发往本机 DNS 的包进入 tun，普通 TCP 仍然走物理网卡 ——
   这就是"TCP 不走隧道"的技术含义。⚠️ `Builder.establish()` 对
   address/route 组合的约束随版本变化，**具体组合需实测**。
4. **前台服务 + 通知**：Android 8+ 的后台服务会被杀；VPN 必须前台化并挂常驻通知。
   ⚠️ `targetSdk = 36` 下前台服务必须声明**类型**，VPN 类应用该用哪个类型
   （`specialUse` 还是专用类型）**我未核实**，需要按目标 SDK 实测。
5. **Dart ↔ 原生桥**：Dart 侧**不能**直接建 tun（`dart:io` 没有这个能力），
   只能经 `MethodChannel`（仓库已有先例：`lib/platform/method_channel_webview.dart`，
   而且它的注释写着"原生侧实现未写"）或 FFI。
6. **必须处理但容易漏的三件事**：
   - **IPv6**：只劫持 A 记录时，客户端走 AAAA 就绕过了；
   - **Private DNS（DoT，Android 9+）**：系统可能改用加密 DNS 到指定主机名，
     你的 UDP 53 拦截会失效 —— **它和 `VpnService` 的交互我未在本机验证**，
     这是最容易让方案"在别人手机上不生效"的点；
   - **另一条 VPN 已存在**：Android 同时只允许一条 VPN，用户开着校园 VPN 时直接失败。

**所以"需要打包什么依赖"的答案是**：原生侧零第三方依赖（`VpnService` 是 framework），
但**要自己写一个 DNS 服务器**。工程量不是"加一个包"，而是"在 APK 里塞一个网络中间件"。

### 3.3 我们**不知道**的部分（必须说清）

- **劫持后把域名解析到哪个地址**：转引注释只说"仅 DNS"。如果它把
  `ecard.shanghaitech.edu.cn` 解析到一个**非学校的 IP**，那么 HTTPS 会因证书
  主机名不匹配而失败（除非那个端点持有学校域名的有效证书 —— 那就等于一次
  对学校域名的**中间人**）。如果它仍解析到学校真实 IP，那"仅 DNS"到底改变了什么、
  为什么能换到绑定码，**在没有源码的情况下我无法解释**。
- **绑定码是什么、换回来什么**：规格 §2.5 引用的
  `campus_card_service.dart:195-233` 是 `verifyOpenId()` / `connect(openId, channel)` ——
  即用绑定码换到一个 **OPENID**（长期标识）。这与我们契约 §11.19-B 的裁决**相反**：
  契约要求"只收一次性 `authCode`，**不是任何长期标识**"
  （`00-FROZEN-CONTRACT.md:1028-1042`）。

> 这两点不确定**不是文档瑕疵，而是决策依据**：一个"起关键作用但说不清原理"的
> 中间人机制，不该被写进一个要长期维护的客户端。

### 3.4 用户可见成本清单（如果真做）

| 成本 | 用户感受 |
| --- | --- |
| 一次性系统授权弹窗 | "这个校园 App 为什么要设 VPN？" |
| 常驻通知 / 状态栏钥匙图标 | 一直显示"可达鸭正在使用 VPN" |
| 与校园 VPN / 代理二选一 | 开了这个就用不了那个（或反过来） |
| 部分 ROM / MDM 直接禁用 | "在我手机上点了没反应" |
| 需要用户关掉"私人 DNS" | 需要教用户改系统设置（且很多人不会） |
| 权限撤销后功能静默失效 | "付款码时好时坏" |

---

## 4. 问题二：这条路在合规上是什么性质（直说）

### 4.1 性质

一句话：**这是一条"绕过学校系统对签发上下文的假定"的技术措施。**

学校签发绑定码的流程，隐含假定"请求来自它认可的客户端/上下文"。
TechPie 的做法是在**用户设备上**改写对学校域名的解析，让这次兑换发生在一个
学校没有预期到的路径上。无论代码写得多干净、无论是否"只代理 DNS"，
**被改变的是学校系统的输入条件**，而不是我们的实现方式。

**原生端有能力（`VpnService`）是"技术上做得到"，不是"被授权了"。**
能力与授权是两件事 —— 这正是规格 §6.5 当初写"不抄"的原因，
而那个原因**不因为换到 APK 而改变**。

### 4.2 风险清单（逐条，不回避）

| # | 风险 | 说明 | 严重度 | 代码能缓解吗 |
| --- | --- | --- | --- | --- |
| **N1** | **未获授权** | 学校没有授权第三方以这种方式接入 eCard。契约 §9 要求"全站显著标注第三方非官方"，而这类行为会加剧"看起来像官方"的观感 | **最高** | ❌ 只能靠**书面授权** |
| **N2** | **可能触及法律红线** | 在用户设备上干扰对学校域名的解析、以非预期方式获取学校系统签发的凭证，**可能**被认定为"干扰他人网络正常功能"或"未经授权访问"。具体定性需**法务**判断，本文**不下法律结论** | **最高** | ❌ |
| **N3** | **违反学校使用规定** | 校园网与 eCard 的使用条款很可能禁止此类接入；后果可能落到**具体学生的账号/学号**上，而不是项目 | **高** | ❌ |
| **N4** | **凭证性质退化** | 换回来的是 **OPENID（长期标识）**，与我们契约 §11.19-B"只收一次性 authCode"的裁决直接冲突。即使不落盘，它在内存里也等价于"代持了一份长期凭据" | **高** | ⚠️ 部分（不落盘），但"代持"这件事本身无法靠代码消除 |
| **N5** | **"只代理 DNS"无法自证** | 用户无法验证你的 tun 到底路由了什么。路由规则写错一行就变成全流量代理。信任完全建立在"相信我们"上 | **高** | ❌ |
| **N6** | **商店与分发** | Google Play 对 `VpnService` 有专门政策；国内应用市场对 VPN 类能力另有要求；iOS 需要 `NetworkExtension` 的特批 entitlement（个人/学生团队**基本拿不到**） | **高** | ❌ |
| **N7** | **脆弱且不可持续** | 依赖学校未公开的流程细节；学校一次改动（换域名、加 DoT、加风控）就全线失效，且失效时用户看到的是"码取不到" | **中** | ❌ |
| **N8** | **把风险从服务端搬到每个用户手机** | 服务端代持的风险是"一次泄漏影响所有用户"；客户端劫持的风险是"每个用户的手机上都跑着一个中间人"。**不是更安全，只是更分散** | **中** | ❌ |

### 4.3 与既有判断的关系

规格 §6.5 把"DNS 隧道劫持"列为**明确不抄**的两件事之一，理由是小程序没有这个能力
且从校园网视角是可疑流量。本文的结论是：

> **小程序做不到，不等于做到就是对的。** 原生端补上了"技术可行性"这一格，
> 但 §6.5 的三条理由里，第 ②③ 条（可疑流量、依赖设备侧能力）**原样成立**，
> 第 ① 条（小程序无 API）被替换成了一条更重的新问题：**我们要向用户申请 VPN 权限。**

### 4.4 什么情况下可以重新评估

四个条件**全部**满足才值得再谈，缺一不可：

1. **信息办/校园卡中心的书面授权**（明确允许第三方以某种方式接入 eCard，含付款码）；
2. **法务意见**（对 §4.2 的 N2/N3 给出明确结论）；
3. **PIA（个人信息保护影响评估）** —— 契约 §11.9 第 3 项至今"无责任人、未编写"；
4. **学校给出正式接口**（那时根本不需要隧道，见 §5-A）。

---

## 5. 问题三：不劫持的替代路径

按推荐顺序：

| # | 方案 | 做法 | 代价 | 风险 | 谁能拍板 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| **A** | **正式接口 / 书面授权**（首选） | 向信息办 / 校园卡中心申请 OPENID 或 OAuth 通道；服务端做令牌交换，客户端只拿短时效码 | 周期长、结果未知 | **零劫持**；仍需解决 N4（凭据代持） | 校方 | 未启动（`blockedBy` 里的 U7/U11） |
| **B** | **WebView 打开 eCard 官方页面** | 复用 Phase 0 的 W4 模式：用户在校园系统页面**自己登录**，我们**不接触**会话；码显示在学校页面里 | 不是"原生付款码"；用户要自己登录 | **低**（我们只提供入口） | 我们自己 | ⚠️ 未验证：学校页面是否允许被嵌入（`X-Frame-Options` / CSP `frame-ancestors`）、移动端是否可用、是否必须微信内打开 |
| **C** | **只做余额/流水，付款码指向官方入口** | 若将来拿到余额接口，付款码按钮改成"打开学校官方 App / 小程序" | 产品价值下降 | **零** | 我们自己 | 需要余额接口（同样未打通） |
| **D** | **维持现状** | 服务端 503 + `upstreamReady: false`；UI 如实显示"通道未接通" | 没有付款码 | **零** | 已实现 | ✅ **当前状态** |

**建议**：**A 并行推进 + B 立刻可做（先验证嵌入限制）+ D 兜底**。
B 是唯一"今天就能给用户一点价值、且零合规风险"的选项，但它需要先做一次
**只读的页面探测**（不登录、不发请求）——这超出本轮边界，登记为后续任务。

**明确不选**：TechPie 的 DNS 隧道（本文 §3/§4）、任何形式的"自建代理 + 学校域名"、任何"先把码写死等以后再接"。

---

## 6. 代码骨架（本轮唯一落地物）

### 6.1 文件与规模

| 文件 | 行数 | 内容 |
| --- | --- | --- |
| `apps/mobile/lib/features/techpie/domain/payment_code_channel.dart` | 256 | 三态枚举 + `PaymentCodeChannel` 值对象 + 服务端错误 ↔ 状态的双向映射 |
| `apps/mobile/lib/features/techpie/domain/payment_code_port.dart` | 136 | `PaymentCodeChannelPort`（`issuePaymentCode()`）+ `PaymentCodeIssuer` 空接口 + `GatedPaymentCodeChannel` 闸门 |
| `apps/mobile/test/domain/payment_code_channel_test.dart` | 382 | 25 条测试（见 §10.2） |

放在 `features/techpie/domain/` 而不是 `lib/domain/{models,ports}/` 的原因：
本轮边界允许"在 `lib/domain` 只加不改"，但这两个类型是**feature 级**的评估产物，
还没有进入契约；等 Lead 裁决后若要提升为共享领域类型，再搬到 `lib/domain/` 即可
（搬迁只需改 import，无逻辑改动）。

### 6.2 三态语义

| 状态 | wire | 含义 | 服务端对应 | 出路 |
| --- | --- | --- | --- | --- |
| `notConfigured` | `NOT_CONFIGURED` | 学校接口**未申请/未打通** | `503 UPSTREAM_UNAVAILABLE` + `reason: CAMPUS_CARD_PAYMENT_CODE_NOT_WIRED` + `upstreamReady: false` | 去申请（§5-A）或走官方页面（§5-B） |
| `requiresBinding` | `REQUIRES_BINDING` | 已登录，但**没开通校园卡** | `409 CAMPUS_BINDING_REQUIRED`（**不是 401**） | 去开通 OPENID 通道 |
| `available` | `AVAILABLE` | 正式通道已打通 | 只有真能签发时 | 取码 |

`paymentCodeNotWiredReason = 'CAMPUS_CARD_PAYMENT_CODE_NOT_WIRED'` 与
`details.reason` **逐字一致**（`campus-card.service.ts:156-165`），因此
"服务端说没接通"与"客户端认为未配置"是**同一个**状态，不会出现两套说法。

**刻意的设计**：枚举里**没有** `unauthenticated`。401 是**一级身份**的问题
（`AuthPort`），把它塞进"通道状态"会让两级身份在实现层悄悄耦合
（契约 §5 硬规则 1）。

### 6.3 为什么 `available` 不可伪造

三条机械约束（都有测试）：

1. **构造封闭**：`PaymentCodeChannel.available()` 是 const 构造，但唯一的
   **使用点**是 `GatedPaymentCodeChannel.official({required PaymentCodeIssuer issuer})`；
   `GatedPaymentCodeChannel` 的私有构造意味着外部只能走三个具名工厂。
2. **唯一的 `Ok`**：`issuePaymentCode()` 里只有一处 `Ok<CampusPaymentCode>`，
   在 `issuer.issue()` 之后；被阻塞时返回 `Err(channel.toApiError())`。
3. **源码扫描**：`lib/features/techpie/domain/` 里不许出现
   `dart:io` / `dart:ffi` / `HttpClient` / `Socket` / `Uri.parse` / `VpnService` /
   `MethodChannel` / `SharedPreferences` / `print(` / `Timer(` —— 本层物理上不具备
   联网、做 DNS、写盘的能力。

再加两条"不撒谎"的兜底：

- 上游返回**空码**时返回 `Err`（`reason: UPSTREAM_RETURNED_EMPTY_CODE`）——
  空串画出来的条码扫不出任何东西，比直接报错更糟；
- `tryFromApiError` **永远不会**把任何错误码还原成 `available`（有一条
  遍历全部 `ApiErrorCode` 的测试）。

而"一次调用失败 ≠ 通道不可用"：`503` 但 `upstreamReady: true` 时
`tryFromApiError` 返回 **null**（通道是通的，只是这次失败），不改变通道状态。

### 6.4 与既有 `CampusCardPort` 的分工（不替代）

| | `CampusCardPort.paymentCode()` | 本轮的 `PaymentCodeChannelPort.issuePaymentCode()` |
| --- | --- | --- |
| 链路 | 经 `services/api` 中转的 OPENID 通道 | 原生端**直连**（TechPie 方案）的抽象 |
| 现状 | 已接线；服务端 503 | **没有**任何实现，`official` 在仓库里零调用点 |
| 目的 | 产品功能 | 把"为什么现在不能做"变成**类型** |

**没有**把它接进 `techpie_providers.dart` / UI：本轮的交付是"评估 + 骨架"，
在信息办答复之前接线只会让用户更快看到一个 503。

---

## 7. 鸿蒙（HarmonyOS NEXT）评估

### 7.1 我们现在**支持**哪些平台

按"能跑起来"而不是"设计上有"来分：

| 端 | 支持状态 | 证据 |
| --- | --- | --- |
| 微信小程序 | ✅ **已交付**（主端） | `AGENTS.md`：20 个模块有小程序页面与后端端点 |
| Web | ✅ **已交付**（拼单切片 + 管理后台占位） | `AGENTS.md` |
| Flutter · Android | ⚠️ **Dart 侧完整，原生工程是生成物** | `apps/mobile/README.md:25-37`；本机只有 `android/` |
| Flutter · iOS | ❌ **`ios/` 不存在** | `ls apps/mobile/ios` 失败 |
| Flutter · 鸿蒙 | ❌ **`ohos/` 不存在** | `ls apps/mobile/ohos` 失败 |

契约（`00-FROZEN-CONTRACT.md:20`）要求覆盖 **iOS/Android/鸿蒙**；
**今天没有任何一个原生端是"可发布"的**。鸿蒙不是"支持得差"，而是**还没开始**。

### 7.2 Flutter 在鸿蒙 NEXT 的现状（区分"确认"与"未验证"）

**确认**（仓库内的既有记录，有引用）：

- 上游 Flutter **没有** OHOS engine；需要 OpenHarmony-SIG 的 `flutter_flutter` fork
  （channel `ohos`），产物是 `.hap`，命令是 `flutter build hap`
  （ADR 0003 `docs/adr/0003-mobile-framework.md:52-58`；`apps/mobile/README.md:442-450`）。
- 插件要换 fork：`flutter_secure_storage_ohos`（**硬 fork，不是联邦插件**，
  上游包在 OHOS 上会崩）；`shared_preferences`、`url_launcher` 等同样需要对应实现
  （`apps/mobile/README.md:445-448`、ADR 0003:296-304）。
- OHOS fork 给 `TargetPlatform` 增加了 `ohos` 成员 —— 对枚举做穷尽 `switch`
  会在该分支编译失败，因此 `lib/platform/platform_info.dart` 用字符串比较
  （`apps/mobile/README.md:449-450`）。
- CI 工具链约 **4.5GB**，hosted runner 装不下，需要容器镜像
  （ADR 0003:296-304）。

**未验证**（我**没有**在本机做任何鸿蒙构建，以下全部是"不知道"，不是"应该没问题"）：

| # | 未验证项 | 为什么不能确认 |
| --- | --- | --- |
| H1 | OHOS fork 与上游 Flutter 的**版本对应关系** | 仓库已把它登记为风险 M1（ADR 0003:363），**未实测**；可能需要回退 Dart 版本 |
| H2 | 本项目依赖的 `dio` / `flutter_riverpod` / `go_router` / `image_picker` / `intl` 在 ohos 下是否可用 | 没有 fork 版本清单，也没试过 |
| H3 | `flutter_secure_storage_ohos` 的长期维护状态 | ADR 0003:369（M7）：维护者可能停更 |
| H4 | 华为开发者资质、签名、上架流程 | 仓库里没有任何记录 |
| H5 | 真机/模拟器行为（启动、渲染、字体、权限） | 未跑过 |

### 7.3 对「付款码通道」的影响

| 项 | 结论 |
| --- | --- |
| Android 的 `VpnService` 方案能直接搬到鸿蒙吗 | **不能**。HarmonyOS NEXT 不再兼容 Android 应用与 Android API，`android.net.VpnService` 在 NEXT 上**不存在** |
| 鸿蒙有没有等价的 VPN/网络扩展能力 | 据我所知有系统级的 VPN 扩展能力（面向网络类应用），但：是否对普通应用开放、是否需要企业资质、Flutter 侧如何从 Dart 调到 ArkTS —— **全部未验证**，我不做推断 |
| iOS 呢 | 更需要 `NetworkExtension` 的特批 entitlement，学生团队基本拿不到 |
| 那我们的 domain 骨架呢 | **与平台无关**：纯 Dart、零框架依赖、零 IO。鸿蒙上跑同一份代码即可；`available` 仍然只可能由正式接口触发 |

**换句话说**：§5 的结论（走正式接口）在三个端上是**同一个结论**；
而 §3 的 DNS 隧道方案在鸿蒙上连"技术可行"都**没有已知路径**。

### 7.4 要支持鸿蒙需要做什么（清单）

| # | 事项 | 状态 |
| --- | --- | --- |
| 1 | 安装 OHOS fork 的 Flutter SDK（独立 checkpoint，与上游分开） | **确认需要**（ADR 0003 / README §7） |
| 2 | `flutter create --platforms=ohos .` 生成 `ohos/` 工程并纳入版本管理 | **确认需要**；未执行 |
| 3 | 替换/补齐 OHOS 版插件（安全存储、shared_preferences、image_picker…），必要时 `dependency_overrides` | **确认需要**；具体清单**未验证** |
| 4 | 用 ArkTS 写原生桥（WebView、定位、统一身份、剪贴板…）—— 现在 `lib/platform/method_channel_*.dart` 的**原生侧全部未实现** | **确认需要**；工作量未评估 |
| 5 | CI 用容器镜像承载 4.5GB 工具链，分平台 job | **确认需要**（ADR 0003） |
| 6 | 华为开发者账号 / 签名 / AGC 上架 | **不确定**（仓库无记录） |
| 7 | 推送（Push Kit）资质 | **不确定**；ADR 风险 M2 已登记 |
| 8 | 真机验证（含本评估涉及的付款码入口） | **未验证** |
| 9 | 若将来做付款码：鸿蒙侧是否存在可用的系统 VPN 扩展能力，以及是否值得 | **不确定**；且按 §4 的结论，**不建议** |

---

## 8. 未验证清单（汇总）

| # | 项 | 影响 | 怎么验证（建议） |
| --- | --- | --- | --- |
| V1 | TechPie `ecard_bind_hijack.dart` 的真实机制（解析到哪个 IP、如何换码） | 决定"仅 DNS"是不是一次中间人 | 拿到 `/tmp/techpie-ref` 或上游仓库后**只读**核对 |
| V2 | 绑定码换回来的是不是长期 OPENID | 决定 N4 的严重度 | 上游 `ecard_bind_service.dart` 只读核对 |
| V3 | `VpnService` 的 tun 路由组合在 targetSdk 36 上的行为 | 决定"仅 DNS"是否真能成立 | 写一个**只在本机、只对一个测试域名**的 PoC（**不在本项目里做**） |
| V4 | Private DNS（DoT）与 `VpnService` 的交互 | 决定方案在部分机型上是否静默失效 | 真机矩阵实测 |
| V5 | Android 14+ 前台服务类型对 VPN 应用的要求 | 上架/稳定性 | 官方文档 + 真机实测 |
| V6 | eCard 官方页面能否被 WebView 嵌入 | 决定 §5-B 是否可行 | **只读** HTTP 头探测（`X-Frame-Options` / CSP），不登录 |
| V7 | 鸿蒙的 VPN 扩展能力是否对普通应用开放 | 决定鸿蒙侧有没有等价路径 | 华为开发者文档 + 资质咨询 |
| V8 | OHOS fork 与本项目依赖的兼容性 | 鸿蒙端能否构建 | 装 fork SDK 后 `flutter build hap` 实测 |

---

## 9. 待 Lead 裁决的事项

1. **是否正式关闭"DNS 隧道"这条路**（本文建议：关闭，并写进 ADR 0003 的"不再评估"清单）。
   现状是它在规格 §6.5 里只是"不抄"，没有"为什么以后也不抄"的记录。
2. **付款码的阻塞项编号**：服务端用 `U7`（代持会话），而付款码不需要 CASTGC。
   建议登记一个专门的开放项，避免"缺什么"含糊（§2.1 的注）。
3. **是否启动 §5-B（WebView 打开 eCard 官方页面）**：需要一次只读的嵌入可行性探测。
4. **鸿蒙是否进入 M1**：本文只提供清单（§7.4），不评估工期。
5. **本轮 domain 骨架的归属**：留在 `features/techpie/domain/`，还是提升到 `lib/domain/`。

---

## 10. 交付说明

### 10.1 新增 / 修改的文件

| 文件 | 类型 | 行数 |
| --- | --- | --- |
| `apps/mobile/lib/features/techpie/domain/payment_code_channel.dart` | 新增 | 256 |
| `apps/mobile/lib/features/techpie/domain/payment_code_port.dart` | 新增 | 136 |
| `apps/mobile/test/domain/payment_code_channel_test.dart` | 新增 | 382 |
| `docs/features/techpie-native-payment-code.md` | 新增 | 本文 |

除此之外**没有**修改任何文件（`apps/mobile/lib/features/techpie/README.md`
也保持原样，以免与"本轮只做 Phase 0"的表述打架）。

### 10.2 验证

```bash
cd apps/mobile
$HOME/toolchains/flutter/bin/flutter analyze        # No issues found!
$HOME/toolchains/flutter/bin/flutter test           # 见下
```

| 项 | 结果 |
| --- | --- |
| `flutter analyze` | `No issues found!`（0 error / 0 warning / 0 info） |
| 新增测试 | `payment_code_channel_test.dart`：**25 例全绿** |
| 全量测试 | 基线 680 例全绿；加新增后 **705 例全绿** |

新增测试的 25 例分五组：

1. **三态封闭**（wire 值、fail-closed 的 `fromWire`、label/guidance 互不相同）—— 3 例
2. **两种阻塞态的表达**（默认值、409 vs 401、`toApiError` 的 details、`available` 抛错、`toJson` 键封闭）—— 5 例
3. **从错误还原状态**（往返一致、带 details、无 details、`upstreamReady: true` → null、401/429/500 → null、**任何错误码都不会变成 `available`**）—— 6 例
4. **闸门行为**（被阻塞 → Err、重复调用仍是 Err、`official` 是唯一 Ok、签发者失败原样上抛、空码 → Err、脱敏）—— 7 例
5. **源码扫描**（文件存在、无 IO 令牌、零框架依赖、`available` 只有一个构造点）—— 4 例

### 10.3 我没有做什么，以及为什么

| 没有做 | 为什么 |
| --- | --- |
| 不实现 DNS 隧道 / `VpnService` | 任务边界明确禁止；且 §4 的结论是"不该做"，不是"还没做" |
| 不写任何会发请求的代码 | 同上；本轮所有代码都是纯计算 |
| 不改 `android/` 清单、不加任何权限 | 加了权限就等于在为一个未授权的功能铺路；且 `android/` 是生成物 |
| 不接进 provider / UI | 接线只会让用户更快看到一个 503；等 §5 的路径定了再动 |
| 不落盘任何凭据 / Cookie / CASTGC | 本层连存储 API 都无法 import（有源码扫描兜底） |
| 不复制 TechPie 代码 | 上游无 LICENSE 文件（规格 §7），且本轮没有源码可读 |
| 不验证 Android/鸿蒙的 API 行为 | 需要真机与 SDK，超出本轮环境；全部登记进 §8 |
| 不动 `apps/miniapp` / `services/api` / `packages/` | 任务边界 |
| 不执行任何 git 操作 | 任务边界 |
