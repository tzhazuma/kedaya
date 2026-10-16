/// `buddy` 的**封闭标签表**与**校园地点白名单**（规格
/// `docs/features/buddy-matching.md` §3.2 / §2.2 / §9 U10）。
///
/// ## 为什么必须是封闭标签
///
/// 规格 §3.2 的问题陈述：STUMatch 的 `interests` 是自由文本数组，共同兴趣靠
/// **字符串精确相等**（`matching.py:277-282` 的 `set` 交集）。自由文本会让
/// `"羽毛球"` / `"打羽毛球"` / `"badminton"` 互不匹配。
///
/// 本端的做法与规格一致：`interestTags` / `activityTags` / `BuddyPost.tags`
/// **一律取自本文件的封闭表**，不允许自由文本进入匹配特征。校验失败返回
/// `VALIDATION_FAILED` + `details.reason = UNKNOWN_TAG:<key>`（规格 §5.4）。
///
/// ## ⚠️ 真相在服务端，本文件是**客户端镜像**（已上报，见 feature README §6）
///
/// 规格 §3.2 明确：标签表**存在 DB（可运营）**，字段为
/// `key` / `label` / `group` / `aliases` / `isActive`，且
/// 「标签表变更必须走 migration + 审计，**不得运行时改**」。
/// 也就是说：**权威表在服务端**，本文件只是客户端为了
/// 「封闭选择器 + 提交前预校验 + 理由文案本地渲染」而留的一份镜像。
///
/// 因此：
///   - 客户端**只发 key**，显示名一律按本表渲染；
///   - 服务端新增标签后，本表必须同步（否则用户选不到新标签 —— 这是
///     **功能缺失**，不是数据损坏）；
///   - 服务端删除/下架标签（`isActive: false`）时，本表把该项标记为
///     [BuddyTag.isActive] `false`：**历史数据仍能渲染**，但选择器不再展示，
///     与规格「下架标签不删除（历史数据仍引用）」一致。
///
/// **规格 §9 U10 仍未关闭**：校园地点白名单由谁维护、内容是什么**至今没有答案**。
/// [buddyCampusLocations] 是一份**上科大校园地点的合理占位**，不是权威清单，
/// 上线前必须由产品/运营替换（见 feature README §6 的未决项）。
library;

/// 标签分组（规格 §3.2：`enum<sport|study|meal|travel|interest>`，供 UI 分栏）。
enum BuddyTagGroup {
  sport('sport', '运动'),
  study('study', '学习'),
  meal('meal', '吃饭'),
  travel('travel', '出行'),
  interest('interest', '兴趣');

  const BuddyTagGroup(this.wire, this.label);

  final String wire;
  final String label;

  static BuddyTagGroup? fromWire(String wire) {
    for (final BuddyTagGroup value in BuddyTagGroup.values) {
      if (value.wire == wire) return value;
    }
    return null;
  }
}

/// 一个封闭标签（规格 §3.2 的表结构）。
final class BuddyTag {
  const BuddyTag({
    required this.key,
    required this.label,
    required this.group,
    this.aliases = const <String>[],
    this.isActive = true,
  });

  /// 机器值（进匹配特征、进请求体的**唯一**形式），如 `badminton`。
  final String key;

  /// 中文显示名，如 `羽毛球`。
  final String label;

  final BuddyTagGroup group;

  /// 别名词表。**仅用于搜索**，不用于匹配（规格 §3.2）。
  final List<String> aliases;

  /// 下架标签不删除（历史数据仍引用）。
  final bool isActive;

  /// 搜索用文本（key + label + aliases 的小写拼接）。
  String get searchText => <String>[key, label, ...aliases].join(' ').toLowerCase();

  @override
  String toString() => 'BuddyTag($key, $label)';
}

