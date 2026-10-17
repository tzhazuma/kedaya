# 03 · API 契约

> 上游真相来源：`docs/architecture/00-FROZEN-CONTRACT.md`（下称 **契约**）§6.1。
> 本文把契约的 HTTP 约定落到 **OpenAPI 3.1**，并给出三个完整端点示例。
> 领域语义见 [02-domain-model.md](./02-domain-model.md)；权限与审计见 [05-security-privacy.md](./05-security-privacy.md)。

版本：`v1` · 2026-10-16

---

## 1. 契约到 OpenAPI 的映射

### 1.1 单一真相的生成链

契约 §6.1 冻结的是 **TypeScript 类型 + 路由形状**。OpenAPI 文档**不是手写的**，而是从 Zod schema 生成——手写必然漂移。

```mermaid
flowchart LR
    z["packages/contracts/src/schemas/*.ts<br/>Zod 4.6.7 schema<br/>（唯一真相）"] --> ts["TypeScript 类型<br/>z.infer"]
    z --> oapi["OpenAPI 3.1 文档<br/>zod-to-json-schema"]
    z --> nest["NestJS 运行时校验<br/>ZodValidationPipe"]
    z --> fe["客户端 SDK 类型<br/>小程序 / Web / Flutter"]
    oapi --> docs["/api/v1/openapi.json<br/>+ Swagger UI（仅非生产）"]
    oapi --> codegen["openapi-typescript<br/>生成 Flutter 侧 DTO"]
```

**硬规则**

| # | 规则 |
| --- | --- |
| 1 | 任何出现在 HTTP 边界上的类型，必须先在 `packages/contracts` 里定义 Zod schema，再 `z.infer` 出 TS 类型。**禁止**手写与 schema 重复的 interface |
| 2 | OpenAPI 文档由 `npm run openapi -w services/api` 生成到 `services/api/openapi.json`，CI 校验它与当前 schema 一致（`git diff --exit-code`） |
| 3 | 生产环境**不暴露** Swagger UI；只暴露 `openapi.json` 给内部工具链 |
| 4 | 枚举值（状态、错误码、模块 ID）只在一个地方定义，三端引用同一份 |

### 1.2 契约 §6.1 的逐条落地

| 契约条目 | OpenAPI 表达 | 备注 |
| --- | --- | --- |
| Base path `/api/v1` | `servers: [{ url: '/api/v1' }]` | 路径里**不重复**写 `/api/v1` |
| `Authorization: Bearer` | `components.securitySchemes.bearerAuth` + 全局 `security` | 公开端点用 `security: []` 覆盖 |
| `X-KedaYa-Trace` 请求头 | `parameters` 中的可选 header | 未传则服务端生成 |
| `traceId` 响应字段 | `ApiEnvelope` 的 `required` 字段 | 见 §2 |
| `Idempotency-Key` | 写操作的**必填** header（POST） | 见 §4 |
| ISO-8601 UTC | `type: string, format: date-time` | 统一 `Z` 后缀，不用 offset |
| 金额整数分 | `type: integer, format: int64, minimum: 0` | 字段名一律 `*Fen` |
| 游标分页 | `cursor` / `limit` query + `Page<T>` schema | **不提供** `offset` / `page` |

### 1.3 OpenAPI 文档骨架

```yaml
openapi: 3.1.0
info:
  title: 可达鸭 KedaYa API
  version: 1.0.0
  description: |
    上海科技大学第三方校园服务平台（非官方）。
    所有响应统一使用 ApiEnvelope 信封；成功与失败都返回 HTTP 200/4xx + 信封。
servers:
  - url: /api/v1
security:
  - bearerAuth: []
tags:
  - name: auth
  - name: groupbuy
  - name: wellbeing
  - name: forum
paths:
  # 见 §5 §6 §7
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
  parameters:
    TraceHeader:
      name: X-KedaYa-Trace
      in: header
      required: false
      schema: { type: string, maxLength: 64 }
    IdempotencyKey:
      name: Idempotency-Key
      in: header
      required: true
      schema: { type: string, minLength: 8, maxLength: 64 }
    Cursor:
      name: cursor
      in: query
      required: false
      schema: { type: string }
    Limit:
      name: limit
      in: query
      required: false
      schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
  schemas:
    ApiError:
      type: object
      required: [code, message]
      properties:
        code:
          type: string
          enum:
            - UNAUTHENTICATED
            - FORBIDDEN
            - NOT_FOUND
            - VALIDATION_FAILED
            - RATE_LIMITED
            - CONFLICT
            - CAMPUS_BINDING_REQUIRED
            - CONSENT_REQUIRED
            - UPSTREAM_UNAVAILABLE
            - INTERNAL
        message: { type: string }
        details: {}
```

