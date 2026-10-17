import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/app_providers.dart';
import '../domain/models/theme_mode.dart';
import '../domain/ports/theme_mode_port.dart';

/// 主题模式控制器。
///
/// 初值来自**同步 hydrate** 的结果 —— `AppRuntime.hydrate()` 在 `runApp` 之前执行
/// （契约 §8 第 1 步），所以首帧就是用户上次选的模式，不会先亮后暗闪一下。
final themeModeControllerProvider =
    NotifierProvider<ThemeModeController, KedaYaThemeMode>(
        ThemeModeController.new);

final class ThemeModeController extends Notifier<KedaYaThemeMode> {
  @override
  KedaYaThemeMode build() {
    final ThemeModePort port = ref.watch(themeModeProvider);
    final StreamSubscription<KedaYaThemeMode> subscription =
        port.changes.listen(
      (KedaYaThemeMode mode) => state = mode,
    );
    ref.onDispose(() {
      unawaited(subscription.cancel());
    });
    return port.current;
  }

  Future<void> setMode(KedaYaThemeMode mode) async {
    await ref.read(themeModeProvider).setMode(mode);
  }
}
