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


### 11.17 可解释性必须**结构性**保证（v1.3.5 · 2026-10-17）

#### 问题：同一类缺陷出现了**两次**

「推荐理由」与「推荐分数」必须自洽 —— 这是可解释性的定义：
**理由必须能解释分数**。不解释任何分数的理由不是解释，是噪音，而且会误导用户
（让他以为系统考虑了某个因素，从而高估该推荐的匹配度）。

但这条约束**靠约定守不住**，实测两次失守：

| 轮次 | 缺陷 | 发现者 |
| --- | --- | --- |
| 第一次 | `academic`/`sport` 展示「时间能碰上」，但只有 `daily` 给这 0.2 分 | api 实现 `buddy` 时 |
| 第二次 | `academic` 展示「常在同一个区域」、`daily` 展示「共同活动 N 项」，而这两个板块**根本没有对应分项**（贡献恒为 0）；另有量级不符（`daily` 兴趣标 0.1/项、实际 0.15/项；`academic` 活动标 0.15/项、实际固定 0.1） | api 补齐 wire 缺口时 |

两次都是"**补一处**"。第一次的修法（给 `explainMatch` 加一个 `section === 'daily'` 判断）
只解决了那一条，所以第二次必然发生 —— **只要还存在两份独立的系数，就还会有第三次。**

#### 裁决：改成**结构性**约束，而不是继续补

**系数只写一次。** `packages/shared/src/buddy/scoring.ts` 里的 `COEFFICIENTS`
是全模块唯一的系数来源；`ruleScoreFor`（算分）与 `explainMatch`（给理由）
共用同一个 `evaluateRules` 内核：

```
ruleScoreFor  = Σ evaluateRules(...).score
explainMatch  = evaluateRules(...).filter(hit).map(→ { code, label, weight: score })
```

于是：
- **被展示的理由，其 `weight` 一定真的进了分数**（结构保证，不是约定）
- **没进分数的规则不会出现在理由里**（它在 `COEFFICIENTS` 里就不存在）
- **权重不可能标错**（`weight` 用的是实际得分，不是另写一个"名义权重"）

`academic` **没有** `same-area` 项、`daily` **没有** `shared-activities` 项 ——
现在它们不在表里，所以结构上无法被展示。

#### 验收：结构性不变式 + **反证**

`packages/shared/src/buddy/buddy.test.ts` 新增一组不变式测试：
**`explainMatch` 的权重之和 === `ruleScoreFor`**（未触顶时逐位相等），
覆盖三板块 × 12 种因子开关组合。

并且做了**反证**（一条不会失败的测试等于没有测试）：

| 故意引入的错误 | 结果 |
| --- | --- |
| 让 `explainMatch` 报告错误的权重（`weight + 0.07`） | **24 条用例失败** |
| 重放第一次的缺陷（`academic` 展示一条不加分的 `same-area`） | **守卫用例失败** |

#### 附带：`buddy` 三处跨端 wire 缺口（已补齐）

| # | 缺口 | 处置 |
| --- | --- | --- |
| 1 | 服务端**没有** `GET /buddy/tags` —— 客户端拿不到权威标签表，只能内置副本（必然漂移） | 新增端点，返回 `tags` + `limits` + `locations`（含 `label` 才是提交值） |
| 2 | `/buddy/recommendations` 只回 `reason` 字符串，无结构化理由 → 客户端只能自己算，**解释与服务端排序不一致** | 同时下发 `reasons: {code,label,weight}[]`；**`reason` 字符串保留**（三端兼容） |
| 3 | `/buddy/items` 没有 `status` 过滤 → 已满/已关闭的活动会**静默消失** | 加 `status` 多值参数（支持重复与逗号两种写法）；**缺省不过滤**（§5.3 优先于 §5.9 的自相矛盾） |

#### 附带：全局既有缺陷 —— 后台标签页永久骨架屏

