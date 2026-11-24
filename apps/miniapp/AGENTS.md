# 小程序开发规范

本文件适用于 `apps/miniapp/` 全部代码。新增页面和修改现有页面必须遵守。

- UI 基础组件统一使用 **Taroify**（`@taroify/core`），图标使用 `@taroify/icons`。不得引入第二套 UI 库。
- 优先复用 `src/presentation/components/` 的 Kdy 封装；按钮、标签、加载、空态、表单、弹层、进度等标准交互使用 Taroify，不得另写一套基础控件。Taro 的 View/Text 用于布局与文字，原生平台能力可按需适配。
- 视觉为「**校园贴纸簿**」（来自 `feature/pingdan` 的统一 UI，规格见
  `docs/design/campus-play/design.md`）：**真白底**（`$kdy-color-campus-white`）+
  墨蓝黑字（`$kdy-color-campus-ink`）+ 鸭黄主操作（`$kdy-color-campus-yellow` /
  `$kdy-gradient-brand`）+ 淡粉/淡绿功能卡（`$kdy-tone-pink` / `$kdy-tone-mint`）+
  手绘胶囊导航（`KdyDock`）。取色来自 `packages/design-tokens/tokens.json` 的
  `colorCampus` 分组；尺寸/材料档位来自 `presentation/theme/tokens.scss` 的派生层。
  三条硬规矩：
  1. **卡与页面都是白的**，靠 1px 校园描边（`$kdy-tone-border`）+ 极淡投影
     （`$kdy-shadow-card`）分开 —— 不要用灰底 / 半透明玻璃"制造层次"
     （白底上的半透明白只会发灰）；
  2. **一整块淡色面只用于功能卡**（淡粉＝社交/一起做事、淡绿＝校园自然、
     淡黄＝主操作、奶白＝中性），面上**只用墨色字**；正文区永远白底，
     正文不用黄字 / 彩色小字；淡色档位是全局类 `.kdy-tone--pink|--mint|--yellow|--milk`，
     不要在页面里手写色面；
  3. 圆角只有三档：卡片 `$kdy-radius-2xl`(20px) / 主视觉容器 `$kdy-radius-3xl`(24px) /
     胶囊 `$kdy-radius-pill`；不要再写 48px/60px 这类手写圆角。
  主按钮是**实心鸭黄 + 墨字**（黄底白字在阳光下看不清）；选中的 `KdyChip` 是
  **鸭黄实心**而不是浅黄描边（一屏十几个胶囊时深浅差别看不出来）；
  宫格图标是"淡色贴纸 + 墨色字形"（`KdyModuleIcon` 的 `MODULE_TONES` 六档 tone，
  不是彩虹）；emoji 既不充当功能图标、也不充当吉祥物（吉祥物是固定贴图
  `assets/mascot/duck.png` 经 `KdyMascot`，贴纸簿的大标题立绘是
  `assets/campus/duck.png` 经 `CampusChrome` —— emoji 在不同微信版本 / 机型上
  渲染成各家字形，颜色与形状都不可控）。
- 大标题只出现在页头：`.kdy-head__title`（主页面的问句标题，34–40px）或
  `CampusChrome` 的 `.campus-title`（入口页 / 首页的贴纸簿大标题）。
  卡片里不要再出现同尺寸标题，否则一屏就没有主次。
- 底部导航有**两种挂载方式，不要重复挂**：四个主页面（首页 / 发现 / 消息 / 我的）
  走微信自定义 tabBar（`app.config.ts` 的 `tabBar.custom: true` + `src/custom-tab-bar/`
  → `KdyDock`），tab 页里**不要**再写 `<KdyDock />`；入口页等非 tab 页面显式写
  `<KdyDock active=... />` 并给内容加 `.kdy-page--dock`（底部留出 dock 的高度）。
  `tabBar.list` 仍然要完整声明（它决定"哪些页面是 tab 页"，`wx.switchTab` 只认这些）。
- ⚠️ `presentation/theme/tokens.scss` 被 `config/index.ts` 的 `sass.resource`
  **注入到每一个 scss 文件的最前面**（包括 `node_modules` 里的 Taroify 样式），
  所以它里面**只能有变量与注释**：一旦出现 `@mixin` / `@each` 等 at-rule，
  Taroify 自己的 `@forward` 就会报「must be written before any other rules」，
  整个构建挂掉（踩过一次）。需要 mixin 就放到组件 / 页面自己的 scss 里。
- 表单控件（`KdyField`）是"浅底实心面 + 16px 圆角"，出错才出现危险色描边；
  输入框不要退回"白底 + 灰细线"的老写法。
