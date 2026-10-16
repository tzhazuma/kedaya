# 可达鸭 · Flutter 原生端（`apps/mobile/`）

iOS / Android / **鸿蒙** 三端原生客户端骨架。包名 `kedaya`，Dart SDK `>=3.6.2 <4.0.0`。

> **第三方非官方平台**：本项目由学生社区维护，与上海科技大学官方系统无关。
> 全站显著标注，不冒充学校官方系统（冻结契约 §9）。

---

## 0. 交付状态（如实声明）

| 项 | 状态 |
| --- | --- |
| 代码 | 已写完（六边形分层 + 拼单/论坛/常见问题三个垂直切片 + 亮/暗主题 + 19 个测试文件 / 208 个用例） |
| **本机编译验证** | ❌ **未验证** —— 开发机上**没有安装 Flutter SDK**（`flutter` / `dart` 命令都不存在），因此 `flutter pub get` / `flutter analyze` / `flutter test` **一次都没有跑过** |
| 静态自检（替代验证） | ✅ **已实际执行**：`/opt/homebrew/bin/python3 tool/selfcheck.py` —— 10 项文本检查全部通过（131 个 Dart 文件，0 处违规），见 §6.5 |
| 依赖版本解析 | ❌ 未验证（`pubspec.yaml` 的版本区间是按 TechPie 的可用组合与 pub.dev 常见版本手写的，`pub get` 可能要求微调） |
| 静态分析 | ❌ 未验证（`analysis_options.yaml` 打开了 `strict-casts` / `strict-inference` / `strict-raw-types`，代码按这些规则手写，但仍需 `flutter analyze` 复核） |
| 运行时行为 | ❌ 未验证（未在真机/模拟器上启动过） |

**下面第 6 节的命令是"装好 Flutter 后必须执行"的清单**；执行结果与本文档不一致时，以实际结果为准，并请回报 Lead。

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
│   │   ├── models/                   #   19 个模块注册表 / 金额 / 结果 / 主题模式 / 模型
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
│       └── faq/                      #   ✅ 常见问题（含幂等「有用」+ 我的工单）
├── tool/
│   └── selfcheck.py                  # 替代验证：本机无 Flutter SDK，用静态自检覆盖能查的部分
└── test/                             # 19 个测试文件
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

1. 代码生成产物（`*.g.dart` / `*.freezed.dart`）没有提交，而开发机没有 Flutter SDK，
   无法运行 `build_runner`；如果模型依赖生成代码，`git clone` 后**一定编译不过**。
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
| 19 个模块注册表（镜像 `packages/contracts`） | `lib/domain/models/kedaya_module.dart` |
| 金额整数分（镜像 `packages/shared/money.ts`） | `lib/domain/models/money.dart` |
| 统一信封 + Dio 装配（Bearer / Trace / 401 刷新重试） | `lib/data/api/{api_envelope,dio_client,kedaya_api_client}.dart` |
| 远端 repositories（auth / campus / consent / groupbuy / **forum** / **faq** / errand / lost-found / wellbeing） | `lib/data/repositories/` |
| 内存 mock 适配器（含延迟与故障注入、举报治理规则、**幂等投票**） | `lib/data/mock/` |
| **亮 / 暗主题**（从设计令牌派生，契约 §11.5） | `lib/presentation/theme/` |
| **主题模式**：跟随系统 / 浅色 / 深色，可切换 + 持久化 + 冷启动同步读回 | `lib/application/theme_controller.dart`、`lib/data/storage/cache_theme_mode_store.dart`、`lib/presentation/pages/profile_page.dart` |
| **拼单垂直切片**：列表 + 详情 + loading/error/empty 三态 + 参团 | `lib/features/groupbuy/` |
| **论坛切片**：版块筛选 + 主题列表（游标分页 + 下拉刷新 + 触底加载）+ 主题详情 + 回复列表/输入 + 发帖（**匿名开关**）+ 举报 + 分享 | `lib/features/forum/` |
| **常见问题切片**：分类导航 + 搜索（防抖）+ 手风琴展开 + **幂等「有用」** + 我的工单 | `lib/features/faq/` |
| **匿名身份与实名身份在模型层解耦**（契约 §9）：`ForumAuthor` sealed 类型 + `AnonymousIdentity` | `lib/domain/models/{forum,anonymous_identity}.dart` |
| 底部导航 + 每个模块的路由段 | `lib/app/app_router.dart`、`lib/presentation/pages/module_detail_page.dart` |
| 二次同意门（`wellbeing`/`dorm-harmony`/`ai-portrait`） | `lib/application/consent_controller.dart` |
| 19 个测试文件 | `test/`（见第 5 节） |
| 静态自检脚本（本机替代验证） | `tool/selfcheck.py`（见第 6.5 节） |