`apps/web` 的 TanStack Query 用默认 `networkMode: 'online'`，
查询在**标签页不可见**时进入 `paused`，重试器用
`focusManager.isFocused() && onlineManager.isOnline()` 决定是否继续
⇒ **后台标签页里请求失败 → 重试永久暂停 → UI 永远停在骨架屏**，
既不出错误态也不出重试按钮。契约 §8 要求的是"失败静默降级为错误态 UI"。

**两个团队各自独立复现过**，且既有 `/groupbuy` 与新增 `/wildlife`、`/buddy` 表现一致
⇒ **全局既有缺陷**，不是某个模块引入的。

**处置**：`queries` 与 `mutations` 都显式设 `networkMode: 'always'`。
理由：我们本来就要在后台标签页完成请求；`'always'` 是官方为此提供的语义，
比"伪造 focus 状态"更直白。代价是离线时不再自动暂停 —— 这正是我们要的
（失败要变成**错误态 UI**，而不是一个永远不结束的 loading）。
配置抽到 `apps/web/src/app/query-client.ts`（独立于 JSX，便于单测直接断言），
并有 6 条测试钉住，防止被"顺手清理"掉。


### 11.18 TechPie 整合裁决（v1.3.6 · 2026-10-17）

规格 `docs/features/techpie-integration.md` §11 列了 13 项未决问题。逐条裁决，
并**明确本轮只做 Phase 0**。

#### 已关闭（在更早的裁决里）

| # | 问题 | 状态 |
| --- | --- | --- |
| U2 | `provider` 枚举与校园平台不一致 | **已关闭** —— §11.10-B 改为 `'cas' \| 'egate' \| 'cpdaily' \| 'ecard' \| 'techpie'` |
| U5 | 场馆预约无归属 | **已关闭** —— §11.10-C 新增第 20 个模块 `facility` |
| U4 | 小程序 `web-view` 能否注入 cookie | **已关闭** —— §11.10-F：**不能**，I3 在小程序端没有出口 |
| U9 | TechPie 许可证 | **已关闭为硬约束** —— 见下方 G |

#### 本轮裁决

**A. U3 —— `POST /techpie/webview-session` 的形状：接受**

它**不是**对已有资源施加的领域动作，而是**创建一个一次性票据资源**
（与 `groupbuy` 的创建同类）。契约 §6.1 的 `POST /<mod>/items/:id/<action>`
形状是给"对已有资源施加领域动作"用的，票据不属于任何 link。
**接受该形状**，并在此登记：`techpie` 的领域动作仍只有 `renew`（§11.2 已冻结）。

**B. U11 —— 校园域名白名单：fail-closed，且不假装它完整**

`webview-session` 的 `targetUrl` 校验依赖域名白名单，但**白名单的真实内容至今未知**
（需列举 `*.shanghaitech.edu.cn` 下的实际域名）。裁决：

1. 白名单**必须 fail-closed** —— 不在名单里一律 `403 FORBIDDEN`，
   **不允许**"通配整个 `shanghaitech.edu.cn`"（那等于没有白名单，
   而且会放行任意子域，包括被攻陷的子域）。
2. 名单内容标注为**占位**（与 `CAMPUS_ORIGIN`、`CAMPUS_LOCATIONS` 同一处理），
   在代码常量、响应字段、文档里**机器可见**。
3. **只允许 `https`**；禁止 `http`、禁止 IP 字面量、
   禁止 `@` 形式的 userinfo（`https://shanghaitech.edu.cn@evil.com` 是经典绕过）。
   > ⚠️ **本条第 3 项原写"禁止非 443 端口"，该表述已由 §11.21-A 修正为
   > "白名单按完整 origin 精确匹配"。** 原规则既漏又误：它放行了
   > `https://evil.com`（只要端口是 443），却挡掉了合法的
   > `https://ecourse.shanghaitech.edu.cn:8080`。**以 §11.21-A 为准。**
4. 校验必须在**服务端**做 —— 客户端传入的 `targetUrl` 一律不可信。

**C. U1 —— 校园网能力：未发现，不编造**

在当前 clone 的 master 上未发现校园网能力。**不编造该能力**，
能力清单里不出现它；若将来确认存在，再补。