---

## 2. 响应信封

契约 §6.1 冻结了 `ApiEnvelope<T>`：

```ts
export type ApiEnvelope<T> =
  | { ok: true; data: T; traceId: string }
  | { ok: false; error: ApiError; traceId: string };
```

### 2.1 HTTP 状态码与错误码的映射表（**冻结**）

| `ApiErrorCode` | HTTP | 何时返回 | 客户端应有行为 |
| --- | --- | --- | --- |
| `UNAUTHENTICATED` | 401 | 无 token / token 过期 / 签名无效 | 静默 refresh，失败则跳登录 |
| `FORBIDDEN` | 403 | 已登录但无权限（含角色不足、跨域访问） | 提示无权限，不跳登录 |
| `NOT_FOUND` | 404 | 资源不存在或**无权可见**（故意不区分） | 展示空态 |
| `VALIDATION_FAILED` | 422 | Zod 校验失败 | 把 `details` 映射到表单字段 |
| `RATE_LIMITED` | 429 | 触发限流 | 读 `Retry-After`，退避重试 |
| `CONFLICT` | 409 | 状态机拒绝、并发冲突、名额已满 | 重新拉取详情，提示用户 |
| `CAMPUS_BINDING_REQUIRED` | 409 | 身份有效但校园系统未绑定 | 跳绑定引导页 |
| `CONSENT_REQUIRED` | 403 | 敏感模块缺二次同意 | 弹同意页，同意后重试 |
| `UPSTREAM_UNAVAILABLE` | 502 | 校园系统/LLM 不可用 | 展示缓存 + 稍后重试提示 |
| `INTERNAL` | 500 | 未预期错误 | 展示 `traceId` 供报障 |

**为什么 `NOT_FOUND` 不区分"不存在"与"无权可见"**：区分会形成存在性预言机（enumeration oracle）。敏感模块（`wellbeing` / `dorm-harmony`）必须一律 404。

### 2.2 成功响应示例

```json
{
  "ok": true,
  "data": {
    "id": "01JBXR8K7M3QZ9V0P2N4T6W8YA",
    "title": "海底捞拼单",
    "status": "OPEN",
    "targetCount": 4,
    "joinedCount": 2,
    "unitAmountFen": 8800,
    "totalAmountFen": 35200,
    "deadlineAt": "2026-10-17T12:00:00.000Z",
    "createdAt": "2026-10-16T10:30:00.000Z"
  },
  "traceId": "0f8b3a1c9d2e4f56"
}
```

### 2.3 失败响应示例

```json
{
  "ok": false,
  "error": {
    "code": "CONFLICT",
    "message": "这个拼单已经满员了",
    "details": {
      "reason": "GROUP_FULL",
      "currentStatus": "FORMED",
      "joinedCount": 4,
      "targetCount": 4
    }
  },
  "traceId": "0f8b3a1c9d2e4f56"
}
```

**约定**：`message` 是**可直接展示给用户的中文**，不含技术细节、不含英文错误名。`details.reason` 是机器可读的细分原因，供客户端做差异化处理。

---

## 3. 分页

契约 §6.1：**游标分页，不用 offset**。

### 3.1 请求

```
GET /api/v1/forum/items?cursor=01JBXR8K7M3QZ9V0P2N4T6W8YA&limit=20
```

| 参数 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `cursor` | `string` | 否 | 上一页最后一条的 ULID。**不用不透明 base64**——ULID 本身有序且不含业务信息 |
| `limit` | `int` | 否 | 1–100，默认 20 |
| `sort` | `enum<createdAt_desc\|createdAt_asc\|hot_desc>` | 否 | 默认 `createdAt_desc` |

### 3.2 响应