- 色值只来自 `packages/design-tokens/tokens.json`。小程序主题映射放在 `src/presentation/theme/`，不要修改生成的 SCSS；不要为小程序改动 Web 的公共主题。
- 设计稿基准宽度为 **375 CSS px**。间距使用 4px 栅格和 `$kdy-space-*`，正文 14–16px、辅助文案至少 12px，按钮触摸区域至少 44px。
- 磨砂效果只用于少量重点区域（agent 页的 sticky 头部、输入区与悬浮球、`elevated` 的主视觉卡）；必须先有足够不透明、可读的背景作为降级。禁止在长列表或多层容器叠加 blur。
- 页面包含清晰标题与说明，列表保留 loading / empty / error / retry，禁用与加载态必须可辨认。底部操作区处理安全区，长标题、长金额和窄屏不得溢出。
- 模块来源仍为 `@kedaya/contracts`，不得重复维护模块清单。未实现能力明确告知，Mock 操作放在折叠的演示工具中。保留非官方声明和敏感模块同意要求。
- 分层：`domain` 与 `application` 禁止 import `data/**` 或 `@tarojs/*`（ESLint 强制），平台能力一律经 `src/platform/**`。数据层错误类型用 `domain/ports/errors.ts` 的 `RepositoryError`。
- 列表 / 详情的状态机复用 `application/common/{listUseCase,detailUseCase}.ts`（`hydrate()` 出缓存 → `load()` 后台刷新 → 失败静默降级），页面不要自己写 loading 布尔值。
- 表单只用 `KdyField`，筛选与单选只用 `KdyChip`；业务模块统一「列表 → 发布 → 详情」三页结构，悬浮操作区必须叠加 `env(safe-area-inset-bottom)`。
- 样式里禁止 WXSS 不支持的选择器：`.a > :first-child` / `>` + `*` / 裸 `*`（会让 `common.wxss` 编译失败、全部页面白屏）。图标字体已在 `src/presentation/theme/icon-font.scss` 里 base64 内联，入口由 `config/index.ts` 的 alias 接管，不要改回 `//at.alicdn.com` 网络字体。`src/presentation/theme/__tests__/wxss-safety.test.ts` 会守住这些约束。
- 新增页面必须同步 `src/app/routes.ts`、`src/app.config.ts` 与首页的模块入口映射。
- 修改后执行 `npm run typecheck -w @kedaya/miniapp`、`npm run test -w @kedaya/miniapp`、`npm run build:weapp`、`npm run verify:weapp -w @kedaya/miniapp`；涉及视觉需在微信开发者工具检查，H5 预览不能替代真机验证。
- `src/assets/` **只放被代码引用的资源**：`assets/tabs/*.png` 是 tabBar 图标（必须在主包），`assets/wildlife/marker-{spot,sighting,sensitive,track}.png` 由 `presentation/theme/mapColors.ts` 的 `MAP_MARKER_ICONS` 引用，`assets/mascot/duck.png` 是吉祥物贴图、由 `presentation/theme/mascot.ts` 的 `DUCK_MASCOT_SRC` 引用（经 `KdyMascot` 用在 agent 页 / 悬浮球 / 登录注册卡 / 头像兜底），`assets/campus/*` 是贴纸簿素材：`dock-sketch-frame.svg` + `sketch-{home,map,create,discover,profile}.svg` 归 `KdyDock`（**必须在主包**，tab 页都要画它），`duck.png` / `arrow.svg` 归 `CampusChrome`，`bag.png` / `paw.png` 归 `KdyFeatureArtwork`，`map-preview.webp` 归首页的校园地图卡。**不要提交没人引用的图片** —— 微信**主包上限 2 MiB**，一份 1 MB 的底图就能把主包顶穿、导致无法上传。`verify:weapp` 会守住主包体积、全部分包页面齐全、构建指纹（`// kedaya-build:<hash>`，由 `config/coherent-build.ts` 注入）一致。⚠️ 目前**还没接入**的贴纸簿素材（沿用 main 早期从 pingdan 抽取时的状态，别以为是活的）：`module-*.svg`（17 个模块的线稿图标 —— 宫格现在走 `KdyModuleIcon` + Taroify 字形，全站统一优先）、`nav-{home,discover,messages,profile}.svg`、`{sun,moon}.svg`（深色模式未落地）。要用它们就**一次性**替换掉对应的通用实现，不要在某一页单独用一套、造成同名模块两种图标。
- 1 MB 级资源必须放**分包**：校园底图 `presentation/pages/wildlife/assets/campus.jpg`（`KdyCampusMap` 用，三个使用页同在该分包；`config/index.ts` 有对应 copy 规则，`verify:weapp` 会断言它存在且 wildlife 分包 ≤ 2 MiB）。溯源、署名与坐标链路见 `docs/features/miniapp-campus-map.md`。
- 食堂分类白名单（`CANTEEN_NAMES`）是**跨端单一真相**，在 `@kedaya/shared/src/nutrition.ts`：菜品的筛选 / 录入只从它取值，不要再在页面里写一份（名字漂移的表现是「筛选点下去是空列表」）。

详细设计规范见仓库 `docs/miniapp-ui.md`。

## 后续阶段（尚未完成，别当成已完成）

