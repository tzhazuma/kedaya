/// 找搭子的**类型**（不是数据）：标签分组、标签、校园地点。
///
/// ## 为什么类型与数据分家
///
/// 标签与地点是**封闭表**，唯一真相在 `packages/contracts/src/buddy-tags.ts`。
/// Dart 无法 import TS，因此数据由 `scripts/sync-flutter-mirrors.mjs` 生成到
/// `buddy_tags.g.dart`；本文件只保留稳定的**类型**与 UI 分组文案。
/// 这样生成物可以整体重写，而消费方的类型名不变。
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

/// 校园地点（`key` 是稳定机器标识，`label` 才是提交给服务端的 wire value）。
final class CampusLocationDef {
  const CampusLocationDef({required this.key, required this.label});

  final String key;
  final String label;

  @override
  String toString() => 'CampusLocationDef($key, $label)';
}
