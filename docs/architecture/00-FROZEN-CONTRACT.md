# 可达鸭 · 冻结契约 (FROZEN CONTRACT)

> **这是所有并行工作流的唯一接口真相来源。**
> 任何工作流开始编码前必须先读本文件。本文件由 Lead 维护；子工作流**不得修改**本文件，
> 若发现契约缺陷，在自己的交付说明中提出，由 Lead 统一修订。

版本：`v1` · 冻结日期：2026-10-16

---

## 1. 产品定义

| 项 | 值 |
| --- | --- |
| 产品名 | **可达鸭** (KedaYa) |
| 英文标识 | `kedaya` |
| 全称 | 上海科技大学 · 统一校园服务平台 |
| Slogan | 上科大，什么需求都可以到达 |
| 定位 | 第三方开源校园服务平台（非官方），聚合上科大校内分散的服务入口 |
| 覆盖端 | ① 微信小程序（**主端**）② 原生移动端 iOS/Android/鸿蒙 ③ Web |

**名字含义**：可达鸭 = "在上科大什么需求都可以到达" 的鸭。

**IP 声明**：吉祥物为**原创**美术（`assets/brand/kedaya-mascot.svg`），与任何第三方角色形象无关。
不得引入任天堂/宝可梦官方素材。详见 `docs/adr/0005-brand-and-ip.md`。

---

## 2. 技术栈（已冻结，版本已从 npm registry 核实）

| 层 | 选型 | 版本 |
| --- | --- | --- |
| 包管理 | npm workspaces | npm 11 |
| 构建编排 | Turborepo | `2.11.8` |
| 语言 | TypeScript | `5.9.3`（**不用 7.x**，生态未稳） |
| 小程序（主） | Taro + **React 18** | `4.3.0` / `18.3.1` |
| Web | Next.js App Router + React 19 | `16.4.2` / `19.3.1` |
| 原生移动端 | Flutter | SDK `>=3.6.2 <4.0.0` |
| 后端 | NestJS | `12.1.3` |
| ORM | Prisma | `7.10.1` |
| 数据库 | PostgreSQL | 16 |
| 缓存/队列 | Redis | 7 |
| 校验 | Zod | `4.6.7` |
| 前端数据层 | TanStack Query | `5.104.3` |
| 样式 | Tailwind CSS | `4.3.3` |
| 测试 | Vitest | `5.0.5` |
| Lint | ESLint | `10.12.0` |

### ⚠️ React 大版本按端不同（刻意，不要"统一"）

`@tarojs/react@4.3.0` 的 peer 是 **`react@^18`**，`@tarojs/taro@4.3.0` 的 peer 是 **`@types/react@^18`**；
而 `next@16.4.2` 的 peer 是 `react@^18.2.0 || ^19.0.0`（两端都接受）。

因此：

| 端 | React | @types/react | @types/react-dom |
| --- | --- | --- | --- |
| `apps/miniapp`（Taro） | `18.3.1` | `^18.3.31` | `^18.3.7` |
| `apps/web`（Next.js） | `19.3.1` | `^19.3.0` | `^19.3.0` |

npm workspaces 会为不同 workspace **嵌套安装**各自的 React 大版本，两端可以共存。

**不要试图统一**：
- 统一到 18 → Web 端退回旧主版本，白白放弃 React 19；
- 统一到 19 → 破坏 Taro 4.3 的 peer 契约，`npm install` 直接 ERESOLVE 失败。

> 这是 M0 阶段被真实 `npm install` 抓出来的契约缺陷（由 `api-nest` 上报、Lead 用
> 隔离镜像 `npm install --package-lock-only` 复现并修复）。教训：**冻结契约里的版本组合
> 必须用真实安装验证过**，不能只看"最新版本号"就写进契约。

**为什么小程序选 Taro 而不是 uni-app**：见 `docs/adr/0002-miniapp-framework.md`。
**为什么原生端选 Flutter 而不是 RN**：见 `docs/adr/0003-mobile-framework.md`。

---

## 3. 仓库布局（写作用域，互不重叠）

