import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/api/dio_client.dart';
import '../data/api/kedaya_api_client.dart';
import '../data/mock/dev_unified_identity.dart';
import '../data/mock/in_memory_stores.dart';
import '../data/mock/mock_auth_repository.dart';
import '../data/mock/mock_campus_session_repository.dart';
import '../data/mock/mock_consent_store.dart';
import '../data/mock/mock_controls.dart';
import '../data/mock/mock_errand_repository.dart';
import '../data/mock/mock_faq_repository.dart';
import '../data/mock/mock_forum_repository.dart';
import '../data/mock/mock_groupbuy_repository.dart';
import '../data/mock/mock_lost_found_repository.dart';
import '../data/mock/mock_wellbeing_repository.dart';
import '../data/repositories/remote_auth_repository.dart';
import '../data/repositories/remote_campus_session_repository.dart';
import '../data/repositories/remote_consent_repository.dart';
import '../data/repositories/remote_errand_repository.dart';
import '../data/repositories/remote_faq_repository.dart';
import '../data/repositories/remote_forum_repository.dart';
import '../data/repositories/remote_groupbuy_repository.dart';
import '../data/repositories/remote_lost_found_repository.dart';
import '../data/repositories/remote_wellbeing_repository.dart';
import '../data/storage/cache_theme_mode_store.dart';
import '../data/storage/preferences_cache_store.dart';
import '../data/storage/secure_credential_store.dart';
import '../domain/ports/auth_port.dart';
import '../domain/ports/campus_session_port.dart';
import '../domain/ports/consent_port.dart';
import '../domain/ports/credential_store_port.dart';
import '../domain/ports/errand_port.dart';
import '../domain/ports/faq_port.dart';
import '../domain/ports/forum_port.dart';
import '../domain/ports/groupbuy_port.dart';
import '../domain/ports/kedaya_api_port.dart';
import '../domain/ports/local_cache_port.dart';
import '../domain/ports/lost_found_port.dart';
import '../domain/ports/platform_ports.dart';
import '../domain/ports/theme_mode_port.dart';
import '../domain/ports/wellbeing_port.dart';
import '../platform/clipboard_share_port.dart';
import '../platform/local_notification_port.dart';
import '../platform/method_channel_unified_identity.dart';
import 'app_environment.dart';

/// 手工装配的运行时容器（不用 DI 框架，参考 TechPie 的 runtime factory 思路）。
///
/// 生命周期：`AppRuntime.create()` → `hydrate()` → `runApp` →
/// `startBackgroundRefresh()` → 退出时 `dispose()`。
///
/// 它**只持有端口**：presentation 拿到的是 `AuthPort` / `GroupbuyPort` 等接口，
/// 因此 mock 与远端实现可以整体替换（契约 §7 依赖倒置）。
final class AppRuntime {
  AppRuntime({
    required this.environment,
    required this.auth,
    required this.campusSessions,
    required this.consent,
    required this.groupbuy,
    required this.forum,
    required this.faq,
    required this.errand,
    required this.lostFound,
    required this.wellbeing,
    required this.credentials,
    required this.cache,
    required this.share,
    required this.notifications,
    required this.unifiedIdentity,
    required this.themeMode,
    this.api,
    this.dioClient,
    this.mockControls,
    List<Future<void> Function()> disposers = const <Future<void> Function()>[],
  }) : _disposers = disposers;

  final AppEnvironment environment;

  /// 网络出口；mock 运行时为 null（UI 不该知道这一点，它只用各业务端口）。
  final KedayaApiPort? api;

  /// 底层 Dio 客户端；mock 运行时为 null。
  final KedaYaDioClient? dioClient;

  final AuthPort auth;
  final CampusSessionPort campusSessions;
  final ConsentPort consent;
  final GroupbuyPort groupbuy;

  /// 论坛（契约 §4.1 `forum`，敏感级中；支持匿名，契约 §9）。
  final ForumPort forum;

  /// 常见问题（契约 §4.1 `faq`，敏感级低；检索无需登录）。
  final FaqPort faq;

  final ErrandPort errand;
  final LostFoundPort lostFound;
  final WellbeingPort wellbeing;

  final CredentialStorePort credentials;
  final LocalCachePort cache;
  final SharePort share;
  final NotificationPort notifications;
  final UnifiedIdentityPort unifiedIdentity;

  /// 主题模式（契约 §11.5）；在 [hydrate] 里同步读回，保证首帧就是用户的选择。
  final ThemeModePort themeMode;

  /// mock 运行时的总开关（延迟 / 故障注入 / 空结果）；真实运行时为 null。
  final MockControls? mockControls;

  /// 最近一次后台刷新的失败摘要（诊断用，绝不弹给用户 —— 契约 §8 静默降级）。
  String? lastBackgroundError;

  final List<Future<void> Function()> _disposers;

