# contact-exchange · 联系方式交换（U8）

> 跨模块隐私基础设施：搭子 / 拼单 / 跑腿等模块在「双方都同意」后交换联系方式，
> 但**不默认暴露**手机号 / 微信号（冻结契约 §9）。
>
> 路由：`/api/v1/contact-exchange`。它不是契约 §4 的用户可见模块，
> 因此不进 `@kedaya/contracts` 的 `MODULES`，也不进 `scripts/scaffold.mjs` 的 SPEC 表。

## 为什么单独做一个模块

`buddy-matching.md` §6.2 原本把联系方式塞进 `notifications` 载荷。那会带来三个问题：

1. 通知一发出就等于**复制**了一份联系方式，撤销不掉；
2. 每个业务模块都会自己发明一套"交换微信号"的字段，隐私规则无法统一；
3. 没有任何地方能回答"谁在什么时候看了谁的联系方式"。

因此把"可交换条目 + 双方同意 + 读取审计"收敛成一个模块。业务侧只需要：

```ts
// 申请
POST /contact-exchange/requests
{ "addresseeId": "...", "contextModule": "buddy", "contextId": "<postId>" }

// 对方同意后，读取对方 shared=true 的条目
GET /contact-exchange/requests/:id/contacts
```

## 端点（12 个）

| # | 方法 | 路径 | 幂等键 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | `GET` | `/contacts` | — | 我的联系方式（游标分页，本人可见明文） |
| 2 | `POST` | `/contacts` | **必需** | 新增条目（`shared` 默认 `false`） |
| 3 | `PATCH` | `/contacts/:id` | 可选 | 改值 / 标签 / 授权开关（Merge Patch） |
| 4 | `DELETE` | `/contacts/:id` | 可选 | 硬删；对方立即不可见 |
| 5 | `POST` | `/requests` | **必需** | 发起交换申请（24h 限流） |
| 6 | `GET` | `/requests` | — | 我的申请（`incoming/outgoing/all` + 状态过滤） |
| 7 | `GET` | `/requests/:id` | — | 申请详情（**不含任何联系方式**） |
| 8 | `POST` | `/requests/:id/approve` | **必需** | 被申请人同意 |
| 9 | `POST` | `/requests/:id/reject` | **必需** | 被申请人拒绝 |
| 10 | `POST` | `/requests/:id/revoke` | **必需** | 任一方撤销 / 解除 |
| 11 | `GET` | `/requests/:id/contacts` | — | 读取对方**已授权**条目（写审计） |
| 12 | `GET` | `/audit` | — | 审计：谁看过我 / 我看过谁 |

全部端点要求登录。所有 `POST` 都挂 `IdempotencyInterceptor`（契约 §11.3），
缺 `Idempotency-Key` 返回 `VALIDATION_FAILED`。

## 隐私设计（三条关键判断）

### 1. 交换的是「读取权限」，不是联系方式副本

`ContactExchangeRequest` 只记录关系与状态；`ACCEPTED` 只是允许
`GET /requests/:id/contacts` **实时**查询对方 `shared = true` 的条目。
同意 / 审批**不复制**任何值。因此：

- 撤销协议 → 下一毫秒就查不到；
- 关闭单条授权（`PATCH {shared:false}`）→ 下一毫秒就不在结果里；
- 删除条目 → 硬删，连历史结果都不存在。

如果按"同意时把联系方式写进通知 / 会话表"的做法，撤销必然有窗口，且无法回收副本。

### 2. 默认关闭 + 允许清单投影，而不是"生成后脱敏"

- `ContactEntry.shared` 默认 `false`；新建条目**不参与**任何交换。
- `GET /requests/:id/contacts` 在非 `ACCEPTED` 时直接 `CONSENT_REQUIRED`，
  **不生成**任何 `masked` / `***` 预览字段。不是"先算出来再打码"。
- 所有响应 DTO 用**逐字段挑选**的允许清单（`toContactEntryWire` /
  `toExchangedContactWire` / `toContactAccessAuditWire` / `toAuditLogPayload`），
  即使仓储行里带 `valueCipher` / `valueFingerprint` / `userId`，也不会被展开。
- 交换结果在应用层再做一次 `shared === true` 过滤（防御性，仓储契约已保证）。

### 3. 密文 + 带密钥指纹；密钥缺失即启动失败

- 明文只以 **AES-256-GCM** 密文落 `ContactEntry.valueCipher`
  （复用 `common/crypto/secret-box`，与 `CampusSession` 同一套格式 `v1.<iv>.<tag>.<ct>`）。
- 去重指纹是 **HMAC-SHA256(密钥, kind:value)**，不是裸 SHA-256。
  手机号是低熵输入，裸哈希可被彩虹表反查 —— 那等于把明文以另一种形式写进数据库。
- `CONTACT_EXCHANGE_ENC_KEY` **没有默认值**；缺失 / 长度错误时
  `AesGcmContactCrypto` 构造抛错 → Nest 装配失败（fail closed）。
  宁可应用起不来，也不接受"忘记配密钥就以明文/弱密钥运行"。

### 审计

`ContactAccessAudit` 只存：

```
actorId, subjectId, requestId, action='view_contacts', entryIds[], entryKinds[], at
```