- **深色模式**：`assets/campus/{sun,moon}.svg` 与 `CampusThemeToggle`（`CampusChrome`）
  已经备好，`tokens.json` 的 `colorNight` 分组也已进生成物，但小程序端**还没有**
  CSS 变量主题层 —— 页面 / 组件 scss 里大量使用 `rgba($kdy-*, x)` / `color.mix()`
  （Sass 函数不接受 `var()`），要落地深色模式必须先把这些字面量迁到 `var(--kdy-*)`。
  在那之前**不要**把主题开关接到页面上（半套深色比没有更糟）。
- 贴纸簿素材与组件都在主包（`KdyDock` / `CampusChrome` / `KdyFeatureArtwork` /
  `assets/campus/*`），主包体积由 `verify:weapp` 守着；后续再加 1 MB 级素材必须放分包。

## 校园活动（activities，独立域）

活动**不并入课程 DDL**（`deadlines` 是作业截止，活动有自己的来源、状态机与提醒）。
本轮新增一个独立分包 `presentation/pages/activities/`，共五页：

| 页面 | 路径 | 作用 |
| ---------- | ----------------- | -------------------------------------- |
| 列表 | `list/index` | 待确认 / 今天 / 本周 / 全部 + 来源筛选 |
| 详情 | `detail/index` | 确认加入日程、忽略、设提醒、复制链接 |
| 公众号导入 | `import/index` | 用户主动粘贴**单篇**链接或正文 |
| 历史页导入 | `history/index` | 解析用户**保存下来的**「查看历史消息」页，勾选后逐篇导入；默认只勾主条 |
| 校园邮箱 | `mail/index` | 绑定 / 同步 / 把邮件事件提升为候选活动 |
| 提醒 | `reminders/index` | 站内信提醒的待发送 / 已结束状态 |

硬约束（改这一域前先读）：

- 类型在 `domain/models/activity.ts`：来源只有 `campus-mail` / `wechat-mp` / `manual`，
  状态只有 `candidate` / `confirmed` / `dismissed` / `archived`；提醒 kind 只有
  `registration` / `start` / `custom`，channel 只有 `inapp` / `wechat-subscribe`。
- **candidate 必须用户确认后才加入日程 / 建提醒**。默认提醒由**服务端**在
  `confirm` 时按「报名截止前 24h、开始前 1h」创建；目标已过不建，
  计算时刻已过但目标未来用 `now + 5min`。客户端只读取提醒、不重复创建。
- 真实 wire 契约：公众号导入请求字段是 `url`（响应 `{item, created}`），
  历史页解析是 `POST /wechat/profile-list`（请求 `{html}`，响应
  `{ok, accountName?, biz?, items:[{title,url,publishedAt,digest?,coverUrl?,isHeadline}]}`；
  失败也用 200 + `{ok:false,code,message}`），
  邮件提升是 `{eventIds: []}`（响应 `{items, created, skipped}`）；
  契约没有「按活动查提醒」端点，详情页拉 `GET /activities/reminders` 后按
  `activityId` 过滤。
- 默认仍建站内信；微信订阅消息需要真实模板 ID 与已绑定微信身份。用户在消息页主动授权后，
  小程序只回传 `templateId` 到 `/notifications/push/wechat-subscriptions`，openid 由服务端从绑定身份读取；
  一次性授权成功后耗尽，占位模板不会被画成可用渠道。管理员派发端点存在，但用户页不暴露。
- 时间存 UTC ISO，展示显式 `Asia/Shanghai`；只有日期没有时刻的原文留在
  `registrationDeadlineRaw`，**不补 23:59**。
- 只存活动字段与 ≤200 字证据片段；邮件正文 / 附件 / 公众号全文不进入小程序。
- 单篇公众号仍只做用户主动链接或正文；**历史页导入（`history/index`）只解析用户自己保存的页面**
  （`POST /wechat/profile-list`，入参是 HTML 原文，服务端不发任何网络请求）；
  自动同步仅走学校/学院认证服务号授权的
  `freepublish/batchget`，按用户订阅运行，不使用私有 Cookie、反检测或绕过验证；
  链接只复制，不用 `web-view`。历史页导入同样**不抓取**：它处理的每一篇用户都已经在微信里看得见。
- 邮箱复用现成 `/mail` 端点（`POST/DELETE /mail/account`、`POST /mail/sync`、
  `GET /mail/events`）：只读 IMAP、AES-256-GCM 服务端加密、`*.shanghaitech.edu.cn`
  IMAP 白名单。密码表单提交后立即清空，绑定/同步失败不显示假成功。
- 活动入口登记在 `domain/models/homeEntries.ts`（服务大厅「校园日常」，不进默认首页）；
  `@kedaya/contracts` 已有 `activities` 模块，`MODULE_ENTRY_PATHS.activities`
  指向列表页。`APP_ENTRIES` 的 `moduleIds` 仍按契约是否存在自适应，
  避免契约回退时目录双向一致性测试变红。
- 单测：`domain/models/__tests__/activity.test.ts`、`mailActivity.test.ts`、
  `application/activities/__tests__/activityUseCases.test.ts`、
  `data/repositories/__tests__/httpActivityRepository.test.ts`、
  `data/repositories/__tests__/mockActivityRepository.test.ts`、
  `presentation/pages/activities/__tests__/activityPages.test.ts`。
