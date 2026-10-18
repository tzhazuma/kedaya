# @kedaya/miniapp · 可达鸭微信小程序（主端）

> **可达鸭（KedaYa）** —— 上海科技大学统一校园服务平台。
> 本项目是**第三方开源**校园服务平台（**非官方**），聚合校内分散的服务入口。
> Slogan：上科大，什么需求都可以到达。

本目录是**微信小程序端（主端）**：Taro 4.3 + React 18 + TypeScript 5.9。
次要编译目标为 H5（同一套代码，平台差异在 `src/platform/` 收口）。

---

## 1. 快速开始

```bash
# 在仓库根目录（npm workspaces，无 pnpm）
npm install

# 微信小程序：开发（watch）/ 生产构建
npm run dev:weapp   -w @kedaya/miniapp
npm run build:weapp -w @kedaya/miniapp

# H5（次要目标）
npm run dev:h5   -w @kedaya/miniapp
npm run build:h5 -w @kedaya/miniapp

# 类型检查 / 单元测试 / Lint
npm run typecheck -w @kedaya/miniapp
npm run test      -w @kedaya/miniapp
npm run lint      -w @kedaya/miniapp

# 微信开发者工具真实模拟器冒烟（需先开启服务端口）
npm run smoke:weapp -w @kedaya/miniapp
```

Windows、VS Code、Codex CLI 与微信开发者工具的自动化配置和手动步骤见
[`docs/development/wechat-agent-automation.md`](../../docs/development/wechat-agent-automation.md)。

> ⚠️ 本仓库有多个工作流并行，`node_modules` 是共享的。
> 任何会改动 `node_modules` 的命令（`npm install` / `npm ci`）都必须串行化：
>
> ```bash
> ./scripts/with-npm-lock.sh npm install
> ```
>
> 只读命令（`tsc` / `vitest` / `taro build`）不需要锁。

---

## 2. 用微信开发者工具打开

1. 先构建：`npm run build:weapp -w @kedaya/miniapp`
   → 产物落在 `apps/miniapp/dist/`（`miniprogramRoot` 已指向它）。
   构建先写入 `.weapp-stage/`，校验页面和脚本后才发布到 `dist/`；
   上一份完整产物保留在 `.weapp-last-good/`。开发监听使用同一流程。
   请等命令行显示“完整包已发布”后再在开发者工具中编译。
2. 打开「微信开发者工具」→ **导入项目**：
   - 目录：`<repo>/apps/miniapp`
   - AppID：**游客模式**即可（`project.config.json` 里是占位值 `touristappid`）
3. 导入后即可看到启动页与四个主页面（首页 / 发现 / 消息 / 我的），底部是自绘的胶囊导航；拼单垂直切片默认走 **mock 数据**，不需要后端。

### 关于 appid（必须替换才能真机调试）

`project.config.json` 的 `appid` 是**占位符** `touristappid`（微信游客模式），
只能用于本地预览。正式开发请：

- 在开发者工具里直接改成可达鸭自己的 appid，**或**
- 写进 `project.private.config.json`（仓库已 gitignore，不会污染公共配置）

真机 / 预览时还需要在微信公众平台配置 **request 合法域名**（https），
否则 `Taro.request` 会被拦截（`project.config.json` 里 `urlCheck: false` 只对本地调试生效）。

---

## 3. 目录结构（六边形分层，契约 §7 冻结）

