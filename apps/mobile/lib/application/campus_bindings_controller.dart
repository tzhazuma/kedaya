import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/app_providers.dart';
import '../domain/models/api_error.dart';
import '../domain/models/campus_binding.dart';
import '../domain/models/result.dart';
import '../domain/ports/campus_session_port.dart';

/// 校园系统绑定控制器（第二级能力层）。
///
/// 契约 §5：这里拿到的只有**绑定元数据**；cookie 只能经
/// [CampusSessionPort.cookieHeaderFor] 交给 WebView 注入，绝不进入 UI 状态。
final campusBindingsControllerProvider =
    AsyncNotifierProvider<CampusBindingsController, List<CampusBinding>>(
      CampusBindingsController.new,
    );

final class CampusBindingsController extends AsyncNotifier<List<CampusBinding>> {
  @override
  Future<List<CampusBinding>> build() async {
    final CampusSessionPort port = ref.watch(campusSessionProvider);
    final StreamSubscription<List<CampusBinding>> subscription = port.changes.listen(
      (List<CampusBinding> bindings) => state = AsyncData<List<CampusBinding>>(bindings),
    );
    ref.onDispose(() {
      unawaited(subscription.cancel());
    });
    return port.bindings;
  }

  /// 绑定一个校园系统。[credential] 只透传给端口，不留在 UI 状态里。
  Future<void> bind(CampusSystem system, String credential) async {
    final Result<CampusBinding> result = await ref
        .read(campusSessionProvider)
        .bind(system, credential: credential);
    if (result.isErr) {
      throw ApiException(result.errorOrNull!, traceId: result.traceIdOrNull);
    }
  }

  Future<void> unbind(CampusSystem system) async {
    final Result<Unit> result = await ref.read(campusSessionProvider).unbind(system);
    if (result.isErr) {
      throw ApiException(result.errorOrNull!, traceId: result.traceIdOrNull);
    }
  }
}