**D. U6 / U7 / U8 / U10 / U12 / U13 —— 维持开放，且它们是 Phase 1+ 的硬阻塞**

这些**都需要人来解决**（信息办书面回复、GeekPie 确认、PIA 责任人指派），
**不能靠代码解决**。特别是：

- **U7（学校是否允许第三方代持 CASTGC）阻塞 Phase 1** —— 在拿到书面回复前，
  **不实现任何 CASTGC 落库路径**。不是"先做着等批准"，而是**根本不做**：
  一旦落库，就有了一个未经授权的凭证副本，事后清理无法消除已发生的风险。
- **U12（明文密码）**：绑定时接受明文密码**风险极高**。若学校提供 OAuth/扫码/SMS，
  **必须优先**。在信息办回复前，Phase 1 的绑定流程**不实现**。

**E. Phase 0 是本轮范围，且它有独立的验收标准**

Phase 0 的**全部**能力都不需要校园授权（校园卡走独立 OPENID 通道、
WebView 走用户自登录、一级身份用过渡 IdP）。它的验收标准 P0-1…P0-8
全部可机器验证，**因此可以立即开工，且不需要任何人的批准**。

Phase 1（结构化校园数据）**阻塞于信息办**；Phase 2（场馆预约与高级能力）
依赖 Phase 1；Phase 3（自动续期）依赖 GeekPie 确认（U8）。
**本轮不实现 Phase 1–3，也不假装它们只是"待接线"。**

**F. 一级身份：不照抄 TechPie 的 Casdoor 方案**

TechPie 用 Casdoor 做一级身份。**我们不能照抄** —— 那会把"可达鸭的账号体系"
绑定到另一个第三方服务的可用性与合规状态上。契约 §5 的 Port 形状按方案 A 设计，
实现用过渡 IdP（方案 B），**Port 边界不因实现是过渡方案而放松**。

**G. 许可证：不复制任何代码（硬约束）**

事实核查结论（规格 §7.1 已实际执行）：TechPie-flutter **仓库内没有 LICENSE 文件**，
README 声称 MIT，GitHub API 报 `license: null`。
**没有 LICENSE 文件时，"README 里写 MIT"在法律上不构成明确授权** ——
MIT 的生效依赖 LICENSE 文件随代码分发。

| 允许 | 禁止 |
| --- | --- |
| 阅读代码、理解架构思想 | **复制任何代码**（哪怕几行） |
| 借鉴六边形分层 / Port 模式 / 启动时序等**设计思想** | 把 Dart 代码"翻译"成 TypeScript（**翻译仍是衍生作品**） |
| 在文档中引用文件路径与行号（事实引用） | 复制 `ecard_bind_hijack.dart` 的隧道实现 |

**任何代码复用必须先取得上游书面澄清**（补 LICENSE 文件，或出具书面许可）。
可达鸭的 `techpie` 模块是**独立实现**，只对齐"能力清单"这一**事实**。

**H. 不变式 I1–I5 的架构测试是 Phase 0 的核心交付**

Phase 0 的价值不只是"能绑定校园卡"，更是**把两级身份的边界用测试钉死**，
使得后续任何人（包括未来的我们）想走捷径时**会立刻失败**：

| 不变式 | 内容 | 为什么它重要 |
| --- | --- | --- |
| **I1** | `KedaYaIdentitySession` 的序列化**不含** 8 个禁用键 | 一级身份绝不能泄漏二级凭证 |
| **I2** | `modules/auth/data/**` **不 import** `campus-session.port` | 防止两级身份在实现层被悄悄耦合 |
| **I3** | `cookieHeaderFor(` 的**全部调用点**都在 `webview-session/` 内 | cookie 只能有一个出口，否则无法审计 |
| **I4** | 登录但未绑定 → `409 CAMPUS_BINDING_REQUIRED`（**不是 401**） | 401 会误导客户端去重新登录，而用户其实已登录 |
| **I5** | mock 上游全超时下 `GET /auth/session` **< 50ms** 返回 | 契约 §8：启动不得被上游拖死 |