```
kedaya/
├── docs/                 ← 工作流 A (arch-docs)
│   ├── architecture/
│   └── adr/
├── apps/
│   ├── miniapp/          ← 工作流 C (miniapp-taro)   微信小程序（主）+ H5
│   ├── web/              ← 工作流 D (web-next)       Next.js Web 门户 + 管理后台
│   └── mobile/           ← 工作流 B (mobile-flutter) Flutter iOS/Android/鸿蒙
├── services/
│   └── api/              ← 工作流 E (api-nest)       NestJS 后端
├── packages/             ← Lead 独占（共享契约层，高耦合）
│   ├── contracts/        @kedaya/contracts
│   ├── design-tokens/    @kedaya/design-tokens
│   └── shared/           @kedaya/shared
├── assets/brand/         ← Lead 独占
├── package.json          ← Lead 独占
├── turbo.json            ← Lead 独占
└── tsconfig.base.json    ← Lead 独占
```

**硬规则**：只写自己作用域内的文件。需要跨作用域改动时，写进交付说明交给 Lead。

---

## 4. 功能模块 ID（冻结，所有端必须使用同一套 key）

### 4.1 业务模块（来自需求图）

| ID | 中文名 | 一句话定义 | 敏感级 |
| --- | --- | --- | --- |
| `groupbuy` | 拼单 | 拼团/凑单：发起、参团、成团、结算 | 低 |
| `takeout-guard` | 偷外卖 | 外卖被拿错的举报、举证、协商、信用记录 | 中 |
| `flea-market` | 跳蚤 | 二手闲置发布、搜索、议价、面交 | 低 |
| `dorm-harmony` | 宿舍矛盾 | 匿名调解申请、调解员介入、公约投票 | **高** |
| `errand` | 跑腿 | 代取快递/买饭/送件，悬赏与接单 | 低 |
| `buddy` | 找搭子 | 运动/自习/吃饭/出行 组队匹配 | 低 |
| `lost-found` | 失物招领 | 丢失登记、拾获登记、双向匹配 | 低 |
| `canteen` | 食堂营养 | 菜品营养数据、热量估算、饮食建议 | 低 |
| `forum` | 论坛 | 版块、主题、回复、举报与治理 | 中 |
| `ai-portrait` | AI 校园画像 | 基于用户行为的画像与推荐（可解释、可关闭） | **高** |
| `wellbeing` | 心理支持 | 倾听与预约入口，危机出口在首屏；不做诊断、不做治疗 | **最高** |
| `faq` | 常见问题 | 知识库、工单式自助答疑 | 低 |
| `techpie` | TechPie 整合 | 与 TechPie / GeekPie 体系互联互通 | 中 |
| `wildlife` | 猫鸟黑天鹅 | 校园动物活动区域地图、投喂规范、上报 | 低 |

### 4.2 基础模块

| ID | 中文名 | 说明 |
| --- | --- | --- |
| `auth` | 身份 | 上科大统一身份认证 + 第三方绑定（见 §5） |
| `schedule` | 课表 | 学期、课程表、考试 |
| `campus-card` | 校园卡 | 余额、流水、付款码 |
| `profile` | 我的 | 资料、设置、隐私开关 |
| `notifications` | 通知 | 站内信、订阅消息（小程序）/推送 |

**敏感级含义**：`高`/`最高` 模块必须走独立权限域 + 审计日志 + 最小化数据采集，见 §7。

---

## 5. 身份模型（继承 TechPie 两级模型，但解耦）

这是本项目**最容易出错**的地方，必须严格分层：

```
第一级 · 身份层 (Identity)     上科大统一身份认证 (CAS / Egate OAuth)
                               → 决定 "你是谁" : userId / 学号 / 姓名 / 院系
                               → 唯一产出 KedaYa 自有 JWT (access + refresh)

第二级 · 能力层 (Campus Session) 第三方系统绑定 (eGate / CpDaily / 教务 / 一卡通)
                               → 决定 "你能访问哪些校园系统"
                               → 产出各系统的 session cookie，绝不上抛为身份
```

**硬规则**

1. `AuthPort` 只认第一级。它**不知道**任何校园系统的 cookie/session/tgc。
2. 任何校园系统能力必须通过 `CampusSessionPort` 获取，不得从 `AuthPort` 读取。
3. 可以"已登录但未绑定" —— 此时身份有效，校园系统功能返回 `CAMPUS_BINDING_REQUIRED`。
4. 敏感模块（`wellbeing`/`dorm-harmony`/`ai-portrait`）的授权是**独立**的，需二次同意。

---

## 6. 冻结的包接口

### 6.1 `@kedaya/contracts`

