# 07 · 登录方式盘点（含 P0-3 修复说明）

> **盘点日期**：2026-10-19（Asia/Shanghai）
> **代码基线**：盘点起点 `main @ 54dc95a`；盘点期间工作区有并行任务的提交与未提交改动（与本文结论无关的模块未纳入证据）
> **审计来源**：[05-campus-integration-audit.md](./05-campus-integration-audit.md) 的 **P0-3**（§0.2 第 3 条、§3.1、§5.7）
> **写作用域**：`services/api/src/modules/auth/**`、`services/api/.env.example`、本文。
> **没有改**：`packages/contracts/`、`apps/`、其他模块。

---

## 0. 一页结论

**已实现 3 条**：邮箱 + 密码、校园邮箱验证码（免密）、微信小程序。
**只有 Mock 的 1 条**：校园 CAS（本轮修掉 P0-3 的 fail-open，并补上 `simulated`）。
**完全没有的 1 条**：手机号。
**「绑定账号」只做了一半**：微信 ↔ 邮箱这一对可以互相绑；**CAS 不能绑到已有账号，也没有账号合并**。

另外，任务描述里的两个路径与仓库现状不符，先纠正（全仓 grep 核实过）：

| 任务描述 | 仓库实际 | 说明 |
| --- | --- | --- |
| `POST /auth/common/cas` | **不存在** | 全仓没有这条路由；CAS 登录是 `POST /api/v1/auth/login` |
| `POST /auth/login`（邮箱密码） | 邮箱密码是 `POST /api/v1/auth/account/login` | `/auth/login` 是 **CAS**，两者不是同一个端点 |

> 下文端点均省略统一前缀 `/api/v1`（见 `packages/contracts/src/envelope.ts` 的 `API_BASE_PATH`）。

---

## 1. 登录方式总表

| 方式 | 端点（实际） | 状态 | 缺什么才能真的可用 |
| --- | --- | --- | --- |
| 邮箱 + 密码 | `POST /auth/account/register/code` → `POST /auth/account/register`<br>`POST /auth/account/login` | ✅ 代码完整 | 生产必须配 `SMTP_*`（没配**拒绝启动**，见 `resolveMailTransport`）；只接受 `@shanghaitech.edu.cn` / `@stu.shanghaitech.edu.cn`；无「非校园邮箱」入口（有意） |
| 校园邮箱验证码（免密） | `POST /auth/account/login/code`（发码）<br>`POST /auth/account/login/code/verify`（登录） | ✅ 代码完整 | 同上的 SMTP 配置；不需要第三方。首次登录自动建号且**不设密码**（`NO_PASSWORD_SENTINEL`） |
| 微信小程序 | `POST /auth/wechat/login`<br>`GET /auth/wechat/config`<br>`GET/POST/DELETE /auth/wechat/binding` | ✅（配密钥后可用） | `WECHAT_MINIAPP_APPID` + `WECHAT_MINIAPP_SECRET`；一个已注册的小程序；生产会**拒绝** `dev:` 模拟 code |
| 手机号 | **无** | ❌ | 见 §4：数据库列、短信服务商、签名/模板报备、频控、校方与隐私合规、三端 UI，一个都还没有 |
| 校园 CAS | `POST /auth/login` | ⚠️ 仅 Mock（P0-3 已修） | 见 §5：真实 `HttpCampusAuthProvider`、校方注册 `service` 回调、客户端跳转链路、provider 切换开关；仓库既有 `CAMPUS_CAS_URL` **未经校方确认** |
| 绑定已有账号 | `POST /auth/wechat/binding`<br>`POST /auth/account/bind-email`（+ `/bind-email/code`） | ⚠️ 仅微信 ↔ 邮箱 | 见 §6：CAS 身份绑定、账号合并、跨表邮箱唯一性都没有；冲突一律报错，不合并 |

---

## 2. 邮箱 + 密码（`/auth/account/*`）

### 2.1 真实链路