### 11.19 TechPie 绑定契约的三处冲突裁决（v1.3.7 · 2026-10-17）

小程序端实现 Phase 0 时发现规格 §8 与冻结 OpenAPI 有三处**形状冲突**。逐条裁决：

#### A. 绑定状态枚举：**以 OpenAPI 为准**（规格那套作废）

| 来源 | 枚举 |
| --- | --- |
| 规格 §8.3 | `UNLINKED \| LINKING \| LINKED \| EXPIRED \| REVOKED` |
| 冻结 OpenAPI | `PENDING \| ACTIVE \| EXPIRED \| REVOKED \| FAILED` |

**裁决：用 OpenAPI 那套。** 理由：
- OpenAPI 那套有 **`FAILED`** —— 绑定可能失败，规格那套**无法表达失败**，
  只能把失败塞进 `UNLINKED`，于是"从没绑过"与"绑过但失败了"不可区分，
  而这两种状态对用户的意义完全不同（前者引导绑定，后者要显示失败原因）。
- `UNLINKED` 是**冗余**的：没有 link 记录本身就是"未绑定"，
  不需要一个专门的记录状态来表达它。
- 已冻结的枚举不应为一份更弱的规格让路。

规格的 `LINKING`/`LINKED` 归一化为 `PENDING`/`ACTIVE`（小程序端已如此实现）。

#### B. `TechpieLinkCreate.openid` → **改名为 `authCode`**，且语义必须是"一次性"

**问题**：规格 §8.5 的字段叫 `openid`，但**小程序在密码学上拿不到 openid** ——
openid 需要服务端用 AppSecret 走 `code2session` 换取。客户端能拿到的只有
`wx.login()` 的**一次性 code**。

**裁决：改名 `authCode`，语义是"一次性凭证交换码"，不是任何长期标识。** 理由：

1. **命名会塑造行为。** 叫 `openid` 会诱导客户端把某个**长期标识**填进去
   （甚至缓存下来复用），而它应该是一次性的。
2. 服务端必须**立即用掉并丢弃**该 code（`code2session`），
   **不得**把 code 或换来的 openid 写进日志（§10.3）。
3. 该字段**只对 `provider: 'ecard'` 有效**（Phase 0 的 OPENID 通道）。
   其余 provider 属 Phase 1，在信息办书面回复前不实现（U7）。

> 这与契约 §11.14-A 的推理一致：**有歧义的坏名字必须改**。
> `openid` 就是这样一个坏名字 —— 它让"一次性 code"看起来像"长期身份"。

#### C. `CampusBindingSummary` 命名冲突：`/techpie/links` 的元素用 **`TechpieLink`**

**问题**：规格 §8.1 说 `GET /techpie/links` 返回 `CampusBindingSummary[]`，
但冻结 OpenAPI 里 `CampusBindingSummary` 已经被
**`/auth/campus-bindings`** 占用，且形状完全不同
（`{platform, bound, expiresAt, lastRenewedAt}`）。

**裁决：`/techpie/links` 的元素用 `TechpieLink`**（OpenAPI 已如此定义），
规格 §8.1 的表述作废。理由：同名两形状是**最坏的一类契约缺陷** ——
它会让实现者按名字去猜，而猜错不会报错、只会静默错。
两者本来就是不同概念：
- `CampusBindingSummary`（`/auth/*`）= **二级身份绑定状态摘要**（面向登录态）
- `TechpieLink`（`/techpie/*`）= **一条可管理的绑定资源**（有 id、可解绑、可续期）

#### D. 两个**缺失的端点**（登记为开放项，不在本轮发明）

小程序端发现冻结契约里：

| 缺失 | 小程序端的诚实处理 | 裁决 |
| --- | --- | --- |
| **校园卡余额端点** | 用 `CampusCardTxn.balanceFen`（交易后余额）**推导**，未发明端点 | **接受推导**；若要独立余额端点，需先登记进契约（属 `campus-card` 模块，跨作用域） |
| **付款码端点** | 实现调用路径 + 常量 `CAMPUS_CARD_PAYMENT_CODE_REGISTERED = false` 机器可见，UI 明确告知"当前仅 mock 可演示" | **登记为开放项**（§11.9）。**不假装它能用** —— 这比编一个端点好 |