```
apps/miniapp/
├── config/                    # Taro 构建配置
│   ├── index.ts               #   baseConfig：sourceRoot/outputRoot/compiler/sass.resource
│   ├── dev.ts / prod.ts       #   开发 / 生产增量配置（骨架阶段为空）
├── project.config.json        # 微信开发者工具项目配置（miniprogramRoot = dist/）
├── babel.config.js            # babel-preset-taro
├── vitest.config.ts           # 纯逻辑测试（node 环境，不需要小程序模拟器）
├── eslint.config.mjs          # ESLint 10 flat config
└── src/
    ├── app.config.ts          # 页面注册 + window（夜间主题色取自 design-tokens；不用原生 tabBar）
    ├── app.tsx                # 根组件：契约 §8 启动时序
    ├── app.scss               # 全局样式
    ├── app/                   # 装配与启动：DI 容器、启动时序、路由表
    │   ├── container.ts       #   ← 全项目唯一把 ports 与 adapters 接起来的地方
    │   ├── bootstrap.ts       #   bootstrapSync（同步 hydrate）+ refreshInBackground
    │   └── routes.ts          #   页面路径常量（纯数据，无 Taro 依赖）
    ├── application/           # 用例层：编排，不含 IO
    │   ├── auth/session.ts
    │   └── groupbuy/          #   listGroupBuys / groupBuyDetail / joinGroupBuy
    ├── domain/                # 纯领域：零框架依赖
    │   ├── models/            #   groupbuy.ts（状态推导/参团资格）、session.ts
    │   └── ports/             #   GroupBuyRepository / HttpPort / CachePort / ClockPort ...
    ├── data/                  # adapters：实现 ports
    │   ├── api/               #   request.ts（信封解包 + 401 刷新重试）、taroHttpAdapter.ts
    │   ├── repositories/      #   http / mock 两套 GroupBuyRepository
    │   ├── storage/           #   Taro 同步存储、内存存储、会话存储
    │   └── mock/              #   内存数据库 + 确定性种子数据
    ├── platform/              # 平台差异适配（订阅消息 / 扫码 / 分享 / 地图 / 导航）
    └── presentation/          # UI
        ├── components/        #   KdyCard / KdyButton / KdyEmpty / KdyTag
        ├── hooks/             #   useStore（useSyncExternalStore 封装）
        ├── theme/tokens.scss  #   设计令牌入口（全局注入）
        └── pages/             #   home / discover / messages / profile / groupbuy/*
```

**依赖方向（硬规则）**：`presentation → application → domain ← data`。
`domain` 与 `application` **不得** import Taro / React / 具体 adapter ——
这条规则由 `eslint.config.mjs` 的 `no-restricted-imports` 兜住，不靠自觉。

页面路径因此以 `presentation/` 开头（例如 `presentation/pages/groupbuy/list/index`），
这是契约 §7 冻结目录的直接结果。

---

## 4. 契约要点在本端的落地

### 4.1 启动时序（契约 §8）

```
1. 同步：从本地存储 hydrate 缓存（关键路径，禁止网络）
2. 立即渲染首屏（带缓存数据）
3. 后台并发：刷新 token → 拉取数据 → 失败静默降级
```

实现见 `src/app/bootstrap.ts` + `src/app.tsx`：

- `bootstrapSync(container)` —— **纯同步**，只读本地存储；
- `refreshInBackground(container)` —— 返回值是 `void`（**不是 Promise**），
  这是刻意的类型约束：调用方无法 `await` 它，从而不可能把「后台刷新」写成「阻塞启动」。

### 4.2 网络层（契约 §6.1）

`src/data/api/request.ts` 收敛了全部 HTTP 约定：

| 约定 | 实现 |
| --- | --- |
| base path `/api/v1` | `buildUrl()` 拼接 |
| `Authorization: Bearer` | 非 `anonymous` 请求自动注入 |
| `X-KedaYa-Trace` | 每个请求生成 trace id；响应体 `traceId` 缺失时回退 |
| `Idempotency-Key` | 写操作可选注入（参团默认带） |
| 信封解包 | `parseEnvelope()` → `toResult()` → `Result<T, ApiError>`（`@kedaya/shared`） |
| 401 | 刷新 token 后**只重试一次**；并发 401 只触发一次刷新（in-flight 去重） |
| 传输层失败 | 与业务失败严格区分：`UPSTREAM_UNAVAILABLE` + `details.kind` |

关键设计：`request.ts` **不 import Taro**，传输由 `HttpPort` 注入
（Taro 实现见 `taroHttpAdapter.ts`）。因此上述行为可以在 Vitest（node）里被完整测试。

### 4.3 设计令牌（契约 §6.2）

**禁止手写色值。** 机制：

- `config/index.ts` 用 Taro 的 `sass.resource` 把
  `src/presentation/theme/tokens.scss` 全局注入到**每一个** `.scss` 文件；
- 该文件 `@import` 了 `packages/design-tokens/dist/tokens.scss`
  （相对路径，绕开 package `exports` 解析差异，任何 sass 版本都确定可解析）；
- 于是任何样式都可以直接用 `$kdy-color-brand` / `$kdy-space-4`，无需逐文件 import。

`app.config.ts`（微信原生配置，构建期求值）读取 `@kedaya/design-tokens/tokens.json`
—— 那是令牌包的**真相来源文件本身**，避免在端上复制一份色值。

### 4.4 模块清单（契约 §4）

首页宫格**完全由 `@kedaya/contracts` 的 `MODULES` 驱动**，端上没有任何写死的模块数组。
新增模块时首页自动出现。API 路径也用 `modulePath('groupbuy', 'items')` 生成。

---

