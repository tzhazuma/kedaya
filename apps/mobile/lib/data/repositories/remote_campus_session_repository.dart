import 'dart:async';

import '../../domain/models/api_request.dart';
import '../../domain/models/campus_binding.dart';
import '../../domain/models/json_read.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/campus_session_port.dart';
import '../../domain/ports/credential_store_port.dart';
import '../../domain/ports/kedaya_api_port.dart';
import '../../domain/ports/local_cache_port.dart';
import '../api/request_ids.dart';

/// 第二级 · 能力层的远端实现（冻结契约 §5）。
///
/// 端点（`/api/v1/auth/campus-sessions/*`）：
///   - `GET    auth/campus-sessions`            -> `{ items: CampusBinding[] }`
///   - `POST   auth/campus-sessions/:system`    `{credential}` -> 见 [_CampusBindPayload]
///   - `DELETE auth/campus-sessions/:system`
///
/// **凭据边界**：`cookieHeader` 只出现在本文件的 data 层 DTO 与安全存储里，
/// 绝不进入 `domain` 模型、绝不进入 `AuthPort`、绝不写日志。
final class RemoteCampusSessionRepository implements CampusSessionPort {
  RemoteCampusSessionRepository({
    required KedayaApiPort api,
    required CredentialStorePort credentials,
    required LocalCachePort cache,
  })  : _api = api,
        _credentials = credentials,
        _cache = cache;

  static const String _bindingsCacheKey = 'campus.bindings';

  final KedayaApiPort _api;
  final CredentialStorePort _credentials;
  final LocalCachePort _cache;
  final StreamController<List<CampusBinding>> _changes =
      StreamController<List<CampusBinding>>.broadcast();

  /// 内存里的 cookie 缓存，避免每次 WebView 注入都打一次 Keychain。
  final Map<CampusSystem, String> _cookies = <CampusSystem, String>{};

  List<CampusBinding> _bindings = const <CampusBinding>[];

  static String _cookieKey(CampusSystem system) => 'campus.${system.id}.cookie';

  @override
  List<CampusBinding> get bindings => _bindings;

  @override
  Stream<List<CampusBinding>> get changes => _changes.stream;

  @override
  List<CampusBinding> hydrateFromCache() {
    final Object? cached = _cache.readJson(_bindingsCacheKey);
    if (cached is! List<Object?>) {
      _bindings = const <CampusBinding>[];
      return _bindings;
    }
    final List<CampusBinding> parsed = <CampusBinding>[];
    for (final Object? item in cached) {
      try {
        parsed.add(CampusBinding.fromJson(
            requireJsonMap(item, what: 'campus.bindings[]')));
      } on FormatException {
        // 单条损坏不影响其它绑定。
      }
    }
    _bindings = List<CampusBinding>.unmodifiable(parsed);
    return _bindings;
  }

  @override
  Future<Result<CampusBinding>> bind(CampusSystem system,
      {required String credential}) async {
    final Result<_CampusBindPayload> result =
        await _api.send<_CampusBindPayload>(
      ApiRequest(
        path: 'auth/campus-sessions/${system.id}',
        method: ApiMethod.post,
        body: <String, Object?>{'credential': credential},
        idempotencyKey: newIdempotencyKey(),
      ),
      (Object? data) => _CampusBindPayload.fromJson(
        requireJsonMap(data, what: 'campus bind'),
      ),
    );
    final _CampusBindPayload? payload = result.valueOrNull;
    if (payload == null) {
      return Err<CampusBinding>(
        result.errorOrNull!,
        traceId: result.traceIdOrNull,
      );
    }
    if (payload.cookieHeader.isNotEmpty) {
      await _credentials.write(_cookieKey(system), payload.cookieHeader);
      _cookies[system] = payload.cookieHeader;
    }
    await _setBindings(<CampusBinding>[
      ..._bindings.where((CampusBinding item) => item.system != system),
      payload.binding,
    ]);
    return Ok<CampusBinding>(payload.binding);
  }

  @override
  Future<Result<Unit>> unbind(CampusSystem system) async {
    final Result<Unit> result = await _api.sendVoid(
      ApiRequest(
          path: 'auth/campus-sessions/${system.id}', method: ApiMethod.delete),
    );
    if (result.isErr) {
      return Err<Unit>(result.errorOrNull!, traceId: result.traceIdOrNull);
    }
    await _credentials.delete(_cookieKey(system));
    _cookies.remove(system);
    await _setBindings(
      _bindings
          .where((CampusBinding item) => item.system != system)
          .toList(growable: false),
    );
    return Ok<Unit>(Unit.instance);
  }

  @override
  Future<String?> cookieHeaderFor(CampusSystem system) async {
    final String? inMemory = _cookies[system];
    if (inMemory != null && inMemory.isNotEmpty) return inMemory;
    final String? stored = await _credentials.read(_cookieKey(system));
    if (stored == null || stored.isEmpty) return null;
    _cookies[system] = stored;
    return stored;
  }

  @override
  Future<void> renewInBackground() async {
    try {
      final Result<List<CampusBinding>> result =
          await _api.send<List<CampusBinding>>(
        const ApiRequest(path: 'auth/campus-sessions', method: ApiMethod.get),
        (Object? data) {
          final Map<String, Object?> json =
              requireJsonMap(data, what: 'campus-sessions');
          return readListOrEmpty(json, 'items')
              .map((Object? item) =>
                  CampusBinding.fromJson(requireJsonMap(item, what: 'items[]')))
              .toList(growable: false);
        },
      );
      final List<CampusBinding>? remote = result.valueOrNull;
      if (remote == null) return;
      // 服务端已解绑的系统，本地凭据一并清掉。
      final Set<CampusSystem> remoteSystems =
          remote.map((CampusBinding item) => item.system).toSet();
      for (final CampusSystem system in CampusSystem.values) {
        if (!remoteSystems.contains(system)) {
          await _credentials.delete(_cookieKey(system));
          _cookies.remove(system);
        }
      }
      await _setBindings(remote);
    } on Object {
      // 契约 §8 第 3 步：失败静默降级。
    }
  }

  /// 释放流（`AppRuntime.dispose()` 调用）。
  Future<void> dispose() => _changes.close();

  Future<void> _setBindings(List<CampusBinding> next) async {
    _bindings = List<CampusBinding>.unmodifiable(next);
    if (!_changes.isClosed) _changes.add(_bindings);
    await _cache.writeJson(
      _bindingsCacheKey,
      _bindings
          .map((CampusBinding item) => item.toJson())
          .toList(growable: false),
    );
  }
}

/// 绑定端点的响应 —— **仅 data 层**：元数据 + 凭据。
///
/// 凭据在这里被立刻写入安全存储，随后只通过 [RemoteCampusSessionRepository.cookieHeaderFor]
/// 提供给 WebView 注入，绝不进入 domain 模型。
final class _CampusBindPayload {
  const _CampusBindPayload({required this.binding, required this.cookieHeader});

  factory _CampusBindPayload.fromJson(Map<String, Object?> json) =>
      _CampusBindPayload(
        binding: CampusBinding.fromJson(
            requireJsonMap(json['binding'], what: 'bind.binding')),
        cookieHeader: readStringOr(json, 'cookieHeader', ''),
      );

  final CampusBinding binding;
  final String cookieHeader;
}
