/// `campus-map` 的路由常量。
///
/// 路由注册在 `lib/app/app_router.dart`（`app/` 的职责）。本文件只提供常量，
/// 避免页面里手写字符串；接线片段见本 feature 的 `README.md`。
abstract final class CampusMapRoutes {
  const CampusMapRoutes._();

  /// 地点目录：`/campus-map`。
  static const String list = '/campus-map';

  /// 契约 §4 的模块 id（`implementedModuleRoutes` 的 key）。
  static const String moduleId = 'campus-map';

  /// 详情：`/campus-map/:id`。
  static const String detailPattern = '/campus-map/:id';

  static const String listName = 'campus-map';
  static const String detailName = 'campus-map-detail';

  /// 某个地点的详情路径。
  static String detail(String placeId) => '$list/$placeId';
}
