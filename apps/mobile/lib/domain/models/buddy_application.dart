/// `buddy` 的**申请**模型与命令（规格 `docs/features/buddy-matching.md` §2.4 / §2.8 / §5.5 / §5.6）。
///
/// 契约 `02-domain-model.md` §2.3 已冻结 `BuddyApplication`：
/// `postId` / `applicantId` / `status`(`PENDING|ACCEPTED|REJECTED|WITHDRAWN`) / `message`(≤200 字)。
/// 本规格新增 `decidedAt` / `decidedBy`（规格 §2.4）。
///
/// **唯一约束**：`@@unique([postId, applicantId])` —— 同一人对同一活动只能有一条申请记录。
/// 撤回后重新申请是**更新**该行回 `PENDING`，不是插新行（规格 §2.4 / 未决项 U7）。
library;

import 'buddy.dart';
import 'json_read.dart';
import 'validate.dart';

/// 申请状态机（规格 §2.8，与契约一致 + `WITHDRAWN → PENDING` 补充）。
enum BuddyApplicationStatus {
  pending('PENDING', '待审批'),
  accepted('ACCEPTED', '已接受'),
  rejected('REJECTED', '已拒绝'),
  withdrawn('WITHDRAWN', '已撤回'),

  /// 未登记状态：按**不可操作**处理（保守）。
  unknown('unknown', '未知');

  const BuddyApplicationStatus(this.wire, this.label);

  final String wire;
  final String label;

  static BuddyApplicationStatus fromWire(String wire) {
    final String normalized = wire.trim().toUpperCase();
    for (final BuddyApplicationStatus value in BuddyApplicationStatus.values) {
      if (value != BuddyApplicationStatus.unknown && value.wire == normalized) {
        return value;
      }
    }
    return BuddyApplicationStatus.unknown;
  }

  /// 只有 `PENDING` 能被发起人审批 / 被申请人撤回（规格 §5.6）。
  bool get isPending => this == BuddyApplicationStatus.pending;

  /// 终态：不会再发生转移。
  bool get isTerminal =>
      this == BuddyApplicationStatus.accepted ||
      this == BuddyApplicationStatus.rejected ||
      this == BuddyApplicationStatus.unknown;
}

/// `canTransition(from, to)` —— 规格 §2.8 的申请状态机，**纯函数**。
///
/// ```
/// [*] → PENDING        （申请）
/// PENDING → ACCEPTED   （发起人接受）
/// PENDING → REJECTED   （发起人拒绝）
/// PENDING → WITHDRAWN  （申请人撤回）
/// WITHDRAWN → PENDING  （重新申请，为 @@unique([postId, applicantId]) 服务）
/// ```
bool canTransitionBuddyApplication(
  BuddyApplicationStatus from,
  BuddyApplicationStatus to,
) {
  if (from == to) return false;
  return switch (from) {
    BuddyApplicationStatus.pending =>
      to == BuddyApplicationStatus.accepted ||
          to == BuddyApplicationStatus.rejected ||
          to == BuddyApplicationStatus.withdrawn,
    BuddyApplicationStatus.withdrawn => to == BuddyApplicationStatus.pending,
    BuddyApplicationStatus.accepted ||
    BuddyApplicationStatus.rejected ||
    BuddyApplicationStatus.unknown => false,
  };
}

/// 审批结论（规格 §5.6：`decide` 不拆成 `accept` / `reject`）。
///
/// 规格 §5.2 的理由：两者共享全部前置校验（必须是发起人、申请必须 `PENDING`、
/// 名额检查），拆开会产生两份重复的守卫代码。
enum BuddyDecision {
  accepted('ACCEPTED', '接受'),
  rejected('REJECTED', '拒绝');

  const BuddyDecision(this.wire, this.label);

  final String wire;
  final String label;

  /// 该结论对应的目标状态。
  BuddyApplicationStatus get targetStatus => this == BuddyDecision.accepted
      ? BuddyApplicationStatus.accepted
      : BuddyApplicationStatus.rejected;

  static BuddyDecision? tryFromWire(String wire) {
    final String normalized = wire.trim().toUpperCase();
    for (final BuddyDecision value in BuddyDecision.values) {
      if (value.wire == normalized) return value;
    }
    return null;
  }
}

/// 一条申请（契约 §2.3 + 规格 §2.4）。
final class BuddyApplication {
  const BuddyApplication({
    required this.id,
    required this.postId,
    required this.applicantId,
    required this.createdAt,
    this.applicantName,
    this.message,
    this.status = BuddyApplicationStatus.pending,
    this.decidedAt,
    this.decidedBy,
  });

