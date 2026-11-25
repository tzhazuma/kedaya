# TechPie 校园卡实现拆解（2026-11-25 复核）

> 目的：把上游 `TechPie-flutter/lib/features/campus_card/`（96 个 Dart 文件）的真实做法写清楚，
> 分清**哪些是协议**、**哪些是上游私有服务**。读的是源码，不是猜测。

## 1. 端点清单（源码里出现过的路径）

| 路径 | 用途 | 鉴权 |
| --- | --- | --- |
| `GET /__ecard_bind/health` | 绑定服务健康检查 | 无 |
| `POST /__ecard_bind/exchange` | 一次性绑定码 → `openid` | `X-Bind-Token` 共享密钥 |
| `POST /bind/wechatBind` | 校园卡**主动绑定**（卡号 + 卡密码 + 证件号 + 手机号） | OPENID 会话 |
| `POST /bind/cancelBind` / `/bind/opencancelBind` | 解绑 | OPENID 会话 |
| `POST /myaccount/openMyAccountApp` | 账户与余额（`data.cardinfo.cardbal`） | OPENID 会话 |
| `GET /selftrade/queryCardSelfTradeList` | 流水（`endDate` 是**开区间**，要 +1 天） | OPENID 会话 |
| `POST /offlineCode/openVirtualcard` | **在线付款码**（`usertype=8, appcode=1`） | OPENID 会话 |
| `POST /offlineCode/openOfflineCode` | **离线码**授权（断网刷卡） | OPENID 会话 |
| `POST /virtualcard/openVirtualCardSelf` | 开通虚拟卡（付款码前提） | OPENID 会话 |
| `POST /virtualcard/qrcodePwdModify` / `qrcodeQuotaModify` | 付款码支付密码 / 限额 | OPENID 会话 |
| `POST /virtualcard/queryOrderStatus` | 付款结果轮询 | OPENID 会话 |
| `POST /scan/scanningResult` | **扫码支付**（商户码 → 扣款） | OPENID 会话 |
| `POST /home/getUserkeys` | 安全设置读取（`offlineqrcodenum`、`qrcodemaxconsamt`） | OPENID 会话 |
| `POST /card/cardQuotaModify` | 消费限额修改 | OPENID 会话 |

载荷统一包在 `{datajson: "<16 位头><base64 密文>"}` 里，密钥每请求随机生成
（`EcardCipher`，已在 kedaya 复刻并有 9 例测试）。

## 2. 关键事实：数据请求要 **JSESSIONID cookie**，而它来自上游私有服务

`data/auth/geekpie_ecard_session_issuer.dart` 写得很直白：

```dart
/// Only GeekPie may acquire/bind a new eCard cookie. There is no direct fallback.
final class GeekPieEcardSessionIssuer implements EcardSessionIssuer { ... }
```

- 它 `POST` 一个**上游自己的**端点，body 是 `{method, openid}`
- 返回 `{success, data: {token, sid, raw: {cardid, idserial, orgid: '2', cookies}}}`
- `token` 必须是 `JSESSIONID=<ascii>`，并且和 `raw.cookies` 完全一致
- 客户端校验非常严：`sid` 非空、`cardid` 非空、`orgid == '2'`，任何一项不符就按协议错误丢弃

也就是说：**只拿到 `openid` 还不够**，账户/流水/付款码都要一个按 openid 换来的
`JSESSIONID`，而换取动作在 GeekPie 的服务端完成（他们那边才是真正用学校接口建会话的人）。

## 3. 绑定码端点：2026-11-25 实测（kedaya 侧）

绕过本机 Clash 代理、直连 `119.78.254.196` 并带 `Host: ecard.shanghaitech.edu.cn`：

```text
GET  /__ecard_bind/health                              → 200 {"ok": true, "codes": 0}
POST /__ecard_bind/exchange   （无 X-Bind-Token）       → 401 {"ok": false, "error": "unauthorised"}
POST /__ecard_bind/exchange   （X-Bind-Token: 错的）     → 401 同上
```

结论：

1. **端点真实存在且健康**，`codes: 0` 表示当前没有待兑换的绑定码；
2. **共享密钥确实是必需的**，缺或错都是 401；
3. `119.78.254.196` 是**绑定服务主机**，不是校园卡主机——它的 `/` 会 302 到
   `http://ecard.bda.edu.cn/errorPage?`（另一个域名），与 TechPie 用 DNS 覆盖
   只劫持 `/__ecard_bind/*` 的做法一致。

## 4. kedaya 已有的与缺的

| 能力 | 状态 |
| --- | --- |
| `EcardCipher`（加解密、头变换） | ✅ 9 例测试 |
| `EcardApiClient`（账户 / 流水 / 付款码） | ✅ 直连实现 + 7 例测试 |
| 绑定码换 OPENID | ✅ 11 例测试；真实端点实测 401 语义正确 |
| OpenID 加密落盘 | ✅ Keychain / Keystore |
| **JSESSIONID 会话签发** | ❌ 缺。上游靠私有服务换 cookie，我们只有 openid |
| 离线码 / 扫码支付 / 密码与限额 | ❌ 缺（都要求上面的会话 + 支付密码） |
| 主动绑卡 `wechatBind` | ❌ 缺（要卡密码与证件号，不能代填） |

**结论**：就算配了 `KEDAYA_ECARD_BIND_TOKEN` 成功换到 `openid`，
后续数据请求仍会因为**没有 JSESSIONID** 而失败。这一步没有可替代的公开入口——
除非我们自己在服务端用学校 OPENID 通道建会话（等价于重做上游那台服务），
或者用户在自己的校园网环境里完成一次网页登录、把会话交给客户端。

## 5. 因此的可选路径

1. **客户端持会话来自己建**：在校园网内用 WebView 走一次 ecard 登录 → 拿 `JSESSIONID`
   → 交给 `CampusCookieVault` → 之后的请求就都通了（不需要 GeekPie 的服务）。
   这是 kedaya 架构 A 的延伸，也是唯一不依赖第三方的路。
2. 复用上游的会话服务：需要他们授权，且密钥与会话形态由他们控制。
3. 只做只读（账户/流水），会话靠用户手动粘贴 cookie：可行但体验差、cookie 会过期。

路径 1 的代码骨架已经有了（`CampusCookieVault` + `canvas` 桥 / `kedayaEval`），
差的是一次真实的 ecard 网页登录流程 —— 这需要校园网内可访问 `ecard` 主机，
而本机 DNS 被代理改写成 `198.18.x.x`，连校园 DNS 也返回同样假地址，所以暂时验不了。
