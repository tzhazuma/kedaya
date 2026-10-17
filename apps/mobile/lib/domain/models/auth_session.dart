import 'json_read.dart';
import 'user.dart';

/// 第一级 · 身份层的会话（冻结契约 §5）。
///
/// **硬规则**：本类型绝不允许出现任何校园系统 cookie / session / tgc 字段。
/// 校园系统能力一律经 `CampusSessionPort`（见 `domain/ports/campus_session_port.dart`）。
/// 该约束由 `test/domain/auth_session_boundary_test.dart` 机械校验：
/// 它遍历 [toJson] 的全部键名，断言不含 `cookie` / `tgc` / `session` 等片段。
final class AuthSession {
  const AuthSession({
    required this.user,
    required this.accessToken,
    required this.refreshToken,
    required this.issuedAt,
    required this.expiresAt,
  });

  factory AuthSession.fromJson(Map<String, Object?> json) => AuthSession(
        user: User.fromJson(readMap(json, 'user')),
        accessToken: readString(json, 'accessToken'),
        refreshToken: readString(json, 'refreshToken'),
        issuedAt: readDateTime(json, 'issuedAt'),
        expiresAt: readDateTime(json, 'expiresAt'),
      );

  final User user;

  /// KedaYa 自有 JWT（第一级），不是任何校园系统的凭据。
  final String accessToken;

  /// 用于轮换 [accessToken]。
  final String refreshToken;

  final DateTime issuedAt;
  final DateTime expiresAt;

  /// 是否已持有可用的令牌。
  ///
  /// 契约 §8：首屏来自**同步 hydrate**，而令牌只存在安全存储里（必须异步读），
  /// 因此冷启动第一帧的会话可能是"已登录但令牌待恢复"（[hasTokens] == false）。
  /// UI 应据此渲染"正在恢复会话"，而不是把用户踢成未登录。
  bool get hasTokens => accessToken.isNotEmpty && refreshToken.isNotEmpty;

  /// 纯函数式过期判断（测试可注入 now，避免依赖真实时钟）。
  bool isExpiredAt(DateTime now) => !expiresAt.isAfter(now.toUtc());

  bool get isExpired => isExpiredAt(DateTime.now());

  /// 是否会在 [window] 内过期（用于后台提前续期）。
  bool expiresWithin(Duration window, {DateTime? now}) =>
      !expiresAt.isAfter((now ?? DateTime.now()).toUtc().add(window));

  Map<String, Object?> toJson() => <String, Object?>{
        'user': user.toJson(),
        'accessToken': accessToken,
        'refreshToken': refreshToken,
        'issuedAt': isoUtc(issuedAt),
        'expiresAt': isoUtc(expiresAt),
      };

  AuthSession copyWith({
    User? user,
    String? accessToken,
    String? refreshToken,
    DateTime? issuedAt,
    DateTime? expiresAt,
  }) =>
      AuthSession(
        user: user ?? this.user,
        accessToken: accessToken ?? this.accessToken,
        refreshToken: refreshToken ?? this.refreshToken,
        issuedAt: issuedAt ?? this.issuedAt,
        expiresAt: expiresAt ?? this.expiresAt,
      );

  @override
  bool operator ==(Object other) =>
      other is AuthSession &&
      other.user == user &&
      other.accessToken == accessToken &&
      other.refreshToken == refreshToken &&
      other.issuedAt == issuedAt &&
      other.expiresAt == expiresAt;

  @override
  int get hashCode =>
      Object.hash(user, accessToken, refreshToken, issuedAt, expiresAt);

  /// 刻意不打印 token 本身。
  @override
  String toString() =>
      'AuthSession(user=${user.userId}, expiresAt=${isoUtc(expiresAt)})';
}
