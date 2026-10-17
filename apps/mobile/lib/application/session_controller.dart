import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/app_providers.dart';
import '../domain/models/auth_session.dart';
import '../domain/ports/auth_port.dart';

/// 会话控制器（第一级身份层）。
///
/// 契约 §8：首屏用**同步 hydrate** 的结果立即渲染；这里绝不 await 网络。
/// 后续变化（后台续期成功、登出）通过 [AuthPort.changes] 推回来。
final sessionControllerProvider = AsyncNotifierProvider<SessionController, AuthSession?>(
  SessionController.new,
);

final class SessionController extends AsyncNotifier<AuthSession?> {
  @override
  Future<AuthSession?> build() async {
    final AuthPort auth = ref.watch(authProvider);
    final StreamSubscription<AuthSession?> subscription = auth.changes.listen(
      (AuthSession? session) => state = AsyncData<AuthSession?>(session),
    );
    ref.onDispose(() {
      unawaited(subscription.cancel());
    });
    return auth.current;
  }

  /// 走学校统一身份认证登录（只产出第一级身份，不产生任何校园系统凭据）。
  Future<void> signIn() async {
    state = const AsyncLoading<AuthSession?>();
    state = await AsyncValue.guard<AuthSession?>(
      () => ref.read(authProvider).signInWithUnifiedIdentity(),
    );
  }

  Future<void> signOut() async {
    state = const AsyncLoading<AuthSession?>();
    await ref.read(authProvider).signOut();
    state = const AsyncData<AuthSession?>(null);
  }
}