> 第 2 条是本次最值得保留的做法：**能力未实现时，用一个机器可见的常量把它标出来，
> 并让 UI 如实告知**，而不是让它看起来已经能用。


### 11.20 TechPie wire 形状**最终收敛**（v1.3.8 · 2026-10-17）

后端实现时发现仓库里同时存在**三套互相矛盾的 techpie wire 形状**，并正确地
**拒绝自行收敛、上报 Lead**（而不是"以我为准"或"都支持"）。这是对的 —— 三方各写一套
会让契约彻底失效。

#### 根因：**port 类型与 wire 类型同名**

规格 §4.3 定义 `CampusBindingSummary` 时，它其实是 **`CampusSessionPort` 的返回类型**
（一个**端口**类型，在进程内部用）；而 §8.1 又说 `GET /techpie/links` 返回
`CampusBindingSummary[]` —— **把端口类型当成了 wire 类型**。
与此同时冻结 OpenAPI 里 `CampusBindingSummary` 是 `/auth/campus-bindings` 的
**另一个 wire 类型**（`{platform, bound, expiresAt, lastRenewedAt}`）。

**同一个名字，跨了两个层（port / wire）、指了两个概念。** 这是本次冲突的总根源 ——
比"两个 wire 形状不一致"更难发现，因为两边看起来都"有定义"。

#### 裁决（逐条，最终版）

**A. `/techpie/links` 的元素类型 = `TechpieLink`**（不是 `CampusBindingSummary`）
- 字段用 **`provider`**（不是 `platform`）—— §11.10-B 已冻结该枚举
- 状态用 **`PENDING \| ACTIVE \| EXPIRED \| REVOKED \| FAILED`** —— §11.19-A 已裁决
- `CampusBindingSummary` **只属于** `/auth/campus-bindings`，不再被 techpie 引用

**B. 端口类型改名为 `CampusBindingState`**

规格 §4.3 的那个类型是**端口**类型（`CampusSessionPort` 的返回），
与 wire 类型是两个层的东西，**必须不同名**。
改名为 `CampusBindingState`，并明确它**不是** wire 契约、**不出现在任何响应里**。

> 规则：**port 类型与 wire 类型不得同名。** 同名会让"这个字段到底按哪个算"
> 变成一个没有答案的问题，而实现者只能猜 —— 猜错不报错，只静默错。

**C. 校园平台枚举**统一为一套（两个 wire 类型现在用两套，这是错的）

| 原 `/auth` 那套 | 原 `/techpie` 那套 | **统一后** |
| --- | --- | --- |
| `egate` | `egate` | `egate` |
| `cp-daily` | `cpdaily` | **`cpdaily`** |
| `academic` | （无） | **`jwc`**（教务） |
| `campus-card` | `ecard` | **`ecard`** |
| （无） | `cas` | `cas` |
| （无） | `techpie` | `techpie` |

**最终枚举：`cas \| egate \| cpdaily \| jwc \| ecard \| techpie`**，两个类型共用。
理由：`cp-daily` 与 `cpdaily` 是同一个东西的两种拼法 —— **同一概念两个拼法，
迟早会出现"只匹配到一半"的 bug**（`if (p === 'cpdaily')` 漏掉 `cp-daily`）。

**D. 移除全部"加法兼容别名"**

后端为兼容三方，在不违反冻结接口处做了加法（`/capabilities` 同时返回 `items` 与 `capabilities`、
条目同时给 `id`/`key`、`platform`/`requiredProvider`、`status`/`available`；
`/webview-session` 同时给 `expiresInSec` 与 `expiresAt`）。

**裁决：全部移除。一个字段只有一个名字。**

