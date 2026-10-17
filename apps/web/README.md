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
│   │   ├── (portal)/        #   门户路由组：groupbuy 列表 + 详情、/m/[moduleId] 模块占位
│   │   ├── (admin)/         #   管理后台路由组：/admin
│   │   ├── providers.tsx    #   TanStack Query Provider + 主题 Provider
│   │   └── globals.css      #   Tailwind 4 入口 + design-tokens 导入 + @theme 映射
│   ├── application/         # 用例层（编排，不含 IO）
│   │   ├── groupbuy/        #   loadGroupBuyList / loadGroupBuyDetail / joinGroupBuy
│   │   └── admin/           #   loadAdminDashboard
│   ├── domain/              # 纯领域（零框架、零 IO）
│   │   ├── models/          #   module(+modules 注册表) / groupbuy / audit
│   │   └── ports/           #   GroupBuyRepository / AuditLogRepository / ModuleSwitchRepository
│   ├── data/                # 适配器层（唯一发请求的地方）
│   │   ├── api/client.ts    #   /api/v1 + Bearer + X-KedaYa-Trace + Idempotency-Key → Result
│   │   ├── schemas/         #   zod 传输层校验（含 schema ↔ domain 双向类型断言）
│   │   ├── repositories/    #   端口实现（http）+ 运行时工厂（mock/http 切换）
│   │   └── mock/            #   内存 mock 适配器 + 数据集（无后端可跑）
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
| mock 适配器 | `data/mock/` | 内存数据集（6 条拼单 / 6 条审计 / 19 个开关），支持故障演练（`error` 模式）与 `reset()` |
| 首页 | `app/page.tsx` | 品牌区（含 `UnofficialNotice`）+ 19 模块宫格（分组）+ 隐私/审计说明 + 平台能力 |
| 模块占位页 | `app/(portal)/m/[moduleId]/page.tsx` | 19 个模块入口全部可达（非 404），展示路由前缀/敏感级/同意门要求 |
| **拼单垂直切片** | `app/(portal)/groupbuy/**` | 列表（游标分页 + 状态/关键词筛选 + 四态）与详情（参与者/规则/**参团 mutation**） |
| 管理后台占位 | `app/(admin)/admin/page.tsx` | 模块开关表（19 行，受权限约束）+ 审计日志表（§9 字段齐全）+ 合规概览 |
| 5+ 复用组件 | `presentation/components/` | `KdyCard` `KdyButton` `KdyBadge` `KdyEmpty` `KdySkeleton` `KdyAlert` `ModuleGrid` `PageHeader` `SiteHeader` `SiteFooter` `UnofficialNotice` |
| 主题 Provider | `presentation/theme/` | light/dark/system 三态；`useSyncExternalStore` 订阅 `localStorage` + `matchMedia`；写 `<html data-theme>`（system 移除）+ `dark` class + `color-scheme`，暗色配色来自令牌 `colorDark` |
| 品牌资源 | `public/brand/` | `kedaya-mascot.svg`、`kedaya-cover.svg`（复制，源文件未动）+ `cover.png`（1200×630，`rsvg-convert`） |
| 测试 | `src/**/*.test.ts` | 6 个文件 / **81 个用例**，全部纯逻辑（node 环境，无需 jsdom） |

### 测试覆盖

| 文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `domain/models/groupbuy.test.ts` | 19 | 名额/进度/参团资格/状态机/折扣/整数分金额/排序/领域校验 |
| `domain/models/modules.test.ts` | 12 | 注册表与契约一一对应、`validateModuleRegistry` 零问题、同意门恰为 3 个、审计范围 = high+critical |
| `domain/models/audit.test.ts` | 14 | 脱敏、审计摘要四要素、过滤/聚合/排序、开关权限、`toggleModule` 不可变 |
| `data/api/client.test.ts` | 13 | 信封成功/失败、非信封兜底、非 JSON、网络异常、请求头与查询串、trace 兜底、baseUrl 覆盖 |
| `application/groupbuy/groupbuy.test.ts` | 10 | 视图模型本地化（分转元/相对时间）、用例编排、错误码透传 |
| `data/mock/groupbuy.repository.test.ts` | 13 | 游标分页不重叠、状态过滤、NOT_FOUND/CONFLICT/VALIDATION_FAILED、故障演练、reset |

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
5. **其余 17 个模块只有占位页**：仅 `groupbuy` 有真实垂直切片。
6. **后台不落库**：模块开关只改内存；审计条目在 mock 里是**追加到内存**，刷新即回到种子数据。
   开关状态没有做乐观更新回滚（失败时只提示 + 重新拉取）。
7. **`/api/v1/admin/*` 不在契约 §6.1 的路由前缀表内**：审计与模块开关属管理域，
   我用了 `/admin/audit-logs`、`/admin/modules`（见下"偏差"）。
8. **未接 E2E / 组件渲染测试**：Vitest 只覆盖纯逻辑；React 组件未做渲染断言（未引入 jsdom/Testing Library）。
   已用真实浏览器人工验证三态与参团动作（见 §5）。
9. **未接入 `platform/share.ts`、`platform/analytics.ts` 的 UI**：能力已实现，但页面上没有调用点。
10. **`next lint` 已不存在**：Next 16 移除了 `next lint` 与 `eslint` 配置键，
    `lint` 脚本改为独立 `eslint .`（扁平配置 `eslint.config.mjs`）。

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
 ✓ src/domain/models/modules.test.ts (12 tests)
 ✓ src/application/groupbuy/groupbuy.test.ts (10 tests)
 ✓ src/domain/models/groupbuy.test.ts (19 tests)
 ✓ src/data/api/client.test.ts (13 tests)
 ✓ src/domain/models/audit.test.ts (14 tests)
 ✓ src/data/mock/groupbuy.repository.test.ts (13 tests)
 Test Files  6 passed (6)
      Tests  81 passed (81)
```

```bash
$ npm run build -w @kedaya/web
▲ Next.js 16.4.2 (Turbopack)
✓ Compiled successfully
✓ Generating static pages using 8 workers (24/24) in 1795ms
Route (app)
┌ ○ /              ├ ○ /_not-found    ├ ○ /admin
├ ○ /groupbuy      ├ ƒ /groupbuy/[id] └   /m/[moduleId]  (19 个 SSG 路径)
```

生产服务器冒烟测试（`next start -p 3210`）：

```
/                          HTTP 200  95577 bytes
/groupbuy                  HTTP 200  26168 bytes
/groupbuy/gb-1001          HTTP 200  22958 bytes
/admin                     HTTP 200  25147 bytes
/m/forum                   HTTP 200  30658 bytes
/m/nope-404                HTTP 404  16536 bytes
/brand/cover.png           HTTP 200  141336 bytes
```

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
