/// 校园地点目录（`campus-map`）—— 纯本地展示模型。
///
/// 这个模块**没有接地图 SDK**：没有底图、没有定位、没有路线规划。它就是一个
/// 可筛选的地点目录，坐标只用于「复制到地图 App」这一条降级路径。
/// 因此模型里也没有 `CampusPlacePort`：数据是编译期种子，不发网络请求。
///
/// 坐标全部是**演示值**，页面上的说明必须与这一点保持一致（见
/// `CampusMapPage` 顶部的提示卡）。真实坐标要等校方授权后由 `data/` 适配。
library;

/// 地点分类 —— 对应页面上除「全部」以外的五个 chip。
///
/// 「全部」不是枚举值，而是 `null`：这样「选中全部分类」与「不筛选」在类型上
/// 是同一件事，不会出现两个都表示全部的取值。
enum CampusPlaceCategory {
  teaching('教学'),
  dining('餐饮'),
  sports('运动'),
  service('服务'),
  dorm('宿舍');

  const CampusPlaceCategory(this.label);

  /// 面向用户的分类名（chip 与列表标签共用）。
  final String label;
}

/// 一个校园地点。
///
/// 字段按**列表页要显示什么**来定：名称、分类、楼栋/楼层、开放时间、到最近校门
/// 的步行分钟数；详情页再加简介与坐标。没有的字段不编造 —— 比如不写「容纳人数」
/// 或「实时拥挤度」，因为演示目录里没有可靠来源。
final class CampusPlace {
  const CampusPlace({
    required this.id,
    required this.name,
    required this.category,
    required this.building,
    required this.floor,
    required this.openingHours,
    required this.nearestGate,
    required this.walkMinutesToNearestGate,
    required this.description,
    required this.latitude,
    required this.longitude,
    this.aliases = const <String>[],
  });

  /// 稳定 id（路由 `/campus-map/:id` 使用）。
  final String id;

  /// 正式名称（列表主标题）。
  final String name;

  /// 常见叫法（「信息学院」「SIST」…），参与搜索。
  final List<String> aliases;

  final CampusPlaceCategory category;

  /// 楼栋（「信息学院 1 号楼」）。
  final String building;

  /// 楼层（「3 层」「地面层」）。
  final String floor;

  /// 开放时间的人话描述（允许含「工作日」「考试周」等限定）。
  final String openingHours;

  /// 最近校门（「东门」「南门」）。
  final String nearestGate;

  /// 步行到最近校门的分钟数（**演示值**，不是路线规划结果）。
  final int walkMinutesToNearestGate;

  /// 简介：一至两句话说清「这里是什么 / 什么时候来」。
  final String description;

  /// 演示坐标（WGS84 量级，但**不是**实测值）。
  final double latitude;

  final double longitude;

  /// 楼栋 + 楼层的展示文本。
  String get buildingAndFloor => '$building · $floor';

  /// 到最近校门的步行说明。
  String get walkSummary => '步行约 $walkMinutesToNearestGate 分钟到$nearestGate';

  /// 「复制位置描述」写进剪贴板的文本：名称 + 楼栋 + 楼层。
  ///
  /// 用全角括号而不是换行：粘到聊天窗口里仍然是一句完整的话，
  /// 不会因为聊天软件折叠换行而把楼栋和名称拆开。
  String get locationCopyText => '$name（$buildingAndFloor）';

  /// 「在地图中打开」实际复制的文本：`纬度, 经度`。
  ///
  /// 固定 6 位小数：多数地图 App 的搜索框都能直接解析这个格式，
  /// 同时避免 `double.toString()` 在长尾小数上产生一长串数字。
  String get coordinatesCopyText =>
      '${latitude.toStringAsFixed(6)}, ${longitude.toStringAsFixed(6)}';

  /// 关键词是否命中这个地点。
  ///
  /// **只搜名称、别名、楼栋** —— 简介与开放时间不参与，否则搜「打印」会把
  /// 整篇简介里提过打印的地点都捞出来，结果看起来像坏了。
  /// 匹配前统一去掉空白并转小写，所以「1号楼」与「1 号楼」等价。
  bool matchesQuery(String query) {
    final String needle = normalizeCampusPlaceQuery(query);
    if (needle.isEmpty) return true;
    if (_containsNormalized(name, needle)) return true;
    if (_containsNormalized(building, needle)) return true;
    for (final String alias in aliases) {
      if (_containsNormalized(alias, needle)) return true;
    }
    return false;
  }
}

/// 关键词归一化：去首尾空白、转小写、去掉中间所有空白。
///
/// 公开这个函数是为了让「1号楼」与「1 号楼」这类等价性可以被单测直接锁定，
/// 而不是散落在页面里的临时处理。
String normalizeCampusPlaceQuery(String value) =>
    value.toLowerCase().replaceAll(RegExp(r'\s+'), '');

bool _containsNormalized(String haystack, String normalizedNeedle) =>
    normalizeCampusPlaceQuery(haystack).contains(normalizedNeedle);

/// 按分类 + 关键词筛选（两个条件是**叠加**关系）。
///
/// [category] 为 `null` 表示全部分类；[query] 为空表示不搜索。
/// 返回顺序与输入一致（种子顺序就是编辑顺序），这样同一筛选条件下的列表
/// 不会因为重建而跳动。
List<CampusPlace> filterCampusPlaces(
  List<CampusPlace> places, {
  CampusPlaceCategory? category,
  String query = '',
}) =>
    <CampusPlace>[
      for (final CampusPlace place in places)
        if ((category == null || place.category == category) &&
            place.matchesQuery(query))
          place,
    ];

/// 按 id 找地点；找不到返回 `null`（详情页据此显示「地点不存在」而不是崩溃）。
CampusPlace? campusPlaceById(List<CampusPlace> places, String id) {
  for (final CampusPlace place in places) {
    if (place.id == id) return place;
  }
  return null;
}