```json
{
  "ok": true,
  "data": {
    "items": [
      { "id": "01JBXR8K7M3QZ9V0P2N4T6W8YA", "title": "选课求建议" }
    ],
    "nextCursor": "01JBXR8K7M3QZ9V0P2N4T6W8YB",
    "total": 128
  },
  "traceId": "0f8b3a1c9d2e4f56"
}
```

| 字段 | 说明 |
| --- | --- |
| `nextCursor` | `null` 表示没有下一页。**不要**用空数组判断 |
| `total` | 可选。仅在低成本可算时返回；列表页默认**不算** total（全表 count 会拖慢） |

### 3.3 为什么不用 offset

| 问题 | offset | 游标 |
| --- | --- | --- |
| 深分页性能 | `OFFSET 10000` 要扫过前 10000 行 | 走 `WHERE id < cursor` 索引，恒定成本 |
| 并发插入导致跳条/重复 | 会 | 不会 |
| 与 ULID 有序性配合 | 浪费 | 天然契合 |

---

## 4. 幂等

契约 §6.1：写操作支持 `Idempotency-Key` 头。**在 KedaYa 里它是必填**（除少数无副作用的 POST）。

```mermaid
sequenceDiagram
    autonumber
    participant C as 客户端
    participant G as IdempotencyGuard
    participant S as 业务服务
    participant DB as PostgreSQL

    C->>G: POST /groupbuy/items<br/>Idempotency-Key: 7f3a...
    G->>DB: SELECT 响应快照<br/>WHERE user_id AND key
    alt 命中
        DB-->>G: 快照 + 状态
        G-->>C: 原样返回上次响应
    else 未命中
        G->>S: 执行业务
        S->>DB: 业务写 + 快照写（同一事务）
        S-->>G: 结果
        G-->>C: 200 新响应
    end
```

| 规则 | 值 |
| --- | --- |
| 唯一约束 | `UNIQUE (user_id, idempotency_key)` |
| 存储内容 | 响应状态码 + 响应体 JSON 快照 + 请求体哈希 |
| 请求体不一致 | 同 key 不同 body → `409 CONFLICT`，`details.reason = IDEMPOTENCY_KEY_REUSED` |
| 保留期 | 24 小时（Worker 清理） |
| 处理中并发 | 第二个请求拿不到快照也拿不到锁 → 返回 `409 CONFLICT`，`details.reason = REQUEST_IN_FLIGHT` |

---

## 5. 完整端点示例 ①：`groupbuy` 创建拼单

### 5.1 定义

| 项 | 值 |
| --- | --- |
| Method | `POST` |
| Path | `/api/v1/groupbuy/items` |
| 认证 | 必需 |
| 幂等 | 必需（`Idempotency-Key`） |
| 权限域 | `domain:trade`（低敏，仅需登录） |
| 限流 | 每用户 10 分钟 5 次 |

### 5.2 请求

```http
POST /api/v1/groupbuy/items HTTP/1.1
Host: api.kedaya.example
Authorization: Bearer eyJhbGciOiJFUzI1NiIs...
Content-Type: application/json
Idempotency-Key: 7f3a9c21-4b8e-4d1a-9f02-5c6d7e8f9a0b
X-KedaYa-Trace: 0f8b3a1c9d2e4f56
```

```json
{
  "title": "海底捞拼单",
  "description": "周五晚上去五角场，还差两人，AA",
  "category": "food",
  "targetCount": 4,
  "unitAmountFen": 8800,
  "deadlineAt": "2026-10-17T12:00:00.000Z",
  "pickupSpot": "学校北门",
  "publish": true
}
```

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `title` | `string` | 是 | 1–60 字符 |
| `description` | `string` | 否 | ≤1000 字符 |
| `category` | `enum<food\|drink\|supplies\|ticket\|other>` | 是 | |
| `targetCount` | `int` | 是 | 2–50 |
| `unitAmountFen` | `int` | 否 | 0–1000000（1 万元） |
| `deadlineAt` | `string(date-time)` | 是 | 必须 > now+1h 且 ≤ now+7d |
| `pickupSpot` | `string` | 否 | ≤120 字符；`category` 为 `food` 时必填 |
| `publish` | `bool` | 否 | 默认 `true`。`false` 则存为 `DRAFT` |

### 5.3 成功响应 · `201 Created`

