/// 宿舍矛盾（`dorm-harmony`）—— **匿名倾诉板**，不是公开举报墙。
///
/// ## 产品边界写在类型里
///
/// 帖子没有作者 id、没有「举报对象」字段，只有由楼栋 + 顺序派生的匿名代号。
/// 因此「点名某个人」这件事在数据结构上就无处可放：正文是自由文本，但
/// 模型本身不提供任何指向实名身份的字段，客户端也不持有匿名↔实名的映射。
///
/// ## 回复是帖子的一部分
///
/// 本模块是**本机内存演示**，回复直接挂在 [DormPost.replies] 上，
/// `replyCount` 永远等于回复列表长度，不存在"计数和列表对不上"的中间态。
library;

/// 正文上限（产品口径：≤500 字）。
const int dormPostBodyMax = 500;

/// 示例楼栋（5 个）。筛选 chip 与发帖选择器共用这一份清单。
const List<String> dormBuildings = <String>[
  '1 号楼',
  '2 号楼',
  '3 号楼',
  '4 号楼',
  '5 号楼',
];

/// 正文长度（按字符计；Dart 的 [String.length] 对中文按字计数）。
int dormBodyLength(String body) => body.trim().length;

/// 是否在正文上限内。
bool isDormBodyWithinLimit(String body) =>
    dormBodyLength(body) <= dormPostBodyMax;

/// A / B / … / Z / AA / AB …（从 1 开始）。
String dormAliasLetter(int sequence) {
  if (sequence <= 0) return 'A';
  int value = sequence;
  String result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + value % 26) + result;
    value ~/= 26;
  }
  return result;
}

/// 匿名代号：`1 号楼 · 同学 A`。
///
/// [sequence] 是该楼栋内的发帖顺序；同一个人多次发帖会得到不同代号，
/// 这是演示期的取舍 —— 不建立「用户 → 代号」的稳定映射，避免反向识别。
String dormAnonymousAlias({
  required String building,
  required int sequence,
  String role = '同学',
}) =>
    '$building · $role ${dormAliasLetter(sequence)}';

/// 摘要：压平换行、截断到 [maxLength]。
String dormExcerpt(String body, {int maxLength = 64}) {
  final String normalized = body.trim().replaceAll(RegExp(r'\s+'), ' ');
  if (normalized.length <= maxLength) return normalized;
  return '${normalized.substring(0, maxLength)}…';
}

/// 一条匿名回复。
final class DormReply {
  const DormReply({
    required this.id,
    required this.alias,
    required this.body,
    required this.createdAt,
  });

  final String id;

  /// 匿名代号（与发帖同一个生成器，role 为「匿名」）。
  final String alias;

  final String body;
  final DateTime createdAt;

  DormReply copyWith({String? body}) => DormReply(
        id: id,
        alias: alias,
        body: body ?? this.body,
        createdAt: createdAt,
      );

  @override
  bool operator ==(Object other) => other is DormReply && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'DormReply($id, $alias)';
}

/// 匿名帖子。
final class DormPost {
  const DormPost({
    required this.id,
    required this.building,
    required this.title,
    required this.body,
    required this.alias,
    required this.createdAt,
    this.replies = const <DormReply>[],
  });

  final String id;
  final String building;
  final String title;
  final String body;

  /// 完整匿名代号，例：`1 号楼 · 同学 A`。
  final String alias;

  final DateTime createdAt;
  final List<DormReply> replies;

  int get replyCount => replies.length;

  String get excerpt => dormExcerpt(body);

  /// 列表里把楼栋与代号分开显示时用：`同学 A`。
  String get aliasTail {
    final int separator = alias.lastIndexOf(' · ');
    return separator == -1 ? alias : alias.substring(separator + 3);
  }

  DormPost copyWith({List<DormReply>? replies}) => DormPost(
        id: id,
        building: building,
        title: title,
        body: body,
        alias: alias,
        createdAt: createdAt,
        replies: replies ?? this.replies,
      );

  @override
  bool operator ==(Object other) => other is DormPost && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'DormPost($id, $building, $title)';
}

/// 发帖草稿（**不含匿名代号**：代号由仓库在写入时生成）。
final class DormPostDraft {
  const DormPostDraft({
    required this.building,
    required this.title,
    required this.body,
  });

  final String building;
  final String title;
  final String body;
}

/// 发帖校验问题。
enum DormPostProblem {
  buildingUnknown,
  titleRequired,
  bodyRequired,
  bodyTooLong,
}

/// 校验草稿。页面只负责展示，规则集中在这里。
List<DormPostProblem> validateDormPostDraft(DormPostDraft draft) {
  final List<DormPostProblem> problems = <DormPostProblem>[];
  if (!dormBuildings.contains(draft.building)) {
    problems.add(DormPostProblem.buildingUnknown);
  }
  if (draft.title.trim().isEmpty) {
    problems.add(DormPostProblem.titleRequired);
  }
  final String body = draft.body.trim();
  if (body.isEmpty) {
    problems.add(DormPostProblem.bodyRequired);
  } else if (body.length > dormPostBodyMax) {
    problems.add(DormPostProblem.bodyTooLong);
  }
  return problems;
}

/// 面向用户的问题文案。
String describeDormPostProblem(DormPostProblem problem) => switch (problem) {
      DormPostProblem.buildingUnknown => '请选择楼栋。',
      DormPostProblem.titleRequired => '标题不能为空。',
      DormPostProblem.bodyRequired => '正文不能为空。',
      DormPostProblem.bodyTooLong => '正文最多 $dormPostBodyMax 字，请删减后再发。',
    };
