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
| `wellbeing` | 心理治疗 | 心理咨询预约、心理测评、危机干预入口 | **最高** |
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
| `buddy` | `join` | 加入搭子 |
| `buddy` | `leave` | 退出搭子 |
| `buddy` | `close` | 发起人关闭招募 |
| `buddy` | `decide` | 发起人审批申请（接受 / 拒绝） |
| `buddy` | `feedback` | 匹配反馈（喂给打分模型，见 `docs/features/buddy-matching.md`） |
| `wildlife` | `moderate` | 管理员审核（隐藏不当图片 / 纠正物种分类） |
| `techpie` | `renew` | 续期 TechPie / 校园系统绑定 |
| `facility` | `cancel` | 发起人取消场馆预约（仅 `booked` 状态可取消） |

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


### 11.10 规格评审裁决（v1.2 · 2026-10-17）

> `feature-specs` 在交付 `docs/features/{buddy-matching,wildlife-map,techpie-integration}.md`
> 时提出 8 项硬阻塞。以下为 Lead 的逐条裁决，**全部具有契约效力**。

#### A. `WildlifeSighting` 必须补 `observedAt`（用户明确要求"发现时间"）

契约原模型只有 `createdAt`（**入库时间**），而用户需求要的是**发现时间**（观察时刻），
两者在补录、离线同步场景下会相差很久。裁决：

- 新增 `observedAt: DateTime`（必填，**观察时刻**，客户端采集）
- `createdAt` 保留，语义收窄为**服务端入库时刻**，只用于审计与排序兜底
- 校验：`observedAt` 不得晚于 `createdAt + 5 分钟`（容忍客户端时钟漂移），
  不得早于 `createdAt - 30 天`（防止误填远古时间污染轨迹）
- 违反返回 `VALIDATION_FAILED`

#### B. `TechpieLink.provider` 枚举改为校园平台标识

原枚举 `techpie | geekpie` 与实现需要不一致（实现要区分 eGate / CpDaily / 校园卡 / CAS）。
裁决改为与 `CampusBinding.platform` **同一套**：

```
provider: 'cas' | 'egate' | 'cpdaily' | 'ecard' | 'techpie'
```

**理由**：绑定目标本来就是校园系统，复用同一枚举避免两套平台标识长期漂移。
`techpie` 保留为"与 GeekPie 体系互联"这一项。

#### C. 新增第 20 个模块 `facility`（场馆预约）

TechPie 已实现场馆/健身房预约（`oa-gym`）。评审指出它在现有 20 个模块里**无处安放**：
- 不属于 `schedule`（不是课程）
- 不属于 `campus-card`（不是支付）
- 不属于 `techpie`（`techpie` 是**互联互通**，不是具体校园服务）

裁决：**新增业务模块 `facility`**（中文名「场馆预约」），`sensitivity: 'medium'`，
`requiresConsent: false`，路由 `facility`。模块总数 19 → **20**。

> 这是模块注册表的一次**正式演进**。`packages/contracts/src/modules.ts` 是唯一真相，
> 三端的导航/宫格会自动跟随（这正是把它做成注册表而不是各端硬编码的价值）。
> 相关测试与文档需同步更新。

#### D. `buddy.joinedCount` 初值语义

裁决：**`joinedCount` 含发起人，初值为 1**；`capacity` 也含发起人。
即"capacity=4 的搭子"= 发起人 + 最多 3 个加入者。理由：符合直觉（"4 人局"就是 4 个人），
且避免 UI 上出现"0/4"这种奇怪初值。

#### E. 游标是**不透明**的，允许复合游标

`docs/architecture/03-api-contract.md` 曾写"cursor 就是 ULID"，这**过度约束**了实现：
`buddy` 的 `sort=startsAt_asc` 需要 `(startsAt, id)` 复合游标。

