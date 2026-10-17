import 'dart:async';

import '../../domain/models/api_error.dart';
import '../../domain/models/api_request.dart';
import '../../domain/models/auth_session.dart';
import '../../domain/models/json_read.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/auth_port.dart';
import '../../domain/ports/credential_store_port.dart';
import '../../domain/ports/kedaya_api_port.dart';
import '../../domain/ports/local_cache_port.dart';
import '../../domain/ports/platform_ports.dart';
import '../api/request_ids.dart';

/// 第一级 · 身份层的远端实现（冻结契约 §5）。
///
/// 端点（契约 §6.1 路由前缀 `/api/v1/auth/*`）：
///   - `POST auth/cas/exchange`  `{code}`        -> `AuthSession`
///   - `POST auth/refresh`       `{refreshToken}` -> `AuthSession`
///   - `POST auth/logout`
///
/// 存储策略（契约 §8 的关键）：
///   - **令牌**（access / refresh）只进 [CredentialStorePort]（Keychain / Keystore）；
///   - **缓存**只存"身份 + 过期时间"，令牌字段写空 —— 因此冷启动的同步 hydrate
///     拿到的是"已登录但令牌待恢复"的会话（`AuthSession.hasTokens == false`），
///     令牌由 [refreshInBackground] 异步从安全存储读回（本地读，非网络）。
///
/// 本实现**不触碰**任何校园系统 cookie —— 那是 `CampusSessionPort` 的职责。
final class RemoteAuthRepository implements AuthPort {
  RemoteAuthRepository({
    required KedayaApiPort api,
    required CredentialStorePort credentials,
    required LocalCachePort cache,
    required UnifiedIdentityPort identity,
  })  : _api = api,
        _credentials = credentials,
        _cache = cache,
        _identity = identity;

  static const String _accessKey = 'auth.accessToken';
  static const String _refreshKey = 'auth.refreshToken';
  static const String _sessionCacheKey = 'auth.session';

  /// 提前续期窗口：剩余有效期小于它就在后台刷新。
  static const Duration renewWindow = Duration(minutes: 5);

  final KedayaApiPort _api;
  final CredentialStorePort _credentials;
  final LocalCachePort _cache;
  final UnifiedIdentityPort _identity;
  final StreamController<AuthSession?> _changes =
      StreamController<AuthSession?>.broadcast();

  AuthSession? _current;

  @override
  AuthSession? get current => _current;

  @override
  Stream<AuthSession?> get changes => _changes.stream;

  @override
  AuthSession? hydrateFromCache() {
    final Object? cached = _cache.readJson(_sessionCacheKey);
    if (cached is! Map<String, Object?>) return null;
    try {
      final AuthSession session = AuthSession.fromJson(cached);
      _emit(session);
      return session;
    } on FormatException {
      // 缓存损坏：视为未登录，绝不阻塞首屏。
      return null;
    }
  }

  @override
  Future<AuthSession> signInWithUnifiedIdentity() async {
    final String? code = await _identity.requestAuthorizationCode();
    if (code == null || code.isEmpty) {
      throw StateError('用户取消了统一身份认证');
    }
    final Result<AuthSession> result = await _api.send<AuthSession>(
      ApiRequest(
        path: 'auth/cas/exchange',
        method: ApiMethod.post,
        body: <String, Object?>{'code': code},
        idempotencyKey: newIdempotencyKey(),
      ),
      _decodeSession,
    );
    final AuthSession? session = result.valueOrNull;
    if (session == null) {
      throw StateError('统一身份认证失败：${result.errorOrNull?.userMessage ?? '未知原因'}');
    }
    await _persist(session);
    _emit(session);
    return session;
  }

