# 18 · 两个「拿不到」的实测结论：eCard 付款码 & 公众号历史

> 2026-10-22。本文记录**实际做过的探测**，包括失败的、以及为什么失败。
> 目的是让下一个人不用再重复这些弯路。

---

## 一、校园卡付款码：TechPie 的方式**我们复现不了**，因为到不了服务

### 1.1 我做了什么

| 探测 | 命令 | 结果 |
| --- | --- | --- |
| 根路径 | `curl -sI https://ecard.shanghaitech.edu.cn/` | **302** → `http://ecard.bda.edu.cn/errorPage?` |
| 换微信 UA | `-A "...MicroMessenger/8.0.49..."` | 仍然 **302** 到同一个错误页 |
| 试登录页 | `/plat/login` | **403**（带 Referer / 完整头也一样） |
| 试常见接口 | `/plat/getPublicKey` `/plat/getSysDate` `/plat/getConfig` `/app/query` `/api/plat/login` `/public/getSysDate` | 全部 **403** |
| 带 OAuth 参数 | `/plat/login?code=test` `?state=1&code=test` `?openid=test` | 全部 **403** |
| 仓库记录的路径 | `/card/balance?x=1` | **403** |
| 找替代主机 | `card.shanghaitech.edu.cn` → **404**；`ecard.stu.*` / `card.stu.*` / `ykt.*` → **000（不存在）** | — |
| 对照（证明网络没问题） | `eams.shanghaitech.edu.cn` **200**、`ids.shanghaitech.edu.cn` **302** | — |
| 错误页本身 | `http://ecard.bda.edu.cn/errorPage?` | **000（连不上）** |

### 1.2 结论

**`ecard.shanghaitech.edu.cn` 从公网到不了真实服务。**
它无条件把请求转到 `ecard.bda.edu.cn`（**北京舞蹈学院**）的厂商通用错误页，
而那个页子本身也不可达。所有业务路径一律 403。

这不是「缺权限」也不是「缺 cookie」，是**服务不在这条网络路径上**。
最可能的解释：校园卡系统只在校内网 / 校园 VPN 内可达。

### 1.3 这为什么让 TechPie 的方案无法复现

TechPie 的绑定流程（据我们规格 §2.5 的转引，未独立核实）：

```
用户在公众号点「绑定校园卡」
  → 学校公众号 OAuth
  → eCard 回调带 binding code 到 ecard.shanghaitech.edu.cn
  → TechPie 用 DNS 隧道把这个域名解析到自己，截获 code
  → 用 code 换 OPENID
  → 之后凭 OPENID 查余额 / 出付款码
```

**这条路我们连第一步都走不了**：

1. **我们不是那个公众号的运营者** —— OAuth 的 `appid` 是学校的，
   跳转链路不会经过我们，也就没有「我们能看到 code」的环节
2. **就算有 DNS 隧道也没东西可截** —— 隧道的前提是「一个本来会到达
   `ecard.shanghaitech.edu.cn` 的请求」。而公网根本到不了这个服务，
   请求在到达前就被转到厂商错误页了
3. **写 `VpnService` 是必要条件不是充分条件** —— 它是技术手段，
   但缺的是**服务可达性**和**授权位置**

> 之前那份 `techpie-native-payment-code.md` 说「做得到但不该做」。
> **这轮实测要把「做得到」收回一半**：在校园网内可能做得到，
> 从公网做不到，而我们都从公网开发。

### 1.4 那还剩什么路

| 路 | 状态 |
| --- | --- |
| **A. 校内网 / 校园 VPN** | 唯一可能让 eCard 可达的方式。**未验证**（我连不上校园网） |
| B. 学校正式接口 | 项目负责人说会去找老师申请。**这是唯一干净的长期方案** |
| C. WebView 打开 eCard 让用户自己看 | 已加进 `CAMPUS_WEBVIEW_TARGETS`（`id: 'ecard'`），但**同样受 §1.2 限制**，`domainVerified: false` |
| D. TechPie 式 DNS 隧道 | §1.3 已论证：复现不了 |

### 1.5 已交付的东西

`apps/miniapp/src/domain/models/techpie.ts` 新增 `ecard` 入口，并且：

- `domainVerified: false` —— **未确认就标未确认**
- `webviewBlockedReason` 如实写：*「校园卡系统目前只能在校内网络访问
  （2026-10-22 实测：公网访问会被转发到厂商错误页）。请连接校园网或学校 VPN
  后再打开；付款码需要登录你自己的校园卡账号。」*
- 测试断言：`ecard` 的 `ssoUrl` 就是它自己（它不走学校 IDS，走微信 OAuth），
  这是一个**显式例外**而不是遗漏

---

## 二、公众号历史：抓包做了，但**抓不到钥匙**

### 2.1 抓包能力实测

| 手段 | 结果 |
| --- | --- |
| `tcpdump`（无 sudo） | ✅ **可用**，能抓 |
| `en0` 抓 443 | ❌ **0 包** —— Clash 是 TUN 模式 |
| `any` 抓 443 | ❌ 0 包 |
| **`utun8` 抓 443** | ✅ **3546 行** —— Clash TUN 接口，这才是对的网卡 |
| DNS 抓包（`udp port 53`） | ❌ 基本没用 —— Clash fake-ip，DNS 在本地就被兜了 |
| `mitmproxy` / `scapy` | ❌ 都没装 |

