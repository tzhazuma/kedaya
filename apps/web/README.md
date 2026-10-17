# @kedaya/web —— 可达鸭 Web 门户 + 管理后台

Next.js **16.4.2** App Router · React **19.3.1** · TypeScript **5.9.3** · Tailwind CSS **4.3.3**
TanStack Query **5.104.3** · Zod **4.6.7** · Vitest **5.0.5**

> 可达鸭（KedaYa）是**第三方开源**校园服务平台，**非上海科技大学官方系统**（契约 §9，全站显著标注）。

---

## 1. 快速开始

```bash
# 仓库根目录（npm workspaces，无 pnpm）
./scripts/with-npm-lock.sh npm install      # 并行工作流下必须用锁包装

# 只跑 Web
npm run dev       -w @kedaya/web            # http://localhost:3000
npm run build     -w @kedaya/web
npm run start     -w @kedaya/web
npm run typecheck -w @kedaya/web
npm run test      -w @kedaya/web
npm run lint      -w @kedaya/web
```

**默认无需后端**：`data/repositories` 工厂默认装配 **mock 适配器**（内存数据），
所以 `npm run dev` 开箱即可跑通拼单垂直切片与后台占位页。

### 环境变量（全部为构建期公开变量）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NEXT_PUBLIC_KEDAYA_USE_MOCK` | `true` | `false` 时切到真实 HTTP（契约 §6.1 路由） |
| `NEXT_PUBLIC_KEDAYA_API_BASE` | `/api/v1` | API 基地址（SSR 可注入绝对地址） |
| `NEXT_PUBLIC_KEDAYA_DEMO_TOKEN` | 空 | 演示用 Bearer token（真实登录必须走契约 §5 身份层） |
| `NEXT_PUBLIC_KEDAYA_SITE_URL` | `http://localhost:3000` | `metadataBase`，用于 openGraph 绝对地址 |
| `NEXT_PUBLIC_ADMIN_API_KEY` | 空 | `/admin/dishes` 写菜品时附加的 `x-admin-key`；须与 API 端 `ADMIN_API_KEY` 一致。**仅限本地开发 / 演示**（见 §10.4） |

示例见 `apps/web/.env.example`。

---

## 2. 目录结构（契约 §7 六边形分层，目录名冻结）

```
apps/web/
├── public/brand/            # 品牌资源（从 assets/brand 复制 + 生成 cover.png）
├── src/
│   ├── app/                 # 装配与路由：layout / providers / page / 路由组
│   │   ├── (portal)/        #   门户路由组：groupbuy / forum / faq、/m/[moduleId] 模块占位
│   │   ├── (admin)/         #   管理后台路由组：/admin
│   │   ├── providers.tsx    #   TanStack Query Provider + 主题 Provider
│   │   └── globals.css      #   Tailwind 4 入口 + design-tokens 导入 + @theme 映射
│   ├── application/         # 用例层（编排，不含 IO）
│   │   ├── groupbuy/        #   loadGroupBuyList / loadGroupBuyDetail / joinGroupBuy
│   │   ├── forum/           #   loadForumPostList / loadForumPostDetailWithBoard / submitForumPost / submitForumReport / replyToForumPost
│   │   ├── faq/             #   loadFaqArticles / voteFaqHelpful(乐观更新) / loadFaqTickets / submitFaqTicket / markdownSubset
│   │   ├── viewState.ts     #   四态选择器（loading/error/empty/ready，纯函数可单测）
│   │   └── admin/           #   loadAdminDashboard
│   ├── domain/              # 纯领域（零框架、零 IO）
│   │   ├── models/          #   module(+modules 注册表) / groupbuy / forum / faq / audit
│   │   └── ports/           #   GroupBuyRepository / ForumRepository / FaqRepository / AuditLogRepository / ModuleSwitchRepository
│   ├── data/                # 适配器层（唯一发请求的地方）
│   │   ├── api/client.ts    #   /api/v1 + Bearer + X-KedaYa-Trace + Idempotency-Key → Result
│   │   ├── schemas/         #   zod 传输层校验（含 schema ↔ domain 双向类型断言）
│   │   ├── repositories/    #   端口实现（http）+ 运行时工厂（mock/http 切换）
│   │   └── mock/            #   内存 mock 适配器 + 数据集（无后端可跑）+ 游标工具（服务端替身）
│   ├── platform/            # 平台差异：env / share / analytics
│   └── presentation/        # UI：components / theme / query
└── README.md
```

依赖方向：`presentation → application → domain ← data`（`domain` 不 import 任何框架或 IO）。

### 首页宫格为什么"不硬编码"

`src/domain/models/modules.ts` 从 `@kedaya/contracts` 的 `MODULES` 派生 `PORTAL_MODULES`（19 个 = 5 基础 + 14 业务），
只补 UI 装饰（icon / accent / **交付状态**）。首页、`/m/[moduleId]` 说明页、管理后台开关表**三处共用同一份数据**。
`validateModuleRegistry()`（纯函数）+ 单测会在有人漏装饰/漏模块/重复 id/漏登记交付状态时立刻失败。

### 交付状态为什么单独一张表

契约只说"有这 19 个模块"，不说"哪些已经能用"——而门户必须说真话。
`src/domain/models/delivery.ts` 是**唯一真相**：`web`（有真实页面）/ `miniapp`（小程序已上线）/
`api-only`（只有接口）。宫格角标、模块说明页、`moduleHref()` 全部由它派生，
且 `stage: 'web'` 必须带 `webHref`（单测兜底，杜绝"标着可用、点进去是占位页"）。

---