```ts
// 统一响应信封
export type ApiEnvelope<T> =
  | { ok: true; data: T; traceId: string }
  | { ok: false; error: ApiError; traceId: string };

export interface ApiError {
  code: ApiErrorCode;      // 机器可读，见下
  message: string;         // 面向用户的中文
  details?: unknown;
}

export type ApiErrorCode =
  | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_FAILED'
  | 'RATE_LIMITED' | 'CONFLICT' | 'CAMPUS_BINDING_REQUIRED'
  | 'CONSENT_REQUIRED' | 'UPSTREAM_UNAVAILABLE' | 'INTERNAL';

// 分页
export interface Page<T> { items: T[]; nextCursor: string | null; total?: number }

// 所有请求走这个形状
export interface ApiRequest<TBody = unknown> {
  path: string;                 // 不含 /api/v1 前缀
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: TBody;
  query?: Record<string, string | number | boolean | undefined>;
}
```

**HTTP 约定（冻结）**

- Base path：`/api/v1`
- 认证：`Authorization: Bearer <accessToken>`
- 追踪：请求头 `X-KedaYa-Trace`，响应体 `traceId`
- 幂等：写操作支持 `Idempotency-Key` 头
- 时间：ISO-8601 UTC 字符串；金额：**整数分**（`amountFen: number`）
- 列表：游标分页（`cursor` / `limit`），不用 offset

**模块路由前缀（冻结）**

```
/api/v1/auth/*        /api/v1/schedule/*
/api/v1/groupbuy/*    /api/v1/takeout-guard/*
/api/v1/flea-market/* /api/v1/dorm-harmony/*
/api/v1/errand/*      /api/v1/buddy/*
/api/v1/lost-found/*  /api/v1/canteen/*
/api/v1/forum/*       /api/v1/ai-portrait/*
/api/v1/wellbeing/*   /api/v1/faq/*
/api/v1/techpie/*     /api/v1/wildlife/*
/api/v1/profile/*     /api/v1/notifications/*
```

**每个模块的 CRUD 形状统一为**

```
GET    /api/v1/<mod>/items           列表（游标分页）
POST   /api/v1/<mod>/items           创建
GET    /api/v1/<mod>/items/:id       详情
PATCH  /api/v1/<mod>/items/:id       更新
DELETE /api/v1/<mod>/items/:id       删除/下架
POST   /api/v1/<mod>/items/:id/<action>   领域动作
```

### 6.2 `@kedaya/design-tokens`

**唯一真相**：`packages/design-tokens/src/tokens.ts`。所有端从它派生，不得手写色值。

```ts
export const tokens = {
  color: {
    brand: '#FFC53D', brandStrong: '#F08F2A', brandSoft: '#FFF3B8',
    ink: '#1B2436', inkSoft: '#33405A',
    bg: '#F7F8FA', surface: '#FFFFFF', surfaceAlt: '#F1F3F7',
    text: '#1F2733', textMuted: '#6B7A90', textInverse: '#FFFFFF',
    border: '#E3E8EF',
    success: '#22A06B', warning: '#E8833A', danger: '#D64545', info: '#3B82F6',
  },
  space:   { 0:0, 1:4, 2:8, 3:12, 4:16, 5:20, 6:24, 8:32, 10:40, 12:48, 16:64 },
  radius:  { sm:4, md:8, lg:12, xl:16, pill:999 },
  fontSize:{ xs:12, sm:14, md:16, lg:18, xl:20, xxl:24, display:32 },
  lineHeight: { tight:1.25, normal:1.5, loose:1.75 },
  fontWeight: { regular:400, medium:500, semibold:600, bold:700 },
  shadow: {
    sm: '0 1px 2px rgba(27,36,54,0.06)',
    md: '0 4px 12px rgba(27,36,54,0.08)',
    lg: '0 12px 32px rgba(27,36,54,0.12)',
  },
  fontFamily: {
    sans: 'PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif',
    mono: 'SFMono-Regular, Menlo, Consolas, monospace',
  },
} as const;
```

**派生产物（必须生成，文件名冻结）**

| 文件 | 消费者 | 形式 |
| --- | --- | --- |
| `dist/tokens.css` | Web (Next.js) | CSS 变量 `--kdy-color-brand` … |
| `dist/tokens.scss` | 小程序 (Taro) | SCSS 变量 `$kdy-color-brand` … |
| `dart/kedaya_tokens.dart` | Flutter | `class KedaYaTokens { static const Color brand = ...; }` |

CSS 变量命名：`--kdy-<group>-<key>`（camelCase 转 kebab-case），例如
`--kdy-color-brand-strong`、`--kdy-space-4`、`--kdy-radius-lg`。

