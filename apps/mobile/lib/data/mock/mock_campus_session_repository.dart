import 'dart:async';

import '../../domain/models/api_error.dart';
import '../../domain/models/campus_binding.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/campus_session_port.dart';
import 'mock_controls.dart';
import 'mock_fixtures.dart';

/// [CampusSessionPort] 的内存实现（第二级能力层）。
///
/// cookie 只存在于本类的私有 map 里 —— 这正是契约 §5 想要的结构：
/// 凭据可以流转给 WebView 注入，但**不会**出现在 [CampusBinding] 或任何上抛对象中。
final class MockCampusSessionRepository implements CampusSessionPort {
  MockCampusSessionRepository({List<CampusBinding>? bindings, MockControls? controls})
    : _bindings = List<CampusBinding>.unmodifiable(bindings ?? const <CampusBinding>[]),
      controls = controls ?? MockControls();

  final MockControls controls;
  final Map<CampusSystem, String> _cookies = <CampusSystem, String>{};
  final StreamController<List<CampusBinding>> _changes =
      StreamController<List<CampusBinding>>.broadcast();

  List<CampusBinding> _bindings;

  @override
  List<CampusBinding> get bindings => _bindings;

  @override
  Stream<List<CampusBinding>> get changes => _changes.stream;

  @override
  List<CampusBinding> hydrateFromCache() => _bindings;

  @override
  Future<Result<CampusBinding>> bind(CampusSystem system, {required String credential}) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<CampusBinding>();
    if (credential.trim().isEmpty) {
      return Err<CampusBinding>(
        const ApiError(code: ApiErrorCode.validationFailed, message: '凭据不能为空'),
        traceId: MockControls.traceId,
      );
    }
    final CampusBinding binding = CampusBinding(
      system: system,
      boundAt: mockNow,
      displayName: 'mock-${system.id}',
      expiresAt: mockNow.add(const Duration(days: 30)),
    );
    _cookies[system] = '${system.id.toUpperCase()}_SESSION=mock-session';
    _bindings = List<CampusBinding>.unmodifiable(<CampusBinding>[
      ..._bindings.where((CampusBinding item) => item.system != system),
      binding,
    ]);
    _emit();
    return Ok<CampusBinding>(binding);
  }

  @override
  Future<Result<Unit>> unbind(CampusSystem system) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<Unit>();
    _cookies.remove(system);
    _bindings = List<CampusBinding>.unmodifiable(
      _bindings.where((CampusBinding item) => item.system != system).toList(growable: false),
    );
    _emit();
    return Ok<Unit>(Unit.instance);
  }

  @override
  Future<String?> cookieHeaderFor(CampusSystem system) async => _cookies[system];

  @override
  Future<void> renewInBackground() async {
    // 内存实现没有服务端可对账：把已过期绑定标成未过期没有意义，
    // 因此这里保持不动，仅模拟"续期尝试"。
    await controls.simulate();
  }

  /// 释放流（`AppRuntime.dispose()` 调用）。
  Future<void> dispose() => _changes.close();

  void _emit() {
    if (!_changes.isClosed) _changes.add(_bindings);
  }
}
