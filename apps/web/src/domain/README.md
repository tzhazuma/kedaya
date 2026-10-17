# domain —— 纯领域层

契约 §7：**零框架、零 IO 依赖**。本目录只允许 import：

- `@kedaya/contracts`（纯类型 + 常量：模块表、错误码、分页）
- `@kedaya/shared`（纯函数：Result、金额、时间）

**禁止** import React / Next / fetch / `@/data/*` / `@/presentation/*`。

## 结构

| 文件 | 内容 |
| --- | --- |
| `models/module.ts` | 门户模块模型 + 注册表自检 `validateModuleRegistry`（纯函数） |
| `models/modules.ts` | **18 个一级入口**（`PORTAL_MODULES`），首页宫格唯一数据源；找搭子归入凑凑 |
| `models/groupbuy.ts` | 拼单模型 + 状态机 + 名额/进度/折扣纯函数 |
| `models/audit.ts` | 审计记录 + 模块开关模型 + 权限判定纯函数 |
| `ports/groupbuy.ts` | `GroupBuyRepository`（list / detail / join） |
| `ports/audit.ts` | `AuditLogRepository`、`ModuleSwitchRepository` |

## 为什么模块表在 domain

契约 §4 说「禁止在各端硬编码模块清单」。把 `MODULES`（契约）→ `PORTAL_MODULES`（装饰后）
的映射放在 domain，好处是：宫格渲染、模块占位页、管理后台开关表
**三处共用同一份数据**，且可以在 node 环境用 Vitest 直接断言（无需 jsdom）。
