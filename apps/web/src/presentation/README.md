# presentation —— UI 层

契约 §7：`presentation → application → domain`。**禁止直接发网络请求**（必须经过 `data/api`）。

```
presentation/
├── components/        # 通用组件 + 各 feature 组件
│   ├── KdyCard.tsx    KdyButton.tsx  KdyBadge.tsx  KdyEmpty.tsx
│   ├── KdySkeleton.tsx  KdyAlert.tsx  ModuleGrid.tsx  PageHeader.tsx
│   ├── SiteHeader.tsx  SiteFooter.tsx  UnofficialNotice.tsx  icons.ts
│   ├── groupbuy/      # 垂直切片：列表（三态 + 游标分页）/ 详情（+ 参团 mutation）
│   └── admin/         # 后台：模块开关表 / 审计日志表 / 概览
├── theme/             # cn()（clsx + tailwind-merge）、ThemeProvider、ThemeToggle
└── query/             # TanStack Query key 工厂、Result → throw 桥接
```

## 样式约定

- 一律使用 design-tokens 派生的工具类：`bg-brand`、`text-ink`、`text-muted`、`border-border`、
  `bg-surface-alt`、`rounded-lg`、`rounded-pill`、`shadow-md`、`text-xxl`。
- **不得出现手写色值**（`#fff`、`rgb(...)`、`text-[#333]` 等一律禁止）。
- 只有"无法用工具类表达"的渐变/内阴影写在 `globals.css` 的 `@layer components` 里，
  且色值仍取自 `--color-*`（即 `--kdy-*`）。

## 三态约定

列表与详情必须显式处理 **loading / error / empty / success**：
`KdyCardSkeleton`（loading）→ `KdyAlert tone="danger"` + 重试（error）→ `KdyEmpty`（empty）。
错误文案统一由 `asApiError()` / `errorMessage()` 从契约 `ApiError` 取，不再各写一套。