裁决（**覆盖 03-api-contract.md 的该表述**）：
- **cursor 对客户端完全不透明**：客户端只能原样回传，**不得解析、不得构造、不得假设格式**
- 服务端可以自由编码复合键（base64url 编码的 `(sortKey, id)` 即可）
- 唯一硬约束：**同一 `sort` + 同一 `filter` 下，游标必须稳定**（翻页不重不漏）
- 切换 `sort` 或 `filter` 时游标失效，返回 `VALIDATION_FAILED`

#### F. 微信小程序 `web-view` **不能**注入 cookie —— I3 在小程序端没有出口

评审实测判断：小程序 `web-view` 无法自定义请求头、无法跨域设置 cookie。
因此契约 §11.4 的 **I3（校园 cookie 唯一出口供 WebView 注入）在小程序端不成立**。

裁决：
- I3 **仍然对 Flutter / Web 端有效**（它们能控制 WebView 请求头）
- 小程序端的校园系统访问走**两条替代路径**，按优先级：
  1. **用户自登录**（在 `web-view` 内让用户自己走学校登录页，cookie 由学校域自己种）
  2. **服务端代理**（后端持 session 代为请求，返回结构化数据，不下发 cookie）
- 小程序端**禁止**尝试绕过此限制（如伪造 header、劫持 cookie）
- 这是**平台能力边界**，不是实现缺陷；三端 UI 需按端展示不同引导文案

#### G. `buddy` 明确不做 dating（合规与定位）

STUMatch 有 `dating`（交友/约会）板块。裁决：**可达鸭不实现**。理由：
1. 校园平台做约会匹配的合规与舆情风险显著高于"找搭子"
2. 产品定位是"什么需求都可以到达"的**事务性**平台，不是社交平台
3. 若未来要做，必须**新开模块 + 新 ADR + 独立二次同意门**，不得在 `buddy` 里悄悄加

`buddy` 的三板块定为 `academic` / `daily` / `sport`。

#### H. 仍然开放、需人来解决的项

评审列出的 10 项"需人解决"问题**全部维持开放**，已登记进各规格文档的未决表。
其中最阻塞的两项：

| # | 问题 | 阻塞 | 影响 |
| --- | --- | --- | --- |
| 1 | 学校是否允许第三方代持 CASTGC | **M1** | 若不允许，`schedule`/`campus-card` 需改为服务端代理或用户自登录 |
| 2 | 校园平面图能否获取、需什么授权 | wildlife Phase 1 | 兜底方案：自绘 SVG 底图（规格文档已给出） |

> **好消息（评审实证）**：校园卡走**独立 OPENID 通道**，不依赖 CASTGC
> （`ecard_api_client.dart` 直连校园卡域名）。因此 **Phase 0 可以零合规风险开工**：
> 校园卡 + WebView 直连，不需要代持任何校园会话。


### 11.11 子资源与集合路由（v1.3 · 2026-10-17）

`web-forum-faq` 与 `miniapp-forum-faq` 各自独立地把"投票"建模为**子资源集合的创建**
（`POST /faq/items/:id/votes`）而不是领域动作，并据此请求登记。Lead 裁决：**认可，并上升为通用约定。**

#### 规则

除了 §6.1 的统一 CRUD 形状与 §11.2 的领域动作，**允许**以下子资源/集合路由，且**无需**逐个登记进 §11.2
（因为它们是"资源"而不是"动作"，语义自明）：

| 形状 | 含义 | 例 |
| --- | --- | --- |
| `GET /<mod>/<collection>` | 附属集合的列表 | `GET /forum/boards` |
| `POST /<mod>/items/:id/<sub>` | 向子集合添加成员（**幂等由 (父, 主体) 唯一约束保证**） | `POST /faq/items/:id/votes` |
| `GET /<mod>/items/:id/<sub>` | 子集合列表（游标分页） | `GET /forum/items/:id/replies` |
| `POST /<mod>/items/:id/replies` | 回复（子集合成员，可带 `parentReplyId` 做楼中楼） | — |
| `GET/POST /<mod>/tickets` | 工单集合 | `GET /faq/tickets` |

**判定标准**：如果这个操作**可以重复执行且每次都是"新增一个成员"**，它是子资源，用 `POST .../<复数名词>`；
如果它是**对既有资源的状态迁移**（且重复执行应被拒绝或幂等），它是领域动作，必须登记进 §11.2。