1. `POST /auth/account/register/code`：只接受校园邮箱；邮箱已注册 → `409 CONFLICT`。
2. `POST /auth/account/register`：验证码 + 密码 → 建号并直接登录（`isNewUser: true`）。
3. `POST /auth/account/login`：邮箱 + 密码；账号不存在与密码错误返回**同一文案**（防枚举）；
   连续 5 次失败锁定 15 分钟。

### 2.2 已经做对的约束

- 验证码：6 位数字、10 分钟有效、最多尝试 5 次、60 秒冷却、每小时最多 5 条；
  只落哈希（`verification-code.ts`）。
- 密码：`scrypt` 哈希，强度校验；改密 / 重置后撤销全部 refresh session。
- 邮箱域名**精确后缀匹配**（`isCampusEmail`），不认 `evil-shanghaitech.edu.cn` 这类伪装域。
- 生产环境 `AUTH_DEV_EXPOSE_CODES=true` **无效**（验证码不会回显到响应）。

### 2.3 缺什么才能真的可用

**只缺部署配置，不缺代码**：

1. 生产必须配置 `MAIL_TRANSPORT=smtp`（或 `SMTP_HOST`）以及 `SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM`。
   `resolveMailTransport()` 在 `NODE_ENV=production` 且未配置时**直接让服务起不来** —— 这是刻意的，
   避免「接口说已发送、用户永远收不到」。
2. SMTP 发信地址/额度需要真实邮件服务商或学校邮件网关；`SMTP_FROM` 必须是服务商允许的发信地址。
3. 若学校要求「仅本校邮箱可注册」，当前实现已经满足；若要放开其他邮箱，属于产品决策，不在本轮范围。

---

## 3. 校园邮箱验证码免密（`/auth/account/login/code*`）

### 3.1 真实链路

1. `POST /auth/account/login/code`：发登录验证码。
   **不区分邮箱是否已注册**（未注册也走同一套发送流程并返回 `sent: true`）—— 否则该接口会变成
   「查询某邮箱是不是上科大师生」的枚举器。
2. `POST /auth/account/login/code/verify`：验证码登录；首次登录自动建号。
   - 建出来的账号 `passwordHash` 是 `!no-password:sign-in-with-email-code`（不可验证的哨兵值），
     所以**永远不能用密码登录**。
   - **这是一个真实的小缺口**：免密账号想升级成「邮箱 + 密码」缺少一个「设置密码」入口 ——
     `password/change` 需要旧密码（哨兵值永远校验不过）；
     `bind-email` 要求账号**还没有** `UserCredential`（免密账号有，只是不可登录），会被 409 拒绝；
     只能走「忘记密码 → 重置」这条语义不太对的绕路。
     微信账号（完全没有 `UserCredential`）可以用 `/auth/account/bind-email` 补完整凭据。

### 3.2 缺什么才能真的可用

1. 同 §2 的 SMTP 配置。
2. 「免密账号 → 邮箱 + 密码」缺少一个**设置密码**端点（`password/change` 需要旧密码；
   `password/reset` 可以走「忘记密码」流程，但那是重置、不是主动设置）。
   目前用户仍可一直用验证码登录，所以不阻塞上线，但产品上是缺口。

---

## 4. 手机号（完全没有）

### 4.1 现状

- `grep -rn "phone|手机号|短信|sms" services/api/src/modules/auth`：**没有任何登录/绑定实现**。
- Prisma `UserCredential` 只有 `email`（唯一），**没有手机号列**；
  `VerificationCode.target` 是普通字符串，但服务层 `normalizeTarget()` 只接受校园邮箱。
- 微信适配器**刻意不读 `session_key`**，也没有实现 `getPhoneNumber`（见 `wechat.domain.ts` 注释）。

### 4.2 缺什么才能真的可用

「手机号登录」不是加个输入框，至少要补完这些：

1. **数据模型**：`UserCredential` 增加手机号（或独立的 `PhoneCredential` 表 + 唯一索引），
   并处理「同一手机号只能属于一个账号」的冲突语义。
2. **短信服务商**：阿里云/腾讯云 SMS（或其他）账号、**签名报备**、**模板报备**（模板审核通常 1–2 个工作日）；
   短信是付费资源，需要额度与告警。