**不存** `value` / `valueCipher` / `valueFingerprint` / 脱敏值。
`viewContacts` 先写审计再返回明文（fail-closed）：审计写不进去就 500，不泄漏联系方式。
用户只能查 `inbound`（谁看过我）或 `outbound`（我看过谁），不能跨用户扫全表。

## 状态机

```
PENDING ──approve(仅被申请人)──▶ ACCEPTED ──revoke(任一方)──▶ REVOKED
   │                                  │
   ├─reject(仅被申请人)──▶ REJECTED     └─ 对方立即可读 shared=true 条目
   ├─revoke(任一方)────▶ REVOKED
   └─expiresAt 到期────▶ EXPIRED（惰性：任何读写前先落库）
```

`ACCEPTED` 不自动过期，只能撤销。`EXPIRED` 由 `expiresAt` 到期推导，
并在任何读写前由 `expireStaleRequests()` 落库。

## 限流

同一对用户（无序 `pairKey = min:max`，**双向计数**）24h 内最多
`CONTACT_EXCHANGE_RATE_LIMIT` 次申请（默认 3，范围 1–100）。
计数包含已拒绝 / 已撤销的尝试 —— 否则"申请-被拒-再申请"就是无限骚扰。
超限返回 `RATE_LIMITED`，`details` 只有 `{limit, windowMs}`，不含任何请求内容。

## 数据库

| 表 | 作用 |
| --- | --- |
| `ContactEntry` | 可交换条目（密文 + 指纹 + `shared`） |
| `ContactExchangeRequest` | 申请 / 协议（状态机 + 上下文 + 过期） |
| `ContactAccessAudit` | 查看审计（只存 id / 类型 / 时间） |

手写迁移：`services/api/prisma/migrations/20261017190000_contact_exchange/`。
除了 Prisma schema 生成的三张表外，迁移里有一条**部分唯一索引**：

```sql
CREATE UNIQUE INDEX "ContactExchangeRequest_pair_active_key"
    ON "ContactExchangeRequest" ("pairKey")
    WHERE "status" IN ('PENDING', 'ACCEPTED');
```

Prisma schema 表达不了 partial unique index，因此它只存在于迁移里。
应用层先做友好检查，并发下由数据库兜底（P2002 → `CONFLICT`）。
过期申请会先被惰性置为 `EXPIRED`，从而释放这条索引。

## 环境变量

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `CONTACT_EXCHANGE_ENC_KEY` | **是** | 64 位 hex / base64 32 字节；缺失即启动失败 |
| `CONTACT_EXCHANGE_RATE_LIMIT` | 否 | 24h 申请上限，默认 3，范围 1–100 |

## 目录

```
contact-exchange/
├── contact-exchange.module.ts        Nest 装配
├── contact-exchange.controller.ts    12 个端点 + Zod schema
├── application/
│   ├── contact-entry.service.ts      我的联系方式 CRUD
│   ├── contact-exchange.service.ts   申请 / 同意 / 拒绝 / 撤销 / 查看
│   ├── contact-audit.service.ts      审计查询
│   └── parse-cursor.ts               复合游标 → VALIDATION_FAILED
├── data/
│   ├── contact-exchange.repository.ts Prisma 实现（唯一碰 IO 的地方）
│   └── aes-gcm-contact.crypto.ts      AES-256-GCM + HMAC 指纹 + 启动期密钥校验
├── domain/
│   ├── contact-exchange.domain.ts     零框架依赖：状态机 / 校验 / 游标 / 投影
│   └── contact-exchange.domain.spec.ts
├── testing/pglite.ts                 真实 PostgreSQL（PGlite）夹具
├── contact-exchange.http.spec.ts     29 个 HTTP 端到端用例
└── contact-exchange.security.spec.ts 11 个安全 / 迁移 / 启动用例
```

## 测试

```bash
cd services/api
npx vitest run src/modules/contact-exchange
```

覆盖：未同意 → 拿不到（含脱敏）、撤销后立即不可见、单条取消授权立即不可见、
限流生效、日志 / 审计无明文、响应不含未授权条目、密文落库、部分唯一索引、
外键级联、密钥缺失启动失败、幂等重放、游标分页。

## 已知限制 / 未决问题

1. **限流是"计数后写入"**，没有数据库级窗口锁；同一对用户在高并发下
   理论上可以同时通过 3 次检查。要彻底消除需要 Redis 令牌桶或事务级锁。
   当前由部分唯一索引保证"最多一条活跃申请"，因此实际危害有限。
2. **幂等存储是进程内 Map**（复用全仓 `IdempotencyStore`），多实例/重启后失效。
   生产必须换 Redis —— 这是全仓既有问题，不是本模块新增。
3. **没有"续期/延长协议"端点**：`ACCEPTED` 不自动过期，只能撤销后重新申请。
   如果产品需要"每年重新确认一次"，应新增 `renew` 动作并补契约。
4. **`message` 的联系方式检测是保守正则**，可能误伤（例如用户写"我在 138 教室"不会命中，
   但写一串 11 位数字会）。宁可误伤也不放行绕过路径。
5. **审计查询没有管理员视角**：普通用户只能看与自己相关的两个方向。
   合规角色如需全量审计，应走独立的管理后台权限域，而不是复用本端点。
