import 'json_read.dart';

/// 匿名身份（冻结契约 §9：「匿名可用 …… 与实名身份解耦存储」）。
///
/// **关键设计**：本类**没有** `userId` 字段，也没有任何能指回实名身份的字段。
/// 在 `forum.dart` 里，作者被建模为 sealed 类型 `ForumAuthor`，实名作者
/// (`RealAuthor`) 与匿名作者 (`AnonymousAuthor`) 是**两个不同的类型** ——
/// 于是"匿名帖子里仍然带着 userId"这类事故在**类型层面**就不可能发生，
/// 而不是靠 code review 记得去清理。
///
/// 契约 §2.4 补充：同一 [AnonymousIdentity] 在版块内**可被版主追溯**，
/// 对普通用户不可见。追溯依赖后端持有的 匿名 id ↔ 实名 id 映射表，
/// **客户端永远不持有该映射**，因此客户端也无法反推匿名背后是谁。
final class AnonymousIdentity {
  const AnonymousIdentity({required this.id, required this.alias, this.boardId});

  factory AnonymousIdentity.fromJson(Map<String, Object?> json) => AnonymousIdentity(
    id: readString(json, 'id'),
    alias: readString(json, 'alias'),
    boardId: readStringOrNull(json, 'boardId'),
  );

  /// 匿名身份 id。由后端在**另一个命名空间**生成，与实名 `userId` 不可互推。
  final String id;

  /// 展示用别名，例如「匿名鸭 #7」。
  final String alias;

  /// 该匿名身份所属版块；版主追溯以此为范围（跨版块不可关联）。
  final String? boardId;

  String get displayName => alias;

  /// 派生一个匿名身份。
  ///
  /// 方向是**单向**的：只有 `boardId + sequence` 两个入参，因此从结果无法反推
  /// 是哪个实名用户 —— 这正是"解耦"在 API 形状上的体现。
  /// [sequence] 由后端按 (用户, 版块) 稳定分配，所以同一人在同一版块的匿名身份
  /// 是稳定的（版主可追溯），但跨版块不相关。
  factory AnonymousIdentity.derive({required String boardId, required int sequence}) =>
      AnonymousIdentity(
        id: 'anon-$boardId-$sequence',
        alias: '匿名鸭 #$sequence',
        boardId: boardId,
      );

  Map<String, Object?> toJson() => <String, Object?>{
    'id': id,
    'alias': alias,
    if (boardId != null) 'boardId': boardId,
  };

  @override
  bool operator ==(Object other) => other is AnonymousIdentity && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'AnonymousIdentity($id, $alias)';
}
