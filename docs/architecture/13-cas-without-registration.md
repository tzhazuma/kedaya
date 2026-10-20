# 13 · `CAMPUS_CAS_SERVICE` 到底是干什么的，以及**不注册**能怎么办

> 2026-10-20。回答两个问题：
> 1. 那个 `service` 参数是干什么用的？
> 2. 不去信息办注册，有没有别的路能实现「用学校统一身份认证登录」？

---

## 1. `service` 是什么

### 一句话

**它是「CAS 认证完之后，把票根送回哪里」的地址，同时也是校方用来判断「你这个应用有没有被批准」的依据。**

两个作用合在同一个参数里，这是 CAS 协议的设计。

### 完整流程

```
① 用户点「用学校账号登录」
        ↓
② 我们生成一个跳转地址，把 service 参数带上去：
   https://ids.shanghaitech.edu.cn/authserver/login
       ?service=https%3A%2F%2Fapi.kedaya.app%2Fauth%2Fcas%2Fcallback
        ↓
③ 用户在**学校的页面**上输入学号和密码
   ← 关键：密码只在 ids.shanghaitech.edu.cn 上，我们从来没见过
        ↓
④ 认证成功，CAS 生成一张**一次性票根**（Service Ticket，形如 ST-1234-xxxx）
   并 302 跳回 service 指定的地址，票根挂在 URL 上：
   https://api.kedaya.app/auth/cas/callback?ticket=ST-1234-xxxx
        ↓
⑤ 我们的服务端拿 ticket **再去**问 CAS：
   GET https://ids.shanghaitech.edu.cn/authserver/p3/serviceValidate
       ?service=<同一个 service>&ticket=ST-1234-xxxx&format=JSON
        ↓
⑥ CAS 确认票根有效，返回学号 / 姓名 / 邮箱
```

### `service` 为什么必须注册

第 ⑥ 步里，CAS **会重新检查我们传的 `service`** 是否与第 ② 步用户登录时用的一致。

如果不一致，就拒绝。这是防**票根被偷去别的站点用**（ticket replay to another service）。

而「允许哪些 `service`」是**校方白名单**。没进白名单的地址，第 ② 步就会被 CAS 挡下来：

> 应用未注册 / 无效的 service

所以：

| 不注册会怎样 | 具体表现 |
| --- | --- |
| 第 ② 步点登录 → 学校页面报错 | 用户根本到不了输密码那一步 |
| 即使手动构造 URL 也没用 | CAS 侧校验，改客户端绕不过 |
| 第 ⑤ 步拿真票根也换不出身份 | `serviceValidate` 会返回 `INVALID_TICKET` |

> 实测（2026-10-20）：`/authserver/p3/serviceValidate` 端点**是通的**，
> 传一个假票根会返回真实结构：
> `{"serviceResponse":{"authenticationFailure":{"code":"INVALID_TICKET","description":"未能够识别出目标 'ST-…'票根"}}}`
>
> 也就是说**接口本身能用**，卡住的只是 `service` 的授权。

---

## 2. 不注册的话，四条替代路线

按「可行性 × 合规性」从高到低：

### 路线 A ⭐ 推荐：申请注册（其实比你想的快）

信息办通常有一个**「接入统一身份认证」的申请流程**，不需要开发工作量，只是审批。

**要准备的材料**（大概率就这些）：

| 材料 | 说明 |
| --- | --- |
| 应用名称与简介 | 可达鸭 · 上科大校园服务平台 |
| 回调地址（`service`） | 例如 `https://api.kedaya.app/auth/cas/callback` |
| 用途说明 | 只做**身份识别**，不获取成绩/课表/财务等业务数据 |
| 数据留存说明 | 我们只存 `studentId` + 显示名 + 邮箱，**不存密码、不存 CASTGC** |
| 负责人 | 学生姓名 + 学号 + 指导老师（如有） |

**我们这边已经就绪**，拿到注册就能直接跑：
- `services/api/src/modules/auth/data/http-campus-auth.provider.ts` —— 真实的 `p3/serviceValidate` provider
- `.env.example` 里 `CAMPUS_CAS_URL` / `CAMPUS_CAS_SERVICE` 两个变量
- CAS 失败 JSON 的解析与中文错误映射

**唯一要改的是一行 `.env`。**

> 💡 申请时明确写「**不使用 CASTGC、不代理任何校园系统流量**」会显著提高通过率 ——
> 这正好是我们与其他第三方实现的关键区别。见 §3。