> 反例：`POST /forum/items/:id/report` 是动作（同一人对同一帖重复举报应被 `CONFLICT` 拒绝），
> 所以它**必须**留在 §11.2 里 —— 这条边界是这次评审最有价值的产出。

#### `GET /faq/categories`

已补进 OpenAPI。**服务端必须提供该端点**，不要让客户端从 `/faq/items` 全量派生
（那会把分类字典变成客户端逻辑，且无法承载排序与归档分类）。

### 11.12 匿名 handle 的残余风险（必须知晓）

实现采用 `anonHandle = HMAC(secret, userId + '|' + scope)`，`scope` 为**帖子/举报作用域**，
因此**跨帖不可关联**（这是正确设计）。但仍有两条残余风险，登记在案：

| # | 风险 | 现状 | 建议 |
| --- | --- | --- | --- |
| R1 | **学号空间小（8 位数字）+ secret 泄漏 → 可暴力枚举反推作者** | `ANON_HANDLE_SECRET` 由环境变量提供；`.env.example` 尚未落地 | ① secret 必须为高熵随机值且**不得有默认值**（缺失即启动失败）② 生产建议改为 HMAC 后**再截断+加盐**或直接用随机 UUID 存映射表 |
| R2 | `authorId` 字段对匿名内容返回的是 handle（客户端 schema 要求非空） | 已如此实现；字段名有轻微误导 | 客户端**不得**把匿名内容的 `authorId` 当实名 ID 使用；已在各端测试中断言 |

**未做**：没有做 handle 轮换（rotation）。若要支持"匿名身份可撤销/可轮换"，需要额外的映射表，
那会**重新引入可关联性**，属于产品决策，不在 M0 范围。


### 11.13 `WildlifeSighting.geo` 在敏感区**必须可为空**（v1.3.1 · 2026-10-17）

**冲突**：契约 §2.10 把 `geo` 写成必填；而规格 §9.3① 要求"命中敏感区（宿舍/保育/巢区）时
**不输出任何坐标**，只给 `zoneId`"。

**裁决：以隐私为准 —— `geo` 必须可为空。** 理由：

1. 敏感区"不给坐标"是**最强的隐私保证**（没有坐标就没有反推可能），
   比"给个模糊坐标"强得多 —— 半径再大，圆内仍然泄漏"在圆的哪一侧"。
2. 若为了满足 `geo` 必填而给敏感区编一个假坐标，等于**把最强的保证降级成最弱的**，
   而且那个假坐标还会进入轨迹推断，污染派生数据。
3. 契约 §9「隐私与合规（不可妥协）」优先级高于 §2 的字段形状描述。

**冻结规则**：
- `geo: {lat,lng}` **可空**；为空时 **`zoneId` 必须非空**（二者至少有一个）
- `fuzzLevel` 此时为 `zone-only`
- 客户端**不得**因 `geo` 为空而渲染到 `(0,0)` 或上一状态的位置 ——
  必须显示"该区域位置不公开"（Flutter 端已按此实现）
- `WildlifeTrack` 的 `points` 同理：敏感区内的观测**不参与轨迹点**

> 这条由 `mobile` 在实现时发现并上报（它选择"以隐私为准"并把冲突写进 feature README）。
> 复核结论：**实现是对的，契约措辞是错的**，故修契约而非改代码。


### 11.14 wildlife 实现期裁决（v1.3.2 · 2026-10-17）

`wildlife` 后端实现时提出 4 个歧义点。逐条裁决：

#### A. 响应坐标字段**只保留 `fuzzedGeo`**（去掉 `geo` 重复键）

规格 §10.3 的响应示例用 `geo`，M0 冻结的 OpenAPI 用 `fuzzedGeo`；实现同时下发了两个（同值）。
**裁决：响应中只保留 `fuzzedGeo`，去掉 `geo`。**