```json
{
  "ok": true,
  "data": {
    "id": "01JBXR8K7M3QZ9V0P2N4T6W8YA",
    "title": "海底捞拼单",
    "description": "周五晚上去五角场，还差两人，AA",
    "category": "food",
    "status": "OPEN",
    "targetCount": 4,
    "joinedCount": 1,
    "unitAmountFen": 8800,
    "totalAmountFen": 35200,
    "deadlineAt": "2026-10-17T12:00:00.000Z",
    "pickupSpot": "学校北门",
    "creator": {
      "id": "01JBXR1A2B3C4D5E6F7G8H9J0K",
      "nickname": "可达鸭本鸭",
      "avatarUrl": "https://cdn.example/avatars/01JBXR1A.png"
    },
    "members": [
      {
        "orderId": "01JBXR8K7M3QZ9V0P2N4T6W8YB",
        "userId": "01JBXR1A2B3C4D5E6F7G8H9J0K",
        "nickname": "可达鸭本鸭",
        "status": "JOINED",
        "quantity": 1,
        "joinedAt": "2026-10-16T10:30:00.000Z"
      }
    ],
    "createdAt": "2026-10-16T10:30:00.000Z",
    "updatedAt": "2026-10-16T10:30:00.000Z"
  },
  "traceId": "0f8b3a1c9d2e4f56"
}
```

**注意**：创建者自动占 1 个名额（`joinedCount: 1`），并已生成一条 `GroupbuyOrder`。这是契约外但领域模型明确的行为（见 [02-domain-model.md](./02-domain-model.md) §1.2）。

### 5.4 错误响应

| HTTP | `code` | `details.reason` | 触发条件 |
| --- | --- | --- | --- |
| 401 | `UNAUTHENTICATED` | — | 无 token |
| 422 | `VALIDATION_FAILED` | `TITLE_TOO_LONG` / `DEADLINE_TOO_SOON` / `DEADLINE_TOO_FAR` / `TARGET_COUNT_OUT_OF_RANGE` / `PICKUP_SPOT_REQUIRED` | Zod 校验失败，`details.issues` 是字段级数组 |
| 429 | `RATE_LIMITED` | — | 10 分钟超 5 次，响应头带 `Retry-After: 300` |
| 409 | `CONFLICT` | `IDEMPOTENCY_KEY_REUSED` | 同 key 不同 body |
| 409 | `CONFLICT` | `REQUEST_IN_FLIGHT` | 同 key 并发 |
| 500 | `INTERNAL` | — | 未预期错误 |