## 5. 平台能力：微信特有 vs H5 降级

「发现」页把下面这张表做成了**可点击、可观察**的演示（真实调用 `src/platform/*`，
并把 `PlatformResult` 的 code 原样显示）。

| 能力 | 微信小程序 | H5 降级 | 文件 |
| --- | --- | --- | --- |
| 订阅消息 | `wx.requestSubscribeMessage`，用户点「允许」后一次性下发 | 无对应能力 → `UNSUPPORTED`，改走站内信 | `platform/subscribeMessage.ts` |
| 扫码 | `wx.scanCode` 原生相机 | 无原生扫码 → `UNSUPPORTED`，引导手动输入 | `platform/scanner.ts` |
| 分享 | **不能静默分享**：必须用户点击 `<Button open-type="share">` 或右上角转发 | `navigator.share` → 再降级复制链接 | `platform/share.ts` |
| 地图 | `wx.openLocation` 打开微信内置地图（可直接导航） | 高德 Web URI → 再降级复制坐标 | `platform/map.ts` |

失败语义统一为 `PlatformFailure.code ∈ {UNSUPPORTED, REJECTED, FAILED}`，
UI 可以据此区分「这个端没有」「用户拒绝」「调用出错」。

---

## 6. 已实现的垂直切片：拼单（`groupbuy`）

- **列表页** `presentation/pages/groupbuy/list`：分类筛选、下拉刷新、触底加载（游标分页）、
  卡片展示（进度条 / 剩余份数 / 截止倒计时 / 状态标签）。
- **详情页** `presentation/pages/groupbuy/detail`：完整信息 + 参与人列表 + 四个动作
  （参团 / 分享 / 复制链接 / 查看地图）。
- **参团动作**：`application/groupbuy/joinGroupBuy.ts` —— 先查会话 → 再用 domain 的
  `canJoin` 本地预校验 → 最后才发请求（带幂等键）。
- **三态齐全**：`loading` / `empty` / `error`（+ `ready`）。
  列表页顶部有「模拟错误态 / 模拟空态 / 重置演示数据」三个按钮，
  走的是 mock 仓储的真实控制面（`failNextRequests` / `clearAll`），**不是硬编码假状态**。

默认 `TARO_APP_USE_MOCK !== 'false'` → 走 mock。接真后端：

```bash
TARO_APP_USE_MOCK=false \
TARO_APP_API_BASE_URL=https://api.example.com \
npm run build:weapp -w @kedaya/miniapp
```

---

## 7. 测试

```bash
npm run test -w @kedaya/miniapp
```

跑在 **node 环境**（`vitest.config.ts`），不需要小程序模拟器 ——
因为除 `data/api/taroHttpAdapter.ts`、`data/storage/taroStorage.ts`、`platform/*` 之外，
所有代码都不 import Taro。

| 测试文件 | 覆盖内容 |
| --- | --- |
| `src/domain/models/__tests__/groupbuy.test.ts` | 状态推导、参团资格、派生摘要、整数分金额 |
| `src/data/api/__tests__/request.test.ts` | 信封解包、trace/Bearer/幂等头、401 刷新重试、并发刷新去重、传输失败语义 |
| `src/data/repositories/__tests__/mockGroupBuyRepository.test.ts` | 游标分页、参团写动作、三态控制面、深拷贝隔离 |
| `src/application/groupbuy/__tests__/listGroupBuys.test.ts` | 契约 §8：同步 hydrate、失败静默降级、empty/error 态、loadMore 续页、快照引用稳定 |
| `src/data/storage/__tests__/sessionStore.test.ts` | 会话 hydrate、快照引用稳定（`useSyncExternalStore` 前提）、tokenStore 视图 |

---

## 8. 已实现 / 未实现 / 已知问题

### ✅ 已实现

- Taro 4.3 + React 18 + TS 5.9 骨架，`weapp` 为主编译目标、`h5` 为次要目标
- 六边形分层目录（契约 §7）与依赖方向 lint 约束
- `app.config.ts`（页面注册 + 夜间 window；底部导航是自绘的 `KdyDock`，不用原生 tabBar）
- 契约 §8 启动时序（同步 hydrate → 立即渲染 → 后台刷新静默降级）
- 统一网络层：`/api/v1`、Bearer、`X-KedaYa-Trace`、`Idempotency-Key`、信封解包、401 刷新重试
- Taro 同步存储 adapter + 内存 adapter + 会话/token 存储
- mock adapter（确定性种子数据 + 内存数据库 + 三态控制面）
- 平台能力封装（订阅消息 / 扫码 / 分享 / 地图 / 导航），逐个注明微信特有与 H5 降级
- 拼单垂直切片：列表 + 详情 + 参团，三态齐全，默认 mock
- 4 个复用组件：`KdyCard` / `KdyButton` / `KdyEmpty` / `KdyTag`（全部取自设计令牌）
- 5 个 Vitest 测试文件（domain / 网络层 / mock 仓储 / 列表用例 / 会话存储）