理由：`geo` 是**有歧义的坏名字** —— 客户端很容易把它当成"精确坐标"来渲染或计算，
而它其实是**已经模糊过**的。隐私字段的名字必须自证其语义。
输入侧仍接受 `geo` 作为别名（客户端兼容），但**响应永不出现 `geo`**。

#### B. k-匿名降级用 `coarsened`，并回退到最近区域

契约 §11.13 规定"`geo` 为空 ⇒ `zoneId` 必须非空"。k<3 且观测不在任何区域内时，
实现回退到**最近区域**（只影响 `zoneId`，不改变模糊半径）。
**裁决：接受。** 这比"geo 与 zoneId 同时为空"更符合 §11.13，且回退到最近区域比网格更粗（更安全）。

#### C. `VALIDATION_FAILED` 的 HTTP 状态码保持 **400**（不是规格写的 422）

规格 §10.3 写 `422`，但本仓库**已冻结**的 `ERROR_HTTP_STATUS` 映射是 `400`，
且 forum/faq/module-wiring 的 257 个基线测试都断言 400。
**裁决：保持 400，规格 §10.3 的 422 作废。**
理由：错误码的**机器可读部分**（`ApiErrorCode`）才是一致性的关键，HTTP 状态码只是传输细节；
为了一处细节去改全局映射、连带改 257 个测试，收益为负。

#### D. 季节加强系数统一用 `seasonalFuzzMultiplier`（繁殖期一律 ×4）

规格 §9.4 的伪码对"仅 `isNestingSensitive`"给 ×2、"保护 + 繁殖"给 ×4；
实现统一用 `@kedaya/shared` 的 `seasonalFuzzMultiplier`（一律 ×4）。
**裁决：接受统一 ×4。** 它**更保守**（隐私更强），且季节系数只能有一份真相 ——
两份实现必然会漂移。规格 §9.4 的 ×2 作废。

#### E. 实现期被测试抓出的 4 个真实缺陷（记录在案）

| # | 缺陷 | 为什么危险 | 被什么抓到 |
| --- | --- | --- | --- |
| 1 | EXIF 剥离器**把 SOF 段一起删了**，输出是坏 JPEG（"SOS before SOF"） | 用户照片会变成无法打开的废文件 | "输出仍可解码"断言 |
| 2 | 保护物种**双人复核形同虚设**（同一审核员点两次即可发布） | 敏感物种位置可被单人公开 | 双人复核测试 |
| 3 | 迁移**丢了 11 条外键** | 表照样能建起来，肉眼看不出来，数据完整性静默失效 | PGlite 真库验证脚本 |
| 4 | 像素数上限是**死代码**（4096 边长下永远到不了 40MP） | 超大图防护实际不生效 | 边界测试 |

> 第 3 条值得强调：**"schema 能建表"不等于"约束生效"**。只跑 `prisma validate` 抓不到它 ——
> 必须在真实数据库上执行迁移并断言约束存在。该方法已固化为
> `services/api/scripts/verify-wildlife-migration.mjs`。


### 11.15 `buddy` 实现期裁决（v1.3.3 · 2026-10-17）

规格 §9 列了 11 项未决问题。其中 4 项在更早的裁决里已关闭，此处补齐其余并显式确认：

