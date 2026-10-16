import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/app_providers.dart';
import '../domain/ports/consent_port.dart';

/// 二次同意控制器（契约 §9）。
///
/// 只管理 `wellbeing` / `dorm-harmony` / `ai-portrait` 三个模块；
/// `auth` / `campus-card` 虽然也是 high 敏感，但**不设同意门**。
final consentControllerProvider = AsyncNotifierProvider<ConsentController, Set<String>>(
  ConsentController.new,
);

final class ConsentController extends AsyncNotifier<Set<String>> {
  @override
  Future<Set<String>> build() async {
    final ConsentPort port = ref.watch(consentProvider);
    final StreamSubscription<Set<String>> subscription = port.changes.listen(
      (Set<String> granted) => state = AsyncData<Set<String>>(granted),
    );
    ref.onDispose(() {
      unawaited(subscription.cancel());
    });
    return port.grantedModuleIds;
  }

  bool hasConsent(String moduleId) => state.valueOrNull?.contains(moduleId) ?? false;

  Future<void> grant(String moduleId) async {
    await ref.read(consentProvider).grant(moduleId);
    state = AsyncData<Set<String>>(ref.read(consentProvider).grantedModuleIds);
  }

  Future<void> revoke(String moduleId) async {
    await ref.read(consentProvider).revoke(moduleId);
    state = AsyncData<Set<String>>(ref.read(consentProvider).grantedModuleIds);
  }
}
