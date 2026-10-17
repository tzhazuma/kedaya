import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/mock/mock_controls.dart';
import '../domain/ports/auth_port.dart';
import '../domain/ports/buddy_port.dart';
import '../domain/ports/campus_card_port.dart';
import '../domain/ports/campus_session_port.dart';
import '../domain/ports/consent_port.dart';
import '../domain/ports/errand_port.dart';
import '../domain/ports/faq_port.dart';
import '../domain/ports/forum_port.dart';
import '../domain/ports/groupbuy_port.dart';
import '../domain/ports/local_cache_port.dart';
import '../domain/ports/location_port.dart';
import '../domain/ports/lost_found_port.dart';
import '../domain/ports/media_picker_port.dart';
import '../domain/ports/platform_ports.dart';
import '../domain/ports/techpie_port.dart';
import '../domain/ports/theme_mode_port.dart';
import '../domain/ports/webview_port.dart';
import '../domain/ports/wellbeing_port.dart';
import '../domain/ports/wildlife_port.dart';
import '../presentation/theme/kedaya_theme.dart';
import 'app_environment.dart';
import 'app_router.dart';
import 'app_runtime.dart';

/// 运行时容器：**必须**在 `ProviderScope` 根部 override（见 `bootstrap.dart`）。
///
/// 故意不给默认实现：忘记装配时立刻抛错，而不是带着空实现静默跑起来。
final appRuntimeProvider = Provider<AppRuntime>(
  (ref) =>
      throw StateError('appRuntimeProvider 必须在 ProviderScope 根部被 override'),
);

final appEnvironmentProvider = Provider<AppEnvironment>(
  (ref) => ref.watch(appRuntimeProvider).environment,
);

/// 第一级身份层（契约 §5）。**不暴露任何校园系统凭据**。
final authProvider =
    Provider<AuthPort>((ref) => ref.watch(appRuntimeProvider).auth);

/// 第二级能力层（契约 §5）。唯一能取校园系统 cookie 的端口。
final campusSessionProvider = Provider<CampusSessionPort>(
  (ref) => ref.watch(appRuntimeProvider).campusSessions,
);

/// 二次同意门（契约 §9）。
final consentProvider =
    Provider<ConsentPort>((ref) => ref.watch(appRuntimeProvider).consent);

final groupbuyRepositoryProvider = Provider<GroupbuyPort>(
  (ref) => ref.watch(appRuntimeProvider).groupbuy,
);

/// 论坛（契约 §4.1 `forum`）。
final forumRepositoryProvider = Provider<ForumPort>(
  (ref) => ref.watch(appRuntimeProvider).forum,
);

/// 常见问题（契约 §4.1 `faq`）。
final faqRepositoryProvider = Provider<FaqPort>(
  (ref) => ref.watch(appRuntimeProvider).faq,
);

/// 本地缓存（契约 §8：`readJson` 是**同步**的，因此可以在 provider 体内直接用）。
final localCacheProvider = Provider<LocalCachePort>(
  (ref) => ref.watch(appRuntimeProvider).cache,
);

final errandRepositoryProvider = Provider<ErrandPort>(
  (ref) => ref.watch(appRuntimeProvider).errand,
);

final lostFoundRepositoryProvider = Provider<LostFoundPort>(
  (ref) => ref.watch(appRuntimeProvider).lostFound,
);

final wellbeingRepositoryProvider = Provider<WellbeingPort>(
  (ref) => ref.watch(appRuntimeProvider).wellbeing,
);

/// 找搭子（契约 §4.1 `buddy`；敏感级**低**、**无同意门**）。
///
/// 与 `wildlife` 同理：`buddy` 不设同意门是契约 §9 判定规则的结果
/// （`packages/contracts/src/modules.test.ts`），因此这里**不经过** `consent`，
/// 也**不会**返回 `CONSENT_REQUIRED`（规格 §5.10 显式声明）。
final buddyRepositoryProvider = Provider<BuddyPort>(
  (ref) => ref.watch(appRuntimeProvider).buddy,
);

/// 校园动物（契约 §4.1 `wildlife`；敏感级低、**无同意门**）。
final wildlifeRepositoryProvider = Provider<WildlifePort>(
  (ref) => ref.watch(appRuntimeProvider).wildlife,
);

/// TechPie 整合（契约 §4.1 `techpie`；敏感级中、**无同意门**）。
///
/// ⚠️ 这是**第二级**（能力层）的端口：它只有绑定元数据、能力清单与一次性票据，
/// **没有**一级身份的任何东西（JWT / 学号 / 姓名）—— 那些走 [authProvider]。
/// 两者是**两个类型**，因此 presentation 层拿到的永远是两个独立对象。
final techpieRepositoryProvider = Provider<TechpiePort>(
  (ref) => ref.watch(appRuntimeProvider).techpie,
);

/// 校园卡（契约 §4.2 `campus-card`）—— **独立 OPENID 通道**（规格 §2.5）。
///
/// 与 [campusSessionProvider]（校园会话代持链路）刻意分开：校园卡不依赖 CASTGC，
/// 因此它的可用性、开通流程与合规风险都与"eGate 绑定"完全独立。
final campusCardRepositoryProvider = Provider<CampusCardPort>(
  (ref) => ref.watch(appRuntimeProvider).campusCard,
);

/// WebView 宿主（契约 §7 的 `platform/` 适配）。
///
/// 端口**只接受一个 URL**：类型上就无法接收 cookie / 请求头 / 会话串
/// （ADR §4-D 否决的路径在这里写不出来）。
final webViewProvider = Provider<WebViewPort>(
  (ref) => ref.watch(appRuntimeProvider).webView,
);

/// 选图端口（mock 运行时是内存实现，不弹相册）。
final mediaPickerProvider = Provider<MediaPickerPort>(
  (ref) => ref.watch(appRuntimeProvider).mediaPicker,
);

/// 定位端口（WGS84；不可用时上报表单降级到地图点选）。
final locationProvider = Provider<LocationPort>(
  (ref) => ref.watch(appRuntimeProvider).location,
);

final shareProvider =
    Provider<SharePort>((ref) => ref.watch(appRuntimeProvider).share);

final notificationProvider = Provider<NotificationPort>(
  (ref) => ref.watch(appRuntimeProvider).notifications,
);

final unifiedIdentityProvider = Provider<UnifiedIdentityPort>(
  (ref) => ref.watch(appRuntimeProvider).unifiedIdentity,
);

/// 主题模式持久化（契约 §11.5）。值已在启动时同步 hydrate（契约 §8 第 1 步）。
final themeModeProvider = Provider<ThemeModePort>(
  (ref) => ref.watch(appRuntimeProvider).themeMode,
);

/// 亮色 / 暗色 `ThemeData`：由 Provider 缓存，避免每次 rebuild 重建主题。
final lightThemeProvider = Provider<ThemeData>((ref) => KedaYaTheme.light());

final darkThemeProvider = Provider<ThemeData>((ref) => KedaYaTheme.dark());

/// mock 运行时总开关；真实运行时为 null（UI 据此决定是否显示调试入口）。
final mockControlsProvider = Provider<MockControls?>(
  (ref) => ref.watch(appRuntimeProvider).mockControls,
);

/// go_router 实例：只创建一次，避免 rebuild 重置导航栈。
final appRouterProvider = Provider<GoRouter>((ref) => createAppRouter());