### 6.3 `@kedaya/shared`

```ts
export type Result<T, E = string> =
  | { ok: true; value: T } | { ok: false; error: E };

export function fenToYuan(fen: number): string;        // 12345 -> "123.45"
export function yuanToFen(yuan: string): number;       // "123.45" -> 12345
export function formatRelativeTime(iso: string, now?: Date): string; // "3 分钟前"
export function isShanghaiTechEmail(email: string): boolean;         // *@shanghaitech.edu.cn
export function assertNever(x: never): never;
export function slugify(input: string): string;
```

---

## 7. 跨端架构约定（继承 TechPie 的六边形 + feature-first）

每个端内部统一分层，目录名冻结：

```
<app>/
├── app/            # 装配与启动：DI、路由注册、运行时工厂
├── application/    # 用例/控制器：编排，不含 IO
├── domain/         # 纯领域：模型 + ports(接口)，零依赖
│   ├── models/
│   └── ports/
├── data/           # adapters：实现 ports（api / storage / mock）
│   ├── api/
│   ├── repositories/
│   └── storage/
├── platform/       # 平台差异适配（scanner / notification / share）
└── presentation/   # UI：pages / components / theme
```

**依赖方向**：`presentation → application → domain ← data`。
`domain` **不得** import 任何框架或 IO。依赖倒置由 `domain/ports` 承载。

**硬规则**

1. `domain` 层零框架依赖（Flutter 端只允许 `dart:core` + 自有模型）。
2. 每个 feature 目录自带 `README.md`，写清该模块的 ports 与用例。
3. 所有网络访问必须经过 `data/api/`，`presentation` 禁止直接发请求。
4. 必须有 mock adapter，让 UI 能在无后端时开发（`data/mock/`）。

---

## 8. 启动时序（三端一致，继承 TechPie）

```
1. 同步：从本地存储 hydrate 缓存（关键路径，禁止网络）
2. 立即渲染首屏（带缓存数据）
3. 后台并发：刷新 token → 拉取各模块数据 → 失败静默降级
```

**禁止**：启动时阻塞等待网络。首屏必须是缓存或骨架屏。

---

## 9. 隐私与合规（不可妥协）

| 规则 | 说明 |
| --- | --- |
| 敏感模块独立同意 | `wellbeing` / `dorm-harmony` / `ai-portrait` 首次进入必须显式二次同意，可随时撤回。**注意区分**：`auth` / `campus-card` 虽然也是 `high` 敏感（需审计 + 最小采集），但**不设同意门** —— 登录/开卡这个行为本身就是同意；再叠一层门只是无意义的点击。判定规则见 `packages/contracts/src/modules.test.ts` |
| 数据最小化 | 心理与宿舍矛盾数据**不进入**通用画像；`ai-portrait` 不得读取这两个域 |
| 匿名可用 | `forum` / `dorm-harmony` / `takeout-guard` 支持匿名身份，与实名身份解耦存储 |
| 审计 | 敏感模块读写全部落审计日志（谁、何时、对哪条记录、什么动作） |
| 未成年人/危机 | `wellbeing` 必须提供危机干预热线出口，且不可被埋进二级菜单 |
| 无官方冒充 | 全站显著标注"第三方非官方平台"，不冒充学校官方系统 |

---

## 10. 各工作流交付要求

每个工作流必须交付：

1. **可运行的骨架**，不是空目录 —— 至少一个能跑通的最小垂直切片。
2. 该作用域内的 `README.md`，含：如何启动、目录说明、已实现/未实现。
3. 自检证据：实际执行过的命令 + 真实输出（不许写"应该可以"）。
4. 未完成项与未知项**如实列出**。
5. 遵守本文件全部冻结项；偏离必须在交付说明中显式标注。

**验证命令由 Lead 在集成阶段统一执行**，子工作流需保证自己的作用域能被下列命令覆盖：

```bash
npm install                 # 根目录，workspace 链接
npx tsc -b                  # TS 全量类型检查
npm run build -w <app>      # 该 app 构建
npm run test -w <app>       # 该 app 测试
```

---

## 11. 契约补充规定（v1.1 · 2026-10-16）

> 本节由 Lead 在 **M0 集成期**补充，用于关闭 `arch-docs` 在 ADR 评审中提出的契约缺口。
> **与 §1–§10 同等效力。** 若与 §1–§10 冲突，以本节为准。

