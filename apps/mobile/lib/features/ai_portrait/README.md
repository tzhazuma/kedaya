# `ai-portrait`（AI 校园画像）

契约模块 id：`ai-portrait`；敏感级 **high**；`requiresConsent: true`。
目录名用 `ai_portrait`（Dart 包内下划线路径），模块 id 仍是 `ai-portrait`。

## 页面与路由

| 页面 | 类 | 建议路由 |
| --- | --- | --- |
| AI 校园画像 | `AiPortraitPage` | `/ai-portrait` |

路由定义在 `presentation/ai_portrait_routes.dart` 的 `buildAiPortraitRoutes()`。
当前任务边界不允许修改 `lib/app/app_router.dart`，装配时需要：

```dart
import '../features/ai_portrait/presentation/ai_portrait_routes.dart';

// createAppRouter(...) 的 routes 里：
...buildAiPortraitRoutes(),
```

同时需要在 `presentation/pages/module_detail_page.dart` 的
`implementedModuleRoutes` 增加 `'ai-portrait': '/ai-portrait'`（该文件不在本模块可改范围内）。

## 红线落点

1. **只读**：`CampusPortraitRepository` 只有 `load()` / `clear()`，
   没有 save / generate / infer；页面没有「生成画像」入口。
2. **空态**：没有画像时返回 `null`，页面显示
   「暂无画像；画像需要足够的、你授权的数据」，不在客户端编造标签。
3. **来源必填**：`PortraitTag` 构造函数拒绝空来源；每个标签用
   `sourceLine` 显示「来源：课表 · 2026-11-20」这样的来源 + 更新时间。
4. **显著声明**：「心理支持与宿舍矛盾不参与画像」在页面顶部横幅常驻，
   不受同意门 / 数据加载状态影响。
5. **删除**：有画像时在画像卡内、空态 / 错误态在页面按钮处显示
   「删除我的画像」；确认后清空本机 `aiPortrait.current.v1`，
   回到空态并提示「已删除本机画像」。空态点击只会清空本机残留数据。
6. **演示标签**：`PortraitDemoPreview` 是静态示例，整体标注「演示数据」，
   明示「不是你的画像」，不写入本机。
7. **不做分享 / 举报**：本目录没有 `SharePort` / 举报入口。

## 文件

```
application/ai_portrait_providers.dart    # 同意门 + 只读控制器
data/campus_portrait_repository.dart      # 本机只读仓库（LocalCachePort）
presentation/components/                  # 边界横幅 / 同意门 / 标签 / 演示卡
presentation/pages/ai_portrait_page.dart  # AiPortraitPage
presentation/ai_portrait_routes.dart      # GoRoute 工厂
```

领域模型：`lib/domain/models/campus_portrait.dart`。
测试：`test/ai_portrait_test.dart`。

## 实现说明

- **为什么 feature 内有 `data/`**：顶层 `lib/data/` 不在本次可改范围；
  这里的 repository 只经 `LocalCachePort` 读取/删除本机画像，不发任何网络请求。
- **为什么没有「生成画像」入口**：后端尚无画像生成逻辑，`GET /me` 返回 `null`
  是常态；客户端编造标签会直接违反红线。演示标签是页面里的静态预览，
  不写入本机、不作为任何人的画像。
- 顶层 `lib/features/README.md` 与 `apps/mobile/README.md` 的模块状态表
  仍把本模块列为未实现；它们不在本次可改范围，需要在集成时更新。