/// 封闭标签表（客户端镜像，见文件头注释）。
///
/// 顺序 = UI 展示顺序：先按 [BuddyTagGroup] 的声明顺序，组内按本列表顺序。
const List<BuddyTag> buddyTagCatalog = <BuddyTag>[
  // ---------------------------------------------------------------- sport
  BuddyTag(
    key: 'badminton',
    label: '羽毛球',
    group: BuddyTagGroup.sport,
    aliases: <String>['打羽毛球', '羽球'],
  ),
  BuddyTag(key: 'basketball', label: '篮球', group: BuddyTagGroup.sport),
  BuddyTag(key: 'football', label: '足球', group: BuddyTagGroup.sport),
  BuddyTag(
    key: 'running',
    label: '跑步',
    group: BuddyTagGroup.sport,
    aliases: <String>['夜跑', '晨跑'],
  ),
  BuddyTag(key: 'fitness', label: '健身', group: BuddyTagGroup.sport),
  BuddyTag(key: 'tabletennis', label: '乒乓球', group: BuddyTagGroup.sport),
  BuddyTag(key: 'swimming', label: '游泳', group: BuddyTagGroup.sport),
  BuddyTag(key: 'tennis', label: '网球', group: BuddyTagGroup.sport),
  BuddyTag(key: 'yoga', label: '瑜伽', group: BuddyTagGroup.sport),
  BuddyTag(key: 'indoor', label: '室内', group: BuddyTagGroup.sport),
  BuddyTag(key: 'outdoor', label: '户外', group: BuddyTagGroup.sport),
  BuddyTag(key: 'cycling', label: '骑行', group: BuddyTagGroup.sport),
  // ---------------------------------------------------------------- study
  BuddyTag(
    key: 'selfstudy',
    label: '自习',
    group: BuddyTagGroup.study,
    aliases: <String>['刷题', '学习'],
  ),
  BuddyTag(key: 'library', label: '图书馆', group: BuddyTagGroup.study),
  BuddyTag(key: 'examprep', label: '备考', group: BuddyTagGroup.study),
  BuddyTag(key: 'coding', label: '编程', group: BuddyTagGroup.study),
  BuddyTag(key: 'english', label: '英语', group: BuddyTagGroup.study),
  BuddyTag(key: 'reading', label: '阅读', group: BuddyTagGroup.study),
  BuddyTag(key: 'groupproject', label: '课程项目', group: BuddyTagGroup.study),
  // ----------------------------------------------------------------- meal
  BuddyTag(key: 'canteen', label: '食堂', group: BuddyTagGroup.meal),
  BuddyTag(key: 'hotpot', label: '火锅', group: BuddyTagGroup.meal),
  BuddyTag(key: 'bbq', label: '烧烤', group: BuddyTagGroup.meal),
  BuddyTag(key: 'coffee', label: '咖啡', group: BuddyTagGroup.meal),
  BuddyTag(key: 'latenight', label: '夜宵', group: BuddyTagGroup.meal),
  BuddyTag(key: 'brunch', label: '早午餐', group: BuddyTagGroup.meal),
  // --------------------------------------------------------------- travel
  BuddyTag(key: 'subway', label: '地铁出行', group: BuddyTagGroup.travel),
  BuddyTag(key: 'carpool', label: '拼车', group: BuddyTagGroup.travel),
  BuddyTag(key: 'airport', label: '机场接送', group: BuddyTagGroup.travel),
  BuddyTag(key: 'weekendtrip', label: '周末出游', group: BuddyTagGroup.travel),
  BuddyTag(key: 'downtown', label: '市区', group: BuddyTagGroup.travel),
  // ------------------------------------------------------------- interest
  BuddyTag(key: 'boardgame', label: '桌游', group: BuddyTagGroup.interest),
  BuddyTag(key: 'gaming', label: '电子游戏', group: BuddyTagGroup.interest),
  BuddyTag(key: 'movie', label: '电影', group: BuddyTagGroup.interest),
  BuddyTag(key: 'music', label: '音乐', group: BuddyTagGroup.interest),
  BuddyTag(key: 'ktv', label: '唱 K', group: BuddyTagGroup.interest),
  BuddyTag(key: 'photography', label: '摄影', group: BuddyTagGroup.interest),
  BuddyTag(key: 'hiking', label: '徒步', group: BuddyTagGroup.interest),
  BuddyTag(key: 'anime', label: '动漫', group: BuddyTagGroup.interest),
  BuddyTag(key: 'museum', label: '看展', group: BuddyTagGroup.interest),
  BuddyTag(key: 'pet', label: '撸猫', group: BuddyTagGroup.interest),
];

