import 'dart:async';

import '../../domain/models/api_error.dart';
import '../../domain/models/kedaya_module.dart';
import '../../domain/ports/consent_port.dart';

/// [ConsentPort] 的内存实现（契约 §9 的二次同意门）。
final class MockConsentStore implements ConsentPort {
  MockConsentStore({Set<String>? granted}) : _granted = <String>{...?granted};

  final Set<String> _granted;
  final StreamController<Set<String>> _changes =
      StreamController<Set<String>>.broadcast();

  @override
  Set<String> get grantedModuleIds => Set<String>.unmodifiable(_granted);

  @override
  Stream<Set<String>> get changes => _changes.stream;

  @override
  Set<String> hydrateFromCache() => Set<String>.unmodifiable(_granted);

  @override
  bool hasConsent(String moduleId) => _granted.contains(moduleId);

  @override
  Future<void> grant(String moduleId) async {
    if (_granted.add(moduleId)) _emit();
  }

  @override
  Future<void> revoke(String moduleId) async {
    if (_granted.remove(moduleId)) _emit();
  }

  /// 内存实现没有服务端记录可对账，因此是**有意的空操作**（不是未实现的占位）。
  @override
  Future<void> refreshInBackground() async {}

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

  void _emit() {
    if (!_changes.isClosed) _changes.add(Set<String>.unmodifiable(_granted));
  }
}