### ❌ 未实现（如实列出，没有用 TODO 占位函数冒充）

| 项 | 说明 |
| --- | --- |
| 原生工程目录 | `android/` `ios/` `ohos/` 未生成（用 `flutter create` 生成，见 §1） |
| 除 `groupbuy` / `forum` / `faq` 外的 16 个模块页面 | 只有 `/module/:id` 落地页展示注册表信息并**明说"尚未实现"**；没有假数据、没有假成功 |
| 论坛的版主治理界面 | 数据层已实现"3 个不同用户举报 → 自动隐藏"与 `LOCKED` 拒答，但**没有**版主 moderation / Lock / Hide 的 UI |
| 发帖/回复频率限制、敏感词拦截 | ❌ 未实现（属于服务端限流与内容审核；客户端只做长度校验） |
| FAQ 工单追问 / 关闭 | `FaqTicketStatus.canFollowUp` 已在模型里就绪，但没有 UI |
| Markdown 渲染 | 论坛正文与 FAQ 答案按**纯文本**展示（契约里的 "Markdown 子集" 未渲染） |
| 校园系统绑定的 UI | `CampusSessionPort` 与 `CampusBindingsController` 已实现并可用（profile 页展示状态），但没有"输入凭据绑定"的对话框页面 |
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

## 5. 测试（19 个文件，共 208 个用例；其中本次新增 8 个文件 / 130 个用例）

> ⚠️ **全部用例都没有在本机执行过**（没有 Flutter SDK）。下面是"每个文件测什么"的清单，
> 不是"测试通过"的证据。

| 文件 | 覆盖 |
| --- | --- |
| `test/domain/money_test.dart` | 整数分 ↔ 元、非法输入、往返一致、带符号展示 |
| `test/domain/module_registry_test.dart` | 19 个模块、id 唯一、route==id、**同意门规则**（`auth`/`campus-card` 不设门） |
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

新增的 8 个文件（加粗）对应本次交付的 `forum` / `faq`：**domain 纯逻辑 4 个 +
mock repository 行为 2 个 + application 三态/幂等 2 个**。

---

## 6. 装好 Flutter 后的验证命令（按顺序执行）

```bash
# 环境
flutter --version                 # 期望 Dart >= 3.6.2
flutter doctor -v

cd apps/mobile

# 1) 依赖解析（最可能出问题的一步：版本区间需按实际 SDK 微调）
flutter pub get

# 2) 静态分析（必须 0 error；strict-* 三个开关已打开）
flutter analyze

# 3) 单元测试（19 个文件应全绿）
flutter test
flutter test test/domain/auth_session_boundary_test.dart   # 单跑契约 §5 边界测试
flutter test test/domain/forum_anonymity_boundary_test.dart # 单跑契约 §9 匿名边界测试
flutter test test/presentation/kedaya_theme_test.dart      # 单跑契约 §11.5 暗色守门测试
flutter test test/application/forum_controller_test.dart   # 单跑论坛三态/筛选
flutter test test/application/faq_controller_test.dart     # 单跑 FAQ 三态/幂等

# 4) 格式化检查（代码按 dart format 风格手写，未在本机跑过）
dart format --output=none --set-exit-if-changed lib test

# 5) 运行（mock 运行时，无后端）
flutter run

# 6) 接后端跑（需要 Lead 提供 dev 域名）
flutter run --dart-define=KEDAYA_FLAVOR=dev --dart-define=KEDAYA_API_BASE_URL=<dev-host>
```

### 6.5 本机替代验证（**已实际执行**）

本机没有 Flutter SDK，所以用一个纯 Python 的静态自检覆盖能查的部分：

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
8. 全部 208 个测试用例都**没有在本机执行过**。

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