**结论**：在这台机器上要抓包，接口必须是 `utun8`（或 Clash 当前的 TUN 接口），
`en0` / `any` 都是空的。

### 2.2 抓到了什么，以及为什么不够

抓到了 TCP 流（例如 `172.65.90.23.443`），但：

1. **TLS 加密** —— HTTP 的 Host / Path 都在密文里
2. **SNI 明文但需要解码** —— ClientHello 里能看到域名，但那只能告诉我们
   「微信连了 `mp.weixin.qq.com`」，这本就知道
3. **真正需要的 `key` / `pass_ticket` 在 HTTP 头或 URL 里** —— 必须解密

### 2.3 为什么 MITM 也不行

要解密 WeChat 的 TLS，需要：

1. 装一个根证书到系统信任链
2. WeChat **不校验证书固定**（certificate pinning）

第 2 条几乎肯定不成立 —— 微信客户端做证书固定是常识配置。
所以 MITM 拿不到明文，只能拿到「连了哪个 IP」。

### 2.4 微信的历史列表到底怎么读的（机制确认）

我们**已知**（来自 URL 结构 + 黑白盒实测）：

```
https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=<biz>&scene=124
    ← 历史列表页面，需要登录态
https://mp.weixin.qq.com/mp/profile_ext?action=getmsg&__biz=<biz>&f=json&offset=0&count=10
    ← 列表数据（JSON），需要 uin + key + pass_ticket
```

实测**无凭据**时：

| 请求 | 结果 |
| --- | --- |
| `action=home&__biz=MjM5NTY5OTMxMA==&scene=124` | HTTP 200 但只有 **2138 B**，含「请在微信客户端打开」，**0 个文章链接** |
| `action=getmsg&…&f=json` | **111 B** 错误 JSON |
| `appmsgalbum?action=getalbum` | `{"base_resp":{"exportkey_token":"","ret":10004}}` —— **干净 JSON，但 ret=10004 = 需要登录** |
| 搜狗微信 | HTTP 200、34 KB，但 **0 个 `mp.weixin.qq.com` 链接**（入口已失效） |
| 文章页「相关文章」递归 | 只有 1 个，且来自**别的公众号** |

**所以**：`getmsg` 就是微信读历史列表的接口，机制清楚。
缺的只是 `uin` / `key` / `pass_ticket` 这三个值。

### 2.5 那三个值在哪

在微信进程的**沙盒里**。我试了：

```
~/Library/Containers/com.tencent.xinWeChat/Data/           → 空（48 K）
~/Library/Group Containers/5A4RE8SF68.com.tencent.xinWeChat/
  → ls: Operation not permitted
```

`drwx------ azuma staff`，**属主是我自己，权限也够，但仍然 `Operation not permitted`**
—— 这是 macOS **TCC** 在拦，需要「完全磁盘访问权限」(Full Disk Access)。

### 2.6 三条可能的下一手（都需要人）

| # | 做法 | 成本 | 我能做的部分 |
| --- | --- | --- | --- |
| 1 | 给 DSH 开「完全磁盘访问权限」，我读 cookie 库 | 30 秒 | 给 → 我就能继续 |
| 2 | 用户在微信里逐篇复制文章链接，我批量解析 | 几分钟 | **已实现**（`POST /wechat/article` 支持 20 篇） |
| 3 | 用户截图公众号历史页，我 OCR | 1 分钟 | 已具备（`modlens_read_image`） |

**我建议 2** —— 它已经在跑，且不碰任何凭据。

### 2.7 一个反直觉的结论

**我们不需要「抓历史列表」也能拿到文章内容。**
单篇文章是公开的（实测 3.5 MB HTML、`js_content` 完整）。
真正缺的只是「文章 URL 的清单」，而那是一个**几百字节**的东西。

为了几百字节去做 MITM / 读 cookie 库 / 请求完全磁盘访问，
**成本远大于「让用户复制几条链接」**。这是我不推荐路径 1 的主要理由。

---

## 三、我改了什么代码

| 文件 | 改动 |
| --- | --- |
| `apps/miniapp/src/domain/models/techpie.ts` | 新增 `ecard` webview 入口 + `webviewBlockedReason` |
| `apps/miniapp/src/domain/models/__tests__/techpie.test.ts` | 4 个守卫测试同步（含 `ecard` 的 SSO 例外、`domainVerified: false`） |

**没有**改：`services/api`、`packages/`、Flutter、Web。

---

## 四、未验证 / 我不知道的

- 校园网内 `ecard.shanghaitech.edu.cn` 是否真的可达 —— **我没连过校园网**
- TechPie 的 DNS 隧道具体劫持哪一步 —— 规格是转引，`/tmp/techpie-ref` 本机不存在，
  **没有独立核实**
- 微信是否真的做了证书固定 —— 强烈推测，**未实测**
- 我们如果拿到 Full Disk Access，微信的 cookie 库是否明文存放 `key` —— **未验证**
