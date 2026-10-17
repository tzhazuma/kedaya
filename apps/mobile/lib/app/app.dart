import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../application/theme_controller.dart';
import '../domain/models/theme_mode.dart';
import '../presentation/theme/kedaya_theme.dart';
import 'app_providers.dart';

/// 应用根组件。
///
/// 只做三件事：主题（亮/暗 + 模式）、路由、文本缩放钳制。业务状态全部来自
/// Riverpod，因此这里**不持有任何业务对象**。
class KedaYaApp extends ConsumerWidget {
  const KedaYaApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final GoRouter router = ref.watch(appRouterProvider);
    final KedaYaThemeMode mode = ref.watch(themeModeControllerProvider);
    return MaterialApp.router(
      title: '可达鸭',
      debugShowCheckedModeBanner: false,
      // 亮暗两套都从生成的设计令牌派生（契约 §6.2 / §11.5）。
      theme: ref.watch(lightThemeProvider),
      darkTheme: ref.watch(darkThemeProvider),
      themeMode: themeModeOf(mode),
      routerConfig: router,
      builder: (BuildContext context, Widget? child) => MediaQuery.withClampedTextScaling(
        minScaleFactor: 0.9,
        maxScaleFactor: 1.4,
        child: child ?? const SizedBox.shrink(),
      ),
    );
  }
}
