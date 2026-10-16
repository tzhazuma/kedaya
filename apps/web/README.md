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
只补 UI 装饰（icon / accent）。首页、`/m/[moduleId]` 占位页、管理后台开关表**三处共用同一份数据**。
`validateModuleRegistry()`（纯函数）+ 单测会在有人漏装饰/漏模块/重复 id 时立刻失败。

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
| 管理后台占位 | `app/(admin)/admin/page.tsx` | 模块开关表（20 行，受权限约束）+ 审计日志表（§9 字段齐全）+ 合规概览 |
| 5+ 复用组件 | `presentation/components/` | `KdyCard` `KdyButton` `KdyBadge` `KdyEmpty` `KdySkeleton` `KdyAlert` `ModuleGrid` `PageHeader` `SiteHeader` `SiteFooter` `UnofficialNotice` + forum/faq 专属组件 |
| 主题 Provider | `presentation/theme/` | light/dark/system 三态；`useSyncExternalStore` 订阅 `localStorage` + `matchMedia`；写 `<html data-theme>`（system 移除）+ `dark` class + `color-scheme`，暗色配色来自令牌 `colorDark` |
| 品牌资源 | `public/brand/` | `kedaya-mascot.svg`、`kedaya-cover.svg`（复制，源文件未动）+ `cover.png`（1200×630，`rsvg-convert`） |
| 测试 | `src/**/*.test.ts` | 15 个文件 / **243 个用例**，全部纯逻辑（node 环境，无需 jsdom） |

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
4. **同意门 UI 未实现**：`/m/[moduleId]` 只**提示**需要二次同意，
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
  审计首行含全部 §9 字段（`心理/调解专员 · u_8f****9d · 10.20.3.14 · 读取 · 心理治疗 · appointment#appt-3301 · 最高敏感 · 允许 · trc-9f31c2a4`）；
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