## 3. 已实现

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| 设计令牌接入 | `globals.css` | `@import '@kedaya/design-tokens/css'` + `@theme` 把 `--kdy-*` 暴露为 `bg-brand` / `text-ink` / `rounded-lg` 等工具类；**全项目零手写色值** |
| 统一响应信封解包 | `data/api/client.ts` | HTTP → `ApiEnvelope` → `Result<T, ApiClientError>`，不向 UI 抛异常；状态码 → 冻结错误码兜底 |
| 请求头约定 | 同上 | `Authorization: Bearer`、`X-KedaYa-Trace`（自动生成 + 响应头兜底）、写操作 `Idempotency-Key` |
| mock 适配器 | `data/mock/` | 内存数据集（6 条拼单 / 8 主题+8 回复+4 举报 / 10 FAQ 条目+3 工单 / 6 条审计 / 20 个开关），支持故障演练（`error` 模式）与 `reset()` |
| 首页 | `app/page.tsx` | 品牌区（含 `UnofficialNotice`）+ 20 模块宫格（分组）+ 隐私/审计说明 + 平台能力 |
| 模块占位页 | `app/(portal)/m/[moduleId]/page.tsx` | 20 个模块入口全部可达（非 404），展示路由前缀/敏感级/同意门要求 |
| **拼单垂直切片** | `app/(portal)/groupbuy/**` | 列表（游标分页 + 状态/关键词筛选 + 四态）与详情（参与者/规则/**参团 mutation**） |
| **论坛切片** | `app/(portal)/forum/**` | 版块导航 + 主题列表（游标分页 / 版块筛选 / 关键词 / **被治理主题显式标注状态**）；详情（正文 + 回复列表 + 回复框 + **举报弹层**）；发帖页（**匿名开关** + 隐私说明） |
| **FAQ 切片** | `app/(portal)/faq/**` | 分类导航 + 搜索 + 手风琴条目 + **「有用/无用」乐观更新与失败回滚**；`/faq/tickets` 我的工单（提交 + 状态 + 脱敏联系方式） |
| **wildlife 切片** | `app/(portal)/wildlife/**`、`app/(admin)/admin/wildlife/page.tsx` | 动物地图（静态底图 + SVG 叠加层）、观测列表/详情、区域列表、推断轨迹页、上报表单（照片上传 + 地图点选 + 自动分类降级）、审核队列（`moderate` 冻结动作）—— 见 §8 |
| **找搭子切片** | `app/(portal)/buddy/**` | 搭子广场（三板块分栏 + 封闭标签筛选 + 游标分页）、详情（`join` 申请 / `leave` 撤回 / `decide` 审批 / `close` 关闭）、发布（**封闭标签选择器，无自由文本**）、我的匹配资料（**可用时段编辑器，支持跨零点**）、推荐（**展示 `explainMatch` 的理由**，不是只给分数）+ `like`/`dislike`/`skip` 反馈 —— 见 §9 |
| 管理后台占位 | `app/(admin)/admin/page.tsx` | 模块开关表（20 行，受权限约束）+ 审计日志表（§9 字段齐全）+ 合规概览 + 子页入口 |
| **营养管家 · 菜品营养数据**（`/admin/dishes`） | `app/(admin)/admin/dishes/page.tsx`、`presentation/components/admin/DishManager.tsx` | 20 个模块中的 `canteen` 的**数据地基**：菜品检索（食堂 / 品类 / 菜名）+ 新建 / 编辑 / 下架，六项营养（热量 / 蛋白 / 脂肪 / 碳水 / 膳食纤维 / 钠，**每份**口径）。写操作走 `x-admin-key`（后端 `AdminGuard`）—— 见 §10 |
| 5+ 复用组件 | `presentation/components/` | `KdyCard` `KdyButton` `KdyBadge` `KdyEmpty` `KdySkeleton` `KdyAlert` `ModuleGrid` `PageHeader` `SiteHeader` `SiteFooter` `UnofficialNotice` + forum/faq/wildlife/buddy 专属组件 |
| 主题 Provider | `presentation/theme/` | light/dark/system 三态；`useSyncExternalStore` 订阅 `localStorage` + `matchMedia`；写 `<html data-theme>`（system 移除）+ `dark` class + `color-scheme`，暗色配色来自令牌 `colorDark` |
| 品牌资源 | `public/brand/` | `kedaya-mascot.svg`、`kedaya-cover.svg`（复制，源文件未动）+ `cover.png`（1200×630，`rsvg-convert`） |
| 测试 | `src/**/*.test.ts` | 26 个文件 / **577 个用例**，全部纯逻辑（node 环境，无需 jsdom） |

### 测试覆盖

| 文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `domain/models/groupbuy.test.ts` | 19 | 名额/进度/参团资格/状态机/折扣/整数分金额/排序/领域校验 |
| `domain/models/forum.test.ts` | 27 | 匿名身份派生（同版块稳定/跨版块不可拼接/不含实名明文）、治理可见性、主题与回复状态机、举报阈值（不同用户去重）、发帖/回复频率、敏感词拦截、标签归一、排序、excerpt |
| `domain/models/faq.test.ts` | 21 | 分类注册表、检索排序（问题命中优先）、有用占比、投票语义（幂等/改票/撤回/不为负）、工单状态机与自动关闭、联系方式脱敏与「不存明文手机号」 |
| `domain/models/modules.test.ts` | 12 | 注册表与契约一一对应（**20 个模块**）、`validateModuleRegistry` 零问题、同意门恰为 3 个、审计范围 = high+critical |
| `domain/models/audit.test.ts` | 14 | 脱敏、审计摘要四要素、过滤/聚合/排序、开关权限、`toggleModule` 不可变 |
| `data/api/client.test.ts` | 13 | 信封成功/失败、非信封兜底、非 JSON、网络异常、请求头与查询串、trace 兜底、baseUrl 覆盖 |
| `application/groupbuy/groupbuy.test.ts` | 10 | 视图模型本地化（分转元/相对时间）、用例编排、错误码透传 |
| `application/forum/forum.test.ts` | 27 | 四态选择器、版块可访问性、治理状态视图模型、匿名开关语义（含 `toCreatePostInput` 只传实名+标记）、举报回执、回复用例、**§11.10-E 游标原样透传** |
| `application/faq/faq.test.ts` | 21 | 条目/分类/工单视图模型、空态引导、**乐观更新与回滚（纯函数）**、投票用例、工单提交校验 |
| `application/faq/markdownSubset.test.ts` | 6 | Markdown 子集行内解析（加粗/行内代码/未闭合标记不吞内容/纯文本退化） |
| `data/mock/groupbuy.repository.test.ts` | 13 | 游标分页不重叠、状态过滤、NOT_FOUND/CONFLICT/VALIDATION_FAILED、故障演练、reset |
| `data/mock/forum.repository.test.ts` | 24 | 游标分页/版块/关键词过滤、隐藏主题可打开、匿名发帖解耦、频率限制、举报阈值→HIDDEN、回复锁定冲突、故障演练、reset |
| `data/mock/faq.repository.test.ts` | 15 | 分类/关键词过滤、游标分页、投票幂等与改票、归档不可投票、工单归属与未登录提交、手机号拒绝、故障演练、reset |
| `data/repositories/forum-faq.http.test.ts` | 16 | 路由由模块注册表派生、`report` 冻结 action、faq votes 子集合、`Idempotency-Key`、脏数据 → INTERNAL、错误码透传、**不透明游标原样传递** |
| `presentation/theme/tokens.test.ts` | 5 | **零手写色值守卫**（扫描 forum/faq 全部源文件）+ 暗色令牌可达性（`[data-theme="dark"]` / `prefers-color-scheme`） |

---

## 4. 未实现 / 已知限制（如实列出）

1. **鉴权是占位**：没有接契约 §5 的身份层（CAS / Egate OAuth），没有 `CampusSessionPort` 的第二级绑定流程。
   后台操作者硬编码为 `DEMO_ADMIN_ACTOR = { id: 'u_admin_01', role: 'admin' }`。
2. **暗色模式已接通，但未做 FOUC 防护**：`design-tokens` 的 `colorDark` 通过
   `[data-theme="dark"]` 与 `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` 暴露，
   `ThemeProvider` 写 `<html data-theme>`（system 模式移除该属性），配色与 `dark:` 变体同时生效。
   未做的是：**没有**在 `<head>` 注入阻塞式内联脚本，所以"上次选了深色"的用户首帧仍是浅色（随后切换）。
   因为没有可见的布局/文字闪烁（只是配色切换），暂未引入该脚本。
3. **业务缓存/离线未实现**：契约 §8 要求"启动时 hydrate 缓存"。当前只 hydrate 了主题偏好，
   拼单列表是纯网络/mock 拉取（首屏为骨架屏，符合"禁止阻塞等待网络"）。
4. **同意门 UI 未实现（仅 Web 端）**：`/m/[moduleId]` 只**提示**需要二次同意，
   没有实现真实的同意记录、撤回、`CONSENT_REQUIRED` 拦截（客户端能识别该错误码但未接流程）。
5. **其余 16 个模块只有占位页**：`groupbuy` / `forum` / `faq` 有真实垂直切片。
6. **后台不落库**：模块开关只改内存；审计条目在 mock 里是**追加到内存**，刷新即回到种子数据。
   开关状态没有做乐观更新回滚（失败时只提示 + 重新拉取）。
7. **`/api/v1/admin/*` 不在契约 §6.1 的路由前缀表内**：审计与模块开关属管理域，
   我用了 `/admin/audit-logs`、`/admin/modules`（见下"偏差"）。
8. **未接 E2E / 组件渲染测试**：Vitest 只覆盖纯逻辑；React 组件未做渲染断言（未引入 jsdom/Testing Library）。
   已用真实浏览器人工验证三态、参团、发帖（匿名）、回复、举报、FAQ 投票与回滚（见 §5）。
9. **未接入 `platform/share.ts`、`platform/analytics.ts` 的 UI**：能力已实现，但页面上没有调用点。
10. **`next lint` 已不存在**：Next 16 移除了 `next lint` 与 `eslint` 配置键，
    `lint` 脚本改为独立 `eslint .`（扁平配置 `eslint.config.mjs`）。
11. **forum/faq 的鉴权仍是演示会话**：`DEMO_FORUM_SESSION`（`u_1024` / 鸭鸭先冲）与
    `DEMO_FAQ_USER_ID` 是占位常量；契约 §5 的身份层未接入，因此"未登录"分支只有
    `campus_only` 版块锁定这一处可验证（`ANONYMOUS_FORUM_SESSION` 已备好，页面未接线）。
12. **Markdown 只支持子集**：FAQ 答案与论坛正文按「Markdown 子集」存储，Web 侧只渲染
    `**加粗**` 与 `` `行内代码` ``（`application/faq/markdownSubset.ts`，纯函数 + 6 个单测），
    其余标记（列表/标题/链接/图片）按纯文本原样展示；**不引入** markdown 库，也**不使用**
    `dangerouslySetInnerHTML`（片段 → React 元素，无注入面）。
13. **论坛匿名只做到"客户端不拼匿名 id"**：匿名化在 data 层/服务端完成，Web 侧
    `deriveAnonymousIdentityId` 只是 mock 的**服务端替身**；真实匿名身份由后端签发。
14. **举报阈值语义在 mock 里是即时生效**：3 个不同用户举报 → 立刻 `HIDDEN`；
    真实后端会进人工队列并可能回滚（`UPHELD` / `DISMISSED`），Web 只负责展示状态与文案。
15. **管理后台的模块开关表已自动变为 20 行**（随 `PORTAL_MODULES` 数据驱动），
    但审计种子数据仍是 6 条固定样例，未按新模块补样例。

---

## 5. 自检证据（真实执行输出摘要）

```bash
$ ./scripts/with-npm-lock.sh npm install --fetch-retries=6 --no-audit --no-fund
[with-npm-lock] 已获取锁，执行: npm install ...
added 383 packages in 31s
```
> 第一次 `npm install` 因网络 `ECONNRESET` 失败，加 `--fetch-retries=6` 重试后成功（真实输出，未隐藏）。

```bash
$ npm run typecheck -w @kedaya/web
> tsc --noEmit -p tsconfig.json
（无输出 = 0 错误）
```

```bash
$ npm run lint -w @kedaya/web
> eslint .
（无输出 = 0 problems；exit code 0）
```
> 说明：中途曾报 16 problems（13 errors）—— `@next/next/no-assign-module-variable`（变量名叫 `module`）、
> `react-hooks/rules-of-hooks`（普通函数名带 `use` 前缀）、`react-hooks/set-state-in-effect`
> （ThemeProvider/ThemeToggle 在 effect 里 setState）、`react-hooks/static-components`（icon-map 误报）、
> `@next/next/no-img-element`（SVG 静态资源）。**均已修复**（ThemeProvider 改为 `useSyncExternalStore`；
> 剩余两处 icon-map / `<img>` 为规则误报，已就地写明理由豁免）。

```bash
$ npm run test -w @kedaya/web
 ✓ src/presentation/theme/tokens.test.ts (5 tests)
 ✓ src/domain/models/forum.test.ts (27 tests)
 ✓ src/application/groupbuy/groupbuy.test.ts (10 tests)
 ✓ src/domain/models/modules.test.ts (12 tests)
 ✓ src/data/api/client.test.ts (13 tests)
 ✓ src/data/mock/faq.repository.test.ts (15 tests)
 ✓ src/data/mock/groupbuy.repository.test.ts (13 tests)
 ✓ src/data/repositories/forum-faq.http.test.ts (16 tests)
 ✓ src/application/faq/faq.test.ts (21 tests)
 ✓ src/application/forum/forum.test.ts (27 tests)
 ✓ src/data/mock/forum.repository.test.ts (24 tests)
 ✓ src/domain/models/groupbuy.test.ts (19 tests)
 ✓ src/domain/models/audit.test.ts (14 tests)
 ✓ src/application/faq/markdownSubset.test.ts (6 tests)
 ✓ src/domain/models/faq.test.ts (21 tests)
 Test Files  15 passed (15)
      Tests  243 passed (243)
```
> 基线 81 个 → 现在 **243** 个；其中 forum/faq 新增 **162** 个（远超任务要求的 8 个）。
> 全部为 node 环境纯逻辑测试，无需 jsdom（沿用仓库既有约定）。

```bash
$ npm run build -w @kedaya/web
▲ Next.js 16.4.2 (Turbopack)
✓ Compiled successfully in 1552ms
✓ Generating static pages using 11 workers (29/29) in 218ms
Route (app)
┌ ○ /            ├ ○ /faq            ├ ○ /forum        ├ ƒ /forum/[id]
├ ○ /forum/new   ├ ○ /faq/tickets    ├ ○ /groupbuy     ├ ƒ /groupbuy/[id]
├ ○ /admin       ├ ○ /_not-found     └   /m/[moduleId] (20 个 SSG 路径)
```

生产服务器冒烟测试（`next start -p 3311`，真实 curl）：

```
/forum             HTTP 200      /forum/new         HTTP 200
/forum/fp-1006     HTTP 200      /faq               HTTP 200
/faq/tickets       HTTP 200      /m/facility        HTTP 200
```

forum/faq 浏览器实测（真实 Chromium，`http://127.0.0.1:3311`，数据全部来自 mock，**无后端**）：

- `/forum`：4 个版块 chip（校园生活/学习交流/树洞/站务与公告）+ 置顶公告排第一；
  `forum-total` = `共 6 条 · 当前展示 4 条` → 点「加载更多（游标分页）」→ `共 6 条 · 当前展示 6 条`，
  出现 `fp-1006`（HIDDEN）与 `fp-1004`（LOCKED）；隐藏卡出现明确治理文案
  「该主题因举报被隐藏，正在人工复核：内容暂时不可见，也不会静默消失。作者可在「我的」里查看处理进度并申诉。」
  → **被隐藏的主题没有被静默吞掉**。
- `/forum/fp-1006`：标题 + `已隐藏` 徽章 + `已被举报隐藏` + 正文占位「正文已被隐藏…」+
  回复框替换为「当前不能回复 / 该主题因举报被隐藏…」（**不是 404**）。
- `/forum/fp-1001`：勾选匿名 → 填内容 → 发布回复 → 回复数 `3 → 4`，新回复显示为
  `匿名同学 · 刚刚 · 已发布 0 赞`，出现「回复已发布」提示。
- `/forum/fp-1001` 举报弹层：`role=dialog` + `aria-modal=true`、5 个原因单选、阈值文案
  「同一内容被 3 个不同用户举报后会先自动隐藏…」、匿名默认勾选；提交自己发的主题 → 正确报
  「不能举报自己发布的内容」（治理规则生效）。换 `/forum/fp-1003` 提交 → 回执
  「举报已提交（主题 · 垃圾广告），当前状态：待人工复核。举报记录 id：frep-9001（匿名举报…）」。
- `/forum/new`：版块下拉来自注册表/mock（`校园生活 / 学习交流（校内可见） / 树洞 / 站务与公告`）；
  勾选匿名后出现**完整**说明：「匿名后你的实名身份不会与帖子关联：帖子只记录一个匿名身份，
  普通用户看不到你的姓名、学号与院系。注意：为处理违规内容，同一匿名身份在同一版块内可被版主追溯，
  该信息不对普通用户公开。」→ 提交后回执「发布成功 … 作者显示为 匿名同学」，跳转链接 `/forum/fp-9001`。
- `/faq`：分类导航 `全部·8 条 / 账号与登录·2 条 / 功能使用·2 条 / 隐私与数据·3 条 / 内容治理·1 条 / 其他·0 条`；
  手风琴展开后答案里的 `**学校统一身份认证页面**` 渲染为 `<strong>`、`` `Cookie` `` 渲染为 `<code>`，
  页面文本中**不再有字面 `**` 或反引号**。
- `/faq` **乐观更新**：点「有用（42）」→ 立即 `有用（43）` 且 `aria-pressed=true`；
  服务端对齐（refetch）后仍保持 43/已投票态（本地票账本 `myVotesRef` 注入 queryFn）。
- `/faq` **失败回滚**：点「演练故障」→ 再点「没用」→ 出现
  `「有用」没有记录成功，已恢复到投票前的状态：常见问题服务暂时不可用（mock 故障演练）`，
  计数保持 `没用（3）`（未虚增）。
- `/faq/tickets`：联系方式填 `13800000000` → 提交按钮**禁用**（明文手机号被拒）；
  换成邮箱提交 → 「工单已提交 工单 id ft-9001，状态：待回复，联系方式记录为 `y***@shanghaitech.edu.cn`」
  （列表里同样脱敏）。
- 暗色：本次实测时本机系统偏好为深色，`--kdy-color-brand` 计算值 = `#ffd666`
  （= 令牌 `colorDark.brand`），页面无手写色值。

构建产物核对：

- 生成的 CSS 中 `.bg-brand{background-color:var(--color-brand)}`、
  `.rounded-lg{border-radius:var(--radius-lg)}`，且 `--kdy-color-brand:#ffc53d` 存在 → 令牌链路成立。
- `grep -rnE '#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(' src/` 仅命中 README 里"禁止手写色值"这句话本身 → **源码零硬编码色值**。
- 这条纪律现在有**机器守卫**：`presentation/theme/tokens.test.ts` 会扫描 forum/faq 的 20+ 个源文件，
  出现任何 hex/rgb/hsl/oklch 字面量即测试失败；同时断言暗色令牌确实可达。
- 首页 HTML 中 `data-module-id` 恰好 **20 个**（契约 v1.2 §11.10-C 新增 `facility`）。

浏览器实测（真实 Chromium，`http://127.0.0.1:3210`）：

- `/groupbuy`：`cardCount=4`、`totalText="共 6 条 · 当前展示 4 条"`（游标分页生效）；
  首卡文案 `¥16.80 / ¥21.00 / 省 ¥4.20（20%） / 8/12 人 / 还有 2 小时`；
  `--color-brand` 计算值为 `#ffc53d`（= `--kdy-color-brand`，令牌链路打通）。
- 点「演练故障」→ `role="alert"` 出现「拼单服务暂时不可用（mock 故障演练）」+ 重试按钮；
  点「恢复正常」→ alert 消失、卡片恢复（三态 + 恢复可验证）。
- `/groupbuy/gb-1001`：点「立即参团」→ `8/12 → 9/12 人`、参与者 `6 → 7`、
  已收款 `¥134.40 → ¥151.20`、进度 `aria-valuenow 66 → 75`、出现「参团成功」提示。
- `/admin`：19 个 `role="switch"`、开关表 19 行、审计表 6 行；
  审计首行含全部 §9 字段（`心理/调解专员 · u_8f****9d · 10.20.3.14 · 读取 · 心理支持 · appointment#appt-3301 · 最高敏感 · 允许 · trc-9f31c2a4`）；
  关闭「拼单」模块后 → 已启用 `16 → 15`、审计行 `6 → 7`，新行内容为
  `管理员 u_ad****01 · 模块开关 · 拼单 · module-switch#groupbuy · 低敏感 · 允许 · 停用模块 · trc-mock-7`。
- `/m/wellbeing`：出现「进入前需要二次同意（契约 §9）」与 `/api/v1/wellbeing/items` 路由前缀。
- **主题三态实测**（点分段控件后读 `getComputedStyle`，验证暗色真的来自令牌而非 `color-scheme`）：

  | 点击 | `<html data-theme>` | `<html class>` | `color-scheme` | body 背景 | 卡片背景 | `--kdy-color-brand` |
  | --- | --- | --- | --- | --- | --- | --- |
  | 深色 | `dark` | `dark` | `dark` | `rgb(11,18,32)` = `#0B1220` | `rgb(21,28,40)` = `#151C28` | `#ffd666` |
  | 浅色 | `light` | `""` | `light` | `rgb(247,248,250)` = `#F7F8FA` | `rgb(255,255,255)` | `#ffc53d` |
  | 跟随系统 | `null`（已移除） | `dark` | `dark` | `rgb(11,18,32)`（本机系统偏好为深色） | — | `#ffd666` |

  → 三条规则都验证到位：显式深/浅色写 `data-theme`，`system` 移除 `data-theme` 交给
  `@media (prefers-color-scheme: dark) :root:not([data-theme=light])`；刷新后 `localStorage` 持久化生效。

构建产物核对：

- 生成的 CSS 中 `.bg-brand{background-color:var(--color-brand)}`、
  `.rounded-lg{border-radius:var(--radius-lg)}`，且 `--kdy-color-brand:#ffc53d` 存在 → 令牌链路成立。
- `grep -rnE '#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(' src/` 仅命中 README 里"禁止手写色值"这句话本身 → **源码零硬编码色值**。
- 首页 HTML 中 `data-module-id` 恰好 **19 个**。

---

## 6. 与冻结契约的偏差（需 Lead 裁定）

1. **`@kedaya/contracts` 未导出 `ApiRequest`**
   契约 §6.1 文档定义了 `ApiRequest<TBody>`，但 `packages/contracts/src/envelope.ts` 实际未导出。
   为不改动 Lead 独占的 `packages/`，我在 `data/api/client.ts` 内按文档原样复刻了一份（形状逐字一致，附注释）。
   **建议**：由 Lead 在 contracts 中补上导出，Web 侧删掉本地副本。

2. **`@import '@kedaya/design-tokens/dist/tokens.css'` 无法编译**
   该包的 `exports` 白名单只导出 `"./css" -> "./dist/tokens.css"`，没有 `./dist/*`，
   Tailwind 4 的解析器强制 exports（报错原文：`"./dist/tokens.css" is not exported under the condition "style"`）。
   因此改为 **`@import '@kedaya/design-tokens/css'`**（指向同一份产物）。任务书里的字面路径不可用。

3. **管理域路由不在契约 §6.1 的前缀表内**
   契约只冻结了 18 个模块前缀（`/api/v1/<mod>/*`），没有管理域。
   我用了 `/api/v1/admin/audit-logs` 与 `/api/v1/admin/modules`。
   **建议**：由 Lead 在契约中补一节「管理域路由」，否则后端 E 工作流可能取别的名字。

4. **`packages/design-tokens/dist/tokens.css` 存在单位错误（属 Lead 作用域，我未改动）**

   ```css
   --kdy-line-height-tight: 1.25px;     /* 应为无单位 1.25 */
   --kdy-line-height-normal: 1.5px;
   --kdy-font-weight-regular: 400px;    /* 应为无单位 400 */
   --kdy-font-weight-semibold: 600px;
   --kdy-z-index-dropdown: 1000px;      /* 应为无单位 1000 */
   --kdy-z-index-modal: 1300px;
   ```

   生成脚本对所有数值统一加了 `px`。**影响**：任何消费这些变量的端（Web/小程序/Flutter）
   都会得到非法值。Web 侧我**刻意没有**把 line-height / font-weight / z-index 映射进 `@theme`
   （避免把坏值带进布局），只用 `color / spacing / radius / fontSize / shadow / fontFamily`。
   **建议**：Lead 修 `scripts/generate.mjs`，对无单位量不追加 `px`，并重新生成三端产物。

5. **暗色令牌的"两套来源"需要 Lead 确认**：契约 §6.2 文档里的 `tokens.color` 只有浅色，
   但 `dist/tokens.css` 实际已新增 `colorDark` 块（我按它的 `data-theme` 约定实现）。
   契约文档与产物不一致 —— 建议 Lead 把 `colorDark` 写进契约 §6.2，避免其他端各写一套暗色。

6. **forum/faq 的"子集合"路由不在契约 §6.1 的 CRUD 形状内**（本次新增，需 Lead 裁定）
   契约 §6.1 只冻结了 `GET/POST /api/v1/<mod>/items`、`/items/:id`、`/items/:id/<action>`。
   forum/faq 有真实的**子资源**需求，我按"创建资源"而非"领域动作"表达，**没有自创任何 action 名**：

   | 用途 | 我的路由 | 为什么不算自创 action |
   | --- | --- | --- |
   | 版块列表 | `GET /api/v1/forum/boards` | 只读集合，非动作 |
   | 回复列表 / 发表回复 | `GET|POST /api/v1/forum/items/:id/replies` | 创建子资源（replies 集合），非 `<action>` |
   | 举报 | `POST /api/v1/forum/items/:id/report` | **已冻结**（契约 §11.2 `forum.report`） |
   | FAQ 条目列表 | `GET /api/v1/faq/items` | 契约标准形状 |
   | 「有用 / 无用」投票 | `POST /api/v1/faq/items/:slug/votes` | 契约 §11.2 **没有** faq 动作，写成 `POST /items/:id/helpful` 就是自创 action；改为创建 `votes` 资源 |
   | 我的工单 | `GET|POST /api/v1/faq/tickets` | 工单是独立实体（域模型 §2.8 的 `FaqTicket`），不叫 items |

   **建议**：Lead 在契约里补一节「子资源与集合路由」，否则后端 F1（`services/api/`）可能取别的名字。
   注：后端 F1 任务书里写的是 `POST /faq/items/:id/helpful` —— 与本端的 `votes` 子集合**不一致**，
   集成时必须统一（我倾向保留 `votes`，因为 `helpful` 会被读成领域动作）。

7. **契约 v1.2 §11.10-E（游标不透明）已在 Web 侧落实**：`cursor` 只被原样透传，
   解析/构造只存在于 mock 仓储（服务端替身）。有 4 个测试守着这条（application 透传、
   HTTP 原样、mock 对未知复合游标安全退化）。

8. **第 20 个模块 `facility` 的 Web 侧适配**（契约 v1.2 §11.10-C）：本次一并补了
   `ModuleIconKey.dumbbell` + `MODULE_ICONS.dumbbell` + `DECORATION.facility`，
   并把 `modules.test.ts` 的断言从 19/14 更新为 20/15。这是**契约变更的集成适配**，
   不是 forum/faq 功能本身（Lead 已确认由我收口）。

---

## 7. 关键实现约定（供后续模块复用）

- **新增一个模块的垂直切片**：`domain/models/<mod>.ts`（模型 + 纯函数）→
  `domain/ports/<mod>.ts`（端口）→ `data/schemas/<mod>.ts`（zod + 双向类型断言）→
  `data/mock/<mod>.repository.ts` → `data/repositories/<mod>.http.ts` → `application/<mod>/*.ts`（VM 映射）→
  `presentation/components/<mod>/*` → `app/(portal)/<mod>/page.tsx`。
- **别忘登记交付状态**：Web 端上线后，在 `domain/models/delivery.ts` 里把该模块改成
  `stage: 'web'` + `webHref`（Web 端页面的真实路由）；只在小程序上线的写 `stage: 'miniapp'`。
  宫格角标、模块说明页、`moduleHref()` 全部由这张表派生 —— 不要在组件里另写判断。
- **UI 不做计算**：金额转元、相对时间、状态文案全部在 application 层完成；
  组件只渲染 VM 字段（这样纯逻辑可用 node 环境单测，不需要 jsdom）。
- **错误只有一个通道**：端口返回 `Result<T, ApiError>`；
  presentation 用 `unwrapOrThrow()`（`presentation/query/unwrap.ts`）转成异常喂给 TanStack Query，
  再用 `asApiError()` / `errorMessage()` 统一渲染 —— 组件里不出现 `if (!r.ok) throw`。
- **样式只用令牌工具类**：`bg-brand` `text-ink` `text-muted` `border-border` `bg-surface-alt`
  `rounded-lg` `rounded-pill` `shadow-md` `text-xxl`；间距基数 `--spacing = --kdy-space-1`（4px），
  所以 `p-4` = 16px、`gap-6` = 24px 也全部由令牌派生。
- **三态是"可测的纯函数"**：用 `application/viewState.ts` 的 `deriveViewState()` 把
  `isPending / isError / isEmpty` 映射成 `loading | error | empty | ready`，
  于是"三态齐全"不需要 jsdom 也能被真实单测覆盖；组件只做 `state === 'loading' ? …` 的分支渲染。
- **乐观更新必须三件套**：`onMutate` 写本地新态 + 存快照、`onError` 回滚快照并**明确告诉用户
  "票没生效"**、`onSettled` 与服务端对齐。派生文案（如"有用 43（93% 认为有用）"）由
  application 的 `applyVoteToArticleVM()` 重算，组件不自己算数字。
- **匿名语义只在 data 层落地**：application/presentation 传的是**实名**身份 + `anonymous` 布尔；
  匿名 id 由服务端（mock 的 `deriveAnonymousIdentityId` 是替身）派生，
  客户端自己拼匿名 id 等于自己发明隐私边界。
- **治理状态必须显式**：`domain/models/forum.ts` 的 `postVisibility()` 是唯一真相，
  HIDDEN / LOCKED 的 `listable: true` 保证它们**留在列表里**并带 `notice`；
  只有 DELETED / DRAFT 才不出现。

---

## 8. wildlife 切片（野生动物）

> 规格：`docs/features/wildlife-map.md` · 契约：`00-FROZEN-CONTRACT.md` §4.1 / §6.1 / §9 / §11.2 / §11.5

### 8.1 底图方案：**方案 B（静态校园平面图 + SVG 叠加层）**

**为什么不用高德/腾讯瓦片**（规格 §1.2，也是代码注释里写明的理由）：

1. 校园尺度（约 1 km²）下街道图会渲染出与校园无关的道路与建筑轮廓，**信息密度反而更低**；
2. 动物活动点大多在草坪、湖边、宿舍楼下、小径旁 —— 这些在街道图上**根本不存在**，
   用街道图当背景，用户看到的是"一个点落在某条不存在的路上"；
3. 静态底图用**图像像素空间**，WGS84 经仿射标定映射到像素，**完全不经过 GCJ-02** ——
   把"坐标偏移几百米、且看起来像数据错了"这类极难排查的 bug 的作用面压到零（规格 §3.2 第 4 条）；
4. 不依赖第三方地图 key（无配额 / 无 ToS 约束）。

**占位底图（诚实标注）**：`public/wildlife/basemap.svg` 是**自绘示意图**（1200×800，
校园轮廓 + 主要建筑 + 湖/绿地 + 步道 + 校门 + 地标标注），**不是测绘成果**。
校园官方平面图**尚未获得授权**（规格 §1.3 / 未决问题 U1，状态：**未知**），
因此代码与 UI 都注明"占位底图，待学校授权后替换"，并且：

- `license: 'original'` → `isPlaceholder: true`；**只有 `school-authorized` 才算非占位** ——
  把"学校授权"这个法务事项变成**可被代码检查**的前置条件（`resolveCampusBasemap()` + 单测）；
- 拿到书面授权后只需替换 SVG 并更新控制点，消费方代码零改动（底图是可配置资源，规格 §1.4）。

**仿射标定**（`src/domain/models/wildlife/basemap.ts`）：

```
WGS84（唯一真相）──toLocalMeters()──▶ 局部 ENU 米制平面 ──affine──▶ 底图像素 (px, py)
```

| 项 | 实测值 |
| --- | --- |
| 控制点数 | **8**（≥ 6），分散在四角与中心 |
| 标定残差 RMSE | **1.70 px**（阈值 < 5，`basemapCalibrationProblems()` 可执行断言） |
| 像素 → WGS84 → 像素 往返误差 | **< 1e-6 px**（硬要求 < 1 px，实测约 1e-9 px） |
| 30 m 的上报 → 像素距离 | **29.8 px**（1 m ≈ 1 px，验收 T7） |
| `lat`/`lng` 颠倒 | 被 `assertInCampus()` 拒绝（`COORDINATE_OUT_OF_CAMPUS`） |

### 8.2 文件清单（全部在 `apps/web/` 内）

| 层 | 文件 |
| --- | --- |
| 静态资源 | `public/wildlife/basemap.svg`（占位底图） |
| domain（模型） | `src/domain/models/wildlife/{basemap,species,sightings,tracks,ethics,geometry,index}.ts` |
| domain（端口） | `src/domain/ports/wildlife.ts` |
| data（传输层） | `src/data/schemas/wildlife.ts` |
| data（mock） | `src/data/mock/fixtures/wildlife.ts`、`src/data/mock/wildlife.repository.ts` |
| data（HTTP） | `src/data/repositories/wildlife.http.ts` |
| data（客户端） | `src/data/api/client.ts` 新增 `upload()`（multipart，见 §8.7 偏差 2） |
| application | `src/application/wildlife/{wildlifeMap,listSightings,listZones,listTracks,reportSighting,moderateSightings,loadWildlifeCatalog}.ts` |
| presentation | `src/presentation/components/wildlife/*`（地图/列表/详情/区域/轨迹/上报表单/伦理/隐私/筛选）、`src/presentation/components/admin/WildlifeModerationQueue.tsx` |
| 页面 | `/wildlife`、`/wildlife/report`、`/wildlife/zones`、`/wildlife/tracks`、`/wildlife/sightings/[id]`、`/admin/wildlife` |

### 8.3 三态齐全（loading / error / empty）+ 空态引导

- loading：骨架屏（`data-testid="wildlife-map-loading"` 等），首屏不阻塞；
- error：`KdyAlert role="alert"` + 重试按钮，且**保留上一次成功的数据**（契约 §8 失败静默降级而非白屏）；
- empty：带引导文案 + "上报一条观测"入口。实测：筛选「珠颈斑鸠」（无观测记录的物种）→
  同时出现三处空态（热点 / 轨迹 / 观测），文案分别为
  "还没有达到公开条件的热点…"、"还没有可推断的轨迹。轨迹要求同一物种在 7 天窗口内至少有 5 个已发布观测。"、
  "还没有审核通过的观测…"。

**无后端可跑**：默认 `NEXT_PUBLIC_KEDAYA_USE_MOCK=true`，7 个页面全部出数据（见 §8.8 实测）。

### 8.4 伦理与隐私（硬要求，逐条落地）

| 要求 | 落地位置 |
| --- | --- |
| 投喂规范 `allowed/discouraged/forbidden` | `FeedingPolicyBadge` + 区域卡片 + 上报表单红色警告条；区域政策与物种默认政策取**较严者** |
| 伦理守则（E1–E8 精简版，≤5 条、每条 ≤20 字） | `EthicsNotice`（上报表单提交按钮上方，默认展开，勾选才可提交） |
| **不是同意门** | 勾选只拒绝**本次提交**；不引入 `CONSENT_REQUIRED`（契约 §9 的同意门只适用于 wellbeing/dorm-harmony/ai-portrait），UI 明确写出这一区别 |
| 不打扰野生动物 / 不带走蛋与幼崽 / 夜间不用闪光灯 | `ETHICS_RULES` + `NO_TAKE_NOTICE` |
| 位置已模糊化说明（**不声称"完全匿名"**） | `PrivacyNoticePanel`（地图页必现）："只能定位到片区（约百米量级）…我们不能声称'完全匿名'" |
| 敏感区**不公开任何坐标** | 敏感区上报 → `geo: null` + 只给 `zoneId`；地图上**不落点**（`sightingToMarker` 返回 `null`） |
| 热点**不是实时位置**（延迟 ≥24h） | 热点卡片固定徽章"历史聚合 · 延迟 ≥24h" + `SPOT_REALTIME_NOTICE`；mock 的 `computedAt` 比当前时间早 26h |
| k-匿名（<3 位不同上报人不公开） | mock 的 `/spots` **过滤掉**不足 3 人的热点（`wsp-04` 不出现） |
| 图片 EXIF 强制剥离 | 上传链路说明 + 客户端预校验（服务端负责真正剥离） |
| 轨迹必须标注"推断，非实测路径" | 地图上虚线 + 每张轨迹卡片的 `KdyBadge`（短标签）+ 服务端 `disclaimer` + `summaryLabel`（"基于 N 次上报推断的活动范围"） |
| 告示文案是草案 | 区域告示位带 `NOTICE_DRAFT_FLAG`（未决问题 U7） |

### 8.5 测试（新增 **132** 个用例，web 243 → **375**）

| 文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `domain/models/wildlife/basemap.test.ts` | 18 | **仿射标定与坐标映射**：RMSE < 5、控制点 ≥ 6、像素↔经纬度往返 < 1 px、30 m → 25–35 px、米↔像素互逆、lat/lng 颠倒被拒、占位底图派生、SVG 尺寸与配置一致 |
| `domain/models/wildlife/wildlife.test.ts` | 41 | 投喂政策取严、繁殖期 ×4（T11）、上海本地月份、置信度分档与**不预选**（T44）、伦理守则 ≤5 条且 ≤20 字、上报校验（伦理/时间/校园/照片/备注）、坐标扣留说明、匿名展示、审核规则（双人复核/队首优先）、k-匿名、轨迹一致性、叠加层几何（**扣留坐标不落点**） |
| `application/wildlife/wildlife.test.ts` | 28 | 地图用例（底图占位/叠加层/图层开关/隐私提示/繁殖期）、观测 VM（禁投喂警告/匿名/分类免责声明/扣留说明）、区域与轨迹 VM（**每条轨迹必带推断标签与免责声明**）、上报用例（校验→回执→敏感区）、分类降级、审核用例（FORBIDDEN→双人通过） |
| `data/mock/wildlife.repository.test.ts` | 24 | 游标分页不重不漏、只给 PUBLISHED、k-匿名过滤、敏感区坐标扣留、网格吸附、伦理/坐标/时间/物种/媒体校验、上传幂等（T37）、双人复核、拒绝必填理由、`classify()` 空数组（T43）、故障演练与 reset |
| `data/repositories/wildlife.http.test.ts` | 11 | 路由由模块注册表派生、`moderate` 冻结动作名、`Idempotency-Key`（同内容复用同键）、multipart 上传、游标原样透传、脏数据 → INTERNAL、错误码透传 |
| `presentation/theme/wildlife-tokens.test.ts` | 10 | wildlife 源码**零手写色值**、叠加层只用 `currentColor` + 令牌工具类、`basemap.svg` 的每个 hex 都是 tokens.css 里真实存在的令牌值、暗色令牌可达 |

### 8.6 未实现 / 已知限制（如实列出）

1. **地图不支持缩放/平移手势**：规格 §1.2 第 5 条要求 1×–4× 缩放，当前只做了固定比例展示
   （点击点选可用，但没有双指缩放/拖动）。这是**未完成的规格项**，不是设计选择。
2. **地图点选只有指针交互**：键盘用户无法在地图上选点（已知无障碍缺口，页面上已如实说明）。
3. **占位底图是浅色静态图**：暗色模式下不做反色（避免伪造地图配色），靠外层令牌背景与叠加层保证可读性。
   `basemap.svg` 是静态资源，无法读取 CSS 变量，因此色值**逐字取自** `tokens.css`，
   并由测试断言"每个 hex 都是令牌里存在的值"。
4. **审核员身份是演示常量**（`DEMO_MODERATOR` / `DEMO_SECOND_MODERATOR` 占位）：
   未接契约 §5 第一级身份层；真正的权限边界必须在服务端（前端按钮禁用只是体验）。
5. **自动分类默认关闭**（`classifierMode: 'manual'`）：`POST /classify` 返回空数组，
   UI 走"静默降级为手动"路径；`'server'` 模式在 mock 里可切换，用于演示建议与"低置信度不预选"。
6. **mock 的模糊化弱于真实后端**：mock 只做网格吸附（规格 §9.3 ②），
   **不含**确定性加噪的 HMAC 部分（规格 §9.3 ③，需要服务端密钥）。**不能拿 mock 做隐私强度评估。**
7. **精确坐标（受限表）在 Web 端没有任何读取入口**：审核队列只**说明**"审核端可见精确坐标"，
   没有真的去取（规格 §2.7 要求每次读取写审计，那属于服务端能力）。
8. **`rejectReason` 只在 `admin` 视角渲染**：公开详情页不传 `admin`，因此不会展示该字段。

### 8.7 与冻结契约的偏差（需 Lead 裁定）

1. **管理端审核队列用 `GET /wildlife/items?status=PENDING`**
   规格 §10.1 把 `/items` 定义为"**仅 `PUBLISHED`**"的公开列表，而审核需要待审核记录。
   我**没有自创端点**，而是给公开列表加了 `status` 过滤参数（mock 与 HTTP 仓储都支持）。
   **建议**：服务端为审核员放开该过滤，或另给一个管理端集合路由（如 `/wildlife/moderation/queue`）。
2. **`ApiClient` 新增 `upload()`（multipart）**
   契约 §7 硬规则 3 要求"所有网络访问必须经过 `data/api/`"，而 `ApiClient` 原先只有 JSON 方法。
   我在 `client.ts` 内新增 `upload(path, form, options)`（**不手写 `Content-Type`**，
   由运行时生成 boundary），wildlife 的 `POST /media` 走它。
   附带改动：`data/repositories/forum-faq.http.test.ts` 的假客户端补了一个 `upload` 桩
   （否则 `ApiClient` 类型不完整，typecheck 失败）。
   **建议**：Lead 评估是否把 `upload` 提升为契约级客户端能力。
3. **`moderate` 的 body 用 `decision`**：与规格 §10.2 一致（`{decision, reason?}`），
   action 名 `moderate` 已登记在契约 §11.2（`wildlife.moderate`），未自创。
4. **实测发现：失败后的重试在**隐藏标签页**里会永久暂停**（与 wildlife 无关，属全局行为）
   TanStack Query 的 retryer 判定 `canContinue() = focusManager.isFocused() && …`；
   标签页隐藏时 `isFocused()` 为 false，于是 `fetchStatus: 'paused'`，UI **永远停在骨架屏**，
   既不出错误态也不出重试按钮。**实测 `/groupbuy`（既有页面）在 HTTP 模式下完全一样**，
   因此这不是 wildlife 切片引入的问题，而是 Web 端全局的健壮性缺口。
   **建议**：Lead 统一评估（例如失败时给出显式错误 + 手动重试，而不是无限等待网络/焦点恢复）。
   wildlife 侧最终**未**改动 `networkMode`，保持与其余页面一致。
5. **`public/wildlife/basemap.svg` 使用字面色值**（静态资源无法读 CSS 变量）：
   已用测试断言"每个 hex 都在 `tokens.css` 里"，从而把"颜色也来自令牌"变成机器可检查的事实。

### 8.8 自检证据（真实执行输出摘要）

```bash
$ npm run typecheck -w @kedaya/web
> tsc --noEmit -p tsconfig.json
（无输出 = 0 错误）

$ npm run lint -w @kedaya/web
> eslint .
（无输出 = 0 problems）

$ npm run test -w @kedaya/web
 Test Files  21 passed (21)
      Tests  375 passed (375)     # 基线 243 + wildlife 新增 132

$ npm run build -w @kedaya/web
▲ Next.js 16.4.2 (Turbopack)
✓ Compiled successfully in 635ms
✓ Generating static pages using 11 workers (34/34)
├ ○ /wildlife        ├ ○ /wildlife/report   ├ ○ /wildlife/zones
├ ○ /wildlife/tracks ├ ƒ /wildlife/sightings/[id] ├ ○ /admin/wildlife
```

生产服务器冒烟（`next start -p 3328`，真实 curl）：

```
/wildlife HTTP 200   /wildlife/report HTTP 200   /wildlife/zones HTTP 200
/wildlife/tracks HTTP 200   /wildlife/sightings/ws-1001 HTTP 200
/wildlife/sightings/nope HTTP 200   /admin/wildlife HTTP 200
```

浏览器实测（真实 Chromium，**无后端**，数据全部来自 mock）：

- `/wildlife`：底图 `<img src="/wildlife/basemap.svg">` + SVG 叠加层；
  图例 `活动区域 5 · 聚合热点 3 · 推断轨迹 3 · 观测点 10`；底图署名与
  `8 个控制点 · 标定残差 RMSE 1.70 px（阈值 < 5）` 可见；
  3 个"推断轨迹，非实测路径"徽章；`另有 2 条观测因位于敏感区或上报人数不足，没有出现在地图上…`；
  隐私面板出现"片区级，不是完全匿名"。
- 图层开关：勾选「观测点」→ 地图上出现 **10** 个观测点（坐标被扣留的 2 条不落点）。
- 物种筛选：选「黑天鹅」→ 地图只剩 1 个区域 / 1 个热点（叠加层与列表同步收窄）。
- **错误态**：点「演练故障」→ `role="alert"` 出现
  「动物地图加载失败 / 动物地图服务暂时不可用（mock 故障演练） /
  契约 §8 要求失败静默降级而非白屏：下方保留上一次成功的地图数据。」+「重试」按钮，
  地图与 12 张卡片**保留**；点「恢复正常」→ 提示消失、数据恢复。
- **空态**：选「珠颈斑鸠」（无观测）→ 三处空态 + "上报一条观测"入口。
- `/wildlife/report`：地图点选 → 「已选点：WGS84 31.177699, 121.592042（像素 699, 599）· 在校园范围内」；
  落在「人工湖（黑天鹅水域）」→ 出现禁投喂警告；伦理守则 **5** 条；勾选后提交按钮启用；
  `<input type="file">` 选 JPEG → 「已上传 1 张：wm-mock-1」+ 自动分类降级提示
  「当前没有启用自动分类（或识别服务不可用），请手动选择物种 —— 这不影响上报。」；
  提交 → 「上报已提交：已提交，进入审核队列…」。
- `/wildlife/sightings/ws-1009`（敏感区记录）：「该记录不公开坐标 / 该位置位于敏感区（宿舍/保育区）…」，
  上报人显示「匿名同学」，页面中**不出现** `reporterId`。
- `/wildlife/tracks`：顶部「推断轨迹，非实测路径」+ 3 张轨迹卡片各带服务端下发的免责声明
  「本轨迹由 31 次同学上报推断得出，并非实测运动路径。」；地图上 3 条**虚线**折线（共 11 个顶点）。
- `/admin/wildlife`：队列 `共 15 条 · 待审核 3 条 · 疑似受伤 1 条 · 保护物种 5 条`，
  疑似受伤（白鹭）排队首；对保护物种点「通过并发布」→
  「操作被拒绝：保护物种需要两名审核员复核…已记录你的第一票」；
  切到「第二名审核员」再通过 → 「操作已完成：记录 ws-1011 → 已发布」，待审核 3 → 2。
- 暗色：点「深色」→ `<html data-theme="dark">`，`--kdy-color-brand` = `#ffd666`（= 令牌 `colorDark.brand`）。

> ⚠️ **错误态验证的一个坑（已记录）**：TanStack Query 的 retryer 用
> `focusManager.isFocused()` 判定是否继续重试；在**隐藏标签页**里它永远为 false，
> 于是失败后的重试会 `paused` 在那里 —— 页面就一直停在骨架屏。
> 本次验证是把标签页"伪装为可见"（覆写 `document.visibilityState` 并派发 `visibilitychange`）
> 之后才拿到上面那条错误态输出的。`/groupbuy`（既有页面）在 HTTP 模式下表现完全相同，
> 详见 §8.7 偏差 4。

---

## 9. 找搭子切片（buddy）

> 规格：`docs/features/buddy-matching.md` · 契约：`00-FROZEN-CONTRACT.md`
> §4.1 / §6.1 / §11.2（5 个冻结动作名）/ §11.10-D（`joinedCount` 含发起人）/ §11.10-E（不透明复合游标）/ §11.10-G（不做交友/约会板块）

### 9.1 交付内容（全部在 `apps/web/` 内）

| 层 | 文件 |
| --- | --- |
| domain（模型） | `src/domain/models/buddy.ts`（板块派生 / 状态机 / **封闭标签表** / 地点白名单 / 校验 / **可用时段含跨零点** / 隐私矩阵） |
| domain（端口） | `src/domain/ports/buddy.ts` |
| data（传输层） | `src/data/schemas/buddy.ts`（zod + schema↔domain 双向断言 + **禁止字段负向检查**） |
| data（mock） | `src/data/mock/fixtures/buddy.ts`、`src/data/mock/buddy.repository.ts`（**服务端替身**：复合游标 / 硬过滤 F1–F7 / `explainMatch` 理由 / MMR / 幂等键） |
| data（HTTP） | `src/data/repositories/buddy.http.ts` |
| application | `src/application/buddy/{session,ids,listBuddyPosts,getBuddyPostDetail,publishBuddyPost,buddyProfile,recommendations}.ts` |
| presentation | `src/presentation/components/buddy/*`（列表 / 卡片 / 板块导航 / 详情 / 发布表单 / **封闭标签选择器** / **可用时段编辑器** / 资料编辑器 / 推荐 / 隐私说明） |
| 页面 | `/buddy`、`/buddy/[id]`、`/buddy/new`、`/buddy/profile`、`/buddy/recommendations` |

### 9.2 硬要求逐条落地

| 要求 | 落地 |
| --- | --- |
| **三板块分栏** | `BUDDY_SECTIONS = ['academic','daily','sport']`，板块由 `sectionOf(activity)` **派生**（不新增字段）；有机器守卫断言源码里不出现第四个板块 |
| **封闭标签（不许自由文本）** | `BUDDY_TAG_TABLE` 是唯一真相（30 条，含 1 条下架样例）；`BuddyTagPicker` **没有**任何文本输入框；未知标签 → `VALIDATION_FAILED` / `UNKNOWN_TAG:<key>` |
| **游标分页** | mock 用 base64url 复合游标 `(sort, sortKey, id)`；客户端只原样回传；切 `sort` / 换筛选 → `VALIDATION_FAILED` / `INVALID_CURSOR` |
| **`explainMatch` 理由** | 服务端（mock）用 `@kedaya/shared` 的 `explainMatch` 产出结构化 `reasons`；推荐页逐条展示徽章 + 拼接文案；无命中回落 `有潜在匹配` |
| **可用时段（含跨零点）** | 编辑器 `dow + start + end`；`endMin < startMin` 表示跨到**次日**（与共享纯函数同一语义）；`endMin === startMin` 被拒 |
| **三态齐全** | `deriveViewState` 纯函数 + 骨架 / `role="alert"` + 重试 / 空态引导（含「清空筛选」「去发布」） |
| **隐私说明（硬要求）** | `BUDDY_PRIVACY_ITEMS` 八行可见性矩阵：公开项 / **匹配资料对任何人不可见（含活动发起人）** / **联系方式仅申请通过后经站内信交换** / **资料可撤回（关闭开关或硬删）** |
| **零手写色值** | `buddy-tokens.test.ts` 扫描全部 buddy 源文件；暗色实测 `--kdy-color-brand = #ffd666` |
| **不做交友/约会板块** | `buddy-tokens.test.ts` 断言源码里不出现该板块标识；三个板块枚举逐字断言 |

### 9.3 测试（新增 **202** 个用例，web 375 → **577**）

| 文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `domain/models/buddy.test.ts` | 55 | **`sectionOf` 全映射**、**帖子状态机 5×5 全矩阵**、申请状态机（含 `WITHDRAWN→PENDING`）、名额/进度/可申请性、性别准入（未填写不拦）、技能门槛、**封闭标签**（未知标签 / 下架标签 / 上限 / 别名仅搜索）、地点白名单、发布草稿校验、联系方式四类模式、**可用时段含跨零点**（长度 / 格式化 / 校验 / 共享 `overlapsAvailability` 的跨零点用例）、资料校验、隐私矩阵 |
| `application/buddy/buddy.test.ts` | 41 | 本地化文案（绝对时间不依赖 ICU 格式）、卡片/列表/详情 VM、**`explainMatch` 五条理由与回落**、匹配模式诚实说明、发布（标签与联系方式拦截）、`datetime-local` 互转、**时段编辑器（追加/修改/删除/非法输入忽略/跨零点）**、资料读写与撤回、join/leave/decide/close 编排、会话与 fixture 对齐 |
| `data/mock/buddy.repository.test.ts` | 68 | **游标分页不重不漏（limit=1/4、两套排序、切 sort 失效、脏游标）**、板块/标签/时间/非 OPEN 过滤、join（不占名额 / 幂等 / 6 类拒绝）、leave（冷却期 / 复用同一行）、decide（非发起人 / 递增 / 满员转 FULL / 拒绝不递增）、close、**发起人视角（自己发布的活动）**、详情可见性、发布校验与幂等（T17）、**推荐理由来自 `explainMatch` + F3–F7 硬过滤 + rule 降级 + 删除资料移出推荐池（T30）**、**反馈板块隔离（T6）**、MMR、资料读写、故障演练与 reset |
| `data/repositories/buddy.http.test.ts` | 21 | 路由由模块注册表派生、**5 个冻结动作名**、`Idempotency-Key`、`creator` 不下发、**游标原样透传**、`userId` 不下发、zod 脏数据 → INTERNAL、错误码与 `details.reason` 透传、资料 PUT/DELETE、申请列表两种响应形状 |
| `presentation/theme/buddy-tokens.test.ts` | 17 | **零手写色值**、暗色令牌可达、**不做交友/约会板块**、**presentation 不得直接发请求**、**发布表单无自由文本标签输入**、隐私说明四处硬要求、推荐页展示模式说明 |

### 9.4 未实现 / 已知限制（如实列出）

1. **问卷（规格 §2.6 / §5.1 端点 16–19）未实现**：本端任务书只要求 5 个页面 + 反馈，问卷不在交付面内。
2. **只有 `hash` 与 `rule` 两档**：`vector` 需要 embedding 服务；规格 §3.4 明确**不做双塔**，因此 `towerScore` 恒不存在。
3. **身份层仍是占位**（`DEMO_BUDDY_SESSION`）：`gender` / `skillLevel` 只用于准入判定，性别**不进**匹配特征（规格 §1.2 N5）。
4. **mock 的模糊化弱于真实后端**：mock 只有内存状态，**整页刷新即回到种子数据**（发布的活动会消失），与 groupbuy/forum/wildlife 一致。
5. **校园地点白名单是占位**（规格未决问题 U10 未关闭）。
6. **`includeClosed` 是本端的显式扩展**（见 §9.5 偏差 1），HTTP 模式下需要后端支持该参数。
7. **隐藏标签页里错误态不会自己出现**（全局既有行为，见 §8.7 偏差 4）：`/buddy` 同样复现，实测需把标签页伪装为可见后才拿到错误态输出。
8. **`/buddy/[id]` 是动态路由**（`ƒ`），不做 SSG（活动 id 由数据决定）。

### 9.5 与冻结契约的偏差（需 Lead 裁定）

1. **`includeClosed` 查询参数**：规格 §5.3 没有这个参数，§5.9 的 `where` 是 `status: 'OPEN'`。
   但「已满 / 已关闭」必须能被用户看到（否则状态静默消失），所以列表加了该参数（默认 `false`，保持规格默认行为）。
   **建议**：后端支持它，或另给一个显式的状态筛选参数。
2. **推荐的 `reasons` 是结构化数组**（`{code,label,weight}[]`，即 `explainMatch` 输出），
   规格 §5.7 只写了字符串 `reason`。两者都下发（`reason` 保留为拼接文案）。
   服务端**只下发聚合短语**（如「共同兴趣 3 项」），**不下发**对方原始标签集 —— 这是 §6.1 的隐私边界。
3. **端口里的 `userId`**：`recommendations` / `listMyApplications` / `getProfile` 在 mock 里需要知道"我是谁"，
   但 HTTP 适配器**刻意不下发**该参数（身份来自 `Bearer` token，让客户端传 userId 等于把越权面交给客户端）。
4. **可用时段允许跨零点**：规格 §2.2 写的是 `endMin > startMin`；本端接受 `endMin < startMin` 并解释为跨到次日，
   与 `@kedaya/shared` 的 `overlapsAvailabilityMinutes` 语义一致（`endMin === startMin` 仍被拒）。
5. **`z.iso.datetime({ offset: true })`**：同时接受 `Z` 与 `+08:00`（规格 §5.4 的请求示例就是 `+08:00`）。
6. **MMR 在 mock 里实现**（λ 默认 0.7，用 `hashVector` 相似度），真实排序由服务端负责。
7. **演示数据里有一条「我发布的」活动（`bp-1013`）**：否则演示会话永远是申请人视角，
   发起人的申请管理 / 审批 / 关闭在浏览器里点不到。

### 9.6 自检证据（真实执行输出摘要）

```bash
$ ./scripts/with-npm-lock.sh npm install
（成功；仅 npm warn install-scripts 提示 14 个包有 install scripts 未审批）

$ npm run typecheck -w @kedaya/web
> tsc --noEmit -p tsconfig.json
（无输出 = 0 错误，exit 0）

$ npm run lint -w @kedaya/web
> eslint .
（无输出 = 0 problems）

$ npm run test -w @kedaya/web
 ✓ src/domain/models/buddy.test.ts (55 tests)
 ✓ src/application/buddy/buddy.test.ts (41 tests)
 ✓ src/data/mock/buddy.repository.test.ts (68 tests)
 ✓ src/data/repositories/buddy.http.test.ts (21 tests)
 ✓ src/presentation/theme/buddy-tokens.test.ts (17 tests)
 Test Files  26 passed (26)
      Tests  577 passed (577)     # 基线 375 + buddy 新增 202

$ npm run build -w @kedaya/web
▲ Next.js 16.4.2 (Turbopack)
✓ Compiled successfully in 444ms
✓ Generating static pages using 11 workers (38/38) in 356ms
├ ○ /buddy   ├ ƒ /buddy/[id]   ├ ○ /buddy/new   ├ ○ /buddy/profile   ├ ○ /buddy/recommendations
```

生产服务器冒烟（`next start -p 3399`，真实 curl）：`/buddy` `/buddy/new` `/buddy/profile`
`/buddy/recommendations` `/buddy/bp-1001` `/buddy/nope` **全部 HTTP 200**。

浏览器实测（真实 Chromium，`http://127.0.0.1:3399`，数据全部来自 mock，**无后端**）：

- `/buddy`：`共 10 条 · 当前展示 4 条` → 点「加载更多（游标分页）」两次 → `8 条` → `10 条`，
  10 张卡片 id 互不重复、按钮消失（`nextCursor=null`）；板块计数 `自习与学术（1）/ 日常与出行（1）/ 运动组队（2）`；
  我发布的活动带「我发布的」徽章 + `不能申请自己发布的活动`；已申请的活动显示 `已提交申请，等待发起人审批。`
- `/buddy` **错误态**：点「演练故障」→ `role="alert"`
  「搭子列表加载失败 / 找搭子服务暂时不可用（mock 故障演练）/ 契约 §8 要求失败静默降级而非白屏。下方展示的是上一次成功获取的数据。」+「重试」，
  **10 张卡片保留**；点「恢复正常」→ 提示消失。
- `/buddy` **空态**：搜索「这个词一定搜不到」→ 「这个筛选下还没有搭子 / 没有找到包含「这个词一定搜不到」的活动。换个关键词，或者由你来发第一条。」+「清空筛选」「去发布」。
- `/buddy/recommendations`：`匹配模式：标签 + 本地降级打分`，`共 1 条 · 其中 1 条带明确理由`；
  理由徽章逐条渲染 **`同一个院系` / `共同兴趣 2 项` / `时间能碰上` / `共同活动 1 项` / `常在同一个区域`**，
  拼接文案 `同一个院系、共同兴趣 2 项、时间能碰上、共同活动 1 项、常在同一个区域`，匹配分 `0.470`（47%）；
  诚实说明「当前是降级档…它不是语义相似」；`感兴趣 / 不感兴趣 / 先跳过` 三个反馈按钮。
- `/buddy/profile`：可用时段编辑器 **8 段**，摘要 `每周 8 段 · 共约 101 小时 · 1 段跨零点`，
  跨零点段显示 `跨零点 · 次日 01:00` 与 `共 2 小时`；两个封闭标签选择器；匹配开关默认状态可见；撤回说明可见。
- `/buddy/new`：板块 chips + 活动类型下拉（由板块反查）+ **无自由文本标签输入**；
  正文填 `想来的同学加我微信：duck2026` → 提交被拒：
  `正文里不能写微信号：申请通过后系统会经站内信交换联系方式。`；改成普通描述 → 提交成功
  `活动已发布，编号 bp-9014。`（附「查看详情」链接）。
- `/buddy/bp-1013`（我发布的活动）：`收到的申请 待审批 2`，两条申请各带「接受 / 拒绝」；
  点「接受」→ 回执 `已通过 早八人 的申请。`、人数 `1/4 → 2/4 人`、待审批 `2 → 1`、已通过 `0 → 1`；
  点「关闭招募」→ 回执 `活动已关闭（CLOSED），不再接受申请。`、状态 `已关闭`、
  出现「发起人已关闭这条招募，不再接受申请。」、关闭按钮消失（终态）。
- `/buddy/bp-1001`（他人活动）：填留言点「申请加入」→ 回执
  `申请已提交，等待发起人审批（join 只是申请，不占名额）。`、`我的申请状态：待审批 · 留言：我也常打，一起？`、
  **人数保持 `2/4 人`（`join` 确实不占名额）**、出现「撤回申请」。
- 暗色：点「深色」→ `<html data-theme="dark">`、`color-scheme: dark`、`--kdy-color-brand = #ffd666`（= 令牌 `colorDark.brand`）、
  卡片背景 `rgb(21, 28, 40)`（= 令牌暗色 surface）→ **buddy 页面零手写色值、暗色由令牌驱动**。

---

## 10. 营养管家切片（`canteen` · Web 侧只有菜品数据管理）

> ADR：[0006](../docs/adr/0006-nutrition-butler.md) · 端点全表：[03-api-contract.md](../docs/architecture/03-api-contract.md) §12
> 用户侧全流程（识别 / 记录 / 需求 / 推荐）在**小程序端**；Web 只负责它依赖的**菜品营养数据地基**。

### 10.1 交付内容（全部在 `apps/web/` 内）

| 层 | 文件 |
| --- | --- |
| domain（模型） | `src/domain/models/canteen.ts`（菜品模型 + `NUTRIENT_FIELDS` 六项展示元数据 + 摘要纯函数；营养计算一律复用 `@kedaya/shared` 的 `nutrition.ts`，**不在 Web 重写一份**） |
| domain（端口） | `src/domain/ports/canteen.ts`（`DishRepository`） |
| data（传输层） | `src/data/schemas/canteen.ts`（zod + schema↔domain 双向断言） |
| data（mock） | `src/data/mock/fixtures/canteen.ts`、`src/data/mock/canteen.repository.ts`（**服务端替身**：内存态 + 延迟 + 故障演练 + 游标分页） |
| data（HTTP） | `src/data/repositories/canteen.http.ts`（`GET /canteen/dishes`、`GET/POST/PATCH/DELETE /canteen/items[/:id]`，写操作带 `x-admin-key`） |
| presentation | `src/presentation/components/admin/DishManager.tsx`（检索 + 新建 + 编辑 + 下架；六项营养表单；`KdyCard` / `KdyAlert` / `KdyBadge` / `KdySkeleton`） |
| 页面 | `/admin/dishes`（`app/(admin)/admin/dishes/page.tsx`），入口在 `/admin` 的子页导航 |
| 装配 | `data/mock/index.ts`、`data/repositories/index.ts`（`dishes` 字段，mock/http 二选一）、`domain/ports/index.ts`、`presentation/query/keys.ts`（`canteen.root/list/detail`） |

数据默认来自 mock（12 道演示菜品，与小程序端**同口径**：每份六项营养），
所以 `/admin/dishes` 开箱可做完整增删改查；把 `NEXT_PUBLIC_KEDAYA_USE_MOCK=false`
并配好 `NEXT_PUBLIC_ADMIN_API_KEY` 即操作真实菜品库。

### 10.2 为什么菜品写操作要带 `x-admin-key`

菜品库是营养结论的**数据地基**（ADR 0006 D1：记录当餐时把营养值快照进历史）。
谁都能改营养值，等于整条"识别 → 计算 → 推荐"链路的结果不可信。
因此后端把 `POST/PATCH/DELETE /canteen/items` 收在 `AdminGuard` 之后（fail-closed：`ADMIN_API_KEY`
与 `ADMIN_USER_IDS` 都未配置时**一律拒绝**），而 `GET /canteen/dishes` 保持匿名可读
（小程序端记录当餐时要检索菜品）。

| 端 | 写权限来源 |
| --- | --- |
| 本机 / 演示 | `apps/web/.env.local` 的 `NEXT_PUBLIC_ADMIN_API_KEY` → 请求头 `x-admin-key` |
| 小程序 | **没有**写入口（`/nutrition/dishes` 页面只是演示 / 补录，文案已写明写入需管理员） |
| 生产 | **未接线**：应由「管理员登录 + 服务端代理」注入，见 10.4 第 1 条 |

### 10.3 测试

| 文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `data/mock/canteen.repository.test.ts` | 13 | 检索（关键词忽略大小写与首尾空格 / 品类）、**游标分页不重不漏**、未知游标安全退化、详情、新建（仓储生成 id 与时间戳）、修改（只改传入字段 / `updatedAt` 刷新）、下架、`NOT_FOUND`、故障演练全端点 `UPSTREAM_UNAVAILABLE` |

### 10.4 未实现 / 已知限制（如实列出）

1. **管理密钥会进浏览器包**：`NEXT_PUBLIC_*` 是构建期公开变量。这只适用于**本地开发 / 演示**；
   生产必须换成管理员登录 + 服务端代理（浏览器不持有 key）。页面上已写明"写操作需要管理员权限"。
2. **`/admin/dishes` 没有做批量导入 / 导出**：逐条录入。72 道菜的初始数据由种子脚本灌入
   （`services/api/prisma/seed.mjs` 的 `seedDishes`），不是从 Web 界面敲的。
3. **过敏原（`allergens`）没有服务端自动推断 —— 已知缺口**：API 接受 `allergens` / `source` /
   `lastVerifiedAt` 三个可选字段，但**只有种子脚本**按菜名推断过过敏原
   （`prisma/seed-data.ts` 的 `inferAllergensFromSeedName`）。Web 表单不提供这三项，
   于是**通过后台新建的菜品 `allergens` 默认为空** —— 小程序端「忌口 / 过敏原」的硬过滤
   对它们不生效（营养汇总与推荐打分不受影响）。上线前必须补：要么在服务端按菜名推断，
   要么把过敏原做成后台的必填维护项。
4. **未接真实登录**：本页与其他后台页一样是**演示会话**（见 §4 第 1 条）。
5. **没有组件渲染测试**：与其余切片一致，Vitest 只覆盖纯逻辑（node 环境），
   `/admin/dishes` 的三态与增删改查靠人工在浏览器验证。