`VALIDATION_FAILED` 的 `details` 形状：

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "拼单信息有几处需要修改",
    "details": {
      "issues": [
        { "path": ["deadlineAt"], "reason": "DEADLINE_TOO_SOON", "message": "截止时间至少要在 1 小时之后" },
        { "path": ["targetCount"], "reason": "TARGET_COUNT_OUT_OF_RANGE", "message": "成团人数需要在 2 到 50 之间" }
      ]
    }
  },
  "traceId": "0f8b3a1c9d2e4f56"
}
```

### 5.5 OpenAPI 片段

```yaml
paths:
  /groupbuy/items:
    post:
      tags: [groupbuy]
      summary: 创建拼单
      operationId: createGroupbuy
      parameters:
        - $ref: '#/components/parameters/IdempotencyKey'
        - $ref: '#/components/parameters/TraceHeader'
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/CreateGroupbuyBody' }
      responses:
        '201':
          description: 创建成功
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/EnvelopeOk'
                  - type: object
                    properties:
                      data: { $ref: '#/components/schemas/GroupbuyDetail' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '409': { $ref: '#/components/responses/Conflict' }
        '422': { $ref: '#/components/responses/ValidationFailed' }
        '429': { $ref: '#/components/responses/RateLimited' }
```

### 5.6 领域动作端点

| Method | Path | 说明 | 幂等 |
| --- | --- | --- | --- |
| `POST` | `/groupbuy/items/{id}/join` | 参团 | 必需 |
| `POST` | `/groupbuy/items/{id}/withdraw` | 退出 | 必需 |
| `POST` | `/groupbuy/items/{id}/publish` | 草稿发布 | 必需 |
| `POST` | `/groupbuy/items/{id}/settle` | 发起结算 | 必需 |
| `POST` | `/groupbuy/orders/{orderId}/confirm` | 确认到货 | 必需 |
| `POST` | `/groupbuy/items/{id}/cancel` | 取消 | 必需 |
| `POST` | `/groupbuy/items/{id}/dispute` | 申诉 | 必需 |

全部遵循契约 §6.1 的 `POST /api/v1/<mod>/items/:id/<action>` 形状。

---

## 6. 完整端点示例 ②：`wellbeing` 预约咨询

### 6.1 定义

| 项 | 值 |
| --- | --- |
| Method | `POST` |
| Path | `/api/v1/wellbeing/appointments` |
| 认证 | 必需 |
| 幂等 | 必需 |
| 权限域 | `domain:wellbeing`（**最高敏感**） |
| 前置 | `ConsentRecord(module='wellbeing', status='GRANTED')` 必须存在 |
| 限流 | 每用户 24 小时 3 次（防刷时段） |
| 审计 | **全量**：创建、读取、取消都落审计 |

### 6.2 请求

```http
POST /api/v1/wellbeing/appointments HTTP/1.1
Host: api.kedaya.example
Authorization: Bearer eyJhbGciOiJFUzI1NiIs...
Content-Type: application/json
Idempotency-Key: 2c1b0a98-7654-4321-fedc-ba9876543210
X-KedaYa-Trace: 7d2c1b0a9e8f7a65
```

```json
{
  "slotStart": "2026-10-20T06:00:00.000Z",
  "mode": "offline",
  "topic": "academic",
  "intakeNote": "最近期末压力比较大，想聊聊时间安排",
  "anonToCounselor": true,
  "consentRecordId": "01JBXS9P8Q7R6S5T4U3V2W1X0Y"
}
```

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `slotStart` | `string(date-time)` | 是 | 必须是 `ListSlots` 返回的可用时段之一 |
| `mode` | `enum<online\|offline>` | 是 | |
| `topic` | `enum<stress\|relationship\|sleep\|academic\|crisis\|other>` | 是 | `crisis` 走紧急流程 |
| `intakeNote` | `string` | 否 | ≤1000 字符，**服务端加密后存储** |
| `anonToCounselor` | `bool` | 否 | 默认 `false` |
| `consentRecordId` | `string` | 是 | 必须属于当前用户且 `status = GRANTED` |

### 6.3 成功响应 · `201 Created`

**注意响应里没有 `userId`、没有学号、没有姓名。** 这是刻意的：客户端不需要，泄漏面为零。

```json
{
  "ok": true,
  "data": {
    "id": "01JBXT1M2N3P4Q5R6S7T8U9V0W",
    "status": "PENDING",
    "slotStart": "2026-10-20T06:00:00.000Z",
    "slotEnd": "2026-10-20T06:30:00.000Z",
    "mode": "offline",
    "topic": "academic",
    "anonToCounselor": true,
    "hasIntakeNote": true,
    "crisisResources": [
      {
        "name": "全国心理援助热线",
        "phone": "12356",
        "hours": "24 小时",
        "priority": 1
      }
    ],
    "createdAt": "2026-10-16T11:05:00.000Z"
  },
  "traceId": "7d2c1b0a9e8f7a65"
}
```

**`hasIntakeNote: boolean` 而不是 `intakeNote: string`**：创建响应不回显敏感正文，客户端只需知道"填了没有"。

**`crisisResources` 恒定返回**：契约 §9 要求危机干预出口不可被埋进二级菜单。把它放在预约响应里，客户端就有能力在任何心理相关页面上渲染入口。

### 6.4 错误响应

| HTTP | `code` | `details.reason` | 触发条件 |
| --- | --- | --- | --- |
| 401 | `UNAUTHENTICATED` | — | 无 token |
| 403 | `CONSENT_REQUIRED` | — | 无有效 `ConsentRecord`。`details` 带 `{ "module": "wellbeing", "scope": "wellbeing-v1" }` |
| 422 | `VALIDATION_FAILED` | `SLOT_NOT_AVAILABLE` / `SLOT_IN_PAST` / `INTAKE_NOTE_TOO_LONG` | |
| 409 | `CONFLICT` | `SLOT_TAKEN` | 并发抢同一时段（行锁拒绝） |
| 409 | `CONFLICT` | `APPOINTMENT_LIMIT_REACHED` | 24 小时内已有 3 条 |
| 429 | `RATE_LIMITED` | — | |
| 502 | `UPSTREAM_UNAVAILABLE` | — | 排班系统不可用 |

`CONSENT_REQUIRED` 完整示例：

```json
{
  "ok": false,
  "error": {
    "code": "CONSENT_REQUIRED",
    "message": "使用心理服务前，需要你先确认知情同意",
    "details": {
      "module": "wellbeing",
      "scope": "wellbeing-v1",
      "consentPath": "/api/v1/profile/consents"
    }
  },
  "traceId": "7d2c1b0a9e8f7a65"
}
```

### 6.5 审计与不落日志（**硬要求**）

| 数据 | 是否落审计 | 是否落应用日志 |
| --- | --- | --- |
| 预约 ID、动作、actor、时间 | 是 | 是 |
| `intakeNote` 正文 | **否** | **否** |
| 学号 / 姓名 | **否** | **否** |
| `topic` | 是（枚举，非自由文本） | 是 |

实现方式：`AuditInterceptor` 的字段白名单 + 日志中间件的脱敏规则，两者都在 `services/api/src/platform/audit/` 与 `.../logging/`。审计字段完整定义见 [05-security-privacy.md](./05-security-privacy.md) §5。

### 6.6 相关端点（**以实现为准**）

| Method | Path | 认证 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/wellbeing/crisis-line` | **无需登录** | 危机出口（热线 + 可执行的下一步）。公开、无需同意，前端**必须首屏**渲染 |
| `GET/POST/DELETE` | `/wellbeing/consents` | 必需 | 二次同意：列（含已撤回历史）/ 授予（幂等）/ 撤回（幂等） |
| `GET` | `/wellbeing/items?status=` | 必需 + 已同意 | 我的预约（**强制按登录主体过滤**，非本人一律 404） |
| `POST` | `/wellbeing/items` | 必需 + 已同意 | 创建预约（归属只从 JWT 取，请求体没有 `userId`） |
| `GET/PATCH/DELETE` | `/wellbeing/items/{id}` | 必需 + 已同意 + 本人 | 详情 / 更新 / 删除 |
| `POST` | `/wellbeing/items/{id}/cancel` | 同上 | 取消（`requested/confirmed → cancelled`） |
| `POST` | `/wellbeing/items/{id}/crisis` | 同上 | 标记紧急渠道，**不改状态**，返回热线 |

> ⚠️ 本节早先的草稿列过 `/wellbeing/slots`、`/wellbeing/appointments`、`/wellbeing/assessments`（PHQ-9 / GAD-7 量表）。
> **量表与诊断不做**——那是医疗行为，可达鸭只做倾听与预约入口。上面的表以 `services/api/src/modules/wellbeing/` 的
> 实际路由为准，端到端可用性验证见 `docs/delivery-plan.md` 的本轮记录。

---

## 7. 完整端点示例 ③：`forum` 发帖

### 7.1 定义

| 项 | 值 |
| --- | --- |
| Method | `POST` |
| Path | `/api/v1/forum/items` |
| 认证 | 必需 |
| 幂等 | 必需 |
| 权限域 | `domain:social`（中敏） |
| 限流 | 每用户 10 分钟 3 帖、24 小时 20 帖 |
| 内容审核 | 同步敏感词检查 + 异步图片审核 |

### 7.2 请求

```http
POST /api/v1/forum/items HTTP/1.1
Host: api.kedaya.example
Authorization: Bearer eyJhbGciOiJFUzI1NiIs...
Content-Type: application/json
Idempotency-Key: a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d
X-KedaYa-Trace: 3e4d5c6b7a8f9e01
```

```json
{
  "boardSlug": "study",
  "title": "选课求建议：机器学习导论还是统计学习",
  "body": "两门课时间冲突，想听听上过的同学的意见。\n\n主要关心作业量和考试形式。",
  "anonymous": true,
  "tags": ["选课", "机器学习"]
}
```

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `boardSlug` | `string` | 是 | 必须存在且当前用户可见（`visibility` 检查） |
| `title` | `string` | 是 | 1–100 字符 |
| `body` | `string` | 是 | 1–20000 字符，Markdown 子集 |
| `anonymous` | `bool` | 否 | 默认 `false` |
| `tags` | `string[]` | 否 | ≤5 个，每个 1–16 字符，去重 |
| `publish` | `bool` | 否 | 默认 `true` |

### 7.3 成功响应 · `201 Created`

```json
{
  "ok": true,
  "data": {
    "id": "01JBY2N3P4Q5R6S7T8U9V0W1XA",
    "board": { "slug": "study", "name": "学业交流" },
    "title": "选课求建议：机器学习导论还是统计学习",
    "body": "两门课时间冲突，想听听上过的同学的意见。\n\n主要关心作业量和考试形式。",
    "status": "PUBLISHED",
    "anonymous": true,
    "author": {
      "displayName": "匿名鸭 #4821",
      "anonymousId": "01JBY2N3P4Q5R6S7T8U9V0W1XB",
      "isAnonymous": true
    },
    "tags": ["选课", "机器学习"],
    "replyCount": 0,
    "likeCount": 0,
    "createdAt": "2026-10-16T11:20:00.000Z",
    "updatedAt": "2026-10-16T11:20:00.000Z"
  },
  "traceId": "3e4d5c6b7a8f9e01"
}
```

**关键设计**：`author.displayName` 在匿名时是**稳定的匿名昵称**（`匿名鸭 #4821`），由 `AnonymousIdentity.id` 派生。

| 为什么这样做 | 理由 |
| --- | --- |
| 匿名昵称稳定 | 同一人在同一帖里连续回复能被认出是同一人，讨论可读 |
| 昵称不含任何实名线索 | 序号是每用户独立的随机盐哈希派生，不可逆 |
| 返回 `anonymousId` | 客户端可据此做"我发的"高亮，无需服务端额外接口 |
| 版主视角不同 | 版主调用同一端点时 `author` 里多一个 `moderatorView.realUserId` 字段，且**该访问落审计** |

### 7.4 错误响应

| HTTP | `code` | `details.reason` | 触发条件 |
| --- | --- | --- | --- |
| 401 | `UNAUTHENTICATED` | — | 无 token |
| 403 | `FORBIDDEN` | `BOARD_CAMPUS_ONLY` | 板块要求登录且用户为访客 |
| 404 | `NOT_FOUND` | — | 板块不存在 |
| 422 | `VALIDATION_FAILED` | `TITLE_EMPTY` / `TITLE_TOO_LONG` / `BODY_TOO_LONG` / `TOO_MANY_TAGS` / `TAG_TOO_LONG` | |
| 422 | `VALIDATION_FAILED` | `SENSITIVE_WORD` | 命中敏感词。`details.matched` 只给**位置与类别**，不回显词本身 |
| 429 | `RATE_LIMITED` | — | 10 分钟超 3 帖 |

`SENSITIVE_WORD` 示例：

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "内容里包含不合适的表述，请修改后重试",
    "details": {
      "issues": [
        { "path": ["body"], "reason": "SENSITIVE_WORD", "message": "第 12 行附近包含不合适的表述", "category": "abuse" }
      ]
    }
  },
  "traceId": "3e4d5c6b7a8f9e01"
}
```

**为什么不回显命中的词**：回显等于给出敏感词表，会被用来绕过。

### 7.5 相关端点

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/forum/items?board=&cursor=&limit=` | 帖子列表 |
| `GET` | `/forum/items/{id}` | 详情（含前 20 条回复） |
| `PATCH` | `/forum/items/{id}` | 编辑（仅作者，15 分钟内） |
| `DELETE` | `/forum/items/{id}` | 删除（软删） |
| `POST` | `/forum/items/{id}/replies` | 回复 |
| `POST` | `/forum/items/{id}/report` | 举报 |
| `POST` | `/forum/items/{id}/lock` | 版主锁定 |
| `POST` | `/forum/items/{id}/hide` | 版主隐藏 |

