# 小程序开发规范

本文件适用于 `apps/miniapp/` 全部代码。新增页面和修改现有页面必须遵守。

- UI 基础组件统一使用 **Taroify**（`@taroify/core`），图标使用 `@taroify/icons`。不得引入第二套 UI 库。
- 优先复用 `src/presentation/components/` 的 Kdy 封装；按钮、标签、加载、空态、表单、弹层、进度等标准交互使用 Taroify，不得另写一套基础控件。Taro 的 View/Text 用于布局与文字，原生平台能力可按需适配。
- 视觉为「可达鸭黄 + 暖白背景 + 深色文字」，卡片圆角 22px、主视觉容器 28px，
  尺寸/效果档位来自 `presentation/theme/tokens.scss` 的派生层。
  黄色用于主操作与选中状态（选中的 `KdyChip` 是**品牌渐变实心**，不是浅黄描边；
  深浅差别在一屏十几个胶囊里分不出来）；正文保持高对比，不使用黄色小字。
  品牌渐变只用于 Hero / 主按钮 / 选中胶囊 / 悬浮球 / 宫格图标底 / 校园卡余额块
  （`$kdy-gradient-brand`，两端都是令牌色），渐变面上**一律深色文字**
  （黄底白字在阳光下看不清），压在渐变上的状态用玻璃胶囊 `.kdy-pill`，
  深色胶囊 `.kdy-pill--dark` 只放状态不放操作；
  宫格图标的"分类色"按用途映射（`KdyModuleIcon` 的 `MODULE_TONES`，六档 tone），
  不是彩虹；层次靠阴影叠层而不是厚重单层阴影；emoji 只允许用于吉祥物，
  不充当功能图标。
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
- `src/assets/` **只放被代码引用的资源**：`assets/tabs/*.png` 是 tabBar 图标（必须在主包），`assets/wildlife/marker-{spot,sighting,sensitive,track}.png` 由 `presentation/theme/mapColors.ts` 的 `MAP_MARKER_ICONS` 引用，`assets/mascot/duck.png` 是吉祥物贴图、由 `presentation/theme/mascot.ts` 的 `DUCK_MASCOT_SRC` 引用（经 `KdyMascot` 用在 agent 页 / 悬浮球 / 登录注册卡 / 头像兜底）。**不要提交没人引用的图片** —— 微信**主包上限 2 MiB**，一份 1 MB 的底图就能把主包顶穿、导致无法上传。`verify:weapp` 会守住主包体积、全部分包页面齐全、构建指纹（`// kedaya-build:<hash>`，由 `config/coherent-build.ts` 注入）一致。

详细设计规范见仓库 `docs/miniapp-ui.md`。