3. **验证码通道泛化**：当前 `hashCode` / `consumeCode` / 频控都以邮箱 target 为键；
   手机号需要同样的 TTL / 尝试次数 / 冷却 / 每小时上限，以及防「短信轰炸」的 IP + 号码双维度频控。
4. **校方与合规**：手机号属于个人信息，需要隐私政策更新、收集目的与保存期限说明；
   是否允许第三方平台收集本校学生手机号，需要校方/信息办确认。
5. **三端 UI**：`apps/miniapp` / `apps/web` / `apps/mobile` 的手机号输入、验证码倒计时、
   区号/格式校验（本轮不可改 `apps/`）。
6. **可选替代**：微信小程序 `getPhoneNumber`（button `open-type="getPhoneNumber"` → code →
   服务端调 `phonenumber.getPhoneNumber`）。它要求**已认证的非个人主体小程序**，
   且仍需把手机号落库。当前适配器明确不处理 `session_key`，也没有这条链路。

**结论**：❌ 没有捷径；在数据模型、服务商、合规三件事落地前，不应上线「手机号登录」按钮。

---

## 5. 校园 CAS（`POST /auth/login`，仅 Mock）

### 5.1 现状

- `AUTH_PORT` 在 `auth.module.ts` 里**永远**绑定 `MockCampusAuthProvider`；没有真实 CAS 客户端。
- `authenticateTicket`：
  - 票据形如 `mock-<8 位学号>` → **直接采信**该学号作为 `externalId`；
  - 其它票据 → sha256 派生一个稳定 `externalId`；
  - 返回 `provider: 'SHTU_CAS'` + 邮箱/姓名/院系（这些字段都是模拟生成）。
- `POST /auth/login` 是**公开接口**（登录本来就不需要先登录），所以 Mock 一旦在真实环境可达，
  就是一条完整的身份伪造路径：`curl` 一个学号 → 拿到该校学生的令牌。

### 5.2 P0-3 修复：Mock 闸门改为 fail-closed

**改前**（`mock-campus-auth.provider.ts`）：

```ts
if (this.config.get<string>('NODE_ENV') !== 'production') return;  // 未设/拼错 → 放行
if (isTruthy(CAMPUS_CAS_MOCK_ALLOWED)) return;
throw ...
```

**改后**（判定顺序只会更严格）：

```ts
const nodeEnv = (NODE_ENV ?? '').trim().toLowerCase();

// 1) 生产无条件拒绝 —— 设了开关也不放行
if (nodeEnv === 'production') throw ...

// 2) 未设置 / 拼错一律拒绝（不能把「忘设 NODE_ENV」当成开发环境）
if (nodeEnv !== 'development' && nodeEnv !== 'test') throw ...

// 3) 非生产也必须显式开启
if (!isTruthy(CAMPUS_CAS_MOCK_ALLOWED)) throw ...
```

**行为矩阵**：

| `NODE_ENV` | `CAMPUS_CAS_MOCK_ALLOWED` | CAS 登录结果 |
| --- | --- | --- |
| 未设置 | 未设置 | **401 `UNAUTHENTICATED`**（拒绝） |
| 未设置 | `true` | **401**（未声明环境不视为开发） |
| `production` | 未设置 / `false` | **401** |
| `production` | `true` | **401**（生产不允许 mock） |
| `development` | 未设置 / `false` | **401**（默认关闭） |
| `development` | `true` | **允许** |
| `test` | `true` | **允许**（CI 全链路用） |
| 未知值（`prod` / `staging` / `dev` 等） | `true` | **401**（按「拼错」fail-closed） |

> 说明：`production` 会 trim + 转小写后比较，`Production ` 仍被当作生产；
> `staging` / `prod` 这类**未知值**按「拼错」拒绝（fail-closed）。
> `CAMPUS_CAS_MOCK_ALLOWED` 接受 `true / 1 / yes / on`（大小写、空白不敏感），其余值一律不认。

**错误文案**（运维可据此定位）：