  /// mock 运行时：零网络、零平台插件，`git clone` 后直接可跑（契约 §7 硬规则 4）。
  factory AppRuntime.mock({Duration latency = const Duration(milliseconds: 250)}) {
    final MockControls controls = MockControls(latency: latency);
    final MockAuthRepository auth = MockAuthRepository(controls: MockControls(latency: latency));
    final MockCampusSessionRepository campus = MockCampusSessionRepository(
      controls: MockControls(latency: latency),
    );
    final MockConsentStore consent = MockConsentStore();
    final InMemoryCacheStore cache = InMemoryCacheStore();
    final CacheThemeModeStore themeMode = CacheThemeModeStore(cache);
    final LocalNotificationPort notifications = LocalNotificationPort();
    return AppRuntime(
      environment: const AppEnvironment.mock(),
      auth: auth,
      campusSessions: campus,
      consent: consent,
      groupbuy: MockGroupbuyRepository(controls: controls),
      forum: MockForumRepository(controls: controls),
      faq: MockFaqRepository(controls: controls),
      errand: MockErrandRepository(),
      lostFound: MockLostFoundRepository(),
      wellbeing: MockWellbeingRepository(),
      credentials: InMemoryCredentialStore(),
      cache: cache,
      share: const ClipboardSharePort(),
      notifications: notifications,
      unifiedIdentity: const DevUnifiedIdentity(),
      themeMode: themeMode,
      mockControls: controls,
      disposers: <Future<void> Function()>[
        auth.dispose,
        campus.dispose,
        consent.dispose,
        themeMode.dispose,
        notifications.dispose,
      ],
    );
  }

  /// 按环境装配：mock 走内存适配器，其余走 Dio + SharedPreferences + Keychain。
  static Future<AppRuntime> create(
    AppEnvironment environment, {
    Duration mockLatency = const Duration(milliseconds: 250),
  }) async {
    if (environment.usesMockAdapters) {
      return AppRuntime.mock(latency: mockLatency);
    }

    final SharedPreferences prefs = await SharedPreferences.getInstance();
    final PreferencesCacheStore cache = PreferencesCacheStore(prefs);
    final SecureCredentialStore credentials = SecureCredentialStore();
    final CacheThemeModeStore themeMode = CacheThemeModeStore(cache);
    const UnifiedIdentityPort identity = MethodChannelUnifiedIdentity();

    // auth 需要在 Dio 的 token 供应器里被引用，因此先声明后赋值。
    late final RemoteAuthRepository auth;
    final KedaYaDioClient dio = KedaYaDioClient(
      baseUrl: environment.apiBaseUrl,
      accessToken: () => auth.current?.accessToken,
      refreshSession: () async {
        try {
          await auth.refresh();
          return true;
        } on Object {
          return false;
        }
      },
    );
    final KedaYaApiClient api = KedaYaApiClient(client: dio);
    auth = RemoteAuthRepository(
      api: api,
      credentials: credentials,
      cache: cache,
      identity: identity,
    );
    final RemoteCampusSessionRepository campus = RemoteCampusSessionRepository(
      api: api,
      credentials: credentials,
      cache: cache,
    );
    final RemoteConsentRepository consent = RemoteConsentRepository(api: api, cache: cache);
    final RemoteWellbeingRepository wellbeing = RemoteWellbeingRepository(api);
    final LocalNotificationPort notifications = LocalNotificationPort();

    return AppRuntime(
      environment: environment,
      api: api,
      dioClient: dio,
      auth: auth,
      campusSessions: campus,
      consent: consent,
      groupbuy: RemoteGroupbuyRepository(api),
      forum: RemoteForumRepository(api),
      faq: RemoteFaqRepository(api),
      errand: RemoteErrandRepository(api),
      lostFound: RemoteLostFoundRepository(api),
      wellbeing: wellbeing,
      credentials: credentials,
      cache: cache,
      share: const ClipboardSharePort(),
      notifications: notifications,
      unifiedIdentity: identity,
      themeMode: themeMode,
      disposers: <Future<void> Function()>[
        auth.dispose,
        campus.dispose,
        consent.dispose,
        themeMode.dispose,
        notifications.dispose,
      ],
    );
  }

  /// 契约 §8 第 1 步：同步 hydrate 缓存 —— **只读本地，禁止网络**。
  void hydrate() {
    auth.hydrateFromCache();
    campusSessions.hydrateFromCache();
    consent.hydrateFromCache();
    themeMode.hydrateFromCache();
  }

  /// 契约 §8 第 3 步：后台并发刷新。单项失败静默降级，绝不阻塞或弹错。
  Future<void> startBackgroundRefresh() async {
    await Future.wait<void>(<Future<void>>[
      _swallow('auth.refresh', auth.refreshInBackground()),
      _swallow('campus.renew', campusSessions.renewInBackground()),
      _swallow('consent.sync', consent.refreshInBackground()),
    ]);
  }

  /// 释放所有端口持有的资源（应用退出 / 测试 tearDown）。
  Future<void> dispose() async {
    for (final Future<void> Function() disposer in _disposers) {
      try {
        await disposer();
      } on Object {
        // 关闭阶段的异常无意义，忽略。
      }
    }
    await dioClient?.close();
  }

  Future<void> _swallow(String label, Future<Object?> task) async {
    try {
      await task;
    } on Object catch (error) {
      lastBackgroundError = '$label: $error';
      if (kDebugMode) {
        debugPrint('[kedaya.bootstrap] 后台刷新失败（已静默降级）$lastBackgroundError');
      }
    }
  }
}
