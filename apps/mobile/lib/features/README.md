# `lib/features/` 约定（冻结契约 §7 硬规则 2）

> **每个 feature 一个目录，自带 README，写清该模块的 ports 与用例。**

## 为什么有这一层

顶层分层（`app/ application/ domain/ data/ platform/ presentation/`）解决的是
**依赖方向**问题：`presentation → application → domain ← data`。

但业务模块有 19 个（契约 §4），把它们全部塞进顶层 `presentation/pages/` 会得到一个
几百文件的平铺目录，模块之间也无法独立演进。因此：

- **跨模块共享**的东西放顶层：`domain/ports/`（端口）、`domain/models/`（模型）、
  `data/repositories/`（适配器）、`data/mock/`（mock）、`presentation/theme/`（主题）、
  `presentation/components/`（无业务语义的通用组件）。
- **只属于一个模块**的东西放 `lib/features/<module-id>/`，内部**沿用同一套子目录名**：

```
lib/features/<module-id>/
├── README.md            # 必填：该模块的 ports 与用例清单
├── application/         # 该模块的 controller / usecase（编排，不含 IO）
├── presentation/
│   ├── pages/           # 页面
│   └── components/      # 只在本模块复用的组件
└── domain/              # 可选：仅当该模块有**独有**模型/端口时
    ├── models/
    └── ports/
```

`<module-id>` **必须**是契约 §4 里的冻结 key（`groupbuy`、`errand`、`wellbeing` …），
与 `/api/v1/<module-id>/*` 的路由段、`KedayaModule.id` 完全一致 —— 不允许自造名字。

## 硬规则

1. **feature 目录名 = 契约 §4 的模块 id**，一一对应，不许多、不许少。
2. **feature 自带 README**，至少写清：该模块的 ports、用例、已实现/未实现。
3. **feature 不直接发网络请求**：必须经 `domain/ports/` 的端口
   （契约 §7 硬规则 3），由 `data/` 提供实现。
4. **feature 不硬编码模块清单**：模块元数据一律来自
   `domain/models/kedaya_module.dart`（镜像 `packages/contracts/src/modules.ts`）。
5. **feature 之间不互相 import**：需要共享就上提到顶层，或者新建端口。
6. **敏感模块（`wellbeing` / `dorm-harmony` / `ai-portrait`）必须先过同意门**
   （`ConsentPort`），并且该模块的数据**不得**流入 `ai-portrait`（契约 §9）。

## 现有 feature

| 目录 | 模块 | 状态 |
| --- | --- | --- |
| `groupbuy/` | 拼单 | ✅ 已跑通（列表 + 详情 + 三态 + 参团） |
| `forum/` | 论坛 | ✅ 已跑通（版块筛选 + 主题列表/详情 + 回复 + 发帖含匿名开关 + 举报 + 分享） |
| `faq/` | 常见问题 | ✅ 已跑通（分类 + 搜索 + 手风琴 + 幂等「有用」+ 我的工单） |
| `wildlife/` | 猫鸟黑天鹅 | ✅ 已跑通（静态底图 + 叠加层 + 观测/区域/轨迹 + 上报含伦理确认 + 仿射标定） |
| `buddy/` | 找搭子 | ✅ 已跑通（三板块分栏列表 + 申请/审批/关闭 + 发布含封闭标签选择器 + 匹配资料含跨零点时段 + 可解释推荐 + 反馈；**不含 dating**） |
| 其余 14 个 | —— | ❌ 未实现：在 `/module/:id` 落地页如实标注"尚未实现" |

## 新建一个 feature 的步骤

1. `mkdir -p lib/features/<module-id>/{application,presentation/pages,presentation/components}`
2. 写 `README.md`（照抄 `groupbuy/README.md` 的结构）。
3. 在 `lib/domain/ports/<module>_port.dart` 定义端口（若还没有）。
4. 在 `lib/data/repositories/remote_<module>_repository.dart` 与
   `lib/data/mock/mock_<module>_repository.dart` 各实现一份。
5. 在 `lib/app/app_runtime.dart` 的两个装配分支（mock / 远端）里接上。
6. 在 `lib/app/app_router.dart` 里加路由段，并让
   `presentation/pages/module_detail_page.dart` 的"实现状态"分支认识它。
7. 加测试：`test/domain/`（纯逻辑）+ `test/data/`（mock 行为）+
   `test/application/`（三态）。