---

## 8. 错误码与 `details.reason` 的登记表

`ApiErrorCode` 是**冻结的 10 个**（契约 §6.1）。`details.reason` 是开放集合，但必须在 `packages/contracts/src/errors/reasons.ts` 登记——**未登记的 reason 不允许出现在代码里**（lint 规则检查字符串字面量）。

```ts
// packages/contracts/src/errors/reasons.ts（示意）
export const REASONS = {
  groupbuy: ['GROUP_FULL', 'GROUP_EXPIRED', 'ALREADY_JOINED', 'NOT_CREATOR', 'CANNOT_WITHDRAW_AFTER_FORMED'],
  wellbeing: ['SLOT_NOT_AVAILABLE', 'SLOT_TAKEN', 'SLOT_IN_PAST', 'APPOINTMENT_LIMIT_REACHED'],
  forum: ['BOARD_CAMPUS_ONLY', 'SENSITIVE_WORD', 'TOO_MANY_TAGS', 'EDIT_WINDOW_CLOSED'],
  common: ['IDEMPOTENCY_KEY_REUSED', 'REQUEST_IN_FLIGHT', 'NOT_FOUND_OR_FORBIDDEN'],
} as const;
```

---

## 9. 客户端消费方式

### 9.1 三个端各自怎么用契约