### 11.1 `PATCH` 语义 —— 用 JSON Merge Patch（关闭 A2）

写操作统一采用 **JSON Merge Patch（RFC 7396）**，媒体类型 `application/merge-patch+json`：

- 请求体**只含要改的字段**；未出现的字段保持原值
- 显式传 `null` 表示**清空该字段**
- **不支持** JSON Patch（`application/json-patch+json`）—— 三端都不需要，小程序端也没有成熟库

### 11.2 领域动作名冻结（关闭 A3）

`POST /api/v1/<module>/items/:id/<action>` 里的 `<action>` **是契约的一部分**，必须登记在册。
三端**不得自创** action 名。已冻结：

| 模块 | action | 语义 |
| --- | --- | --- |
| `groupbuy` | `join` | 参团 |
| `groupbuy` | `leave` | **成员**退团 |
| `groupbuy` | `cancel` | **发起人**取消整个拼单（与 `leave` 语义不同，两者都需要） |
| `groupbuy` | `settle` | 结算 |
| `errand` | `accept` | 接单 |
| `errand` | `complete` | 送达完成 |
| `lost-found` | `claim` | 认领 |
| `lost-found` | `match` | 标记为疑似匹配（双向匹配的中间态） |
| `lost-found` | `close` | 关闭登记（已找回 / 已归还 / 放弃） |
| `flea-market` | `reserve` | 预定 |
| `forum` | `report` | 举报 |
| `wellbeing` | `cancel` | 取消预约 |
| `takeout-guard` | `resolve` | 结案 |

> **修订（v1.1.1）**：初版遗漏了 `groupbuy.cancel`、`lost-found.match`、`lost-found.close`。
> `mobile-flutter` 实现时发现并上报 —— 这三个都是**真实领域需要**的动作，不是自创，
> 因此补登记而非要求改代码。
>
> **本节的目的不是限制表达，而是防止未登记的漂移。** 实现时若发现某个动作确实是领域需要的，
> **正确做法是补进本表 + OpenAPI**，而不是绕过去。新增 action 必须**同时**改这两处。

### 11.3 `Idempotency-Key` 的必要性（关闭 A6）

| 方法 | 是否必需 |
| --- | --- |
| `POST`（创建资源 / 领域动作） | **必需** —— 缺失返回 `VALIDATION_FAILED` |
| `PATCH` / `PUT` / `DELETE` | 可选 |
| `GET` | 不适用 |

理由：POST 是唯一会**重复扣款 / 重复参团**的方法，而小程序端网络重试非常常见。

### 11.4 端口契约：冻结「不变式 + 能力集」，不冻结方法签名（关闭 T7 · v1.1.1 修订）

> **修订说明**：本节初版直接冻结了一份方法签名清单。`mobile-flutter` 实现时按平台实际需要
> 做了形状适配，并**主动上报**而非静默偏离 —— 这是正确行为。复核结论：**形状差异是合理的**，
> 问题在本节写得过死。因此改为冻结**不变式**与**能力集**；方法签名按语言/平台惯例本地化。

#### 硬不变式（不可协商 —— 三端都必须有验收测试）

| # | 不变式 | 验收方式 |
| --- | --- | --- |
| **I1** | 身份层会话类型**不含** `cookie` / `cookies` / `session` / `sessionToken` / `tgc` / `castgc` / `ticket` / `tenant` 任何字段 | 类型与序列化键名断言 |
| **I2** | 身份层**不返回**任何校园系统凭据；校园凭据只存在于能力层的私有实现与安全存储 | 键名断言 + 代码审查 |
| **I3** | 校园系统 cookie 的**唯一出口**是一个受限方法（如 `cookieHeaderFor(platform)`），**仅供 WebView 注入**使用 | 断言无其它公开出口 |
| **I4** | 「已登录但未绑定」是**合法状态**：身份有效，校园功能返回 `CAMPUS_BINDING_REQUIRED` | 集成测试 |
| **I5** | 读取本地会话必须**同步**可用（`currentSession()` / `hydrateFromCache()`），供 §8 首帧使用 | 启动时序测试 |

> `packages/contracts/src/openapi.test.ts` 已对 OpenAPI 侧做 I1 的镜像断言
> （`CampusBindingSummary` 不得含 cookie/session/tgc 等键）。

#### 能力集（必须存在等价能力；**命名与分组自由**）

**身份层（第一级 · `AuthPort`）** —— 必须能：

