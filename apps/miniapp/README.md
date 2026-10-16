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
```

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
2. 打开「微信开发者工具」→ **导入项目**：
   - 目录：`<repo>/apps/miniapp`
   - AppID：**游客模式**即可（`project.config.json` 里是占位值 `touristappid`）
3. 导入后即可看到 tabBar 四个页面与拼单垂直切片（默认走 **mock 数据**，不需要后端）。

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
    ├── app.config.ts          # 页面注册 + tabBar + window（色值取自 design-tokens）
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
        │                      #   + KdySwitch / KdySearchBar / KdyAccordion / KdyField
        │                      #   + KdyEthicsNotice / KdyPrivacyNotice（wildlife 的伦理与隐私提示）
        │                      #   + KdyBuddyPrivacyNotice（buddy 的隐私提示，语义与 wildlife 不同）
        ├── hooks/             #   useStore（useSyncExternalStore 封装）
        ├── theme/tokens.scss  #   设计令牌入口（全局注入）
        └── pages/             #   home / discover / messages / profile
                               #   groupbuy/* · forum/{list,detail,create,report}
                               #   faq/{index,tickets}
                               #   wildlife/{map,report,tracks}
                               #   buddy/{list,detail,create,profile,recommendations}
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

## 6.1 垂直切片：论坛（`forum`）

对应 `docs/architecture/02-domain-model.md` §2.4，敏感级 `medium`。

- **列表页** `presentation/pages/forum/list`：版块筛选（「全部」+ 版块）、主题卡片
  （标题 / 摘要 / 标签 / 状态标签 / 置顶 / 回复数 / 相对时间）、下拉刷新、触底加载。
- **详情页** `presentation/pages/forum/detail`：主题正文 + 一级「楼中楼」回复 +
  回复输入框 + 举报入口 + `onShareAppMessage` 分享。
- **发帖页** `presentation/pages/forum/create`：标题 / 正文 / 标签 + **匿名开关**，
  并在页面上直接展示隐私说明（匿名只对普通同学隐藏，版主可在板块内追溯）。
- **举报页** `presentation/pages/forum/report`：理由选择（`spam|abuse|illegal|privacy|other`）
  + 匿名举报开关。
- **治理规则真的在跑**（不是 UI 假状态）：列表不含 `HIDDEN`/`DELETED`/`DRAFT`；
  `LOCKED` 主题无法回复（domain 的 `canReply` 判定，UI 与仓储共用）；
  3 个**不同**用户举报 → 目标自动 `HIDDEN`。
- **写动作**：`createForumPost` / `replyToPost` / `reportForumContent` ——
  会话门 → domain 本地校验 → 仓储写动作，全部带 `Idempotency-Key`（契约 §11.3）。
- **三态齐全**：`loading` / `empty` / `error`（+ `ready`，缓存降级时另有提示）。
  顶部「模拟错误态 / 模拟空态 / 重置演示数据」走 `mockForumControls` 的真实控制面。

## 6.2 垂直切片：常见问题（`faq`）

对应 `docs/architecture/02-domain-model.md` §2.8，敏感级 `low`（**搜索无需登录**）。

- **FAQ 页** `presentation/pages/faq/index`：搜索框 + 分类标签 + 手风琴列表 +
  「有用」按钮；下拉刷新、触底加载。
- **我的工单页** `presentation/pages/faq/tickets`：工单列表（状态标签 / 官方回复 /
  未登录提交标记）+ 提交表单。
- **「有用」是幂等的**：重复点击只算一次。两道保险 ——
  ① 本地已投票记录命中就直接返回 `applied: false`（连请求都不发）；
  ② mock 仓储按 `userId + articleId` 去重，真后端另有 `Idempotency-Key`。
  两者共用 domain 的 `applyHelpfulVote`，语义不会漂移。
- **隐私硬约束**：工单 `contact` **拒绝中国大陆手机号**
  （domain-model §2.8「不存明文手机号」），校验在 domain 层，页面只展示错误。
- **未登录也能提交工单**（`userId: null`），列表此时只显示匿名工单。

## 6.3 垂直切片：猫 / 鸟 / 黑天鹅（`wildlife`）

对应 `docs/features/wildlife-map.md`，敏感级 **low**（**无同意门**，契约 §9）。

- **动物地图页** `presentation/pages/wildlife/map`：`<map>` 底图 +
  **活动区域圈**（`circles`）+ **聚合热点 / 历史观测标记**（`markers`）+ **推断轨迹折线**（`polyline`，
  虚线）；物种筛选、区域列表、点标记看观测详情（物种 / 发现时间 / 照片 / 区域 / 投喂规范）、
  「在腾讯地图中打开」（`wx.openLocation`）。
- **上报观测页** `presentation/pages/wildlife/report`（**核心流程**）：
  `Taro.chooseMedia` 选图 → 按需压缩 → `POST /media`（**multipart**，走 `data/api/mediaUpload.ts`）→
  `POST /classify` 自动分类建议（**无 key 时静默降级为纯手动**）→ 手动选物种 →
  可选「给个体起名」（`POST /individuals`）→ 定位（`getLocation`，WGS84）或地图点选（GCJ-02）→
  发现时间（默认现在，可改）→ 伦理勾选（**表单校验，不是同意门**）→ `POST /items`（带幂等键）。
- **推断轨迹页** `presentation/pages/wildlife/tracks`：页面顶部**常驻**免责横幅 +
  每条轨迹卡片标注「推断轨迹」+ **原样展示服务端下发的 `disclaimer`**（缺失时回退本地兜底）。
- **伦理与隐私提示（硬要求，不是可选项）**：`KdyEthicsNotice`（投喂规范 `allowed|discouraged|forbidden`
  + 不打扰提示 + 伦理清单 + 勾选）与 `KdyPrivacyNotice`（**明确告诉用户「你看到的公开位置是模糊后的」**、
  敏感区不公开坐标、聚合热点延迟 ≥24h）。
- **坐标系（本模块最大的坑，规格 §3）**：全链路 WGS84；`<map>` 只认 GCJ-02。
  转换入口**只有两个**，都在 `domain/models/wildlife.ts`：
  `toMapPoint()`（渲染前 WGS84→GCJ-02）与 `toApiPoint(point, from)`（上传前 GCJ-02→WGS84，
  `from` **必填**）。页面**禁止**自己拼叠加层 —— 一律走 `buildMapOverlays()`。
- **三态齐全**：`loading` / `empty` / `error`（+ `ready`，缓存降级另有提示）。
  顶部「模拟错误态 / 模拟空态 / 重置演示数据」走 `mockWildlifeControls` 的真实控制面。

> ⚠️ **与规格 §1.2 的偏离（已在交付说明中记录）**：规格**推荐**方案 B
> （静态校园平面图 + 叠加层，无坐标系问题），而本实现按本任务的显式要求采用**方案 A**
> （原生 `<map>` + `markers`/`circles`/`polyline`）。两者对用户的核心差别是底图内容；
> 坐标转换规范两者一致。`<map>` 自 2021 年起需要腾讯位置服务 key / 小程序绑定，
> 未配置时 `onError` 会给出明确提示（mock 数据与其余功能不受影响）。

> ⚠️ **未决项（诚实标注）**：物种清单是**推测**（规格 §2.5 / U2，未做实地调查）；
> 底图与 `CAMPUS_BBOX` / `CAMPUS_ORIGIN` 是**占位值**（U1 / U3）；
> 告示文案是**草案，未经校方或社团审核**（U7）；GCJ-02 控制点未采集（U4），
> 因此规格 §11.1 的 **T4（与腾讯控制点误差 < 5 m）未执行**。

---

## 6.4 垂直切片：找搭子（`buddy`）

对应 `docs/features/buddy-matching.md` 与契约 §11.2（动作名）/ §11.10-D（`joinedCount`）/
§11.10-E（不透明游标）/ §11.10-G（三板块，**不做 dating**）。敏感级 **low**、**无同意门**。

- **列表页** `presentation/pages/buddy/list`：**三板块分栏**（`academic` / `daily` / `sport`）+
  下拉刷新 + 触底游标分页；卡片展示状态 / 时间 / 地点 / 人数 / 标签 / 发起人。
- **详情页** `presentation/pages/buddy/detail`：完整信息 + 四个动作
  （`join` 申请 / `leave` 撤回 / `decide` 审批 / `close` 关闭）+ 匹配反馈
  （like / dislike / skip）。**申请列表仅发起人可见**（规格 §6.1 可见性矩阵）。
- **发布页** `presentation/pages/buddy/create`：板块 → 活动类型（**派生**，不存 `section`）/
  标题 / 说明（含联系方式拦截）/ 地点（白名单）/ 日期时间 / 时长 / 人数 / 性别准入 /
  运动水平（**仅 sport**）/ 标签。
- **我的匹配资料** `presentation/pages/buddy/profile`：院系、兴趣标签（≤20）、活动标签（≤10）、
  **可用时段（周几 + 起止时间，可增删）**、常去区域（≤5）、运动水平（仅 sport）、
  一句话自述、**匹配开关（默认关闭）**、**删除匹配资料（撤回）**。
- **推荐页** `presentation/pages/buddy/recommendations`：**展示 `explainMatch()` 给出的结构化理由**
  （「同一个院系」「共同兴趣 3 项」「时间能碰上」…）而不是只给一个分数；
  `matchMode`（`vector`/`hash`/`rule`）**原样展示**，`rule` 模式下不会出现「智能推荐」。

### 三条硬约束的落地（本模块最容易做错的地方）

1. **封闭标签表（规格 §3.2）**：`interestTags` / `activityTags` / `BuddyPost.tags`
   **一律取自服务端封闭标签表**。发布页与资料页**没有**标签输入框；
   用例层的 `addTagByText()` 是唯一能"输入"标签的入口，任何未登记的字符串都会被拒
   （`未登记的标签：xxx`，对齐服务端 `UNKNOWN_TAG:<key>`）。
   理由：自由文本会让「羽毛球」/「打羽毛球」/`badminton` 互不匹配，而共同标签数
   是本模块最精确、最可解释的匹配特征。
   ⚠️ 本端的 `BUDDY_TAGS` 是**服务端权威表的逐字镜像**（62 项，
   `services/api/src/modules/buddy/domain/tags.ts`），并由单测钉住规模与关键 key ——
   初版凭规格文字自拟了 37 个 key，其中 7 个服务端并不存在（详见 §8.7(a)）。
   由于服务端**当前没有** `GET /buddy/tags`，`listTags()` 失败时会**回落到这份镜像**
   （仍是封闭表，不是自由输入）。
2. **可用时段（规格 §3.3 F7）**：时段重叠是**硬过滤**，判定**直接调用**
   `@kedaya/shared` 的 `overlapsAvailability`（与服务端同一套）。跨零点由活动时长表达
   （时段本身不跨零点），例如周一 23:30 踢 90 分钟会命中**周二** 00:00–02:00 的时段。
3. **可解释性（G3）**：理由由 `explainMatch()` 产出，并**显式区分两件事**：
   - `reason`（标题）= **服务端下发的原文**，它才是排序依据的表述（客户端推算**不得**覆盖它）；
   - `reasons`（标签）= 服务端结构化条目（有则用），否则客户端用
     **公开信息**（活动标签 / 地点 / 时间）+ 我自己的资料经 `explainMatch()` 算出；
   - `reasonSource` 标注标签来源（`server` / `client`），`serverReason` 保留服务端原文。
   客户端**永远不**声称「同一个院系」或「共同兴趣 N 项」—— `BuddyProfile`
   对任何人都不直接可见（规格 §6.1），发起人的院系/兴趣不在客户端，硬算只能靠编造。

### 隐私提示（规格 §6，**硬要求**）

`KdyBuddyPrivacyNotice` 在列表 / 详情 / 发布 / 资料 / 推荐五个页面常驻，三句话缺一不可：
① 匹配资料（院系/兴趣/可用时段/区域/水平）**不对任何人展示**，只被算法使用；
② 活动只公开活动信息、昵称与头像，**联系方式在申请通过后经站内信交换**；
③ 匹配资料**可随时撤回**（关闭匹配或删除后立即移出推荐池）。

> ⚠️ **未决项（诚实标注）**：
> - `CAMPUS_AREAS` 已改为**逐字镜像服务端**的 `CAMPUS_LOCATIONS`（25 项），
>   但服务端自己就标注了「真实清单必须由产品 + 运营确认后替换」—— 因此**仍是占位内容**
>   （规格 U10 未提供真实清单）。镜像它至少保证两端彼此一致，不宣称它已真实。
> - `SHTU_DEPARTMENTS` 是 UI 的**下拉建议值**（服务端对 `department` 只约束 ≤64 字，
>   不校验白名单），与 Web 端的 `BUDDY_DEPARTMENTS` 逐字一致 ——
>   两端不一致会让 `same-department` 规则永远不命中。
> - 规格 §6.2 的「匹配成功后可见的联系方式」字段属 `profile` 模块（跨模块需求，U8），
>   本端只做到「撮合」，站内信交换由 `notifications` 模块负责。

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
| `src/domain/models/__tests__/forum.test.ts` | 主题状态机（`canReply`）、匿名展示、草稿校验（长度/标签/敏感词/PII 提示）、回复树组装 |
| `src/domain/models/__tests__/faq.test.ts` | 可见性、搜索/分类、工单隐私校验（拒绝手机号）、`applyHelpfulVote` 幂等 |
| `src/data/api/__tests__/request.test.ts` | 信封解包、trace/Bearer/幂等头、401 刷新重试、并发刷新去重、传输失败语义 |
| `src/data/repositories/__tests__/mockGroupBuyRepository.test.ts` | 游标分页、参团写动作、三态控制面、深拷贝隔离 |
| `src/data/repositories/__tests__/mockForumRepository.test.ts` | 游标分页、列表可见性、置顶排序、发帖/回复、举报阈值治理、三态控制面 |
| `src/data/repositories/__tests__/mockFaqRepository.test.ts` | 只返回 PUBLISHED、分类/搜索、投票幂等（服务端侧）、工单归属、三态控制面 |
| `src/data/repositories/__tests__/httpForumFaqRepository.test.ts` | 真后端仓储的 URL 映射、`Idempotency-Key`、`forum.report` 动作名、错误映射 |
| `src/application/groupbuy/__tests__/listGroupBuys.test.ts` | 契约 §8：同步 hydrate、失败静默降级、empty/error 态、loadMore 续页、快照引用稳定 |
| `src/application/forum/__tests__/listForumBoards.test.ts` | 版块三态、缓存降级、订阅/快照稳定性 |
| `src/application/forum/__tests__/listForumPosts.test.ts` | 契约 §8 + 游标续页 + 版块切换清空 |
| `src/application/forum/__tests__/forumPostDetail.test.ts` | 主题与回复分别失败、回复树、触底续页、写后就地更新 |
| `src/application/forum/__tests__/createForumPost.test.ts` | 未登录/校验失败拦截、匿名开关、幂等键唯一性与复用 |
| `src/application/forum/__tests__/replyToPost.test.ts` | `LOCKED`/`HIDDEN`/`DELETED` 主题拒答、`replyCount` 乐观更新 |
| `src/application/forum/__tests__/reportForumContent.test.ts` | 登录门、非法理由拦截、匿名与 `reporterId` 解耦、重复举报 `CONFLICT` |
| `src/application/faq/__tests__/browseFaq.test.ts` | 分类/搜索、投票幂等（本地不再发请求）、投票记录持久化 |
| `src/application/faq/__tests__/myTickets.test.ts` | 未登录提交、隐私校验、缓存降级、列表头部插入 |
| `src/data/storage/__tests__/sessionStore.test.ts` | 会话 hydrate、快照引用稳定（`useSyncExternalStore` 前提）、tokenStore 视图 |
| `src/domain/models/__tests__/wildlife.test.ts` | **坐标系（渲染 WGS84→GCJ-02 / 上传 GCJ-02→WGS84 / 偏移量级 200–800 m / 往返自洽 / lat-lng 互换被拒）**、地图叠加层派生、投喂规范取更严格者、伦理与隐私文案、分类三档降级、表单校验 |
| `src/application/wildlife/__tests__/wildlifeMap.test.ts` | 契约 §8 hydrate/load、三态、物种筛选、**`buildMapOverlays` 产出的每个坐标都是 GCJ-02**、E10 热点 24h 延迟过滤、敏感区不渲染点位 |
| `src/application/wildlife/__tests__/reportSighting.test.ts` | **地图点选 GCJ-02 → 提交 body 必须是 WGS84（且不等于点选值）**、GPS 原样透传、伦理勾选拦截、分类降级（manual/fallback/vision_api）、照片上传与重试复用 `clientPhotoId`、提交幂等键复用、个体命名 |
| `src/application/wildlife/__tests__/tracks.test.ts` | 推断轨迹三态、选中详情、**「推断轨迹」标注恒存在**、服务端 `disclaimer` 优先与本地兜底 |
| `src/data/repositories/__tests__/mockWildlifeRepository.test.ts` | 游标分页、三态控制面、**敏感区不存坐标 / 网格吸附真的生效**、E10 过滤、分类降级、个体重名 `CONFLICT` |
| `src/data/repositories/__tests__/httpWildlifeRepository.test.ts` | `/wildlife/*` 路径映射、URL 编码、`Idempotency-Key`、**仓储层不做坐标转换（原样透传 WGS84）**、上传委托给 multipart 端口 |
| `src/data/api/__tests__/mediaUpload.test.ts` | 上传表单字段（`clientPhotoId` 幂等依据）、响应解包、缺字段/非信封/未声明 `exifStripped` 的处理 |
| `src/domain/models/__tests__/buddy.test.ts` | **封闭标签校验（自由文本被拒 / 下架标签被拒 / 上限）**、`sectionOf` 全 6 值、**`canTransitionPost` 5×5 全矩阵**、申请状态机、`joinedCount` 含发起人、F1–F6 资格、**可用时段边界（含跨零点：周一 23:30+90min 命中周二时段；22:30+90min 到 24:00 不算进入周二）**、资料校验（≤20/≤10/≤5）、联系方式检测**不误报日期**、发布表单校验、隐私三句话、**镜像标签表与地点白名单与服务端权威表一致（62 / 25 项，且初版 7 个伪造 key 已清掉）** |
| `src/data/repositories/__tests__/mockBuddyRepository.test.ts` | 游标分页（`limit=1` 翻页不重不漏）、板块/标签筛选、**自由文本标签被拒（`UNKNOWN_TAG`）**、幂等键（同 key 同 body 复用 / 同 key 异 body `CONFLICT` / 缺 key `IDEMPOTENCY_KEY_REQUIRED`）、`join` 不占名额、`leave` 后重申请复用同一行、`decide(ACCEPTED)` 才递增 `joinedCount`、**非发起人 `FORBIDDEN`**、**申请列表仅发起人可见**、硬过滤 F1/F4/F6/F7、**反馈 section 隔离**、`explainMatch` 理由（academic 的「同一个院系」/ sport **不**产出它）、未开启匹配时「按时间排序」+ score 0、三态控制面 |
| `src/data/repositories/__tests__/httpBuddyRepository.test.ts` | `/buddy/*` 路径映射、**五个动作名逐字等于契约 §11.2（且未自创 accept/reject/cancel）**、所有 `POST` 带 `Idempotency-Key`、**游标原样透传**、`GET /buddy/profile` 404 → `null`、错误映射带 `details.reason` |
| `src/application/buddy/__tests__/listBuddyPosts.test.ts` | 契约 §8 同步 hydrate / 失败静默降级、三态、**缓存按板块分片（切板块不会串数据）**、游标续页与累积、快照引用稳定、摘要标签中文化 |
| `src/application/buddy/__tests__/buddyRecommendations.test.ts` | **`deriveReasons` 与 `explainMatch` 输出逐字一致**、客户端补齐理由并标注 `reasonSource: client`、服务端理由优先、**客户端不声称「同一个院系」/「共同兴趣」**、`reasonText` 前 3 条 + 「有潜在匹配」回落、`matchMode` 三档原样暴露、资料拉取失败不阻塞推荐、**标题理由永远优先用服务端原文（客户端推算不得覆盖排序依据）**、`serverReason` 语义、反馈带当前板块并重拉、反馈本地记忆 UPSERT |
| `src/application/buddy/__tests__/createBuddyPost.test.ts` | **`addTagByText` 拒绝自由文本**（三种写法）、`toggleTag` 同源校验、≤8 上限、标签表拉取失败**回落到封闭镜像**（不是清空、更不是自由输入）、`setSection` 派生 activity、离开 sport 清 `minSkillLevel`、未登录/校验失败不发请求、提交按 `+08:00` 转 UTC、幂等键复用与改动后变化、`reset` 保留标签表 |
| `src/application/buddy/__tests__/buddyProfile.test.ts` | 契约 §8 hydrate、资料存在/不存在、**可用时段能填（含去重、非法时段被丢弃）**、兴趣 ≤20 / 活动 ≤10 / 区域 ≤5、`bio` 清空为 `null`、匹配开关默认关闭、**撤回调用 `DELETE /buddy/profile` 并清缓存**、撤回失败不谎报成功 |
| `src/application/buddy/__tests__/buddyPostDetail.test.ts` | hydrate 含资格计算、`own-post` 判定、**申请列表可见性（非发起人 `FORBIDDEN` → 不可见而非页面错误）**、`join` 后重拉详情、幂等键与 (帖,人) 绑定、`decide` 传 `applicationId`+`decision`、`close` → `CLOSED`、**反馈用帖子的 `activity` 派生 section**、未加载帖子时拒绝反馈 |

> 测试替身集中在 `src/application/__tests__/testDoubles.ts`（文件名不含 `.test.ts`，
> 不会被 vitest 收集）。它刻意**不** import `data/` 下的实现，保持 `application` 层分层干净。

---

## 8. 已实现 / 未实现 / 已知问题

### ✅ 已实现

- Taro 4.3 + React 18 + TS 5.9 骨架，`weapp` 为主编译目标、`h5` 为次要目标
- 六边形分层目录（契约 §7）与依赖方向 lint 约束
- `app.config.ts`（页面注册 + tabBar 四页 + 品牌色导航栏）
- 契约 §8 启动时序（同步 hydrate → 立即渲染 → 后台刷新静默降级）
- 统一网络层：`/api/v1`、Bearer、`X-KedaYa-Trace`、`Idempotency-Key`、信封解包、401 刷新重试
- Taro 同步存储 adapter + 内存 adapter + 会话/token 存储
- mock adapter（确定性种子数据 + 内存数据库 + 三态控制面）
- 平台能力封装（订阅消息 / 扫码 / 分享 / 地图 / 导航），逐个注明微信特有与 H5 降级
- 拼单垂直切片：列表 + 详情 + 参团，三态齐全，默认 mock
- **论坛垂直切片**：版块 + 主题列表 / 详情 + 楼中楼回复 / 发帖（含匿名开关与隐私说明）/
  举报，下拉刷新 + 触底游标分页 + `onShareAppMessage`，治理规则真实生效
- **FAQ 垂直切片**：分类 + 搜索 + 手风琴 + 「有用」（幂等）+ 我的工单，三态齐全
- **野生动物（`wildlife`）垂直切片**：地图（区域圈 + 热点 + 观测标记 + 推断轨迹折线）/
  上报（选图压缩上传 + 定位或地图点选 + 发现时间 + 自动分类降级 + 手动选物种 + 个体命名）/
  推断轨迹（显著标注「不是实测路径」）；投喂规范与位置模糊化提示为**硬要求**；`app.config.ts`
  已声明 `permission.scope.userLocation` 与 `requiredPrivateInfos: [getLocation, chooseLocation]`
- 10 个复用组件：`KdyCard` / `KdyButton` / `KdyEmpty` / `KdyTag` / `KdySwitch` /
  `KdySearchBar` / `KdyAccordion` / `KdyField` / `KdyEthicsNotice` / `KdyPrivacyNotice`
  （全部取自设计令牌；地图叠加层色值走 `presentation/theme/mapColors.ts`，同样派生自 `tokens.json`）
- **找搭子（`buddy`）垂直切片**：三板块列表（游标分页 + 下拉刷新 + 触底加载）/ 详情
  （`join` 申请 / `leave` 撤回 / `decide` 审批 / `close` 关闭）/ 发布（**封闭标签表，无自由输入**）/
  我的匹配资料（**可用时段可填** —— F7 硬过滤的依据）/ 推荐（**展示 `explainMatch()` 的结构化理由**）；
  匹配反馈 like/dislike/skip；隐私提示在五页常驻；`dating` **不做**（契约 §11.10-G）
- 11 个复用组件（新增 `KdyBuddyPrivacyNotice`，buddy 的隐私提示与 wildlife 的
  `KdyPrivacyNotice` 分开 —— 两者的「哪些信息会公开」语义完全不同）
- 33 个 Vitest 测试文件 / 592 个测试（domain / 网络层 / mock 仓储 / http 仓储 / 用例 / 存储）

### ❌ 未实现（诚实清单）

- **统一身份认证**：契约 §5 第一级身份层（CAS / Egate OAuth → KedaYa JWT）未接入。
  「我的」页的登录是**明确标注的骨架占位**（`data/mock/mockAuth.ts` 伪造形状合法的 token）。
- **校园系统绑定**：契约 §5 第二级能力层（`CampusSessionPort`）未实现。
  `profile.campusBound` 目前是手工切换的占位开关。
- **敏感模块二次同意**：契约 §9 的同意流程与审计日志未实现（首页对这类模块只做标注 + 提示）。
- **站内信列表**（`notifications`）：只有订阅消息链路，站内信列表是空态。
- **其余 15 个业务模块**：契约 §4 已登记，端上未实现（首页明确显示「开发中」）。
- **`wildlife` 未实现的部分（诚实清单）**：
  - **修正 / 撤回自己的上报**（`PATCH` / `DELETE /wildlife/items/:id`）—— 契约端点已定义，端上未做入口；
  - **审核队列**（`POST /wildlife/items/:id/moderate`）—— 属管理端，端上不做；
  - **底图叠加（规格 §1.2 方案 B：静态校园平面图 + 仿射标定）** —— 未做，本实现用原生 `<map>`；
  - **`WildlifeSpot` 的小时分布直方图可视化**、区域多边形的敏感区判定 —— 未做；
  - **照片「已上传」列表的本地草稿持久化**（规格 §4.5「3 次全失败保留本地草稿」）—— 只在内存里保留，
    杀进程后丢失；
  - **`POST /media` 的 401 刷新重试** —— `mediaUpload.ts` 刻意不复用 `ApiClient` 的刷新去重
    （与 `HttpPort` 耦合），401 直接返回 `UNAUTHENTICATED`，由用例层提示重新登录；
  - **地图 key**：`<map>` 需要腾讯位置服务 key / 小程序绑定；未配置时地图空白，
    `onError` 会提示，其余功能不受影响。
- **论坛治理后台**：版主锁定 / 隐藏 / 申诉的**操作入口**未做（端上只消费治理结果）；
  主题/回复的删除、点赞、编辑也未做。
- **FAQ 内容运营侧**：文章的新增/编辑/归档（`AnswerTicket`）未做，端上只读。
- **`buddy` 未实现的部分（诚实清单）**：
  - **问卷**（`BuddyQuestionnaire` / `BuddyQuestionnaireResponse`，规格 §2.6）—— 端点
    `GET|POST /buddy/questionnaires*` 已定义，端上未做页面（本轮交付不含问卷）；
  - **我的申请列表页**（`GET /buddy/applications`）—— 未做独立页面；
    当前只在**详情页**展示「我对这条搭子的申请状态」（`BuddyPost.myApplication`）；
  - **`PATCH /buddy/items/:id`（JSON Merge Patch 编辑）** 与
    **`DELETE /buddy/items/:id`（转 `CANCELLED`）** —— 契约端点已定义，端上未做入口
    （发起人目前只能 `close` 到 `CLOSED`，不能取消到 `CANCELLED`）；
  - **内容安全（敏感词）**：只做了规格 §6.4 的**联系方式模式**前端预校验
    （手机号 / 微信 / QQ），敏感词依赖 M2 的共享内容安全能力（规格 U9），未接入；
  - **F5 性别准入的客户端预校验**：`BuddyProfile` **不采集性别**（规格 §6.3），
    客户端无法独立判定，因此 `canApplyToPost` 的 `genderCompatible` 缺省为 `true`，
    由服务端在 `join` 时返回 `FORBIDDEN` / `GENDER_PREFERENCE_MISMATCH`。
    **这是刻意的**，不是遗漏 —— 客户端只负责提前给出好文案；
  - **举报入口**：规格 §6.4 建议复用 `forum.report`，但那是针对 `forum` 内容的
    （规格 U11 未决），端上**未**提供 buddy 的举报入口；
  - **向量匹配（`vector` / `hash` 模式）**：mock 诚实返回 `matchMode: 'rule'`
    （无 embedding）；端上不实现向量推理，只消费服务端的 `matchMode` 与 `score`。
- **tabBar 图标**：未配置 `iconPath`（品牌图标未就位），当前只显示文字。
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

4. **契约缺口：`faq` 的 `VoteHelpful` 没有登记的领域动作名**（需 Lead 裁决，未擅自扩契约）。
   契约 §11.2 冻结了 `<action>` 名并要求「三端不得自创」，但登记表里 `faq` 没有任何 action。
   为了不自创动作名，本端把「有用」投票建模为**子资源集合的创建**：
   `POST /api/v1/faq/items/:id/votes`（body `{ value: 'helpful' }`），而不是
   `POST /api/v1/faq/items/:id/helpful`。子资源不受动作名冻结约束，且天然可承载
   `Idempotency-Key`。若 Lead 决定登记为 `faq.vote` 动作，只需改
   `data/repositories/httpFaqRepository.ts` 里的一行路径。
   另有两处**子资源**扩展同样未在契约中显式登记（非动作名，不违反 §11.2，但建议补进 OpenAPI）：
   `GET /api/v1/forum/boards`、`GET|POST /api/v1/forum/items/:id/replies`、
   `GET|POST /api/v1/faq/tickets`。

5. **tabBar 结构未改动**（任务硬性要求）：仍是最初的四个 tab
   （首页 / 发现 / 消息 / 我的）。论坛与 FAQ 从**首页宫格**与**「发现」页**进入。
   首页宫格原本是 `if (module.id === 'groupbuy')` 的硬编码分支，本次改为由
   `app/routes.ts` 的 `MODULE_ENTRY_PATHS` 表驱动（模块清单仍 100% 来自
   `@kedaya/contracts` 的 `MODULES`）。

6. **⚠️ 跨端 wire 形状不一致（M1 集成前必须由 Lead 裁决，本端未擅自跟随）**。
   本端（小程序）的 HTTP 映射与 **Web 端、Flutter 端、domain-model 文档一致**，
   但与 `services/api` 的**实现**存在差异。三端客户端彼此一致、后端单独偏离，
   因此这里保持契约侧写法并上报，而不是把后端的偏离抄进主端：

   | 项 | 本端 / Web / mobile / 文档 | `services/api` 实现 | 后果（真后端模式） |
   | --- | --- | --- | --- |
   | 主题列表筛选参数 | `boardId`、`keyword` | `board`、`q` | **静默返回未筛选结果**（后端忽略未知参数） |
   | FAQ 搜索参数 | `keyword` | `q` | 同上 |
   | 「有用」投票路径 | `POST /faq/items/:id/votes` | `POST /faq/items/:id/helpful` | 404 |
   | 举报理由取值 | `privacy`（domain-model §2.4） | `pii`（OpenAPI 与后端） | 后端**已兼容**旧值 `privacy`（`normalizeReportReason`），可正常受理 |
   | 主题状态取值 | `PUBLISHED` 等大写 | `published` 等小写 | 状态标签/`canReply` 判定错位 |
   | 举报回复 | `POST /forum/items/:replyId/report` + `targetType: 'REPLY'` | 只支持举报主题（无 `targetType`） | 举报回复会打到错误目标 |

   证据（真实文件行）：
   `services/api/src/modules/forum/forum.controller.ts:141-150`（`board`/`q`）、
   `services/api/src/modules/faq/faq.controller.ts:74-83`（`q`）、
   `services/api/src/modules/faq/faq.controller.ts:121`（`items/:id/helpful`）、
   `services/api/src/modules/forum/domain/forum.domain.ts:84`（小写状态）、
   `:169`（`pii`）、
   `packages/contracts/openapi/kedaya.v1.yaml:500-506`（契约侧 `boardId`）。
   **本端受影响文件只有两处**（若 Lead 裁决跟随后端，改这两处即可）：
   `data/repositories/httpForumRepository.ts`、`data/repositories/httpFaqRepository.ts`。
   默认 mock 模式下不受影响，页面与用例层无需改动。

7. **⚠️ `buddy` 的跨端一致性问题（M1 集成前必须由 Lead 裁决）**。
   本端实现时**实际读了并行的 `services/api` / `apps/web` buddy 实现**（它们在同一个
   worktree 里），据此校正了自己的 wire 假设。以下四项**都不是本端能单独修的**：

   **(a) 三端的封闭标签表互不相同 —— 这是最严重的一项。**
   | 端 | 位置 | key 数 | 与服务端差异 |
   | --- | --- | --- | --- |
   | **服务端（权威）** | `services/api/src/modules/buddy/domain/tags.ts:39` | **62** | — |
   | Web | `apps/web/src/domain/models/buddy.ts` 的 `BUDDY_TAG_TABLE` | 46（active 30，含 1 条 `isActive:false` 的 `esports-league`） | 服务端有 **39** 个它没有；它有 **23** 个服务端没有（`airport-ride` / `metro` / `dinner` / `lunch` / `stadium` / `lab` …） |
   | 小程序（本端） | `apps/miniapp/src/domain/models/buddy.ts` 的 `BUDDY_TAGS` | 62 | **已改为逐字镜像服务端，无差异** |

   服务端用 `assertKnownTags()` 以 `UNKNOWN_TAG:<key>` 拒收未登记 key
   （`application/buddy-validation.ts:29`）。因此 Web 端目前会提供**服务端不认**的标签 ——
   用户点一个看起来正常的标签，提交时被拒。
   **本端的处置**：把自拟的 37 项换成服务端 62 项的逐字副本（并加单测钉住规模与关键 key，
   同时断言初版那 7 个伪造 key 已清掉）。**Web 端需要同样的修正**，或反过来把
   Web 的标签补进服务端表 —— 但必须**只留一份**。

   **(b) 服务端没有 `GET /buddy/tags`。** 契约 §11.11 允许 `GET /<mod>/<collection>`，
   规格 §3.2 也说标签表"存在 DB（可运营）"，但 `buddy.controller.ts` 的路由表里没有它
   （只有 `profile` / `items` / `recommendations` / `applications` / `questionnaires`）。
   本端的处置：`listTags()` 失败时**回落到内置的封闭镜像**（不是清空、更不是自由输入）。
   建议服务端补这个端点，让"服务端封闭表"成为可运营的唯一真相。

   **(c) `/buddy/recommendations` 只回 `reason` 字符串，没有结构化理由。**
   `application/buddy-recommend.service.ts:185` 是
   `items.push({ post, score, reason })`。而规格 G3 要求可解释性、任务要求展示
   `explainMatch()` 的理由。本端的处置：标题用服务端原文（**排序依据**），
   结构化标签由客户端 `explainMatch()` 按**公开信息**推算，两者**分开标注**
   （`reason` / `reasons` / `reasonSource` / `serverReason`）。
   **早先版本在客户端能推算时用推算结果覆盖了服务端原文 —— 那会造出
   「解释与排序不一致」，已修正。** 建议 OpenAPI 增加 `reasons: MatchReason[]`。

   **(d) `@kedaya/shared` 的 `MatchTarget.tags` 字段未被读取。**
   `ruleScoreFor` / `explainMatch` 只读 `target.creator`（对方 `BuddyProfile`），
   `target.tags`（帖子自己的 `tags`）在实现里**没有任何引用**；
   但规格 §3.2 说「`BuddyPost.tags` 是**匹配打分的主特征**」。
   本端的处置：按规格 §3.4 的字面意思调用
   （`target = { creator: 发起人画像, tags: post.tags }`）—— 与**服务端
   `domain/matching.ts:127` 完全一致**（`{ creator: candidate.creator, tags: candidate.post.tags }`），
   因此两端行为一致，只是"帖子标签不参与打分"这件事本身与规格 §3.2 的措辞矛盾。
   建议 Lead 在 shared 里让两个函数读 `target.tags`，或删掉规格里那句话。
   **这是 shared 包的缺口，不是本端偏离。**

8. **`GET /buddy/items` 是否按 `status` 过滤，规格自相矛盾**（本端按 §5.3 实现）。
   §5.3 的 query 表**没有** `status` 参数（只按 `startsAfter` 过滤时间），
   而 §5.9 的分页示例里写了 `where: { status: 'OPEN', ... }`。
   本端（mock）按 §5.3 实现 —— **不**按 `status` 过滤，因此 `FULL` / `CLOSED`
   的活动仍会出现在列表里（用户需要知道「满了 / 关了」，而不是让它凭空消失）。
   若 Lead 裁定跟 §5.9，只需在 `data/mock/buddyMemoryDatabase.ts` 的 `visibleInList`
   加一个状态条件，并同步 `httpBuddyRepository` 的查询参数。

9. **`build:weapp` 出现两条 webpack 性能警告（非错误，构建 exit 0）**：
   `AssetsOverSizeLimitWarning: common.js (252 KiB) > 244 KiB` 与 `NoAsyncChunksWarning`。
   **实测确认这两条是本切片引入的**：把 `app.config.ts` 里的 5 个 buddy 页面注册临时去掉后
   重新构建，`dist/common.js` 为 **249839 字节**（恰好卡在 244 KiB = 249856 字节阈值下方，
   无警告）；加回后为 **256246 字节**（首版）/ **257897 字节**（修正标签表后），触发警告。
   即：**基线本来就贴着阈值**，任何新模块都会踩到。这属于仓库级的性能预算问题，
   不在本端作用域内解决（建议 Lead 调整 `config/index.ts` 的 `performance` 阈值，
   或对 buddy 页面做分包）。

---

## 9. 自检证据

真实命令输出粘贴在**交付说明**里（task-3 为骨架阶段、task-8 为 forum + faq 阶段），
本 README 不复制输出，避免与真实结果脱节。

task-8（forum + faq）验证过的命令：

```bash
export PATH="/opt/homebrew/bin:$PATH"
./scripts/with-npm-lock.sh npm install        # exit 0
npm run typecheck -w @kedaya/miniapp          # exit 0
npm run test      -w @kedaya/miniapp          # 18 files / 263 tests passed
npm run lint      -w @kedaya/miniapp          # exit 0
npm run build:weapp -w @kedaya/miniapp        # exit 0（Compiled successfully）
npm run typecheck                             # 仓库级 turbo：7 successful, 7 total
```

task-11（`wildlife`）验证过的命令 —— **真实输出见交付说明**：

```bash
export PATH="/opt/homebrew/bin:$PATH"
./scripts/with-npm-lock.sh npm install        # exit 0（仅 npm warn install-scripts，无 error）
npm run typecheck -w @kedaya/miniapp          # exit 0（无输出 = 无类型错误）
npm run test      -w @kedaya/miniapp          # 25 files / 382 tests passed（基线 18/263，+7 文件 / +119 测试）
npm run lint      -w @kedaya/miniapp          # exit 0（0 problems）
npm run build:weapp -w @kedaya/miniapp        # exit 0（Compiled successfully in 3.66s）
```

构建产物抽查（真实命令输出）：

```
apps/miniapp/dist/assets/wildlife/{marker-spot,marker-sighting,marker-sensitive,marker-track}.png
apps/miniapp/dist/presentation/pages/wildlife/{map,report,tracks}/{index.js,index.json,index.wxml,index.wxss}
dist/app.json → permission.scope.userLocation.desc 已声明；
                requiredPrivateInfos = ["getLocation","chooseLocation"]；
                tabBar.list 仍是 4 项（首页/发现/消息/我的），结构未改动
```

task-12（`buddy` 找搭子）验证过的命令 —— **真实输出见交付说明**：

```bash
export PATH="/opt/homebrew/bin:$PATH"
./scripts/with-npm-lock.sh npm install        # exit 0（仅 npm warn install-scripts，无 error）
npm run typecheck -w @kedaya/miniapp          # exit 0（无输出 = 无类型错误）
npm run test      -w @kedaya/miniapp          # 33 files / 592 tests passed（基线 25/382，+8 文件 / +210 测试）
npm run lint      -w @kedaya/miniapp          # exit 0（0 problems）
npm run build:weapp -w @kedaya/miniapp        # exit 0（Compiled successfully in 3.88s；2 条性能警告见 §8.9）
```

构建产物抽查（真实命令输出）：

```
apps/miniapp/dist/presentation/pages/buddy/{list,detail,create,profile,recommendations}/{index.js,index.json,index.wxml,index.wxss}
dist/app.json → pages 共 20 条，其中 5 条是 buddy；
                tabBar.list 仍是 4 项（首页/发现/消息/我的），**结构未改动**；
                requiredPrivateInfos 仍是 ["getLocation","chooseLocation"]（buddy 不需要定位）
dist/common.js = 257897 字节（基线 249839 字节 → +8058；见 §8.9 的性能警告）
```
