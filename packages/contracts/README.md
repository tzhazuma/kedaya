# @kedaya/contracts

可达鸭**三端共享契约** —— 响应信封、错误码、26 个模块注册表、OpenAPI 3.1。

## 为什么需要它

小程序、Flutter、Web 三个客户端 + 一个后端，如果各自定义错误码和模块清单，
就一定会漂移：小程序叫 `UNAUTHORIZED`、后端叫 `UNAUTHENTICATED`、Flutter 又叫别的。
本包把这些收敛到**一处**。

## 内容

### 1. 统一响应信封（`src/envelope.ts`）

```ts
import { unwrap, toResult, type ApiEnvelope } from "@kedaya/contracts";

// 抛异常版本
try {
  const order = unwrap(envelope);          // 成功返回 data，失败抛 ApiEnvelopeError
} catch (e) {
  if (e instanceof ApiEnvelopeError) {
    if (e.needsConsent)        redirectToConsent();
    if (e.needsCampusBinding)  redirectToBinding();
  }
}

// 不抛异常版本
const r = toResult(envelope);
if (!r.ok) console.warn(r.error.code, r.traceId);
```

**错误码（冻结，与 OpenAPI 枚举一一对应）**

| code | 含义 | 客户端应有反应 |
| ------------------------- | -------------------- | -------------------------- |
| `UNAUTHENTICATED` | 未登录 / token 失效 | 跳登录 |
| `FORBIDDEN` | 无权限 | 提示 |
| `NOT_FOUND` | 资源不存在 | 空态 |
| `VALIDATION_FAILED` | 参数校验失败 | 字段级报错 |
| `RATE_LIMITED` | 限流 | 退避重试 |
| `CONFLICT` | 状态冲突（拼单已满） | 刷新后提示 |
| `CAMPUS_BINDING_REQUIRED` | 需绑定校园系统 | 引导绑定（**不是**跳登录） |
| `CONSENT_REQUIRED` | 需二次同意 | 引导同意（**不是**跳登录） |
| `UPSTREAM_UNAVAILABLE` | 上游校园系统不可用 | 降级 / 稍后重试 |
| `INTERNAL` | 服务端错误 | 提示 + traceId |

> ⚠️ `CAMPUS_BINDING_REQUIRED` 与 `CONSENT_REQUIRED` **都不是认证问题**。
> 用户已登录，只是缺绑定或缺同意。把它当 401 处理会导致用户被反复踢回登录页 ——
> 这正是两级身份模型要避免的（见 `docs/architecture/00-FROZEN-CONTRACT.md` §5）。

### 2. 模块注册表（`src/modules.ts`）

26 个模块的**唯一清单**。三端的导航、宫格、权限判定全部由它驱动。

```ts
import {
  MODULES,
  BUSINESS_MODULES,
  CONSENT_MODULES,
  getModule,
  modulePath,
} from "@kedaya/contracts";

MODULES.map((m) => m.nameZh);              // 25 个中文名
CONSENT_MODULES.map((m) => m.id);          // ['dorm-harmony','ai-portrait','wellbeing']
getModule("wellbeing")?.sensitivity; // 'critical'
modulePath("groupbuy", "items", 123); // 'groupbuy/items/123'
```

| 字段 | 说明 |
| ------------------- | ----------------------------------------- |
| `id` | 冻结的 key，同时是 API 路由段 |
| `nameZh` / `nameEn` | 中文名 / 英文标识 |
| `summary` | 一句话定义 |
| `category` | `business` \| `core` |
| `sensitivity` | `low` \| `medium` \| `high` \| `critical` |
| `requiresConsent` | 是否必须二次同意 |
| `route` | API 路由前缀 |

**敏感级与同意门是两件事**（契约 §9）：

- `auth` / `campus-card` 是 `high`，但 `requiresConsent: false` —— 登录/开卡行为本身就是同意
- `wellbeing` / `dorm-harmony` / `ai-portrait` 才需要显式二次同意

### 3. 校园活动域（`src/activities.ts`）

第 25 个模块 `activities` 是**独立域**，不并进课程 `deadlines`：

- 来源只有 `campus-mail` / `wechat-mp` / `manual`，**没有自动发现或批量抓取**；
- 抽取 / 导入只产生 `candidate`，用户确认后才进入活动日程视图（ICS / 系统日历）
  并生成提醒；**不写入课程课表**；
- 只存活动字段 + ≤200 字证据片段，不存邮件正文 / 公众号全文；
- 提醒 MVP 只有站内信 `inapp`；`wechat-subscribe` 未接通前不得标成已送达；
- 路由常量覆盖列表、手动创建、确认、忽略、归档、恢复、单篇公众号 / 邮件导入、
  提醒增删与管理员派发（`ACTIVITY_ROUTES`）；
- 多候选导入响应 `ActivityImportResult` 是 `{ item, items, created, skipped }`；
- 小程序页面路径在 `MINIAPP_PAGES` 里登记了列表 / 详情 / 导入 / 邮件提升 / 提醒五页。

### 4. OpenAPI 3.1（`openapi/kedaya.v1.yaml`）

三端与后端之间的接口契约。包含全部**有后端端点**的 21 个模块的 tag、
统一信封 schema、10 个错误码、以及各模块的资源路径与实体 schema。

```bash
# 用 Swagger UI 打开
npx @redocly/cli preview-docs packages/contracts/openapi/kedaya.v1.yaml
```

## 契约一致性由测试保证

`src/openapi.test.ts` 会把 YAML 与 TS 类型对账：

- OpenAPI 的 `ApiErrorCode` 枚举 **必须**与 `envelope.ts` 的联合类型完全一致
- 每个 path 的第一段必须是已注册的模块路由
- 有后端端点的模块必须有 tag 且至少一个端点（无端点的模块显式排除）
- `CampusBindingSummary` **不得**含任何 `cookie` / `session` / `tgc` 字段（契约 §5）
- 金额字段一律 `*Fen` 且必须是 `integer`（整数分）
- 敏感模块端点必须标注 `CONSENT_REQUIRED`
- 活动域：`candidate` 必须经独立 confirm 动作才能进入活动日程视图（ICS / 系统日历）；导入只接受单篇公众号 / 用户勾选的邮件
- 活动导入：单篇公众号与邮件提升都返回 `{ item, items, created, skipped }`（一篇文章可能识别出多场活动）
- 活动提醒：列表 `status=scheduled` 是 `pending + sending` 的别名，不是落库状态
- 活动归档 / 恢复：`archive` / `restore` 是独立领域动作；恢复只回到 `candidate`，不自动确认
- 管理员派发：`POST /activities/reminders/dispatch` 接受管理员 JWT 或 `x-admin-key`，并声明 401/403
- `wellbeing/crisis-line` 必须 `security: []`（危机出口不能被门槛拦住）

```bash
npm run test -w @kedaya/contracts
```

**改了 YAML 或 TS 任一边，另一边不同步就会红。** 这是故意的。

## 消费方式

在 package.json 里写：

```json
{ "dependencies": { "@kedaya/contracts": "*" } }
```

本包直接暴露 TS 源码（`main: ./src/index.ts`），
由消费者的打包器编译。Next.js 需要在 `next.config.ts` 里加：

```ts
transpilePackages: [
  "@kedaya/contracts",
  "@kedaya/design-tokens",
  "@kedaya/shared",
];
```
