import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'app_environment.dart';
import 'app_providers.dart';
import 'app_runtime.dart';

/// 契约 §8 启动时序（三端一致）：
///
/// ```
/// 1. 同步：从本地存储 hydrate 缓存（关键路径，禁止网络）
/// 2. 立即渲染首屏（带缓存数据）
/// 3. 后台并发：刷新 token → 拉取各模块数据 → 失败静默降级
/// ```
///
/// **禁止**：启动时阻塞等待网络。首屏必须是缓存或骨架屏。
/// 本函数是这条时序的**唯一实现**；`main.dart` 只调用它。
Future<void> bootstrap({AppEnvironment? environment}) async {
  WidgetsFlutterBinding.ensureInitialized();

  final AppEnvironment env = environment ?? AppEnvironment.fromDartDefine();

  // 装配运行时。注意：真实环境这里只做**本地** IO（SharedPreferences.getInstance），
  // 不发起任何网络请求。
  final AppRuntime runtime = await AppRuntime.create(env);

  // ① 同步 hydrate：只读本地缓存，不 await 网络。
  runtime.hydrate();

  // ② 立即渲染首屏：缓存或骨架屏，绝不等待网络。
  runApp(
    ProviderScope(
      overrides: <Override>[appRuntimeProvider.overrideWithValue(runtime)],
      child: const KedaYaApp(),
    ),
  );

  // ③ 后台并发刷新：失败静默降级（不 await，不阻塞首帧）。
  unawaited(runtime.startBackgroundRefresh());
}