| 端 | 消费方式 |
| --- | --- |
| 小程序（Taro） | 直接 import `@kedaya/contracts`；Zod schema 用于**响应解析**（不信服务端） |
| Web（Next.js） | 同上；Server Component 里直接用 schema 解析 |
| Flutter | 通过 `openapi-typescript` → JSON Schema → `json_serializable` 生成 DTO；**不手写模型** |
| NestJS | Zod schema 同时用于请求校验（`ZodValidationPipe`）与 OpenAPI 生成 |

### 9.2 三端共用的请求封装要求

```ts
// 三端都必须实现这四条
interface ApiClient {
  // 1. 自动注入 Authorization 与 X-KedaYa-Trace
  request<T>(req: ApiRequest): Promise<ApiEnvelope<T>>;
  // 2. 401 时静默 refresh 并重试一次，失败才跳登录
  // 3. 写操作自动生成 Idempotency-Key（同一逻辑请求复用同一个 key）
  // 4. 网络层错误统一包成 { ok: false, error: { code: 'INTERNAL' } }，不抛异常
}
```

第 4 条是刻意的：**不抛异常**让调用方不必写 try/catch，用 `Result` 风格处理。Flutter 侧的 `Result<T, E>` 定义在 `@kedaya/shared` 的等价 Dart 版本里（契约 §6.3）。

