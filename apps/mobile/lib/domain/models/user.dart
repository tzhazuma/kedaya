import 'json_read.dart';
import 'validate.dart';

/// 第一级 · 身份层的用户（冻结契约 §5）。
///
/// 只承载"你是谁"：userId / 学号 / 姓名 / 院系。**不含**任何校园系统凭据。
final class User {
  const User({
    required this.userId,
    this.studentId,
    this.displayName,
    this.department,
    this.email,
    this.avatarUrl,
  });

  factory User.fromJson(Map<String, Object?> json) => User(
    userId: readString(json, 'userId'),
    studentId: readStringOrNull(json, 'studentId'),
    displayName: readStringOrNull(json, 'displayName'),
    department: readStringOrNull(json, 'department'),
    email: readStringOrNull(json, 'email'),
    avatarUrl: readStringOrNull(json, 'avatarUrl'),
  );

  /// KedaYa 自有用户 id（不是学号，也不是任何校园系统 id）。
  final String userId;

  final String? studentId;
  final String? displayName;
  final String? department;
  final String? email;
  final String? avatarUrl;

  String get displayNameOrId =>
      (displayName != null && displayName!.isNotEmpty) ? displayName! : userId;

  bool get hasShanghaiTechEmail => email != null && isShanghaiTechEmail(email!);

  Map<String, Object?> toJson() => <String, Object?>{
    'userId': userId,
    'studentId': studentId,
    'displayName': displayName,
    'department': department,
    'email': email,
    'avatarUrl': avatarUrl,
  };

  User copyWith({
    String? userId,
    String? studentId,
    String? displayName,
    String? department,
    String? email,
    String? avatarUrl,
  }) => User(
    userId: userId ?? this.userId,
    studentId: studentId ?? this.studentId,
    displayName: displayName ?? this.displayName,
    department: department ?? this.department,
    email: email ?? this.email,
    avatarUrl: avatarUrl ?? this.avatarUrl,
  );

  @override
  bool operator ==(Object other) =>
      other is User &&
      other.userId == userId &&
      other.studentId == studentId &&
      other.displayName == displayName &&
      other.department == department &&
      other.email == email &&
      other.avatarUrl == avatarUrl;

  @override
  int get hashCode =>
      Object.hash(userId, studentId, displayName, department, email, avatarUrl);

  @override
  String toString() => 'User($userId, $displayNameOrId)';
}