/// `key -> BuddyTag`（含下架标签：历史数据仍要能渲染显示名）。
final Map<String, BuddyTag> buddyTagByKey = <String, BuddyTag>{
  for (final BuddyTag tag in buddyTagCatalog) tag.key: tag,
};

/// 当前**可选**的标签（`isActive`）。选择器只展示这些。
List<BuddyTag> get buddyActiveTags =>
    buddyTagCatalog.where((BuddyTag tag) => tag.isActive).toList(growable: false);

/// 按分组取可选标签。
List<BuddyTag> buddyActiveTagsOfGroup(BuddyTagGroup group) => buddyTagCatalog
    .where((BuddyTag tag) => tag.isActive && tag.group == group)
    .toList(growable: false);

/// 标签是否已登记（**下架标签也算已登记** —— 历史数据不能被判成非法）。
bool isKnownBuddyTag(String key) => buddyTagByKey.containsKey(key);

/// 标签是否可选（已登记 **且** 未下架）。提交新数据时用这个。
bool isActiveBuddyTag(String key) => buddyTagByKey[key]?.isActive ?? false;

/// 显示名；未登记的 key **原样返回**（宁可显示机器值，也不要吞掉数据）。
String buddyTagLabel(String key) => buddyTagByKey[key]?.label ?? key;

/// 批量转显示名。
List<String> buddyTagLabels(Iterable<String> keys) =>
    keys.map(buddyTagLabel).toList(growable: false);

/// 模糊搜索标签（key / label / aliases，大小写不敏感）。空关键词返回全部可选标签。
List<BuddyTag> searchBuddyTags(String keyword, {BuddyTagGroup? group}) {
  final String needle = keyword.trim().toLowerCase();
  return buddyActiveTags
      .where((BuddyTag tag) => group == null || tag.group == group)
      .where((BuddyTag tag) => needle.isEmpty || tag.searchText.contains(needle))
      .toList(growable: false);
}

// ------------------------------------------------------------------ 数量上限

/// 规格 §2.2：`interestTags` ≤ 20 项。
const int buddyInterestTagMaxCount = 20;

/// 规格 §2.2：每项 ≤ 24 字。
const int buddyInterestTagMaxLength = 24;

/// 规格 §2.2：`activityTags` ≤ 10 项。
const int buddyActivityTagMaxCount = 10;

/// 规格 §2.3：`BuddyPost.tags` ≤ 8 项。
const int buddyPostTagMaxCount = 8;

/// 规格 §2.2：`preferredAreas` ≤ 5 项。
const int buddyPreferredAreaMaxCount = 5;

/// 规格 §2.2：`department` ≤ 64 字。
const int buddyDepartmentMaxLength = 64;

/// 规格 §2.2：`bio` ≤ 200 字。
const int buddyBioMaxLength = 200;

// -------------------------------------------------------------- 校园地点白名单

/// 校园地点白名单（`location` 与 `preferredAreas` 共用）。
///
/// ⚠️ **占位清单，不是权威数据**（规格 §9 U10 未关闭：白名单由谁维护、内容是什么
/// 至今没有答案）。上线前必须由产品/运营替换；替换点只有本常量与
/// [isKnownCampusLocation] 一处。
const List<String> buddyCampusLocations = <String>[
  '图书馆',
  '图书馆一楼咖啡角',
  '一食堂',
  '二食堂',
  '三食堂',
  '体育馆',
  '体育馆 3 号场',
  '游泳馆',
  '田径场',
  '篮球场',
  '网球场',
  '教学中心',
  '学生服务中心',
  '信息科学与技术学院',
  '生命科学与技术学院',
  '物质科学与技术学院',
  '创业与管理学院',
  '生物医学工程学院',
  '5 号宿舍楼',
  '6 号宿舍楼',
  '8 号宿舍楼',
  '校门口',
  '张江地铁站',
];

/// 地点是否在白名单内（精确匹配，去首尾空白）。
bool isKnownCampusLocation(String location) =>
    buddyCampusLocations.contains(location.trim());