---

## 10. 版本与兼容

| 变更 | 是否破坏兼容 | 做法 |
| --- | --- | --- |
| 新增可选请求字段 | 否 | 直接加 |
| 新增响应字段 | 否 | 直接加；客户端必须容忍未知字段 |
| 新增枚举值 | **是**（对穷尽 switch 的客户端） | 客户端必须有 `default` 分支；新增前评估 |
| 删除/重命名字段 | 是 | 走 `/api/v2` |
| 收紧校验 | 是 | 至少提前一个版本发公告 + 双写期 |

**Flutter 端特别注意**：`assertNever` 风格的穷尽 switch 遇到新枚举值会崩。所有枚举解析必须有 fallback 到 `UNKNOWN` 的分支，且未知值**不得**导致 UI 崩溃。

---

## 11. 本文档未决问题

| # | 问题 | 影响 |
| --- | --- | --- |
| A1 | `total` 字段是否在列表接口统一返回？当前约定"低成本才算"，但"低成本"没有客观标准 | 客户端分页 UI 无法统一 |
| A2 | 契约未定义 `PATCH` 的语义（JSON Merge Patch vs JSON Patch）。本文按 Merge Patch（`application/merge-patch+json`）设计 | 需 Lead 确认并补进契约 |
| A3 | 契约 §6.1 的 `POST /api/v1/<mod>/items/:id/<action>` 未规定 action 名是否要在契约里冻结。本文按各模块自由命名 | 三端 action 名可能漂移 |
| A4 | 未定义 webhook / 事件推送给客户端的机制（当前只有轮询 + 推送通知） | 实时性受限 |
| A5 | 敏感模块的 404 vs 403 边界：本文规定"无权可见一律 404"，但 `wellbeing` 的 `CONSENT_REQUIRED` 用 403 会泄漏"这个模块存在" | 需权衡；当前认为"模块存在"是公开信息，可接受 |
| A6 | `Idempotency-Key` 在 GET 上无意义，契约说"写操作支持"，未明确 PUT/PATCH/DELETE 是否必需 | 本文规定 POST 必需、PATCH/PUT/DELETE 可选 |