理由：加法兼容看起来"无害且友好"，实际是**把一个概念变成两个 owner**：
- 两个名字会**永久共存** —— 没有任何自然时点去删掉旧的那个（"万一还有人用呢"）；
- 消费方会**分裂**（一部分读 A、一部分读 B），于是"改一个地方"不再足够；
- 它让契约**看起来**兼容，实际上把不一致从编译期推到了运行期。

**正确的做法是现在收敛，而不是兼容。** 三端都在同一轮里，没有"存量消费者"需要保护。

**E. `/webview-session` 的形状**（最终版）
- 入参：`{linkId, targetUrl}`（`linkId` 而非 `platform` —— 票据针对**一条具体绑定**，
  而不是"某个平台"；用 `platform` 会让"用户有两条同平台绑定"变成歧义）
- 出参：`{ticket, targetUrl, expiresAt, singleUse: true}`
- 规格的 `expiresInSec: 30` 作废（绝对时间 `expiresAt` 比相对秒数更适合分布式校验）


### 11.21 TechPie 客户端实现期裁决（v1.3.9 · 2026-10-17）

#### A. **修正 §11.18-B 的端口规则** —— 我原来那条是错的

§11.18-B 我写了"禁止非 443 端口"。**这条规则是错的**，Flutter 端在实现时发现它与
规格 §8.4 的示例地址 `https://ecourse.shanghaitech.edu.cn:8080/` 直接冲突 ——
而真实校园系统**确实可能跑在非 443 端口上**（校内自建服务很常见）。

**"禁止非 443 端口"是一刀切，它既不能防住真正的风险，又会挡掉合法场景。**

真正的风险不是"端口是多少"，而是**"这个 origin 是不是我们批准的那个"**。
所以正确做法是**按完整 origin 精确匹配**：

**修正后的规则（取代 §11.18-B 第 3 条）**：
1. 白名单条目是**完整 origin**（`scheme://host[:port]`），例如
   `https://ecourse.shanghaitech.edu.cn:8080`
2. 校验必须是**精确 origin 匹配**（scheme + host + port 三者全等），
   **不是** host 匹配后再看端口
3. 仍然**禁止**：`http`、IP 字面量、`@` userinfo
   （`https://shanghaitech.edu.cn@evil.com` 是经典绕过）、
   通配子域（`*.shanghaitech.edu.cn` —— 会放行被攻陷的子域）
4. 校验在**服务端**做

> **精确 origin 匹配比"host + 端口白名单"更强**：它连"同一个 host 的另一个端口"都挡住了，
> 而那条一刀切规则反而放行了 `https://evil.com`（只要端口是 443）。
> 换句话说，**原来那条规则既漏又误**。

#### B. 校园卡是**真实缺口**，必须定契约（不能靠客户端猜）

Flutter 端发现：`services/api` 的 `campus-card` 目前是 `scaffold.mjs` 生成的**通用 CRUD**
（`items` + `summary`，而 `summary` 是**汇总**不是余额；`direction: 'out'|'in'`；
字段 `happenedAt`），**没有** 开通 / 余额 / 流水 / 付款码 的路由。
而三端都需要这四件事。