  factory BuddyApplication.fromJson(Map<String, Object?> json) => BuddyApplication(
    id: readString(json, 'id'),
    postId: readString(json, 'postId'),
    applicantId: readString(json, 'applicantId'),
    applicantName: readStringOrNull(json, 'applicantName'),
    message: readStringOrNull(json, 'message'),
    status: BuddyApplicationStatus.fromWire(readStringOr(json, 'status', 'PENDING')),
    createdAt: readDateTime(json, 'createdAt'),
    decidedAt: readDateTimeOrNull(json, 'decidedAt'),
    decidedBy: readStringOrNull(json, 'decidedBy'),
  );

  final String id;
  final String postId;
  final String applicantId;

  /// 申请人展示名（后端可选下发；为空时回落为 id）。
  final String? applicantName;

  /// 申请留言（≤200 字）。规格 §6.1：只有发起人与申请人本人能看到。
  final String? message;

  final BuddyApplicationStatus status;
  final DateTime createdAt;

  /// 接受/拒绝时刻（审计用）。
  final DateTime? decidedAt;

  /// 审批人，**必须**等于 `post.creatorId`（规格 §2.4）。
  final String? decidedBy;

  String get displayName =>
      (applicantName != null && applicantName!.isNotEmpty) ? applicantName! : applicantId;

  bool get isPending => status.isPending;

  /// 是否是 [userId] 提出的申请。
  bool isFrom(String userId) => applicantId == userId;

  Map<String, Object?> toJson() => <String, Object?>{
    'id': id,
    'postId': postId,
    'applicantId': applicantId,
    'applicantName': applicantName,
    'message': message,
    'status': status.wire,
    'createdAt': isoUtc(createdAt),
    'decidedAt': decidedAt == null ? null : isoUtc(decidedAt!),
    'decidedBy': decidedBy,
  };

  BuddyApplication copyWith({
    String? id,
    String? postId,
    String? applicantId,
    String? applicantName,
    String? message,
    BuddyApplicationStatus? status,
    DateTime? createdAt,
    DateTime? decidedAt,
    String? decidedBy,
  }) => BuddyApplication(
    id: id ?? this.id,
    postId: postId ?? this.postId,
    applicantId: applicantId ?? this.applicantId,
    applicantName: applicantName ?? this.applicantName,
    message: message ?? this.message,
    status: status ?? this.status,
    createdAt: createdAt ?? this.createdAt,
    decidedAt: decidedAt ?? this.decidedAt,
    decidedBy: decidedBy ?? this.decidedBy,
  );

  @override
  bool operator ==(Object other) => other is BuddyApplication && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() => 'BuddyApplication($id, post=$postId, ${status.wire})';
}

/// 申请加入命令（`POST /api/v1/buddy/items/:id/join`，action 名见契约 §11.2）。
///
/// ⚠️ **重要语义**（规格 §5.5）：`join` 是**申请**，不是**入队**。
/// 因此 `join` **不**递增 `joinedCount`，只有 `decide(ACCEPTED)` 才递增。
final class BuddyJoinCommand {
  const BuddyJoinCommand({required this.postId, this.message});

  final String postId;

  /// 申请留言（可选，≤200 字）。规格 §6.1：只有发起人与申请人本人可见。
  final String? message;

  /// 留言长度校验（按 Unicode 码点计数）。
  String? get messageError {
    final String? value = message;
    if (value == null || value.trim().isEmpty) return null;
    if (!isLengthWithin(value, 1, buddyApplicationMessageMaxLength)) {
      return '留言请控制在 $buddyApplicationMessageMaxLength 字以内';
    }
    final String? contact = buddyContactInfoKind(value);
    if (contact != null) {
      return '留言里不要填$contact —— 申请通过后系统会自动交换联系方式';
    }
    return null;
  }

  bool get isValid => messageError == null;

  /// `postId` 在**路径**里，请求体只有 `message`。
  Map<String, Object?> toJson() => <String, Object?>{
    'message': (message == null || message!.trim().isEmpty) ? null : message!.trim(),
  };
}

/// 审批命令（`POST /api/v1/buddy/items/:id/decide`，规格 §5.6）。
final class BuddyDecideCommand {
  const BuddyDecideCommand({
    required this.postId,
    required this.applicationId,
    required this.decision,
  });

  final String postId;
  final String applicationId;
  final BuddyDecision decision;

  /// `postId` 在路径里，请求体是 `{ applicationId, decision }`。
  Map<String, Object?> toJson() => <String, Object?>{
    'applicationId': applicationId,
    'decision': decision.wire,
  };
}
