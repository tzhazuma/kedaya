# 小程序开发规范

本文件适用于 `apps/miniapp/` 全部代码。新增页面和修改现有页面必须遵守。

- UI 基础组件统一使用 **Taroify**（`@taroify/core`），图标使用 `@taroify/icons`。不得引入第二套 UI 库。
- 优先复用 `src/presentation/components/` 的 Kdy 封装；按钮、标签、加载、空态、表单、弹层、进度等标准交互使用 Taroify，不得另写一套基础控件。Taro 的 View/Text 用于布局与文字，原生平台能力可按需适配。
- 视觉固定为「可达鸭黄 + 暖白背景 + 深色文字 + 简约扁平卡片」。黄色用于主操作与选中状态；正文保持高对比，不使用黄色小字。禁止大面积渐变、厚重阴影、彩虹图标和 emoji 充当功能图标。
- 色值只来自 `packages/design-tokens/tokens.json`。小程序主题映射放在 `src/presentation/theme/`，不要修改生成的 SCSS；不要为小程序改动 Web 的公共主题。
- 设计稿基准宽度为 **375 CSS px**。间距使用 4px 栅格和 `$kdy-space-*`，正文 14–16px、辅助文案至少 12px，按钮触摸区域至少 44px。
- 磨砂效果只用于少量重点区域；必须先有足够不透明、可读的背景作为降级。禁止在长列表或多层容器叠加 blur。
- 页面包含清晰标题与说明，列表保留 loading / empty / error / retry，禁用与加载态必须可辨认。底部操作区处理安全区，长标题、长金额和窄屏不得溢出。
- 模块来源仍为 `@kedaya/contracts`，不得重复维护模块清单。未实现能力明确告知，Mock 操作放在折叠的演示工具中。保留非官方声明和敏感模块同意要求。
- 分层：`domain` 与 `application` 禁止 import `data/**` 或 `@tarojs/*`（ESLint 强制），平台能力一律经 `src/platform/**`。数据层错误类型用 `domain/ports/errors.ts` 的 `RepositoryError`。
- 列表 / 详情的状态机复用 `application/common/{listUseCase,detailUseCase}.ts`（`hydrate()` 出缓存 → `load()` 后台刷新 → 失败静默降级），页面不要自己写 loading 布尔值。
- 表单只用 `KdyField`，筛选与单选只用 `KdyChip`；业务模块统一「列表 → 发布 → 详情」三页结构，悬浮操作区必须叠加 `env(safe-area-inset-bottom)`。
- 样式里禁止 WXSS 不支持的选择器：`.a > :first-child` / `>` + `*` / 裸 `*`（会让 `common.wxss` 编译失败、全部页面白屏）。图标字体已在 `src/presentation/theme/icon-font.scss` 里 base64 内联，入口由 `config/index.ts` 的 alias 接管，不要改回 `//at.alicdn.com` 网络字体。`src/presentation/theme/__tests__/wxss-safety.test.ts` 会守住这些约束。
- 新增页面必须同步 `src/app/routes.ts`、`src/app.config.ts` 与首页的模块入口映射。
- 修改后执行 `npm run typecheck -w @kedaya/miniapp`、`npm run test -w @kedaya/miniapp`、`npm run build:weapp`；涉及视觉需在微信开发者工具检查，H5 预览不能替代真机验证。

详细设计规范见仓库 `docs/miniapp-ui.md`。
