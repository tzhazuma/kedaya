# ADR 0007 · 小程序全线 UI 统一到「校园贴纸簿」

| 项 | 值 |
| --- | --- |
| 状态 | **已接受 (Accepted)**，第二阶段（深色模式）待续 |
| 日期 | 2026-10-18 |
| 决策者 | Lead |
| 影响范围 | `apps/miniapp/src/app.scss`、`apps/miniapp/src/presentation/theme/**`、`apps/miniapp/src/presentation/components/**`、`apps/miniapp/src/presentation/pages/**`、`apps/miniapp/src/custom-tab-bar/**`、`packages/design-tokens/tokens.json`、`docs/miniapp-ui.md`、`apps/miniapp/AGENTS.md` |
| 相关 | [design.md](../design/campus-play/design.md)、[0005-brand-and-ip.md](./0005-brand-and-ip.md)、`apps/miniapp/AGENTS.md` |

> **本文档回答一个问题：小程序的"长相"以谁为准、哪些是硬约束、哪些还没做完。**
> 需求（用户原话）：*「要求都按远程最新的分支的那个 UI 风格完整的修复……要求是统一 UI，
> 即所有的 UI 控件都是按照这个」*、*「整个系统的架构都是使用 pingdan 的那个分支的 UI」*。

---

## 1. 背景

`feature/pingdan`（`4dac7c6 更新UI`）把小程序做成了「校园贴纸簿」：真白底 + 墨蓝黑字 +
鸭黄实心主按钮 + 淡粉/淡绿功能卡 + 手绘胶囊导航，设计稿在
`docs/design/campus-play/{design.md,home-concept.png,welcome-concept.png,nav-reference.png}`。

它与当时的 `main` 是**两条平行演化的线**：`main` 已经按「可达鸭黄 + 暖白 + 玻璃拟态」
铺了 20 个契约模块的 107 个 scss 文件，pingdan 只覆盖了少数页面，
但**整体架构不同**（750rpx 基准、CSS 变量主题层、无原生 tabBar）。

## 2. 决策

| # | 决策 | 状态 |
| --- | --- | --- |
| D1 | 视觉语言**全站统一**到校园贴纸簿；`docs/miniapp-ui.md` 与 `apps/miniapp/AGENTS.md` 同步改写（它们是"唯一真相"） | 已落地 |
| D2 | **不做整体 merge**：`feature/pingdan` 基于旧基底，整体合并会删掉约 29 万行（main 的 20 个模块）。改为**逐层移植**：设计稿 → 令牌 → 派生层 → 组件 → 页面 → 外壳 | 已落地 |
| D3 | 取色进 `packages/design-tokens/tokens.json` 的**新分组** `colorCampus` / `colorNight`（色相是跨端可复用的），圆角 / 阴影 / 淡色面等**各端视觉语言**留在小程序派生层 | 已落地 |
| D4 | **基准宽度保持 375pt**（不动 `designWidth`）。搬运设计稿（750rpx）的数字**一律除以 2** | 已落地 |
| D5 | 圆角收敛为三档 20 / 24 / pill；卡与页面**都是白的**，靠 1px 校园描边分层，不用灰底、不用玻璃底 | 已落地 |
| D6 | 淡色面四档（`$kdy-tone-pink/mint/yellow/milk`）**只用于功能卡**，面上只用墨色字；正文区永远白底 | 已落地 |
| D7 | 底部导航换成**自绘手绘胶囊 dock**（`KdyDock`），经微信 `tabBar.custom: true` + `src/custom-tab-bar/` 挂在四个 tab 页；非 tab 页显式挂载。`tabBar.list` 完整保留（决定 tab 页集合，`switchTab` 与消息红点下标不变） | 已落地 |
| D8 | 新增**入口页** `PAGE_PATHS.welcome` 作为 `pages[0]`，首页左上角「返回入口」互跳 | 已落地 |
| D9 | 「消息」**不占 dock 格子**（第六格会挤掉中间的凸起按钮），但仍是 tabBar 页，入口留在「我的」 | 已落地 |
| D10 | **深色模式第二阶段**：`colorNight` 令牌与 `CampusThemeToggle` 已备好，但页面/组件 scss 里大量 `rgba($kdy-*, x)` / `color.mix()`（Sass 函数不吃 `var()`），必须先做**全站 CSS 变量化**才能接上。在此之前**不把主题开关接到界面上** | 待续 |

## 3. 已知边界（诚实标注）

- **深色模式未实现**：不做"半套深色"（比没有更糟）。`assets/campus/{sun,moon}.svg`、
  `CampusThemeToggle`、`KdyDock` 的 `--dark` 分支等是为它预留的。
- **未接入的贴纸簿素材**：`module-*.svg`（17 个模块线稿图标）、
  `nav-{home,discover,messages,profile}.svg`。宫格图标当前走
  `KdyModuleIcon` + Taroify 字形（全站统一优先）；要换成线稿必须**一次性**替换，
  不能某一页单独用一套（同名模块两种图标 = 更不统一）。
- **自定义 tabBar 的观感需真机确认**：`custom: true` 下微信不画原生 tabBar，
  `KdyDock` 是 `position: fixed` 的浮动胶囊；页面底部留白用 `.kdy-page--dock`。
  真机 / 开发者工具需确认 dock 与安全区、`KdyAgentFab`（已抬到 dock 上方）不打架。
- **H5 预览不能替代真机**（AGENTS.md 既有约定）。

## 4. 后果

- 好处：一屏之内"白底 + 鸭黄主操作 + 淡色功能卡"是同一套语言，107 个页面共享派生层，
  改色只改令牌；新增页面照抄 `.kdy-head` / `.kdy-tone--*` / `KdyDock` 即可。
- 代价：① 底部导航从"系统 tabBar"变成"自绘组件"，**必须自己处理安全区与遮挡**
  （已在 `KdyDock`、`.kdy-page--dock`、`KdyAgentFab` 三处处理）；
  ② 深色模式被推迟到第二阶段，期间 `colorNight` 是"备而不用"的令牌；
  ③ 页面 scss 里的字面色值需要在第二阶段清理（本次只收口到令牌层）。
- 回滚：本次改动集中在样式与外壳（`app.scss` / `theme/` / `components/*.scss` /
  `pages/*/index.scss` / `custom-tab-bar/`），
  需要退回旧观感时把 `tokens.scss` 的派生层与 `app.scss` 还原即可（令牌分组是加法，不影响 Web）。