- 生产：`Mock 身份在 NODE_ENV=production 下**无条件禁用**（即使设置了 CAMPUS_CAS_MOCK_ALLOWED=true 也不会生效）…`
- 未设置/拼错：`Mock 校园统一身份认证被拒绝：NODE_ENV 未设置或不是 development/test（当前值：…）…`
- 开发未开开关：`Mock 校园统一身份认证未开启：本环境的 CAS 登录要求显式设置 CAMPUS_CAS_MOCK_ALLOWED=true …`

**为什么仍然是 401 而不是拒绝启动**：CAS 只是**可选**登录入口，邮箱与微信仍可用；
邮件没配会让整条注册链路失效，所以邮件那条是拒绝启动，CAS 这条是「该入口暂不可用」。

### 5.3 CAS 登录响应补 `simulated`

- **字段定义**：`domain/account-session.ts` 的 `AccountSession.simulated?: boolean`（原本只给微信登录）。
- **端口声明**：`domain/auth.domain.ts` 的 `AuthPort.simulated?: boolean`。
- **身份来源自报**：`MockCampusAuthProvider.simulated = true`；
  将来真实 CAS 实现不设该属性（或显式 `false`），无需再改登录服务。
- **响应组装处**：`auth.service.ts` 的 `AuthService.login()` 返回对象里
  `simulated: this.authPort.simulated === true`；
  `LoginResult` 类型把它从可选改成**必填布尔值**（`Omit<AccountSession, 'isNewUser' | 'simulated'> & { simulated: boolean }`）。
- 因此：
  - Mock CAS → `simulated: true`；
  - 真实 CAS（实现不设属性）→ `simulated: false`；
  - 微信登录原本就有 `simulated`（开发 `dev:` 凭证为 true），不受影响。

**客户端注意**：这是**新增**字段，旧客户端会忽略它；新客户端必须在 CAS 登录后检查
`simulated === true` 并显著标注「演示身份」，绝不能把 `mock-<学号>` 当成真实学号展示。
本轮**没有改 `apps/`**，三端 UI 是否已经展示该标记需要客户端任务跟进。

### 5.4 真实 CAS 还缺什么

1. **服务端实现**：新增 `HttpCampusAuthProvider implements AuthPort`：
   - CAS 2.0/3.0：服务端 `GET {CAMPUS_CAS_URL}/serviceValidate?service=<回调>&ticket=<ticket>`，
     解析 XML，取学号/姓名/院系/邮箱；**绝不**在客户端校验票据。
   - 或 OAuth：`authorization_code` → `access_token` → `/userinfo`。
   - 拿到身份后立即丢弃 ticket/access_token，不落库、不进日志、不进响应（`assertIdentityOnly` 兜底）。
2. **provider 切换**：`auth.module.ts` 现在硬编码 `{ provide: AUTH_PORT, useClass: MockCampusAuthProvider }`；
   需要按显式开关（例如新的 `CAMPUS_AUTH_MODE=mock|live`，**当前不存在**）绑定真实实现。
   不要复用 `CAMPUS_DATA_MODE` —— 那管的是第二级取数。
3. **校方注册**：需要在信息办注册 CAS/OAuth 客户端，登记 **`service` 回调地址**
   （由部署域名决定，形如 `https://<你的 API 域名>/api/v1/auth/cas/callback`；
   **具体地址必须由校方确认，仓库里没有可信值**）。
4. **凭据**：`CAMPUS_CAS_URL`、`CAMPUS_SSO_CLIENT_ID`、`CAMPUS_SSO_CLIENT_SECRET`。
   ⚠️ `.env.example` 与 `test/setup.ts` 里的 `https://cas.shanghaitech.edu.cn/cas` 是**仓库既有值，
   未经校方确认**，不能当官方地址使用，也不要在文档/客户端里把它写成「官方地址」。
5. **客户端跳转链路**：`GET /auth/login-url`（生成授权地址 + `state` 防 CSRF）在
   `docs/architecture/02-domain-model.md` 被提到，但**当前没有实现**（全仓 grep 无该端点）。
   三端需要接入「跳转 → 回调 → 把 ticket 交给 `POST /auth/login`」的流程。