- 发起登录（取得授权码的 URL，或由平台宿主代取授权码）
- 用授权码换取可达鸭**自有 JWT**
- 刷新 JWT
- 登出并吊销全部 refresh token
- **同步**读取当前会话（I5）
- （推荐）会话变更通知，供 UI 响应式更新
- （推荐）后台静默刷新，服务 §8 第 3 步

**能力层（第二级 · `CampusSessionPort`）** —— 必须能：

- 列出绑定
- 绑定 / 解绑
- 续期
- 查询某平台是否已绑定（**可**由「列出绑定」推导）
- 取得某平台的 cookie 注入串（**I3 的唯一出口**）

#### 明确允许的形状适配（不算偏离）

1. 把「发起登录」放进**平台适配层**（因为授权码必须由原生宿主 / 小程序宿主提供）——
   只要 I1–I5 成立。
2. `refresh()` 从安全存储自取 refresh token，而不是由调用方传入。
3. 增加契约未列的方法（如 `changes`、`refreshInBackground`、`cookieHeaderFor`）——
   只要它们不破坏 I1–I5。
4. 语言惯例差异（Dart 用 `Future<T>`、TS 用 `Promise<T>`；Dart 的 `Port` 后缀等）。

**唯一不允许的**：违反 I1–I5。违反这五条的任何形状都必须在 code review 中被拒绝。

### 11.5 暗色模式（关闭 C3）

`tokens.json` 新增 **`colorDark`** 组（16 个令牌），由生成器派生：

| 端 | 产物 | 用法 |
| --- | --- | --- |
| Web | `[data-theme="dark"]` 覆盖**同名** `--kdy-color-*` | **消费方代码零改动** |
| 小程序 | `$kdy-color-dark` map + `@mixin kdy-theme-dark` | 按类切换（小程序无 CSS 变量级联） |
| Flutter | `KedaYaTokens.colorDark*` + `darkColors` + `resolveColor()` | 由 `ThemeExtension` 承载 |

暗色由 `data-theme` 属性驱动，同时支持 `prefers-color-scheme` 自动跟随。

### 11.6 `takeout-guard` 不设同意门（关闭 S11）

`takeout-guard` 是 `medium` 敏感、支持匿名，但**不要求二次同意**。
理由：这是**维权 / 举证**场景，加同意门会直接阻碍受害方维权。
保护手段改为「匿名默认 + 举证材料最小化 + 信用记录仅内部可见」。

### 11.7 明确不面向未成年人（关闭 S10）

本项目面向上海科技大学在校师生，**不面向未成年人**。
此项必须写入用户协议与隐私政策。`wellbeing` 的危机干预出口仍然保留 ——
成年人同样需要，且该出口**永远不设任何门槛**。

### 11.8 React 大版本按端不同（关闭 ADR-0001 §5.2 第 3 条 / ADR-0002 U2）

已在 §2 详述。结论：**不能统一，但可以共存** ——
小程序锁 React `18.3.1`（Taro 4.3 的 peer 约束），Web 用 React `19.3.1`，
npm workspaces 嵌套安装，实测 `npm install` exit 0。

### 11.9 仍然开放、尚未关闭的问题

以下缺口**没有**在 M0 关闭，必须在对应里程碑前解决（详见 `docs/architecture/06-roadmap.md` 与各 ADR 的未决问题表）：

| # | 问题 | 阻塞 | 责任方 |
| --- | --- | --- | --- |
| 1 | 学校是否允许第三方代持校园会话（CASTGC）—— 合规性未与信息办确认 | **M1** | 待指派 |
| 2 | 上游续期接口可用性未知（TechPie 的 `/api/auth/renew` 是它自建后端的能力） | **M1** | 待指派 |
| 3 | PIA（个人信息保护影响评估）报告与隐私政策/用户协议**无责任人、未编写** | **M3**（需 M1 启动） | 待指派 |
| 4 | 微信小程序类目资质（心理服务 / 二手交易）能否获批未知 | **M3** | 待指派 |
| 5 | 未做中国商标网实时检索、未取得法律意见（G-IP1 / G-IP2） | **上线** | 待指派 |
| 6 | `Taro` 的 GitHub license 报 `NOASSERTION`（npm 报 MIT），采用前需人工确认 | M0 收尾 | Lead |
| 7 | TechPie-flutter 仓库**无 LICENSE 文件**（README 声称 MIT）—— 只借鉴架构模式，不复制代码 | 持续 | 全体 |