**裁决：校园卡按以下形状定契约**（登记为 `campus-card` 模块的正式端点）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/campus-card/account` | 账户：`{activated, balanceFen, updatedAt}`。**金额一律整数分** |
| `POST` | `/campus-card/account/activate` | 开通（**OPENID 通道**，与 CASTGC 完全解耦） |
| `DELETE` | `/campus-card/account` | 解绑/注销 |
| `GET` | `/campus-card/transactions` | 流水（游标分页），字段 `{id, amountFen, direction: DEBIT\|CREDIT, balanceAfterFen, occurredAt, merchant}` |
| `GET` | `/campus-card/payment-code` | 付款码 `{code, expiresAt}`（**短时效，禁止缓存/禁止进日志**） |

字段名裁决（**取代** scaffold 生成的通用形状）：
- `direction` 用 **`DEBIT` / `CREDIT`**（大写），**不是** `out` / `in` ——
  与全仓其它枚举一致（`PENDING`/`PUBLISHED`/`DEBIT`），且 `out`/`in` 有方向歧义
  （"out" 是从谁的角度？）
- 时间字段用 **`occurredAt`**（**不是** `happenedAt`）—— 与全仓 `observedAt`/`startsAt`/`createdAt`
  的命名习惯一致（**交易发生时刻** vs **入库时刻**，契约 §11.10-A 已确立这个区分）
- 余额用 **`balanceFen`**（**不是** `summary`）—— `summary` 是"汇总"，
  而这里是"余额"，两个概念

**付款码的登记状态**：契约里**没有**付款码端点，而小程序端已用
`CAMPUS_CARD_PAYMENT_CODE_REGISTERED = false` **机器可见**地标出这一点。
**裁决：现在登记该端点，并把常量置为 `true`** —— 因为形状已由本条确定。
但**在真实校园卡通道打通前，服务端返回 `UPSTREAM_UNAVAILABLE` 而不是假数据**。

#### C. 规格 §8.4 的两处文档错误（以裁决为准）

| 规格写的 | 实际/裁决 | 理由 |
| --- | --- | --- |
| 票据兑换是 `GET` | **`POST /techpie/webview-session`** | 它**创建**一个一次性票据资源（非幂等），`GET` 语义错误（`GET` 不应有副作用） |
| 示例地址含 `:8080` 且与"禁非 443"冲突 | 见本条 A | 规则已修正为精确 origin 匹配；`:8080` 现在**可以**在白名单里 |

#### D. W4 直连**不要求绑定** —— 这是刻意的

Flutter 端发现 `services/api` 的 `resolvePlatform()` 在未指定平台时**不校验绑定**，
并据此把 `createWebViewSession(platform:)` 改为可空。

**裁决：正确，保持。** 理由：W4 的定义就是"**用户在校园系统页面自己登录，我们不接触 cookie**"——
我们**不需要**用户的凭证就能把他送到那个页面。要求先绑定才能直连，
等于**给一个不需要权限的功能加了权限门**。

但要注意：**直连不需要绑定 ≠ 直连不需要登录** —— 它仍需一级身份（`UNAUTHENTICATED` 仍适用）。

#### E. 两套平台枚举合并 —— §11.20-C 已处理

Flutter 端发现 `campus_binding.dart` 的 `CampusSystem`（`egate|cpdaily|academic|ecard`）
与契约 §11.10-B 的 `cas|egate|cpdaily|ecard|techpie` 并存。
**§11.20-C 已裁决统一为 `cas|egate|cpdaily|jwc|ecard|techpie`。**
`CampusSystem` 应改为该枚举的别名（或直接删除），**不得保留第二套拼法**。

#### F. 能力清单的键名并集必须收敛

Flutter 端为容错，客户端**同时接受** `title`/`nameZh`、`description`/`summary`、
`state`/`status`、`reason`/`blockedReason`。

**裁决：收敛为单一键名**（与 §11.20-D 同一推理 —— 一个概念只有一个 owner）：
`key` / `nameZh` / `phase` / `available` / `requiredProvider` / `blockedReason`。
客户端的并集容错**应在本轮之后删除**，而不是长期保留。


### 11.22 TechPie Phase 0 收尾裁决（v1.3.10 · 2026-10-17）

四端实现完成后浮现 4 项必须收敛的问题。

#### A. `ticket` 既是 I1 的禁用键、又是 §8.4 要求的响应字段 —— **这是真矛盾**

I1 把 `ticket` 列为 8 个禁用键之一（因为它可能指代会话票据），
而 §8.4 的 `POST /webview-session` 响应**明文要求**返回 `ticket`。
后端按 I1 的**本意**执行：只在 `webview-session` 这一个端点放行，其余一律禁止。

**裁决：采纳该处理，并把 I1 的措辞精确化。**

I1 的**本意**是"一级身份会话的序列化不得夹带二级凭证"，
它约束的对象是 **`KedaYaIdentitySession` 及其派生投影**（`/auth/session`、
`/auth/campus-bindings`、绑定摘要），**不是全仓每一个叫 `ticket` 的字段**。

**精确化后的 I1**：
> `KedaYaIdentitySession` 及 `/auth/*` 的全部响应，序列化键名不得包含
> `cookie` / `cookies` / `session` / `sessionToken` / `tgc` / `castgc` / `ticket` / `tenant`。
> 其它模块的**领域字段**若语义不同（如 `webview-session` 的一次性票据），
> 不受该禁令约束 —— 但必须满足它自己的约束（不缓存 / 不进日志 / 不进 URL / 用后即焚）。

理由：把一条**关于身份的**禁令扩大成"全仓禁用某个词"，会让合法字段被迫改名
（`webviewTicket` → 什么？），而改名**不减少任何风险** —— 风险来自"值泄漏"，
不来自"键叫什么"。**用词禁令只能约束它真正要约束的那个对象。**

#### B. I3 的豁免面：**只豁免 `*.spec.ts`**

后端为让 I3 的静态扫描**完备而非启发式**，把端口声明写成属性 + 函数类型
（`cookieHeaderFor: (…) => …`），于是"出现 `cookieHeaderFor(`" ⟺ "有人真的在调用"。
代价是测试无法直接调用它，故豁免 `*.spec.ts`。

**裁决：接受。** 两个条件同时成立才可接受：
1. 豁免面**只有** `*.spec.ts`（不能是"任何测试相关文件"或目录级豁免）；
2. 测试**不随产物发布**（`tsconfig.build.json` 的 `exclude` 钉死）。

理由：I3 的目的是"cookie 只能有一个出口，否则无法审计"。
`*.spec.ts` 不进生产产物，因此不构成第二个出口。
**但豁免面必须恰好是这一类** —— 一旦放宽到目录或"测试文件"这种模糊集合，
I3 就从"结构保证"退化成"看起来像保证"。

#### C. `POST /techpie/webview-session/:ticket` —— **登记为正式端点（第 9 个）**

规格 §8.4 的"换取方式"要求它，但冻结 OpenAPI **只登记了签发端**。
没有兑换端，票据**根本用不掉** —— 这是契约自身的缺口，不是实现多余。

**裁决：登记。** 形状：`POST /techpie/webview-session/{ticket}` →
`{url, targetUrl, mode: 'direct', expiresAt, cookieInjected: false, reason: 'W4_PHASE_0'}`。
`cookieInjected: false` 在 Phase 0 下**恒为 false** —— W4 的定义就是"我们不接触 cookie"。
这个字段存在的意义是**让"我们没注入 cookie"这件事可被机器断言**，而不是靠文档承诺。

#### D. `POST /webview-session` 的 `platform` 是**可空**的

规格 §8.4 的表格写必填且要求"已绑定"，但 §9.1 的 W4 直连**不需要绑定**。
Web 端按可空建模，`null` 时**省略该键**（后端 schema 是 `.optional()`）。

**裁决：`platform` 可空，且为可空时省略该键（不下发 `null`）。** 理由见 §11.21-D：
W4 直连的定义就是"用户自己在校园系统页面登录，我们不接触凭证" ——
**我们不需要凭证就能把他送到那个页面**。要求先绑定等于给不需要权限的功能加权限门。

> 顺带确立一条通用规则：**可空的可选字段，为空时省略键，而不是下发 `null`。**
> `null` 与"字段不存在"在多数 JSON 反序列化里是**不同**的语义，
> 混用会让客户端不得不写 `if (x == null || x === undefined)`。

#### E. 后端需按 §11.20 收敛（本轮遗留）

后端实现时**以规格为准**（`platform` + `UNLINKED|LINKING|LINKED|…` + 加法别名），
因为它先于 §11.20 完成。§11.20 已裁决**以 OpenAPI 为准**。
因此后端需：改用 `provider`、改用 `PENDING|ACTIVE|EXPIRED|REVOKED|FAILED`、
**删除全部加法别名**、并按 §11.21-B 实现校园卡的四条端点。