### ❌ 未实现（诚实清单）

- **统一身份认证**：契约 §5 第一级身份层（CAS / Egate OAuth → KedaYa JWT）未接入。
  「我的」页的登录是**明确标注的骨架占位**（`data/mock/mockAuth.ts` 伪造形状合法的 token）。
- **校园系统绑定**：契约 §5 第二级能力层（`CampusSessionPort`）未实现。
  `profile.campusBound` 目前是手工切换的占位开关。
- **敏感模块二次同意**：契约 §9 的同意流程与审计日志未实现（首页对这类模块只做标注 + 提示）。
- **站内信列表**（`notifications`）：只有订阅消息链路，站内信列表是空态。
- **其余 18 个业务模块**：契约 §4 已登记，端上未实现（首页明确显示「开发中」）。
- ~~**tabBar 图标**~~：原生 tabBar 已移除，底部导航改为自绘 `KdyDock`（胶囊 + 圆形按钮），不再需要 tabBar 图标资源。
- **H5 端未实机验证**：`build:h5` 脚本已就绪，但本轮只验证了 `weapp` 构建。
- **CI / 真机预览**：未在真机与微信开发者工具中打开验证（无图形环境）。
- **E2E 测试**：未接入小程序自动化（miniprogram-automator）。

### ⚠️ 已知问题 / 需要在别处修

1. **`@kedaya/design-tokens` 的 SCSS 生成有单位缺陷**（不在本工作流作用域，未改动）：
   `dist/tokens.scss` 里 `$kdy-line-height-*` 被生成为 `1.5px`、`$kdy-font-weight-*` 为
   `600px`、`$kdy-z-index-*` 为 `1000px` —— 这些量本应是无单位数字。
   本端因此**没有使用**这三组变量（`line-height` / `font-weight` 在样式里写字面量数字，
   这不违反「禁止硬编码色值」）。建议 Lead 在 `packages/design-tokens/scripts/generate.mjs`
   里对 `lineHeight` / `fontWeight` / `zIndex` 跳过 `px` 后缀。

2. **React 大版本按端不同**（契约 §2 已裁决）：本端是 React **18.3.1**
   （`@tarojs/react@4.3.0` 的 peer 是 `react@^18`）。代码里不使用任何 React 19 专有 API。

3. **`prebundle` 已显式关闭**：Taro 4 默认开启依赖预打包，会把产物写进共享的
   `node_modules` 缓存目录，而本仓库多个工作流并行安装，因此
   `config/index.ts` 里设 `compiler: { type: 'webpack5', prebundle: { enable: false } }`。
   这仍是 webpack5 编译器，只是关掉预打包。

4. **开发者工具报 `dist/app.json ... 未找到 app.json` 时的恢复步骤**（已从构建侧修掉诱因，
   但工具自身会把「找不到 app.json」的失败结果缓存住，需要人工清一次）：

   原因有两个，都已在本仓库规避：
   - `h5` 产物曾经和小程序共用 `dist/`，跑一次 `build:h5` 就会把 `dist/app.json` 覆盖掉
     → 现在 H5 输出到 `dist-h5/`（见 `config/index.ts` 的 `OUTPUT_ROOT`）；
   - 发布曾经用「`dist` → `.weapp-last-good` 改名、`.weapp-next` → `dist` 改名」的方式换包
     → 工具的目录 watcher 会因此失联（日志里只有 `unlinkDir dist`，之后再没有 `add dist/...`），
     现在改成**原地同步**（`scripts/publish-weapp.cjs`），只产生普通的增删改事件。

   如果你正好在旧版本留下的坏状态里，按顺序试：
   1. 「关闭当前项目」再重新打开（不是只点编译 —— 失败结果缓存在工具进程内）；
   2. 仍不行就退出整个微信开发者工具再启动；
   3. 再不行：「工具 → 清除缓存 → 全部清除」，然后重新打开项目。

---

## 9. 自检证据

见本目录交付说明（Lead 的 task-3 交付消息）中粘贴的真实命令输出。
本 README 不复制输出，避免与真实结果脱节。
