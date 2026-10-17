import 'dart:async';

import '../../domain/models/auth_session.dart';
import '../../domain/models/user.dart';
import '../../domain/ports/auth_port.dart';
import 'mock_controls.dart';
import 'mock_fixtures.dart';

/// [AuthPort] 的内存实现（第一级身份层）。
///
/// 刻意**不含**任何校园系统 cookie —— 那属于 [MockCampusSessionRepository]。
/// 契约 §5 的边界在 mock 运行时也必须成立，否则 UI 会在开发期依赖错误的假设。
final class MockAuthRepository implements AuthPort {
  MockAuthRepository({
    User user = mockUser,
    AuthSession? session,
    MockControls? controls,
  }) : _user = user,
       _session = session,
       controls = controls ?? MockControls();

  final User _user;
  final MockControls controls;
  final StreamController<AuthSession?> _changes =
      StreamController<AuthSession?>.broadcast();

  AuthSession? _session;

  @override
  AuthSession? get current => _session;

  @override
  Stream<AuthSession?> get changes => _changes.stream;

  @override
  AuthSession? hydrateFromCache() {
    if (_session != null) _emit(_session);
    return _session;
  }

  @override
  Future<AuthSession> signInWithUnifiedIdentity() async {
    await controls.simulate();
    final AuthSession session = _freshSession();
    _session = session;
    _emit(session);
    return session;
  }

  @override
  Future<AuthSession> refresh() async {
    await controls.simulate();
    final AuthSession? existing = _session;
    if (existing == null) {
      throw StateError('MockAuthRepository.refresh: 尚未登录');
    }
    final AuthSession refreshed = _freshSession(user: existing.user);
    _session = refreshed;
    _emit(refreshed);
    return refreshed;
  }

  @override
  Future<void> signOut() async {
    _session = null;
    _emit(null);
  }

  @override
  Future<bool> refreshInBackground() async => _session != null;

  /// 释放流（`AppRuntime.dispose()` 调用）。
  Future<void> dispose() => _changes.close();

  AuthSession _freshSession({User? user}) {
    final DateTime issuedAt = mockNow;
    return AuthSession(
      user: user ?? _user,
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      issuedAt: issuedAt,
      expiresAt: issuedAt.add(const Duration(hours: 2)),
    );
  }

  void _emit(AuthSession? session) {
    if (!_changes.isClosed) _changes.add(session);
  }
}