| # | 问题 | 裁决 |
| --- | --- | --- |
| U1 | 5 个 action 未登记 | **已关闭** —— §11.2 已冻结 `join`/`leave`/`close`/`decide`/`feedback`（v1.2） |
| U2 | `joinedCount` 初值 / `capacity` 是否含发起人 | **已关闭** —— §11.10-D：均含发起人，初值 1 |
| U3 | 复合游标与"cursor 就是 ULID"冲突 | **已关闭** —— §11.10-E：cursor 对客户端**不透明**，服务端可用复合游标 |
| **U7** | `WITHDRAWN → PENDING` 是否合法（撤回后重新申请） | **允许**，但**带冷却**：同一 `(postId, applicantId)` 撤回后 **10 分钟内**不得重新申请（`RATE_LIMITED`）。理由：无冷却会让"反复申请后撤回"变成骚扰手段（规格 §6.4 已识别该风险）。DB 层用 `@@unique([postId, applicantId])` + UPSERT 实现，不新增行。 |
| U4/U5 | embedding 模型选型与维度 | **默认 `hash` 模式（768 维）**，不依赖外部 API key。`vector` 模式需运维先实测 `bge-base-zh-v1.5` 的 QPS 与显存。⚠️ **维度建库后不可改** —— 改维度需全量重算 + 重建索引，所以现在就把 768 写死在迁移里。 |
| U6 | 是否投入双塔 | **不做**（§11.10 已述）。需要 ≥6 个月真实行为日志才谈得上训练。 |
| **U8** | `profile` 模块是否提供"匹配成功后可见的联系方式" | **跨模块依赖，维持开放**。`buddy` 当前只能做到"撮合"，做不到"联系"。已登记进 §11.9 开放问题。 |
| **U10** | 校园地点白名单由谁维护 | **维持开放**。规格假定它存在，实际未知。在它落地前，`location` 只做长度校验，不做白名单校验 —— **不要假装有白名单**。 |
| U9 | 内容安全能力 M2 才上线 | **复用同一套**，`buddy` 不单独实现（避免两套敏感词库漂移）。 |
| U11 | 举报是否复用 `forum.report` | **不复用**。`forum.report` 是 forum 内容的举报；跨模块举报需要统一 `Report` 表，属于 M2 共享能力。**在通用举报落地前，`buddy` 不提供举报入口**，而不是硬塞一个语义不符的接口。 |

#### 明确不做（记录在案，防止后续被"顺手加上"）

1. **`dating` 板块**（§11.10-G）—— 三板块只有 `academic`/`daily`/`sport`。
2. **双塔权重加载** —— `towerScore` 恒 `undefined`。不实现权重文件加载，
   那会造出一个**永远读不到的代码路径**（比没有更糟：它会让后人以为双塔已经接好了）。
3. **`gender` / `age` / `birthDate` / `mbti` 采集** —— 规格 §6.3。
4. **`BuddyProfile` 进入 `ai-portrait`** —— 规格 §6.3 主动禁止（"兴趣 + 可用时段"是典型画像输入）。
   禁令必须在 M2 就写进 `portrait-scope.guard.ts`，而不是等 M4 的 `ai-portrait` 上线 ——
   **"先立规矩，再放数据"**。


### 11.16 `buddy` 实现期裁决（第二批 · v1.3.4 · 2026-10-17）

后端实现时提出 5 项。逐条裁决：

#### A. `explainMatch` 的「时间能碰上」只在 `daily` 板块出现 —— **改代码，不改规格**

**问题**：共享包的 `explainMatch` 对**三个板块**都输出「时间能碰上」，
而 `ruleScoreFor` **只在 `daily`** 给这 0.2 分。
于是 `academic`/`sport` 的推荐会出现「时间合适」却**不加分**：
**用户看到的理由解释不了他看到的排序。**

**裁决：改 `explainMatch`，让它与打分表严格一致**（只有 `daily` 输出该理由）。
理由：**可解释性的定义就是"理由必须能解释分数"**。一条不解释任何分数的理由不是解释，是噪音 ——
它会让用户误以为系统考虑了时间，从而高估某条推荐的匹配度。

> 由后端在实现时发现并上报（它选择"保持共享包行为、在 api 侧记录"而不是偷偷改共享包 —— 这是对的）。
> 复核：**共享包是错的**，已在 `packages/shared/src/buddy/scoring.ts` 修复 + 补回归测试
> （断言 academic/sport 下开关该理由**不改变分数**，daily 下**改变**）。

#### B. 冻结状态图缺 `FULL → CANCELLED` —— **补进契约**

**问题**：按冻结图实现 ⇒ **已满的帖子无法被 `DELETE /items/:id` 取消**（返回 409）。
`FULL` 表示"人够了"，不代表"不能再取消"。

