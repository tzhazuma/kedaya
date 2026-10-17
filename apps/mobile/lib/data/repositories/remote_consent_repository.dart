import 'dart:async';

import '../../domain/models/api_error.dart';
import '../../domain/models/api_request.dart';
import '../../domain/models/json_read.dart';
import '../../domain/models/kedaya_module.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/consent_port.dart';
import '../../domain/ports/kedaya_api_port.dart';
import '../../domain/ports/local_cache_port.dart';

/// [ConsentPort] 的远端实现（契约 §9 的二次同意门）。
///
/// 端点：
///   - `GET    profile/consents`             -> `{ items: string[] }`（模块 id）
///   - `POST   profile/consents`  `{moduleId}` -> 记录同意
///   - `DELETE profile/consents/:moduleId`     -> 撤回同意
///
/// 本地缓存让"已同意"在离线时也成立（同意是用户的既有决定，不应因为断网失效）；
/// 撤回则是**本地立即生效**，服务端同步失败不回滚 —— 撤回必须永远可行。
final class RemoteConsentRepository implements ConsentPort {
  RemoteConsentRepository(
      {required KedayaApiPort api, required LocalCachePort cache})
      : _api = api,
        _cache = cache;

  static const String _cacheKey = 'consent.granted';

  final KedayaApiPort _api;
  final LocalCachePort _cache;
  final StreamController<Set<String>> _changes =
      StreamController<Set<String>>.broadcast();

  Set<String> _granted = <String>{};

  @override
  Set<String> get grantedModuleIds => Set<String>.unmodifiable(_granted);

  @override
  Stream<Set<String>> get changes => _changes.stream;

  @override
  Set<String> hydrateFromCache() {
    final Object? cached = _cache.readJson(_cacheKey);
    if (cached is! List<Object?>) return grantedModuleIds;
    _granted = <String>{
      for (final Object? item in cached)
        if (item is String) item,
    };
    return grantedModuleIds;
  }

  @override
  bool hasConsent(String moduleId) => _granted.contains(moduleId);

  @override
  Future<void> grant(String moduleId) async {
    final Result<Unit> result = await _api.sendVoid(
      ApiRequest(
        path: 'profile/consents',
        method: ApiMethod.post,
        body: <String, Object?>{'moduleId': moduleId},
      ),
    );
    if (result.isErr) {
      throw ApiException(result.errorOrNull!, traceId: result.traceIdOrNull);
    }
    _granted = <String>{..._granted, moduleId};
    await _persist();
  }

  /// 撤回**本地立即生效**：即使服务端同步失败也必须撤回成功（契约 §9：可随时撤回）。
  @override
  Future<void> revoke(String moduleId) async {
    _granted = <String>{..._granted}..remove(moduleId);
    await _persist();
    try {
      await _api.sendVoid(
        ApiRequest(
            path: 'profile/consents/$moduleId', method: ApiMethod.delete),
      );
    } on Object {
      // 本地已撤回；服务端会在下次 refreshInBackground 时对账。
    }
  }

  @override
  Future<void> refreshInBackground() async {
    try {
      final Result<Set<String>> result = await _api.send<Set<String>>(
        const ApiRequest(path: 'profile/consents', method: ApiMethod.get),
        (Object? data) {
          final Map<String, Object?> json =
              requireJsonMap(data, what: 'consents');
          return <String>{
            for (final Object? item in readListOrEmpty(json, 'items'))
              if (item is String) item,
          };
        },
      );
      final Set<String>? remote = result.valueOrNull;
      if (remote == null) return;
      _granted = remote;
      await _persist();
    } on Object {
      // 契约 §8 第 3 步：失败静默降级（保留本地已同意的集合）。
    }
  }

  @override
  ApiError consentRequiredError(String moduleId) {
    final KedayaModule? module = moduleById(moduleId);
    final String name = module?.nameZh ?? moduleId;
    return ApiError(
      code: ApiErrorCode.consentRequired,
      message: '进入「$name」前需要先阅读并同意隐私说明',
    );
  }

  /// 释放流（`AppRuntime.dispose()` 调用）。
  Future<void> dispose() => _changes.close();

  Future<void> _persist() async {
    await _cache.writeJson(_cacheKey, _granted.toList(growable: false));
    if (!_changes.isClosed) _changes.add(grantedModuleIds);
  }
}