### 路线 B：用 `egate` 的 OAuth（如果校方开放）

你的原始需求里提到过：

```
https://ids.shanghaitech.edu.cn/authserver/login?service=https%3A%2F%2Fegate-new.shanghaitech.edu.cn%2Flogin
```

这是 **eGate 作为 CAS 客户端**的登录地址。它说明 eGate 已经在白名单里。

如果 eGate 本身提供 **OAuth2 授权给第三方**（有些学校的门户支持），那我们注册的是 eGate 的 OAuth 应用，而不是 CAS 的 service。

**现状**：未验证 eGate 是否有这个能力。**需要向信息办确认**。
如果只有 CAS，那和路线 A 是同一件事。

### 路线 C：邮箱验证码登录（**已经能用，不依赖校方**）

这是**当前生产环境实际在用**的方式：

```
用户输入 @shanghaitech.edu.cn 邮箱
    ↓
我们发一个 6 位验证码到这个邮箱
    ↓
用户输入验证码 → 登录成功
```

**优势**：
- **完全不需要校方任何审批**
- 学校邮箱本身就等于「在读/在职证明」—— 能收到邮件就说明账号有效
- 已经在跑：`modules/auth/` 里的邮箱验证码流程

**劣势**：
- 用户要切到邮箱收码，比 SSO 多两步
- 拿不到学号（只能拿到邮箱地址），需要用户自己填学号做绑定

> 严格说路线 C **不是「统一身份认证」**，但它实现了同一个业务目标：
> **证明这个人是上科大的人。** 在你拿到 CAS 注册之前，这是最稳的兜底。

### 路线 D：微信登录 + 手动绑定学号（**已经能用**）

```
微信授权登录 → 得到一个 openid
    ↓
用户手动填学号 + 选择身份（本科/研究生/教职工）
    ↓
（可选）用学校邮箱收一次验证码来证明学号是真的
```

**这条路的诚实边界**：

- 纯微信登录**不能证明**这个人是上科大的 —— 任何人都有微信
- 所以必须叠加**至少一种**校方凭据：学校邮箱验证码（路线 C）或 CAS（路线 A）
- 我们的两级身份模型就是为此设计的：
  - **一级身份**（你是谁）：微信 / 邮箱验证码 / CAS —— 任选
  - **二级身份**（你能访问什么校园数据）：CAS 或 eCard 绑定后才解锁

**当前实现**：一级身份支持微信 + 邮箱；二级身份未绑定时会返回 `CAMPUS_BINDING_REQUIRED`（**409，不是 401**），提示用户去绑定。

---

## 3. 为什么我们的 CAS 方案和别人的不一样

参考项目里有两种做法，**我们都不采用**：

| 做法 | 谁在用 | 为什么不抄 |
| --- | --- | --- |
| 服务端存学号 + 密码，定时模拟登录拿 CASTGC | NextDDL 的 `loginXxxSession` | **违反「不代持密码」硬红线**。密码泄露 = 学生所有校园系统失守。即便拿到授权也不做 —— 授权变的是许可，不是风险 |
| DNS 劫持 `ecard.shanghaitech.edu.cn` 换绑定码 | TechPie 的 `ecard_bind_hijack.dart` | 小程序**没有** DNS/VPN 能力；且从校园网看是可疑流量 |

我们做的是**标准 CAS 客户端**：
- 密码只在学校的页面上输入，我们的服务器**永远看不到**
- 只拿一次性票根换一次身份，票根用完即废
- 不存 CASTGC，不代理任何业务请求

**这也是为什么值得去申请** —— 我们的方案是信息办最容易批的那一类。

---

## 4. 行动清单

| # | 事项 | 谁做 | 状态 |
| --- | --- | --- | --- |
| 1 | 向信息办提交 CAS service 注册申请 | 项目负责人 | ⬜ 待办 |
| 2 | 确认 eGate 是否提供第三方 OAuth | 项目负责人 / 信息办 | ⬜ 待办 |
| 3 | 拿到 `service` 后写入服务器 `.env` 的 `CAMPUS_CAS_SERVICE` | 开发 | ⬜ 阻塞于 #1 |
| 4 | 学校邮箱验证码登录（路线 C） | 开发 | ✅ 已实现 |
| 5 | 微信登录 + 学号绑定（路线 D） | 开发 | ✅ 已实现 |

**在 #1 完成之前，路线 C 和 D 已经能覆盖「登录」这个需求。**
CAS 带来的增量是**免去手工绑定**（可以自动拿到学号），不是「能不能登录」。
