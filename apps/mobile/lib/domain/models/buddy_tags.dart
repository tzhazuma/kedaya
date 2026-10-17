/// `buddy` 的**封闭标签表**与**校园地点白名单**（规格
/// `docs/features/buddy-matching.md` §3.2 / §2.2 / §9 U10）。
///
/// ## 唯一真相与生成物
///
/// 数据（62 个标签 / 25 个校园地点 / 4 个数量上限）的**唯一真相**是
/// `packages/contracts/src/buddy-tags.ts`。Dart 不能 import TS，因此：
///
///   - [buddyTagCatalog] / [buddyCampusLocationDefs] / 数量上限在
///     `buddy_tags.g.dart`，由 `scripts/sync-flutter-mirrors.mjs` **生成**；
///   - 类型（[BuddyTag] / [BuddyTagGroup] / [CampusLocationDef]）在
///     `buddy_tag.dart`，是稳定 API；
///   - 本文件只放**派生查询**（by key / 分组 / 搜索 / 白名单判定）。
///
/// 改了标签表请回到仓库根跑 `node scripts/sync-flutter-mirrors.mjs`，
/// CI 用 `--check` 拦截手改与漂移。
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
library;

import 'buddy_tag.dart';
import 'buddy_tags.g.dart';

export 'buddy_tag.dart';
export 'buddy_tags.g.dart';

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

// ------------------------------------------------------------- 规格常量（非生成物）
//
// 数量上限（20 / 10 / 8 / 5）在 `buddy_tags.g.dart`，来自契约。
// 下面这些是**界面/校验文案**用的长度上限，契约未以常量导出，留在手写层。

/// 规格 §2.2：每项 ≤ 24 字。
const int buddyInterestTagMaxLength = 24;

/// 规格 §2.2：`department` ≤ 64 字。
const int buddyDepartmentMaxLength = 64;

/// 规格 §2.2：`bio` ≤ 200 字。
const int buddyBioMaxLength = 200;

// -------------------------------------------------------------- 校园地点白名单

/// 地点是否在白名单内（精确匹配，去首尾空白）。
bool isKnownCampusLocation(String location) =>
    buddyCampusLocations.contains(location.trim());

/// `label -> key`（埋点/i18n 用）；未登记返回 null。
String? campusLocationKey(String label) {
  final String needle = label.trim();
  for (final CampusLocationDef location in buddyCampusLocationDefs) {
    if (location.label == needle) return location.key;
  }
  return null;
}