6. **上线动作**：`NODE_ENV=production` 下 Mock 已无条件拒绝；接好真实 CAS 后删除
   `CAMPUS_CAS_MOCK_ALLOWED`，并确认 `AUTH_PORT` 指向真实实现。

---

## 6. 「绑定账号」的真实状态（重点，别写成已完成）

### 6.1 已有的两条（**同一 userId 上加凭据/身份，不新建账号**）

| 方向 | 端点 | 行为 | 冲突处理 |
| --- | --- | --- | --- |
| 微信账号 → 补邮箱密码 | `POST /auth/account/bind-email/code` → `POST /auth/account/bind-email` | `attachCredential({ userId, email, passwordHash })`，**同一个 `userId`**；是「解绑微信」的前置条件 | 账号已有邮箱凭据（含免密账号）→ `409`；邮箱已被 `UserCredential` 占用 → `409` |
| 邮箱账号 → 绑微信 | `POST /auth/wechat/binding` | `linkIdentity(userId, { provider: 'WECHAT_MINIPROGRAM', externalId: openid })`，**同一个 `userId`** | 该 openid 已属于**另一个**账号 → `409 CONFLICT`（不做静默合并）；已绑自己 → 幂等返回状态 |
| 解绑微信 | `DELETE /auth/wechat/binding` | `unlinkIdentity`；账号必须**还有别的登录方式** | 只剩微信 → `403 FORBIDDEN`（否则用户被锁在门外） |

这两条是真实可用的，并且微信登录 / 邮箱登录 / CAS 登录**签发同构 JWT**，
所以「同一个账号多种登录方式」在微信 ↔ 邮箱这一对上是成立的。

### 6.2 没有的东西（如实列出）

1. **CAS 身份不能绑定到已有账号**。
   没有任何 `POST /auth/cas/binding` / `link-cas` 端点；`UserRepository.linkIdentity()` 是通用能力，
   但**只有微信路径调用它**。CAS 登录走 `upsertFromIdentity()`，只按 `(provider, externalId)` 查，
   **不按邮箱匹配**。后果：
   - 先用校园邮箱注册了账号，再用 CAS 登录 → **新建了第二个 `User`**（即使邮箱相同）；
   - 反过来，CAS 建号后再用同一邮箱注册/验证码登录，也会是另一个 `User`。
2. **没有账号合并**。全仓没有 merge service / endpoint / 数据迁移。
   冲突一律 `409`（微信）或 `400/409`（邮箱占用），**不会**把两个账号的数据（课表、帖子、好友…）合并。
   `wechat-auth.service.ts` 的注释明确写了「而不是帮用户合并账号 —— 合并涉及数据归属，必须用户显式操作」，
   但「显式操作」的入口也**不存在**。
3. **邮箱唯一性只在 `UserCredential.email` 上**。
   `AuthIdentity.email` **没有唯一索引**，CAS 的 `upsertFromIdentity` 也不检查邮箱归属；
   `bindEmail` 只查 `UserCredential`，不查 `AuthIdentity.email`。
   因此「同一邮箱挂在两个 `User` 上」在数据层是可能的。
4. **没有身份管理读侧**。`UserRepository.listIdentities()` 存在，但没有 HTTP 端点列出「本账号已绑定哪些身份」；
   `GET /auth/me` 只返回 `user`（展示名 / 头像 / 院系）+ 第二级 `campusBindings`，**不返回 CAS 身份**；
   登录响应里的 `account` 只说明「有没有邮箱密码 / 是否绑微信」。
5. **没有手机号绑定**（见 §4）。
6. **没有 CAS / EGATE 解绑入口**（`unlinkIdentity` 是通用的，但只暴露了微信解绑）。

### 6.3 用户实际会遇到的场景

| 场景 | 结果 |
| --- | --- |
| 微信首次登录 | 自动建号（`isNewUser: true`） |
| 微信账号补邮箱密码 | 同一个 `userId`，可用邮箱密码登录；可解绑微信 |
| 邮箱账号绑微信 | 同一个 `userId`，可用微信登录 |
| 邮箱账号再用 CAS 登录 | **新 `User`**（除非之前用同一 CAS 身份登录过）；没有「绑定 CAS」入口 |
| 同一邮箱既有邮箱账号又有 CAS 身份 | 两个 `User`，无合并，无提示 |
| 微信 openid 已属于别人，再绑定 | `409`，明确拒绝，不抢占、不合并 |