**裁决：`FULL → CANCELLED` 合法。** 理由：
- 发起人在人满后仍可能因故取消（场地没了、自己有事），**这是常态不是异常**；
- 冻结图里 `FULL → CLOSED` 是合法的，而 `CLOSED`（不再接受申请）与 `CANCELLED`（活动取消）
  对已加入的人意义完全不同 —— **不让取消会逼发起人只能"关闭"而不能"取消"**，
  已加入的人会以为活动照常进行。
- 实现侧只需在状态图加一条边（**不是**放宽整个状态机）。

#### C. `GET /buddy/items/:id/applications` —— **登记为正式端点**

**问题**：§6.1 可见性矩阵要求「申请人列表：发起人 ✅」，
但 §5.1 端点总表**没有**对应的读端点。没有它，发起人拿不到 `applicationId`，
`decide` 端点**无法被调用** —— 规格自身有缺口。

**裁决：登记为第 20 个端点**，权限与 §6.1 一致：
仅发起人可读全部；申请人只能读自己那一条（在 `/applications` 里）。
**`NOT_FOUND` 不区分"帖子不存在"与"帖子不可见"**（api-contract §2.1）。

#### D. `VALIDATION_FAILED` 保持 400 —— 与 §11.14-C 同一条裁决，**适用于全仓**

规格 §5.3–5.8 写 422，全仓 `ERROR_HTTP_STATUS` 冻结为 400。
**保持 400。** 这是**第二次**出现同一分歧（wildlife 也提过），
因此明确其适用范围：**全仓所有模块**，规格里出现的 422 一律作废。
理由重申：错误码的机器可读部分（`ApiErrorCode`）才是一致性的关键；
为一处传输细节改全局映射、连带改数百个既有测试，收益为负。

#### E. T29（`ai-portrait` 禁读 `BuddyProfile`）—— **维持开放，但明确风险**

本仓的对应机制是 `ai-portrait.domain.ts` 的 `FORBIDDEN_PORTRAIT_SOURCES`，
它**按模块 id**（`wellbeing`/`dorm-harmony`）而非按表名禁读，且被既有测试钉死为恰好那两个。

**裁决：不在本模块改动它**（改会动另一个模块的语义并让它测试变红 —— 属跨作用域）。
但**风险必须记录**：`BuddyProfile` 的「兴趣 + 可用时段」是**典型画像输入**，
规格 §6.3 已主动禁止它进入 `ai-portrait`。
在禁读清单补齐前，这条禁令**只是纸面约束**。已登记进 §11.9 开放问题，并标注为
**M4 `ai-portrait` 上线前的阻塞项** —— 因为"先立规矩，再放数据"是本项目的既定原则。

#### F. 有意偏离（记录在案，不视为缺陷）

| # | 偏离 | 理由 |
| --- | --- | --- |
| 1 | **没有 Redis 缓存**（规格 §3.7 要求 15 分钟 TTL） | 本仓无任何 Redis 依赖。改为每次实时计算 —— §2.7 自己也说几千用户规模下实时更快更简单，且"反馈立刻生效"天然成立。**不引入新运行时依赖 + 一段无法验证的失效逻辑。** |
| 2 | **限流未实现**（`RATE_LIMITED` 码存在） | 全仓无配额基础设施；进程内计数器会造出**多实例下不成立的假限流** —— 比没有更危险（让人以为已经防住了）。 |
| 3 | **`vector` 档生产不可达** | 无中文 embedding 模型/Worker。hash 档就地算；vector 档**只读**已存向量，读不到就整次降级为 rule，**绝不混用两种向量空间**（混用会让相似度失去意义）。 |
| 4 | **F5（性别准入）当前不可达** | 全仓**没有任何地方采集性别**（`BuddyProfile` 按 §6.3 明确不采集）。判定函数已实现并单测，未知一律**保守放行** —— 否则 `same`/`other` 的活动**没人能申请**。 |
| 5 | **`post.tags` 并入 `target.creator.activityTags`** | 共享 `ruleScoreFor` 只读 creator 字段。取舍：帖子 tags 是**公开信息**，一定参与；发起人 `BuddyProfile` 特征**仅当 `matchEnabled=true`** 才参与（在仓储层过滤，不可能忘记）。 |