  @override
  Future<AuthSession> refresh() async {
    final String refreshToken = await _refreshTokenForRefresh();
    if (refreshToken.isEmpty) {
      throw StateError('AuthPort.refresh: 本地没有 refreshToken，无法续期');
    }
    final Result<AuthSession> result = await _api.send<AuthSession>(
      ApiRequest(
        path: 'auth/refresh',
        method: ApiMethod.post,
        body: <String, Object?>{'refreshToken': refreshToken},
        idempotencyKey: newIdempotencyKey(),
      ),
      _decodeSession,
    );
    final AuthSession? refreshed = result.valueOrNull;
    if (refreshed == null) {
      throw StateError(
          'AuthPort.refresh 失败：${result.errorOrNull?.userMessage ?? '未知原因'}');
    }
    await _persist(refreshed);
    _emit(refreshed);
    return refreshed;
  }

  @override
  Future<void> signOut() async {
    // 本地优先：服务端登出失败也必须让用户登出。
    try {
      await _api.sendVoid(
          const ApiRequest(path: 'auth/logout', method: ApiMethod.post));
    } on Object {
      // 静默：契约 §8 的"失败静默降级"精神。
    }
    await _clearPersisted();
    _emit(null);
  }

  @override
  Future<bool> refreshInBackground() async {
    try {
      final String accessToken = await _credentials.read(_accessKey) ?? '';
      final String refreshToken = await _credentials.read(_refreshKey) ?? '';

      if (accessToken.isEmpty && refreshToken.isEmpty) {
        // 本地确实没有会话；若缓存里也没有身份，明确落到未登录。
        if (_current == null) _emit(null);
        return false;
      }

      final AuthSession? cached = _current;
      if (accessToken.isNotEmpty &&
          cached != null &&
          !cached.expiresWithin(renewWindow)) {
        // 本地令牌仍可用：直接恢复，**不发网络**（离线也能用）。
        _emit(cached.copyWith(
            accessToken: accessToken, refreshToken: refreshToken));
        return true;
      }

      if (refreshToken.isEmpty) return false;

      final Result<AuthSession> result = await _api.send<AuthSession>(
        ApiRequest(
          path: 'auth/refresh',
          method: ApiMethod.post,
          body: <String, Object?>{'refreshToken': refreshToken},
          idempotencyKey: newIdempotencyKey(),
        ),
        _decodeSession,
      );
      final AuthSession? refreshed = result.valueOrNull;
      if (refreshed == null) {
        final ApiErrorCode? code = result.errorOrNull?.code;
        if (code == ApiErrorCode.unauthenticated ||
            code == ApiErrorCode.forbidden) {
          // refreshToken 被吊销：清凭据并落回未登录，避免反复失败。
          await _clearPersisted();
          _emit(null);
        }
        return false;
      }
      await _persist(refreshed);
      _emit(refreshed);
      return true;
    } on Object {
      // 契约 §8 第 3 步：后台刷新失败必须静默降级。
      return false;
    }
  }

  /// 释放流（`AppRuntime.dispose()` 调用）。
  Future<void> dispose() => _changes.close();

  AuthSession _decodeSession(Object? data) =>
      AuthSession.fromJson(requireJsonMap(data, what: 'auth'));

  Future<String> _refreshTokenForRefresh() async {
    final AuthSession? session = _current;
    if (session != null && session.refreshToken.isNotEmpty) {
      return session.refreshToken;
    }
    return await _credentials.read(_refreshKey) ?? '';
  }

  Future<void> _persist(AuthSession session) async {
    await _credentials.write(_accessKey, session.accessToken);
    await _credentials.write(_refreshKey, session.refreshToken);
    // 缓存**不含**令牌：冷启动的同步 hydrate 只能拿到身份与过期时间。
    await _cache.writeJson(_sessionCacheKey, _redactedJson(session));
  }

  Future<void> _clearPersisted() async {
    await _credentials.delete(_accessKey);
    await _credentials.delete(_refreshKey);
    await _cache.remove(_sessionCacheKey);
  }

  Map<String, Object?> _redactedJson(AuthSession session) => <String, Object?>{
        'user': session.user.toJson(),
        'accessToken': '',
        'refreshToken': '',
        'issuedAt': isoUtc(session.issuedAt),
        'expiresAt': isoUtc(session.expiresAt),
      };

  void _emit(AuthSession? session) {
    _current = session;
    if (!_changes.isClosed) _changes.add(session);
  }
}