**结论**：用户说的「绑定账号」如果指的是「微信 ↔ 邮箱」——**已实现**；
如果指的是「把学校统一身份认证 / 手机号也绑到同一个账号」——**没有实现**；
「账号合并」——**完全没有**。不要把这一行写成 ✅。

---

## 7. 生产行为变更与影响（P0-3）

1. **CAS Mock 从「默认开（非生产）」变成「默认关（所有环境）」**。
   - 以前：`NODE_ENV` 未设置 / 拼错的部署，`mock-<学号>` 可以直接登录。
   - 现在：这些部署的 `POST /auth/login` 会返回 **401 `UNAUTHENTICATED`**，直到显式设置
     `NODE_ENV=development`（或 `test`）**且** `CAMPUS_CAS_MOCK_ALLOWED=true`。
   - 这是**有意的破坏性变更**：旧的 fail-open 行为就是一条身份伪造路径。
2. **生产环境永远不能开 Mock**：`NODE_ENV=production` + `CAMPUS_CAS_MOCK_ALLOWED=true` 仍然 401。
   生产要恢复 CAS 登录，只能接入真实 CAS（§5.4）。
3. **登录响应新增 `simulated`**：加法变更，旧客户端忽略即可；新客户端应展示「演示身份」。
4. **没有改契约**：`packages/contracts/src/campus-services.ts` 里 CAS 条目仍然是
   `simulatedDisclosure: 'none'` 和「`NODE_ENV` 未设/拼错时任何人可冒充」的旧审计结论 ——
   **它现在已过时**。该文件不在本轮写作用域，需要契约 owner 在后续更新。
5. **`.env.example` 新增 `CAMPUS_CAS_MOCK_ALLOWED="false"`**（默认关闭）并写明两个前置条件；
   本地开发要跑 CAS mock，需要把它改成 `true` 且确认 `NODE_ENV=development`。

---

## 8. 验证

```bash
export PATH="/opt/homebrew/bin:$PATH"
cd /Users/azuma/Developer/kedaya
npm run typecheck -w @kedaya/api   # 0 errors
npm run test -w @kedaya/api        # 1612 passed | 9 skipped（基线 1604 + 本轮新增 8）
```

本轮新增/更新的测试：

- `src/modules/auth/data/mock-campus-auth.provider.spec.ts`
  - `NODE_ENV` 未设 + 开关未设 → 拒绝（P0-3 核心回归）
  - `NODE_ENV` 未设 + 开关=true → 拒绝
  - `NODE_ENV` 拼错（`prod` / `staging` / `dev`）+ 开关=true → 拒绝
  - `Production `（大小写/空白变体）被归一化后仍按 production 拒绝
  - `development` + 开关未设 → 拒绝
  - `production` + 开关未设 → 拒绝
  - `production` + 开关=true → **仍然拒绝**
  - `development` / `test` + 开关=true → 允许
  - 真值写法（1 / true / TRUE / yes / on）与假值写法
  - `simulated === true`
- `src/modules/auth/auth.service.spec.ts`
  - CAS mock 身份 → `simulated: true`
  - 真实 CAS 实现（无标记）→ `simulated: false`
  - 登录响应形状锁增加 `simulated` 键

---

## 9. 本轮明确没做的

- 未实现真实 CAS 客户端（没有校方地址/凭据，**不编地址**）。
- 未实现手机号（数据模型、短信服务商、合规都不具备）。
- 未实现 CAS ↔ 已有账号绑定、账号合并（涉及数据归属与迁移，必须单独立项，且需要产品/法务决策）。
- 未改 `packages/contracts/`（CAS 审计结论已过时，需 owner 跟进）。
- 未改 `apps/`（三端展示 `simulated` 标记需客户端任务跟进）。
