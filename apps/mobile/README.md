# 可达鸭 · Flutter 原生端（`apps/mobile/`）

iOS / Android / **鸿蒙** 三端原生客户端骨架。包名 `kedaya`，Dart SDK `>=3.6.2 <4.0.0`。

> **第三方非官方平台**：本项目由学生社区维护，与上海科技大学官方系统无关。
> 全站显著标注，不冒充学校官方系统（冻结契约 §9）。

---

## 0. 交付状态（如实声明）

| 项 | 状态 |
| --- | --- |
| 代码 | 已写完（六边形分层 + 拼单/论坛/常见问题/校园动物/**找搭子**五个垂直切片 + 亮/暗主题 + 46 个测试文件） |
| **本机编译验证** | ✅ **已验证（2026-10-19）** —— 本机已安装 **Flutter 3.35.1 stable / Dart 3.9.0**（SDK 位于 `~/toolchains/flutter`，未改 shell 配置文件）。`flutter pub get` 成功；`flutter analyze` **0 issue**；`flutter test` **680 例：679 通过 / 1 失败**（失败是既有的令牌镜像头 hash 断言，见 §8 第 8 条，与本次改动无关） |
| 静态自检（补充验证） | ✅ 已实际执行（历史记录）：`/opt/homebrew/bin/python3 tool/selfcheck.py` —— 10 项文本检查全部通过（203 个 Dart 文件：lib 161 + test 42，0 处违规），见 §6.5 |
| 依赖版本解析 | ✅ 已验证：`flutter pub get` 成功，实际解析 riverpod **2.6.1** / go_router **14.8.1** / freezed **2.5.8** 等，全部落在 `pubspec.yaml` 的区间内，无需微调 |
| 静态分析 | ✅ 已验证：`flutter analyze` → `No issues found!`（**0 error / 0 warning / 0 info**；`strict-casts` / `strict-inference` / `strict-raw-types` 保持开启） |
| 运行时行为 | ❌ 未验证（未在真机/模拟器上启动过；`flutter run` 不在本次范围） |

**第 6 节是已在 2026-10-19 实际执行过的验证清单**；执行结果与本文档不一致时，以实际结果为准，并请回报 Lead。

---

## 1. 快速开始

```bash
cd apps/mobile

# 1) 拉依赖
flutter pub get

# 2) 直接运行（默认 mock 运行时，零后端、零网络）
flutter run

# 3) 接后端（示例）
flutter run \
  --dart-define=KEDAYA_FLAVOR=dev \
  --dart-define=KEDAYA_API_BASE_URL=https://your-api.example.com
```

默认 `AppFlavor.mock`：`git clone` 之后**不需要任何后端**就能看到完整 UI
（契约 §7 硬规则 4 要求必须有 mock adapter）。

原生工程目录（`android/` `ios/` `ohos/`）**没有提交**：它们是 `flutter create` 的产物，
本工作流的写作用域只覆盖 Dart 侧骨架。首次运行前需要：

```bash
cd apps/mobile
flutter create --org cn.shanghaitech.kedaya --project-name kedaya --platforms=android,ios .
```

（鸿蒙需要 OHOS fork 的 Flutter SDK，见第 7 节。）

> **改设计令牌时不要手改本端文件**：`lib/presentation/theme/kedaya_tokens.dart` 是
> **生成物的副本**（带"勿手改"横幅）。在仓库根目录跑 `npm run tokens`
> （= `generate.mjs` + `scripts/sync-flutter-tokens.mjs`）会同时更新源与副本。

---

## 2. 目录结构（目录名是冻结契约 §7 的，不得改名）

```
apps/mobile/
├── pubspec.yaml
├── analysis_options.yaml
├── lib/
│   ├── main.dart                     # 只调用 bootstrap()，不含第二份启动逻辑
│   ├── app/                          # 装配与启动：DI、路由、运行时工厂
│   │   ├── app_environment.dart      #   flavor / baseUrl / dart-define 覆盖
│   │   ├── app_runtime.dart          #   手工装配全部端口（mock / 远端两套）
│   │   ├── app_providers.dart        #   Riverpod 装配（ProviderScope 根部 override）
│   │   ├── app_router.dart           #   go_router：底部导航 + 每个 feature 的路由段
│   │   ├── app.dart                  #   根组件（亮/暗主题 + themeMode + 路由）
│   │   └── bootstrap.dart            #   契约 §8 启动时序的**唯一**实现
│   ├── application/                  # 用例/控制器：编排，不含 IO
│   │   ├── session_controller.dart
│   │   ├── campus_bindings_controller.dart
│   │   ├── consent_controller.dart
│   │   ├── theme_controller.dart
│   │   └── module_catalog.dart
│   ├── domain/                       # 纯领域：零框架依赖（只 dart:core + 自有模型）
│   │   ├── models/                   #   21 个模块注册表（含 deadlines）/ 金额 / 结果 / 主题模式 / 模型
│   │   └── ports/                    #   接口（依赖倒置的支点）
│   ├── data/                         # adapters：实现 ports
│   │   ├── api/                      #   Dio 装配 + 信封解包
│   │   ├── repositories/             #   remote 实现
│   │   ├── storage/                  #   Keychain / SharedPreferences / 主题模式
│   │   └── mock/                     #   内存 mock（无后端可跑）
│   ├── platform/                     # 平台差异：share / notification / SSO 入口
│   ├── presentation/                 # UI
│   │   ├── pages/ components/ theme/
│   └── features/                     # 每个 feature 一个目录（见 lib/features/README.md）
│       ├── README.md
│       ├── groupbuy/                 #   ✅ 已跑通的垂直切片（拼单）
│       ├── forum/                    #   ✅ 论坛（含匿名开关 + 举报）
│       ├── faq/                      #   ✅ 常见问题（含幂等「有用」+ 我的工单）
│       ├── wildlife/                 #   ✅ 校园动物（静态底图 + 叠加层 + 上报 + 推断轨迹）
│       └── buddy/                    #   ✅ 找搭子（三板块列表 + 申请/审批/关闭 + 发布 + 匹配资料 + 可解释推荐）
├── tool/
│   └── selfcheck.py                  # 补充验证：静态自检覆盖 analyze 查不到的文本层问题
└── test/                             # 46 个测试文件
    ├── domain/  data/  application/  presentation/
```

**依赖方向**：`presentation → application → domain ← data`。
`domain/` 里没有任何 `package:flutter/*`、没有 `dart:convert`、没有 Dio ——
JSON 解码只在 `data/api/` 发生，模型只接收**已解码**的 `Map<String, Object?>`。
主题模式也因此用 domain 自有的 `KedaYaThemeMode` 枚举，而不是 Flutter 的 `ThemeMode`。

---

## 3. 关键设计说明

### 3.1 契约 §8 启动时序（`lib/app/bootstrap.dart`）

```dart
final runtime = await AppRuntime.create(env);  // 只做本地 IO（SharedPreferences.getInstance）
runtime.hydrate();                             // ① 同步 hydrate 缓存，禁止网络
runApp(ProviderScope(... KedaYaApp()));        // ② 立即渲染首屏
unawaited(runtime.startBackgroundRefresh());   // ③ 后台并发刷新，失败静默降级
```

- 第 ① 步的 `hydrate()` 是**同步**的：`LocalCachePort.readJson` 的契约就是同步
  （`SharedPreferences` 在 `getInstance()` 时已把数据读进内存）。它 hydrate 四样东西：
  会话、校园系统绑定、同意记录、**主题模式**。
- 第 ③ 步的每一项（token 续期 / 校园系统绑定对账 / 同意记录对账）都单独 try/catch，
  失败只记进 `AppRuntime.lastBackgroundError`，**不弹错、不阻塞**。
- 主题模式必须在第 ① 步读回，否则首帧会用错主题、再闪一下才切到用户的选择。

### 3.2 契约 §5 两级身份模型

| 层 | 端口 | 产物 | 边界 |
| --- | --- | --- | --- |
| 第一级 身份 | `AuthPort` | KedaYa 自有 JWT（`AuthSession`） | **绝不含**任何校园 cookie/session/tgc |
| 第二级 能力 | `CampusSessionPort` | 各校园系统 session cookie | 只能经 `cookieHeaderFor()` 交给 WebView 注入 |

- `AuthSession` / `CampusBinding` 的序列化键名由
  `test/domain/auth_session_boundary_test.dart` **机械校验**：出现
  `cookie`/`tgc`/`castgc`/`session`/`egate`/`cpdaily` 等片段即测试失败。
- 校园系统 cookie 只存在于 `RemoteCampusSessionRepository` 的私有字段与安全存储里，
  连 `domain` 模型都不经过。
- "已登录但未绑定"是合法状态：此时身份有效，校园系统功能返回
  `CAMPUS_BINDING_REQUIRED`（`ApiError.needsCampusBinding`）。

### 3.3 模型策略：**手写 `fromJson` / `toJson`**（不用 freezed 代码生成）

`pubspec.yaml` 里声明了 `freezed_annotation` / `json_annotation` / `build_runner` /
`freezed` / `json_serializable`（任务要求），但**当前所有模型都是手写的**。原因：

1. 代码生成产物（`*.g.dart` / `*.freezed.dart`）没有提交，而开发机当时没有 Flutter SDK
   （**现已安装 Flutter 3.35.1，见 §0**），无法运行 `build_runner`；如果模型依赖生成代码，`git clone` 后**一定编译不过**。
2. 手写版可以用纯 `dart:core` 实现，正好满足"`domain` 层零框架依赖"。
3. 解析逻辑集中在 `domain/models/json_read.dart`（类型不符即抛 `FormatException`，
   未知枚举值收敛为 `unknown` 而不是崩溃）。

后续若改用 freezed：`analysis_options.yaml` 已忽略 `invalid_annotation_target`，
且 `exclude` 已包含 `**/*.g.dart` / `**/*.freezed.dart`。

### 3.4 主题：亮 / 暗（契约 §6.2 + §11.5）

**色值只有一个来源**：`packages/design-tokens` 的生成物。

- `lib/presentation/theme/kedaya_tokens.dart` 是它的**生成物副本**（`npm run tokens`
  同步，带"勿手改"横幅）。Flutter 包无法 import 包边界之外的 Dart 文件，
  所以必须留一份副本；副本由脚本维护，因此不会再漂移。
- `KedaYaColors`（`ThemeExtension`）承载 16 个颜色令牌，组件用
  `context.kedayaColors.xxx` 取值，**禁止硬编码色值**。
- 亮暗两套**共用同一个字段清单**（`KedaYaColors._fromTokens` 的初始化列表），
  因此结构上不可能漂移：
  - 亮色 ← `KedaYaTokens.resolveColor(key, isDark: false)`；
  - 暗色 ← `KedaYaTokens.darkColors[key]`（契约 §11.5 的暗色覆盖表），
    缺键**直接抛 `StateError`** —— 宁可启动即报错，也不要在暗色主题里混进亮色值。
- `KedaYaTheme.light()` / `KedaYaTheme.dark()` 共用同一个私有 `_build()`，
  只换调色板与 `Brightness`，所以新增组件样式只需改一处。
- 主题模式：`KedaYaThemeMode`（domain 枚举）→ `ThemeModePort` →
  `CacheThemeModeStore`（复用 `LocalCachePort`，不新增存储依赖）→
  `ThemeModeController`（Riverpod `Notifier`）。`themeModeOf()` 是 domain 枚举到
  Flutter `ThemeMode` 的**唯一**转换点。
- 切换入口在「我的 → 外观」（`SegmentedButton`：跟随系统 / 浅色 / 深色），
  选择立即生效并落盘，下次冷启动首帧就是该模式。
- 校验：`test/presentation/kedaya_theme_test.dart` 断言亮暗字段集合一致、
  16 个键都与亮色不同、以及 `KedaYaTokens.darkColors` 的键集合与 Dart 字段清单一致
  （生成器新增暗色令牌时会失败，逼着客户端同步补字段）。

### 3.5 匿名（契约 §9）与幂等（`faq`）

两条要求各自落在**类型**与**幂等键**上，而不是靠 UI 记得处理：

- **匿名**：`ForumAuthor` 是 sealed 类型，实名 (`RealAuthor`) 与匿名
  (`AnonymousAuthor(AnonymousIdentity)`) 是**两个不同的类型**；后者**没有** `userId`
  字段，`realUserIdOrNull` 恒为 `null`。因此"匿名帖里混进实名 id"在编译期就不可能，
  解析时即使 payload 带了 `authorId` 也会被丢弃。边界由
  `test/domain/forum_anonymity_boundary_test.dart` 机械校验。
- **幂等**：`FaqVoter` 给出稳定幂等键（已登录 `u:<userId>` / 未登录 `d:<deviceId>`，
  设备 id 落 `LocalCachePort`），mock 与远端都按 `voterId` 去重，重复点击返回
  `counted: false`（**不是失败**）；UI 再叠一层"已标记有用"的禁用态。
  详见 `lib/features/faq/README.md`。

### 3.6 论坛 / FAQ 的端口与用例

见各自的 feature README：`lib/features/forum/README.md`、`lib/features/faq/README.md`
（含 ports ↔ HTTP 对照、用例清单、治理规则实现情况、未实现项）。

---

## 4. 已实现 / 未实现

### ✅ 已实现（可运行、有测试）

| 项 | 位置 |
| --- | --- |
| 契约 §8 启动时序 | `lib/app/bootstrap.dart` + `lib/main.dart` |
| 六边形分层骨架（目录名严格按 §7） | `lib/{app,application,domain,data,platform,presentation}/` |
| 13 个 domain port | `lib/domain/ports/`：`AuthPort`、`CampusSessionPort`、`KedayaApiPort`、`CredentialStorePort`、`LocalCachePort`、`ConsentPort`、`ThemeModePort`、`GroupbuyPort`、`ForumPort`、`FaqPort`、`ErrandPort`、`LostFoundPort`、`WellbeingPort` + `platform_ports.dart` |
| 21 个模块注册表（镜像 `packages/contracts`，含 2026-10-19 新增的 `deadlines`） | `lib/domain/models/kedaya_module.dart` |
| 金额整数分（镜像 `packages/shared/money.ts`） | `lib/domain/models/money.dart` |
| 统一信封 + Dio 装配（Bearer / Trace / 401 刷新重试） | `lib/data/api/{api_envelope,dio_client,kedaya_api_client}.dart` |
| 远端 repositories（auth / campus / consent / groupbuy / **forum** / **faq** / errand / lost-found / wellbeing） | `lib/data/repositories/` |
| 内存 mock 适配器（含延迟与故障注入、举报治理规则、**幂等投票**） | `lib/data/mock/` |
| **亮 / 暗主题**（从设计令牌派生，契约 §11.5） | `lib/presentation/theme/` |
| **主题模式**：跟随系统 / 浅色 / 深色，可切换 + 持久化 + 冷启动同步读回 | `lib/application/theme_controller.dart`、`lib/data/storage/cache_theme_mode_store.dart`、`lib/presentation/pages/profile_page.dart` |
| **拼单垂直切片**：列表 + 详情 + loading/error/empty 三态 + 参团 | `lib/features/groupbuy/` |
| **论坛切片**：版块筛选 + 主题列表（游标分页 + 下拉刷新 + 触底加载）+ 主题详情 + 回复列表/输入 + 发帖（**匿名开关**）+ 举报 + 分享 | `lib/features/forum/` |
| **常见问题切片**：分类导航 + 搜索（防抖）+ 手风琴展开 + **幂等「有用」** + 我的工单 | `lib/features/faq/` |
| **校园动物切片**：静态底图（方案 B）+ `CustomPaint` 叠加层（区域/聚合热点/推断轨迹）+ 观测与区域与轨迹页 + 上报（选图/上传/定位/地图点选/分类建议/命名个体/伦理确认）+ **仿射标定**（纯 Dart，像素↔经纬度往返 < 1 px） | `lib/features/wildlife/`（见其 README） |
| **找搭子切片**：三板块分栏列表（游标分页 + 下拉刷新 + 触底加载）+ 详情 + 申请/撤回/审批/关闭 + 发布（**封闭标签选择器**）+ 我的匹配资料（**可用时段编辑器含跨零点**）+ **可解释推荐（展示匹配理由）** + like/dislike/skip 反馈 + 隐私说明；**不含 dating**（契约 §11.10-G） | `lib/features/buddy/`（见其 README） |
| **匹配算法 Dart 侧镜像**（`ruleScoreFor` 系数 / `explainMatch` 理由 / `overlapsAvailability` 含跨零点 / 反馈衰减；与规格 §3.3 逐字一致，有守门测试） | `lib/domain/models/buddy_matching.dart` |
| **TechPie 整合 Phase 0**：绑定管理（列表 / 发起绑定 / 解绑 / **手动**续期，响应不含凭证）+ 能力清单（**未绑定项显示 `CAMPUS_BINDING_REQUIRED` 引导，不是报错**；未登录项显示 `UNAUTHENTICATED` 引导；Phase 1–3 一律标注未实现并写明阻塞方）+ 校园系统 WebView 直连（**一次性票据** 30 秒、用后即焚、不进状态不进日志）+ 校园卡（余额 / 流水 / 付款码，**独立 OPENID 通道**，与校园会话代持完全解耦）；三个新端口 `TechpiePort` / `CampusCardPort` / `WebViewPort`，一级身份与二级绑定是**两个独立 port** | `lib/features/techpie/`（见其 README） |
| **匿名身份与实名身份在模型层解耦**（契约 §9）：`ForumAuthor` sealed 类型 + `AnonymousIdentity` | `lib/domain/models/{forum,anonymous_identity}.dart` |
| 底部导航 + 每个模块的路由段 | `lib/app/app_router.dart`、`lib/presentation/pages/module_detail_page.dart` |
| 二次同意门（`wellbeing`/`dorm-harmony`/`ai-portrait`） | `lib/application/consent_controller.dart` |
| 46 个测试文件 | `test/`（见第 5 节） |
| 静态自检脚本（补充验证） | `tool/selfcheck.py`（见第 6.5 节） |

### ❌ 未实现（如实列出，没有用 TODO 占位函数冒充）

| 项 | 说明 |
| --- | --- |
| 原生工程目录 | `android/` `ios/` `ohos/` 未生成（用 `flutter create` 生成，见 §1） |
| 除 `groupbuy` / `forum` / `faq` / `wildlife` / `buddy` 外的 14 个模块页面 | 只有 `/module/:id` 落地页展示注册表信息并**明说"尚未实现"**；没有假数据、没有假成功 |
| 论坛的版主治理界面 | 数据层已实现"3 个不同用户举报 → 自动隐藏"与 `LOCKED` 拒答，但**没有**版主 moderation / Lock / Hide 的 UI |
| 发帖/回复频率限制、敏感词拦截 | ❌ 未实现（属于服务端限流与内容审核；客户端只做长度校验） |
| FAQ 工单追问 / 关闭 | `FaqTicketStatus.canFollowUp` 已在模型里就绪，但没有 UI |
| Markdown 渲染 | 论坛正文与 FAQ 答案按**纯文本**展示（契约里的 "Markdown 子集" 未渲染） |
| 校园系统绑定的 UI | `CampusSessionPort` 与 `CampusBindingsController` 已实现并可用（profile 页展示状态）；`techpie` 模块新增了绑定管理页（列表 / 解绑 / **手动**续期 / 发起绑定面板），但**刻意没有**"输入明文口令"的输入框 —— Phase 0 只提供免口令通道，明文口令绑定阻塞于信息办对 U12 的书面回复（契约 §11.18-D） |
| 统一身份认证的原生侧 | `MethodChannelUnifiedIdentity` 已定义 channel 契约（`kedaya/unified_identity`），**原生侧实现未写**；mock 运行时用 `DevUnifiedIdentity` |
| 本地化（i18n） | 未接 `flutter_localizations`（会与 `intl` 版本绑定冲突）；UI 文案直接写中文 |
| 推送 | `LocalNotificationPort` 是内存实现；未接厂商推送 / `flutter_local_notifications` |
| 系统分享面板 | `ClipboardSharePort` 落剪贴板（真实可用）；未接 `share_plus` |
| 崩溃上报 / 埋点 | 未接 |
| 鸿蒙构建 | 未验证（需要 OHOS fork，见 §7） |

### ⚠️ 上线前必须替换

1. `lib/data/mock/crisis_resources.dart` 里的**危机干预热线是示例数据**
   （`021-0000-0000` 是明显的假号），必须由学校心理健康中心提供真实号码后替换。
   契约 §9 要求该出口不可被埋进二级菜单、且不可因网络失败消失。
2. `AppEnvironment.prodBaseUrl` 目前是占位域名 `https://api.kedaya.local`。
3. 品牌素材（吉祥物 SVG）在 `assets/brand/`（Lead 独占），本端尚未接入 UI。

---

## 5. 测试（46 个文件；其中 `wildlife` 新增 13 个文件 / 184 个用例，`buddy` 新增 10 个文件 / 199 个用例，`techpie` 新增 11 个文件）

> ✅ **已在 2026-10-19 用 Flutter 3.35.1 实际执行**：`flutter test` → **680 个用例，
> 679 通过、1 失败**（`test/presentation/kedaya_tokens_mirror_test.dart` 的
> source-blob hash 断言，属既有问题且与本次改动无关，见 §8 第 8 条）。
> 下表是"每个文件测什么"。

| 文件 | 覆盖 |
| --- | --- |
| `test/domain/money_test.dart` | 整数分 ↔ 元、非法输入、往返一致、带符号展示 |
| `test/domain/module_registry_test.dart` | 21 个模块（含 `deadlines`）、id 唯一、route==id、**同意门规则**（`auth`/`campus-card` 不设门） |
| `test/domain/result_and_api_error_test.dart` | `Result` 的 Ok/Err/map/flatMap/unwrap、错误码 wire 往返、未知码收敛 |
| `test/domain/auth_session_boundary_test.dart` | **契约 §5 边界机械校验**：序列化键名不含校园凭据；未知校园系统抛错 |
| `test/domain/groupbuy_order_test.dart` | 模型解析/序列化、未知状态收敛、进度收敛、查询参数收敛 |
| **`test/domain/forum_post_test.dart`** | 论坛模型解析/序列化、状态收敛（未知→不可回复）、`LOCKED` 语义、草稿校验、标签解析、**匿名开关语义**（请求体不含实名标识） |
| **`test/domain/forum_anonymity_boundary_test.dart`** | **契约 §9 机械校验**：`AnonymousAuthor` 无实名出口、payload 混入 `authorId` 也被丢弃、匿名帖子/回复/举报的序列化键名不含实名片段 |
| **`test/domain/faq_article_test.dart`** | 文章/工单解析、搜索纯逻辑、状态机辅助、**联系方式拒绝手机号**、长度校验、`counted` 语义 |
| **`test/domain/faq_voter_test.dart`** | 幂等键稳定性、`u:`/`d:` 前缀不混淆、未知 key 保守收敛、设备票 ≠ 用户票 |
| `test/data/api_envelope_test.dart` | 信封成功/失败解包、非 JSON 容错、decode 不被误调用、路径收敛 |
| `test/data/mock_groupbuy_repository_test.dart` | mock 游标分页、参团累加与锁定、冲突/404/校验、故障与空结果开关 |
| **`test/data/mock_forum_repository_test.dart`** | 分页/版块筛选/关键词、`HIDDEN` 不可见、置顶排序、**匿名身份稳定且跨人跨版块不同**、`LOCKED` 拒答、**举报去重 + 3 人自动隐藏**、故障/空结果 |
| **`test/data/mock_faq_repository_test.dart`** | 分类、`DRAFT` 不可见、分类/关键词检索、**「有用」幂等（同一 voter 只计一次）**、工单归属与分页、提交校验（拒绝手机号）、故障/空结果 |
| `test/data/theme_mode_store_test.dart` | 主题模式落盘与同步 hydrate、损坏/未知值回落、`changes` 广播 |
| `test/application/groupbuy_list_controller_test.dart` | **三态**：loading→data / empty / error；翻页失败保留列表；写操作后失效读 provider |
| **`test/application/forum_controller_test.dart`** | **三态**、版块筛选（首次生效 + 切换重载）、翻页失败保留列表、回复后失效重取、发帖后列表含新帖、举报去重抛 `CONFLICT` |
| **`test/application/faq_controller_test.dart`** | **三态**、分类/搜索筛选、筛选重载、**幂等端到端（走 provider）**、局部覆盖、工单提交与失效重取 |
| `test/application/theme_controller_test.dart` | 初值来自同步 hydrate、setMode 落盘并推给订阅者、外部写入同步到状态 |
| `test/presentation/kedaya_theme_test.dart` | **亮暗字段集合一致**、`darkColors` 键集合交叉校验、16 键都与亮色不同、`resolveColor` 亮/暗/未知分支、`light()`/`dark()` 的 ThemeData 装配、`themeModeOf` 映射 |
| **`test/domain/wildlife_geo_test.dart`** | 纯 Dart `cos`/`sqrt` 精度、ENU 往返、**像素 → 经纬度 → 像素 往返 < 1 px**、最小二乘标定还原仿射、RMSE 阈值、`lat`/`lng` 写反被拒、30 m ↔ 25–35 px |
| **`test/domain/wildlife_datum_boundary_test.dart`** | **GCJ-02 不得入库**：`GeoDatum` 只有一个成员、序列化无 `gcj*` 键、payload 里的 `gcjLat`/`exactLat`/`reporterId` 被忽略、**源码机械扫描无 gcj 标识符** |
| **`test/domain/wildlife_sighting_test.dart`** | 状态大小写收敛、发现时间 vs 上报时间、敏感区无坐标、分类来源、**§10.3 的 8 条校验 reason**、图片魔数 / 5 MB 上限、置信度三档 + 低置信度不预选、伦理规则规模、命名个体 |
| **`test/domain/wildlife_track_test.dart`** | GeoJSON `[lng, lat]` 顺序、坏点丢弃、**`isInferred` 恒真（即使服务端发 false）**、免责说明兜底永不为空、折线长度现算、方法收敛 |
| **`test/domain/wildlife_basemap_test.dart`** | §1.4 的四条 CI 规则（RMSE<5 / 控制点≥6 / odbl 署名 / 尺寸）、多问题全列、affine 必须是 6 个数 |
| **`test/domain/wildlife_zone_species_test.dart`** | 物种繁殖期字段、`shanghaiMonth`、投喂政策收敛与徽章语义、告示位 40 字摘要、`zoneContaining` 取最小半径、热点直方图规范化 / `peakHours` / **聚合延迟 ≥24h** |
| **`test/data/mock_wildlife_repository_test.dart`** | mock 行为：**只返回 PUBLISHED**、游标分页、物种与受伤筛选、自己的待审核可见 / 别人的 404、上报校验、健康异常不等审核、纠正闭环、撤回、个体同名冲突、故障与空结果 |
| **`test/data/mock_wildlife_privacy_test.dart`** | **隐私行为**：返回坐标 ≠ 精确坐标且网格对齐、时间粗化到小时/天、**敏感区无坐标 + 热点不公开**、响应无 `reporterId`/`exactLat`、热点 `computedAt` 早于 24h |
| **`test/data/mock_wildlife_media_test.dart`** | 上传幂等（同 `clientPhotoId` → 同 `mediaId`）、嗅探出的 MIME、非图片与超限拒绝、媒体不能被两条观测复用、不带照片也能提交、分类器关闭/开启/低置信度/故障降级 |
| **`test/application/wildlife_map_controller_test.dart`** | **三态**（loading/data/empty/error）、物种筛选重载、**底图标定不合法 → 整页错误态**、refresh、只读 provider |
| **`test/application/wildlife_sighting_list_controller_test.dart`** | **三态**、游标翻页、翻页失败保留列表、筛选重载、详情 404、写操作后失效重取 |
| **`test/application/wildlife_report_controller_test.dart`** | 上报编排：默认发现时间、上传与**重试复用幂等键**、定位降级、地图点选自动判定区域、分类预选阈值、未勾伦理不发请求、完整提交流程、**同名个体复用**、服务端拒绝、健康异常告警、reset |
| **`test/presentation/wildlife_widget_test.dart`** | 组件与文案约束：伦理提示 5 条 + "不是授权"、forbidden 警告条、**"推断轨迹 · 非实测路径"**、隐私说明、聚合延迟、投喂徽章、底图叠加层渲染与点选反算、**亮/暗主题下列表页均可用** |

新增的 8 个文件（加粗）对应本次交付的 `forum` / `faq`：**domain 纯逻辑 4 个 +
mock repository 行为 2 个 + application 三态/幂等 2 个**。

`wildlife` 追加 13 个文件 / 184 个用例（加粗，见上表）：**domain 纯逻辑 6 个（含
坐标系与 GCJ-02 边界）+ mock 行为 3 个（含隐私）+ application 3 个 + 组件 1 个**。

`buddy`（本次交付）追加 **10 个文件 / 199 个用例**：

| 文件 | 覆盖 |
| --- | --- |
| `test/domain/buddy_matching_test.dart` | **规格 §3.3 系数逐字校验**、三板块上限、**§5.7 理由（文档示例逐字一致）**、**F7 跨零点 + 时区边界**、融合公式、反馈权重与 `buddyExpNeg` 精度、`matchMode` 诚实文案 |
| `test/domain/buddy_post_test.dart` | `sectionOf` 全覆盖、**5×5 状态机矩阵**、`section: dating` 被忽略、敏感键不被读取、发布草稿逐条校验 |
| `test/domain/buddy_profile_test.dart` | `AvailabilitySlot` 校验、**跨零点拆分**、本地时间文案、`matchEnabled` 默认 false、**封闭标签表完整性 + 别名搜索** |
| `test/domain/buddy_application_test.dart` | 申请状态机 4×4 矩阵、`BuddyDecision`、留言校验、命令请求体形状 |
| `test/domain/buddy_privacy_boundary_test.dart` | **无 dating**（枚举 + `fromWire` + 源码机械扫描）、响应键名黑名单、`BuddyCreator` 只有三字段、**端口没有读他人资料的出口** |
| `test/data/mock_buddy_repository_test.dart` | 过滤 / **游标不重不漏** / 损坏游标容错、`join` 不占名额、撤回后复用同一行、F5/F6、`decide` 名额、`close` 归属、申请可见性、反馈 UPSERT、资料保存删除 |
| `test/data/mock_buddy_recommend_test.dart` | 未开启匹配 → 「按时间排序」、**F1–F7 逐条**、分数与理由逐字断言、**反馈影响分数**、**section 隔离** |
| `test/application/buddy_controller_test.dart` | 三态、三板块分栏切换、翻页失败保留列表、写操作后的 provider 失效 |
| `test/application/buddy_recommend_controller_test.dart` | 三态、**打开匹配开关后从降级变成可解释推荐**、反馈后 refresh 生效、删除资料后回到诚实降级 |
| `test/presentation/buddy_widget_test.dart` | **理由必须展示**、**降级档不出现「为你智能推荐」**、分栏只有三个板块、时段编辑器预览跨零点、隐私页九条承诺、**亮/暗主题下列表页与推荐页均可用** |

---

## 6. 验证命令与结果（2026-10-19 已在 Flutter 3.35.1 上执行）

| 命令 | 本机实际结果 |
| --- | --- |
| `flutter --version` | Flutter 3.35.1 • stable • Dart 3.9.0 |
| `flutter pub get` | ✅ Got dependencies（riverpod 2.6.1 / go_router 14.8.1 / freezed 2.5.8，无版本冲突） |
| `flutter analyze` | ✅ `No issues found!`（0 error / 0 warning / 0 info） |
| `flutter test` | ⚠️ 680 例：679 通过 / 1 失败（`kedaya_tokens_mirror_test.dart` 的 hash 断言） |

```bash
# 环境
flutter --version                 # 期望 Dart >= 3.6.2
flutter doctor -v

cd apps/mobile

# 1) 依赖解析（最可能出问题的一步：版本区间需按实际 SDK 微调）
flutter pub get

# 2) 静态分析（必须 0 error；strict-* 三个开关已打开）
flutter analyze

# 3) 单元测试（46 个文件；2026-10-19 实测 680 例）
flutter test
flutter test test/domain/auth_session_boundary_test.dart   # 单跑契约 §5 边界测试
flutter test test/domain/forum_anonymity_boundary_test.dart # 单跑契约 §9 匿名边界测试
flutter test test/presentation/kedaya_theme_test.dart      # 单跑契约 §11.5 暗色守门测试
flutter test test/application/forum_controller_test.dart   # 单跑论坛三态/筛选
flutter test test/application/faq_controller_test.dart     # 单跑 FAQ 三态/幂等
flutter test test/domain/wildlife_geo_test.dart           # 单跑坐标/仿射标定（含往返 < 1 px）
flutter test test/domain/wildlife_datum_boundary_test.dart # 单跑「GCJ-02 不得入库」边界
flutter test test/data/mock_wildlife_privacy_test.dart    # 单跑位置模糊化/敏感区无坐标
flutter test test/presentation/wildlife_widget_test.dart  # 单跑「推断轨迹」文案与亮暗主题
flutter test test/domain/buddy_matching_test.dart         # 单跑 §3.3 系数逐字校验 + 跨零点时段
flutter test test/domain/buddy_privacy_boundary_test.dart # 单跑「无 dating + 响应键名黑名单」
flutter test test/data/mock_buddy_recommend_test.dart     # 单跑推荐硬过滤 F1–F7 与理由
flutter test test/presentation/buddy_widget_test.dart     # 单跑「推荐理由必须展示」与亮暗主题

# 4) 格式化检查（可选；本次只对改动的 2 个文件跑过 dart format）
dart format --output=none --set-exit-if-changed lib test

# 5) 运行（mock 运行时，无后端）
flutter run

# 6) 接后端跑（需要 Lead 提供 dev 域名）
flutter run --dart-define=KEDAYA_FLAVOR=dev --dart-define=KEDAYA_API_BASE_URL=<dev-host>
```

### 6.5 本机静态自检（补充验证，**已实际执行**）

在 Flutter 装好之前，用一个纯 Python 的静态自检覆盖能查的部分（历史记录，仍然保留）：

```bash
cd apps/mobile
/opt/homebrew/bin/python3 tool/selfcheck.py            # 10 项检查，退出码 0 = 全通过
/opt/homebrew/bin/python3 tool/selfcheck.py --verbose
```

它检查：① import 可解析（相对路径 + `package:kedaya/…` 都要落到真实文件）；
② 括号/花括号平衡（忽略字符串与注释）；③ `directives_ordering`
（dart: → package: → 相对，组内字母序）；④ 未使用的 `dart:` import；
⑤ **未使用的 import（启发式，含第三方包）**；⑥ **`const` 构造里出现运行期表达式**
（手写 Dart 最常见的编译错误：把 const 令牌换成 `context.kedayaColors.*` 后忘了去 `const`）；
⑦ TODO/FIXME 占位；⑧ 硬编码 `Color(0x…)`；⑨ domain 层是否 import 框架；
⑩ application 层是否把 `Ref` 当字段持有。

**它替代不了 `flutter analyze` / `flutter test`** —— 类型错误、API 版本不匹配、
运行时行为都不在它的覆盖范围内。见 §8。

手测要点：

1. 首页 → 「拼单」→ 列表应出 5 条 mock 数据（loading 态可见约 250ms）。
2. 右上角 🧪 菜单可切换 **正常 / 空列表 / 上游故障** —— 用来验证 empty 与 error 三态。
3. 点任意一条进详情 → 「参团 1 份」→ 份数 +1，进度条前进，满员后按钮禁用。
4. 详情页 URL 改为不存在的 id（例如 `/groupbuy/gb-nope`）应显示**空态**而非错误态。
5. 「我的 → 外观」切 跟随系统 / 浅色 / 深色：应立即整体变色（背景、卡片、导航栏、
   按钮、文字）；**杀掉进程重进应记住选择，且首帧就是该模式**（不闪一下再切）。
6. 系统切换到深色（若选"跟随系统"）应自动跟随。
7. 首页 → 「论坛」→ 列表应出 **6** 条（第 7 条 `HIDDEN` 不应出现）；版块 chip 切到
   「学习交流」应只剩 2 条；滚到底部应自动加载下一页（列表页 footer 也会显示"没有更多了"）。
8. 论坛 → ✏️ 发帖：填标题+正文 → 打开**匿名开关** → 按钮文案变成「匿名发布」，
   开关下方应显示「匿名后你的实名身份不会与帖子关联」；发布后回到列表，
   新帖应带「匿名」徽标，作者名是 `匿名鸭 #N`（**不是**当前账号名）。
9. 论坛 → 进 `fp-1005`（已锁定）→ 底部应显示"暂不能回复"而不是输入框；
   进 `fp-1002` 回复一条 → 回复数 +1。
10. 论坛 → 详情右上角 🚩 → 选理由 → 提交 → 提示"举报已提交"；**再举报同一条**应提示
    "你已经举报过这条内容了"（去重）。详情右上角 🔗 分享 → 剪贴板应拿到含标题的链接。
11. 论坛 → 🧪 菜单切空列表/上游故障，验证 empty 与 error 三态；详情页 URL 改成
    `/forum/fp-nope` 应显示**空态**。
12. 首页 → 「常见问题」→ 7 篇（第 8 篇 `DRAFT` 不应出现）；点分类 chip 切「账号与登录」
    → 3 篇；搜索框输入「匿名」（约 300ms 后）→ 只剩 1 篇。
13. 展开任一条 → 点「有用」→ 计数 +1 且按钮变「已标记有用」并禁用；
    **重复点击无法再触发**（这是 UI 层幂等）；杀掉进程重进，同一条应仍是"已标记"状态
    （设备/用户 id 已落盘）。
14. 常见问题 → 🎫「我的工单」→ 3 条（待回复 / 已回复 / 已关闭）；点 ➕ 提交工单：
    联系方式填 `13800138000` 应被拒绝并提示不要填手机号，改成邮箱后可提交。
15. 暗色主题下重复 7–14 步：所有卡片/标签/chip/输入框都应是暗色系（无白底黑字残留）。
16. 首页 → 「校园整合」→ 顶部显示「一级 · 未登录」（mock 运行时默认未登录）。
    在「我的」里登录后回来：应显示「一级 · 已登录」+「二级 · 2 项…」—— 这两块来自**两个独立 provider**，
    页面上没有任何一个对象同时持有它们。
17. 「绑定管理」→ 2 条（CpDaily 已绑定 / eGate 已过期）。点「解绑」列表少一条且**不影响登录态**；
    对已过期项点「手动续期」应把它救回来（mock 支持续期；把 `renewSupported` 设为 false 可验证 F3 的诚实文案）。
18. 「能力清单」→ 未登录时每项显示「去登录」；登录后校园卡三项变成「去绑定」+ 引导文案
    （**不是**错误页）；课表 / 考试 / DDL / 场馆 / 会话注入 / 自动续期应显示「未实现」并写明阻塞在谁身上。
19. 「校园系统直连」→ 顶部有白名单占位提示；未绑定平台显示「去绑定」；CpDaily 已绑定 → 点「打开」
    应显示"已交给系统 WebView 打开"（mock 宿主记录了一次性中转 URL）；把宿主设为不可用
    （`InMemoryWebViewPort(available: false)`）应显示"本机暂不支持内嵌打开"。
20. 「校园卡」→ 未登录显示「去登录」；登录后显示 OPENID 开通引导；mock 运行时点
    「（mock）模拟 eCard 授权回调并开通」→ 出现余额 / 付款码 / 4 条流水；付款码离开页面再回来
    应**重新取码**（`autoDispose`）。

---

## 7. 鸿蒙（HarmonyOS）说明

- 需要 **OHOS fork 的 Flutter SDK**（stock Flutter 没有 OHOS engine）。构建产物是 `.hap`。
- `flutter_secure_storage` 上游不带 OHOS 实现，需要替换为 `flutter_secure_storage_ohos`
  （TechPie 的做法）；`lib/data/storage/secure_credential_store.dart` **不需要改**，
  差异只在 `pubspec.yaml` 的依赖替换。
- `shared_preferences` / `url_launcher` 等同样需要 OHOS fork 的对应实现。
- `lib/platform/platform_info.dart` 刻意用 `defaultTargetPlatform.name` 字符串比较：
  OHOS fork 给 `TargetPlatform` 增加了 `ohos` 成员，对枚举做穷尽 `switch` 会在该分支编译失败。

---

## 8. 已知风险 / 需要 `flutter analyze` 复核的点

1. **Riverpod API 面**：`AsyncNotifier` / `AsyncNotifierProvider` / `AsyncValue.guard` /
   `Notifier` / `NotifierProvider` / `Provider.overrideWithValue` / `ref.invalidate`
   均按 flutter_riverpod **2.6.x** 的 API 书写；若解析到 3.x 需要改 `AsyncNotifier`
   与 `Ref` 的用法（application 层已刻意不持有 `Ref`，只有 provider 体内用到）。
2. **go_router 版本**：`StatefulShellRoute.indexedStack` + `StatefulShellBranch` +
   `StatefulNavigationShell.goBranch` 按 go_router **14.x** 的 API 书写。
3. **`Color.withValues`**：需要 Flutter 3.27+（Dart 3.6 对应 Flutter 3.27，故可用）；
   若 SDK 更旧需换成 `withOpacity`。
4. **`CardThemeData`**：Flutter 3.27+ 的 `ThemeData.cardTheme` 类型；
   更旧的版本是 `CardTheme`。
5. **`SegmentedButton`**（「外观」切换）：需要 Flutter 3.7+。
6. **暗色缺键会抛错**：`KedaYaColors._resolve` 在 `darkColors` 缺键时抛 `StateError`
   （有意为之，见 §3.4）。若生成器改了键名，请在仓库根目录跑 `npm run tokens`
   后同步 `KedaYaColors.tokenKeys` 与 `toMap()`。
7. `freezed` / `json_serializable` 目前是**未被使用**的依赖（见 §3.3），
   `flutter pub get` 不会报错，但如需精简可以删掉这 5 行。
8. **测试已执行，但有 1 例既有失败**（2026-10-19，Flutter 3.35.1）：`flutter test`
   共 680 例，679 通过、1 失败 —— `test/presentation/kedaya_tokens_mirror_test.dart`
   的「生成文件头记录了正确的 source blob hash」。根因：
   `packages/design-tokens/tokens.json` 在提交 `6ff0164` 新增了 `colorCampus`（11 个）
   与 `colorNight`（22 个）两组令牌，但 `scripts/sync-flutter-mirrors.mjs` 未同步扩展
   （现在直接运行会抛 `未知令牌组 "colorCampus"`），导致 Flutter 镜像无法重新生成，
   头部 hash 停留在旧版本。镜像里已覆盖的 10 组 / 73 个令牌**值本身仍与源逐键一致**
   （其余断言全绿）。修法：先扩展生成器的分组规则再 `node scripts/sync-flutter-mirrors.mjs`
   重新生成；**不要手改生成物里的 hash**（那会掩盖真实漂移）。

### 8.1 `forum` / `faq` 新增的风险点（需要 `flutter analyze` 复核）

9. **`FamilyAsyncNotifier`**：`forumRepliesProvider` 用的是
   `AsyncNotifierProvider.family<ForumReplyListController, ForumReplyListState, String>`
   + `class ... extends FamilyAsyncNotifier<State, Arg>`，并按 riverpod **2.6.x** 的
   `build(Arg arg)` / `arg` 语义书写。若解析到 3.x，这一处需要改写成新的 family 语法
   （这是本次交付里**唯一**新增的 Riverpod API 面）。
10. **`ChoiceChip` / `ExpansionTile` / `showModalBottomSheet`**：均按 Flutter 3.27 的
    API 书写（`showCheckmark`、`expandedCrossAxisAlignment`、
    `MediaQuery.viewInsetsOf`）。`MediaQuery.viewInsetsOf` 需要 Flutter 3.10+。
11. **`Switch` 的默认样式**：论坛回复框/发帖页/举报弹层直接用了 `Switch` 与
    `SwitchListTile`，没有自定义颜色 —— 它们的颜色来自 `ColorScheme`（`KedaYaTheme`
    已按亮/暗注入），因此暗色下应当正常；若实测有偏差，请在 `KedaYaTheme._build` 里
    补 `switchTheme`，**不要**在页面里写色值。
12. **测试里的时序假设**：`forum_controller_test.dart` / `faq_controller_test.dart`
    有两处依赖"依赖失效后的重建已完成"，用了一个轮询到非 loading 的 `settle()` 辅助函数
    （最多 50 次 `await Future.delayed(Duration.zero)`）。这是本机无法验证的部分里
    **最可能先失败**的一处；若失败，请先确认是时序问题而不是逻辑问题。
13. **契约缺口（已上报，未擅自修改）**：`forum.reply`、`forum.helpful`（`faq.helpful`）、
    `forum/boards`、`faq/categories` 未登记在契约 §11.2 / §6.1。本端按统一形状调用，
    需要 Lead 补进 §11.2 与 OpenAPI（契约 §11.2 明确要求两处同时改）。
14. **占位域名**：论坛分享链接基址 `forumShareBaseUrl = 'https://kedaya.local/forum'`
    （`lib/features/forum/presentation/pages/forum_post_detail_page.dart`）与
    `AppEnvironment.prodBaseUrl` 是同一类占位，上线前必须替换。
15. **mock 的 `currentUserId` 是可变字段**：`MockForumRepository.currentUserId` 默认
    `mockUser.userId`，只为了在测试里模拟"不同用户举报"。真实实现里这个值来自 JWT，
    客户端不可自选 —— 别把这个字段当成可配置项接到 UI 上。

### 8.2 与 `services/api` 的跨端一致性（交付时实测，**只读**了 API 代码）

16. **已按"两端都能用"对齐的差异**（详见两个 feature README 的对照表）：
    版块字段 `board`/`boardId`、列表参数 `board`/`q`、状态大小写
    （后端主题/回复状态是**小写**，举报状态是**大写**）、举报理由
    （文档 `privacy` vs 后端规范值 `pii`）、举报补充说明 `detail`/`note`、
    回复路径 `items/:id/replies`、helpful 响应只回 `{id, helpfulCount, counted}`、
    匿名在后端表现为 `authorId: null` 且**不下发** `anonymousIdentity`。
    本端一律**双向兼容**（发规范值、解析两种），因此不会因字段名/大小写差异崩解析。
17. **`GET /faq/categories` 后端不存在** → 真实后端下 FAQ 分类条会显示
    「分类加载失败 + 重试」，文章列表不受影响；mock 运行时正常。
18. **`POST /faq/items/:id/helpful` 需要登录** → 未登录的"设备票"只在 mock 下成立。
19. **🔒 隐私发现（已上报 Lead，本端只读未改）**：`services/api` 的
    `ForumPostModel.anonHandle` / `ForumReportModel.reporterKey` 会随响应下发
    （`PrismaCursorRepository.toModel` 是恒等透传，
    `services/api/src/common/crud/prisma-cursor.repository.ts:37`）。
    这会让任何客户端把同一匿名作者的所有帖子关联起来，与
    `02-domain-model.md` §2.4「对普通用户不可见」冲突。
    本端 `domain` 模型**不含**这两个字段，并有测试断言 `toJson()` 不出现 `anonHandle`。
    建议后端序列化前剔除。
20. **后端不下发作者展示名**（`ForumPostModel` 只有 `authorId`）→ 真实后端下
    实名作者会显示成 ULID。本端不做"编造昵称"的兜底，请在 `profile`/后端补展示名。
21. **契约 §11.2 未登记的 action**：`forum.reply`（后端用子资源 `replies`）、
    `faq.helpful`；以及未冻结的只读子资源 `forum/boards`、`faq/categories`。
    本端按后端实际路径调用并上报，**没有**改 `docs/` 与 `packages/`（Lead 独占）。

### 8.3 `wildlife` 新增的风险点（需要 `flutter analyze` 复核）

22. **新增依赖 `image_picker: ^1.1.2`**（本端第一次引入平台插件依赖）。
    用到的 API 面：`ImagePicker().pickMultiImage({imageQuality, limit})`、
    `XFile.readAsBytes()` / `XFile.name` / `XFile.mimeType`。若解析到别的版本，
    这一处需要按实际签名调整（`limit` 参数需要 image_picker ≥ 1.1.0）。
23. **`MethodChannelLocation` 的原生侧未实现**（`kedaya/location`，与
    `kedaya/unified_identity` 同样只有 Dart 侧契约）。此时定位返回 `null`，
    UI **自动降级到「在地图上点选」**——这条路径完整可用，不是占位。
24. **`RadioListTile` 的 `groupValue` / `onChanged`** 按 Flutter **3.27** 书写；
    若 SDK ≥3.32，会变成 deprecation 警告（需要改用 `RadioGroup`）。
25. **`InteractiveViewer(constrained: false)`** 承载固定尺寸的 `SizedBox`，
    点选模式假设"子画布左上角与视口左上角对齐"（恒等变换下成立）。
    如果实测点选坐标偏移，问题在这里，而不是在仿射标定（标定有往返单测）。
26. **`WildlifeSighting.geo` 在本端是**可空**的**：契约 §2.6 把 `geo` 写成必填，
    但规格 §9.3 ① / T10 要求敏感区**不输出任何坐标**。本端以隐私要求为准，
    并把这条冲突上报 Lead（见 `lib/features/wildlife/README.md` §6）。
27. **两处共享文件的纯增量改动**：`KedayaApiPort.sendMultipart`（规格 §4.1 的
    multipart 服务端代理上传需要它）与 `ApiRequest.contentType`（契约 §11.1 的
    JSON Merge Patch 需要它）。二者都没有改变既有行为，但属于
    `lib/domain/` 的公共面，建议 Lead 知悉。
28. **`FutureProvider.family<..., String?>`**（个体列表按物种过滤）用**可空 String**
    作 family 参数：riverpod 2.6.x 允许，但这是一个容易被 3.x 改掉的用法。

### 8.4 `buddy` 新增的风险点（需要 `flutter analyze` 复核）

29. **`DropdownButtonFormField.value`**（发布页的地点选择）按 Flutter **3.27** 书写；
    若 SDK ≥ 3.32，该参数被 `initialValue` 取代（deprecation 警告，仍可编译）。
    若要在新 SDK 上消掉警告，把 `value:` 换成 `initialValue:` 即可（只有一处）。
30. **`showTimePicker` / `showDatePicker` / `SegmentedButton` / `FilterChip` /
    `InputChip` / `Slider`** 均按 Flutter 3.27 的 API 书写。
31. **`buddyRecommendControllerProvider` 在 `build()` 里 `ref.watch(buddyProfileProvider)`**
    （为了让"刚打开匹配开关"立刻反映到推荐）。这会让推荐控制器在资料 provider
    从 loading 变 data 时**重建一次**（多一次本地 mock 查询，零延迟）。
    若实测有抖动，改成在 `BuddyActions.saveProfile` 里显式 `ref.invalidate` 即可
    （**已经**有那次 invalidate，watch 只是兜底）。
32. **`test/application/buddy_recommend_controller_test.dart` 的时序假设**：
    依赖"资料失效后的重建已完成"，用了轮询到非 loading 的 `settle()` 辅助函数
    （最多 50 次 `await Future.delayed(Duration.zero)`）。这是本机无法验证的部分里
    **最可能先失败**的一处（与 `forum`/`faq` 的同类辅助函数一致）。
33. **`test/domain/buddy_privacy_boundary_test.dart` 会读源码**（`File('lib/...')`）：
    相对路径依赖 `flutter test` 的工作目录 = 包根目录。若 CI 换了工作目录，
    该用例的 `expect(targets, isNotEmpty)` 会先失败（这是刻意的自检）。
34. **`buddyCampusLocations` 是占位白名单**（规格 §9 U10 未关闭）：
    上线前必须由产品/运营替换，落点是**一个常量**。
35. **`buddyTagCatalog` 是服务端标签表的客户端镜像**（规格 §3.2）：
    服务端新增标签后客户端选不到（功能缺失，不是数据损坏），需同步本表。
36. **顺手修掉了一个既有测试文件的编译错误**：`test/application/forum_controller_test.dart`
    第 136 行用了 `MockForumRepository(seed: ...)`，而该构造函数没有 `seed` 参数
    （`MockGroupbuyRepository` 才有）→ 已改为 `posts:`。这是与 `buddy` 无关的
    既有缺陷，会让**整套** `flutter test` 编译失败，因此一并修掉。

### 8.5 `techpie` / `campus-card` 新增的风险点（需要 `flutter analyze` 复核）

37. **`CampusPlatform` 与既有 `CampusSystem` 是两套枚举**：本模块按契约 §11.10-B 的裁决
    新建 `CampusPlatform`（`cas|egate|cpdaily|ecard|techpie`），**没有**改动被
    `CampusSessionPort` 使用的 `CampusSystem`（`egate|cpdaily|academic|ecard`）。
    两套枚举的合并需要 Lead 裁决（登记在 `lib/features/techpie/README.md` §7.6）。
38. **已按 `services/api` 的实现对齐了一轮**（只读核对，未改后端）：
    平台枚举、能力清单的 **13 条 id** 与并集键名、`phase0` 小写写法、
    `EXPIRED` / `PHASE_BLOCKED` 别名、票据兑换改 **POST**、票据不指定平台即
    **不要求绑定**（W4）、兑换响应 `expiresAt: null` 的兜底、`credential.kind=openid`、
    以及 `direction: 'out'|'in'` 这类取值差异的容错解析。
    **仍未收敛的是校园卡本身**：`services/api` 的 `campus-card` 目前是
    `scaffold.mjs` 生成的通用 CRUD（`items` + `summary`=汇总，不是余额；
    没有开通/解绑/付款码路由），而本端需要的是"开通 / 余额 / 流水 / 付款码"。
    逐条列在 `lib/features/techpie/README.md` §9.4–9.6，**需要后端/Lead 收敛**。
39. **`campusTargetUrlProblem` 只允许 443 端口**，因此规格 §8.4 的示例地址
    `https://ecourse.shanghaitech.edu.cn:8080/` 会被客户端**直接拒绝** ——
    这是刻意的（契约 §11.18-B 第 3 条晚于规格，`services/api` 的
    `checkCampusTargetUrl` 同样拒绝）。若实测该校园系统确实跑在 8080，
    需要 Lead 重新裁决；落点是**一处判断**。
40. **`unawaited(...)` 的用法**：`analysis_options.yaml` 打开了 `discarded_futures` /
    `unawaited_futures`，本模块的页面把所有 Future 回调都包了 `unawaited(...)`；
    但 `onRetry: controller.refresh` / `onRefresh: controller.refresh`
    （`techpie_bindings_page.dart`，2 处）仍沿用既有模块的 **tear-off** 写法。
    若 `flutter analyze` 报 `discarded_futures`，改成 `() => unawaited(controller.refresh())` 即可。
41. **两个测试文件会读源码**（`test/domain/techpie_source_invariants_test.dart`、
    `test/domain/techpie_two_tier_boundary_test.dart`，相对路径 = 包根）：
    与既有 `buddy` / `wildlife` 的边界测试同一策略 —— 若 CI 换了工作目录，
    它们会先失败（这是刻意的自检）。
42. **`campusDomainAllowlist` 与 `phase0CampusWebEntries` 是占位**（U11 未关闭）：
    两者各有一个**机器可见**的占位标记（`campusDomainAllowlistIsPlaceholder` /
    `phase0CampusWebEntriesArePlaceholder`），替换真实域名时必须同时改成 `false`。
43. **能力目录的阶段标注是客户端侧数据**（`lib/data/mock/techpie_fixtures.dart`）：
    真实运行时目录来自服务端，客户端只负责"不把 Phase 1+ 显示成可用"这条规则。
44. **原生侧 WebView / eCard 授权流程未实现**：`MethodChannelWebView` 已定义 channel
    契约（`kedaya/webview`），原生侧缺失时返回 `false`，页面走"本机暂不支持内嵌打开"的降级；
    真实 OPENID 与校园系统授权码都必须来自原生授权流程，本端**不伪造**。
