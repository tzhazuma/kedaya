import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/app_providers.dart';
import '../../../application/session_controller.dart';
import '../../../domain/models/api_error.dart';
import '../../../domain/models/bind_credential.dart';
import '../../../domain/models/campus_capability.dart';
import '../../../domain/models/campus_card.dart';
import '../../../domain/models/campus_web_entry.dart';
import '../../../domain/models/page.dart';
import '../../../domain/models/result.dart';
import '../../../domain/models/techpie_link.dart';
import '../../../domain/ports/campus_card_port.dart';
import '../../../domain/ports/techpie_port.dart';
import '../../../domain/ports/webview_port.dart';

/// `techpie` 模块的用例（application 层：编排，不含 IO）。
///
/// ⚠️ **两级身份的边界在这里也必须成立**：
///
///   - 第一级身份（"你是谁"）**只**从 `sessionControllerProvider` 读 ——
///     它是一个 `AsyncValue<AuthSession?>`，与绑定数据**没有任何共同对象**；
///   - 第二级绑定（"你能访问哪些校园系统"）只从 `TechpiePort` /
///     `CampusCardPort` 读。
///
/// 因此本文件**不 import** `domain/ports/auth_port.dart`：装配层（`lib/app/`）
/// 之外没有文件能同时看到两个端口，也就没有对象能把两级身份混在一起
/// （`test/domain/techpie_two_tier_boundary_test.dart` 机械扫描这条）。

// ------------------------------------------------------------------ 绑定列表

/// 我的绑定列表（`GET /techpie/links`，只含元数据）。
final techpieLinksControllerProvider =
    AsyncNotifierProvider<TechpieLinksController, List<TechpieLink>>(
  TechpieLinksController.new,
);

final class TechpieLinksController extends AsyncNotifier<List<TechpieLink>> {
  @override
  Future<List<TechpieLink>> build() async {
    final Result<List<TechpieLink>> result =
        await ref.watch(techpieRepositoryProvider).listLinks();
    // 失败抛 ApiException；`CAMPUS_BINDING_REQUIRED` 与 `UNAUTHENTICATED`
    // 是两个不同的错误码，presentation 层据此给出两种不同的引导。
    return result.unwrap;
  }

  Future<void> refresh() async {
    state = const AsyncLoading<List<TechpieLink>>();
    state = await AsyncValue.guard<List<TechpieLink>>(
      () => ref
          .read(techpieRepositoryProvider)
          .listLinks()
          .then((Result<List<TechpieLink>> result) => result.unwrap),
    );
  }
}

// ------------------------------------------------------------------ 能力清单

/// 能力清单：把**服务端可用性**与**我的绑定情况**合并成每个能力的真实状态。
///
/// 合并规则是纯函数 `resolveCampusCapabilities`（domain 层），
/// 因此"已登录但未绑定 → `CAMPUS_BINDING_REQUIRED`"与
/// "未登录 → `UNAUTHENTICATED`"这两条分流可以被单测逐条钉死。
final campusCapabilitiesProvider = FutureProvider<List<CampusCapability>>((
  ref,
) async {
  final TechpiePort port = ref.watch(techpieRepositoryProvider);
  final CampusCardPort cardPort = ref.watch(campusCardRepositoryProvider);

  // 第一级身份：只取"有没有登录"这一个布尔，**不**与绑定数据合并成对象。
  //
  // 用 `.future` 而不是 `.valueOrNull`：会话是**本地同步**可得的
  // （契约 §8 第 1 步的 hydrate），但 provider 的首次计算仍会经过一次
  // AsyncLoading —— 直接读 valueOrNull 会把"还没解析完"误判成"未登录"，
  // 于是整张能力清单闪一下 UNAUTHENTICATED。
  final bool signedIn =
      (await ref.watch(sessionControllerProvider.future)) != null;

  final List<TechpieLink> links = await ref.watch(
    techpieLinksControllerProvider.future,
  );
  final DateTime now = DateTime.now();
  final Set<CampusPlatform> usablePlatforms = <CampusPlatform>{
    for (final TechpieLink link in links)
      if (link.isUsableAt(now)) link.platform,
  };

  // 校园卡走**独立 OPENID 通道**：它的可用性来自 `CampusCardPort`，
  // 而不是 `/techpie/links`（规格 §2.5）。
  try {
    final CampusCardLink? card = (await cardPort.linkStatus()).valueOrNull;
    if (card != null && card.isUsableAt(now)) {
      usablePlatforms.add(CampusPlatform.ecard);
    }
  } on Object {
    // 静默降级：校园卡状态未知不该让整张能力清单失败（契约 §8 第 3 步）。
  }

  final List<CampusCapability> catalog = (await port.listCapabilities()).unwrap;

  // 只有**明确结论**才算服务端覆盖：`UNKNOWN` 表示服务端没给结论，
  // 交给客户端按绑定情况推导（否则整页会退化成一片"状态未知"）。
  final Map<String, CampusCapabilityState> serverStates =
      <String, CampusCapabilityState>{
    for (final CampusCapability capability in catalog)
      if (capability.state != CampusCapabilityState.unknown)
        capability.id: capability.state,
  };

  return resolveCampusCapabilities(
    catalog: catalog,
    signedIn: signedIn,
    usablePlatforms: usablePlatforms,
    serverStates: serverStates,
  );
});

// ------------------------------------------------------------------ 校园卡

/// 校园卡页面的数据（余额 + 流水；**不含**付款码）。
///
/// 付款码刻意不在这个状态里：它是短时效支付凭据，只在付款码页面**可见期间**
/// 存在（见 `campusPaymentCodeProvider` 的 `autoDispose`）。
final class CampusCardSnapshot {
  const CampusCardSnapshot({
    required this.link,
    this.account,
    this.transactions = const <CampusCardTransaction>[],
  });

  final CampusCardLink link;
  final CampusCardAccount? account;
  final List<CampusCardTransaction> transactions;

  /// 已开通（未过期）。
  bool get isLinked => link.state.isUsable;

  /// 从未开通 / 已过期 —— 两者是不同的引导文案。
  bool get needsOpen => !isLinked;

  bool get hasNoTransactions => transactions.isEmpty;
}

/// 校园卡控制器（第二级 · **独立 OPENID 通道**）。
final campusCardControllerProvider =
    AsyncNotifierProvider<CampusCardController, CampusCardSnapshot>(
  CampusCardController.new,
);

final class CampusCardController extends AsyncNotifier<CampusCardSnapshot> {
  @override
  Future<CampusCardSnapshot> build() async {
    final CampusCardPort port = ref.watch(campusCardRepositoryProvider);
    final CampusCardLink link = (await port.linkStatus()).unwrap;
    if (!link.state.isUsable) {
      // 未开通**不是错误**：这是合法状态，页面要引导开通（OPENID 通道），
      // 而不是弹一个 CAMPUS_BINDING_REQUIRED 的错误页。
      return CampusCardSnapshot(link: link);
    }
    final CampusCardAccount account = (await port.account()).unwrap;
    final Page<CampusCardTransaction> page =
        (await port.listTransactions()).unwrap;
    return CampusCardSnapshot(
      link: link,
      account: account,
      transactions: page.items,
    );
  }

  Future<void> refresh() async {
    state = const AsyncLoading<CampusCardSnapshot>();
    state = await AsyncValue.guard<CampusCardSnapshot>(_load);
    // 开通状态变了 → 能力清单里的校园卡项也要跟着变。
    ref.invalidate(campusCapabilitiesProvider);
  }

  /// 用 OPENID 开通（mock 运行时由页面提供一个模拟值；真实运行时的 OPENID
  /// 必须来自 eCard 官方授权流程，见 README 的"未实现"清单）。
  Future<void> connect(
      {required String openId, String channel = 'wechat'}) async {
    final CampusCardPort port = ref.read(campusCardRepositoryProvider);
    requireOk(await port.connect(openId: openId, channel: channel));
    await refresh();
  }

  Future<void> disconnect() async {
    final CampusCardPort port = ref.read(campusCardRepositoryProvider);
    requireOk(await port.disconnect());
    await refresh();
  }

  Future<CampusCardSnapshot> _load() async {
    final CampusCardPort port = ref.read(campusCardRepositoryProvider);
    final CampusCardLink link = (await port.linkStatus()).unwrap;
    if (!link.state.isUsable) return CampusCardSnapshot(link: link);
    final CampusCardAccount account = (await port.account()).unwrap;
    final Page<CampusCardTransaction> page =
        (await port.listTransactions()).unwrap;
    return CampusCardSnapshot(
      link: link,
      account: account,
      transactions: page.items,
    );
  }
}

/// 付款码：`autoDispose` —— **离开页面即丢弃**，因此它不可能被长期缓存。
final campusPaymentCodeProvider =
    FutureProvider.autoDispose<CampusPaymentCode>((
  ref,
) async {
  final Result<CampusPaymentCode> result =
      await ref.watch(campusCardRepositoryProvider).paymentCode();
  return result.unwrap;
});

// ------------------------------------------------------------------ 直连入口

/// Phase 0 的四个 WebView 直连入口（客户端侧目录，服务端仍会再校验一次）。
final campusWebEntriesProvider = Provider<List<CampusWebEntry>>(
  (ref) => phase0CampusWebEntries,
);

// ------------------------------------------------------------------ 写操作

/// 绑定管理动作（绑定 / 解绑 / 手动续期）。
///
/// **不持有 Ref**（只拿端口 + 失效回调），因此能在测试里直接构造 ——
/// 与 `BuddyActions` 同一策略。
final techpieActionsProvider = Provider<TechpieActions>((ref) {
  final TechpiePort port = ref.watch(techpieRepositoryProvider);
  return TechpieActions(
    port: port,
    onLinksMutated: () {
      ref.invalidate(techpieLinksControllerProvider);
      ref.invalidate(campusCapabilitiesProvider);
    },
  );
});

final class TechpieActions {
  const TechpieActions({required this.port, required this.onLinksMutated});

  final TechpiePort port;

  /// 绑定集合被改动（绑定 / 解绑 / 续期）后的失效回调。
  final void Function() onLinksMutated;

  /// 发起绑定。Phase 0 只接受**免口令**的凭据形态（见 `BindCredential`）。
  Future<TechpieLink> bind(
    CampusPlatform platform,
    BindCredential credential,
  ) async {
    final TechpieLink link = (await port.bind(
      platform,
      credential: credential,
    ))
        .unwrap;
    onLinksMutated();
    return link;
  }

  /// 解绑（幂等）。
  Future<void> unbind(String linkId) async {
    requireOk(await port.unbind(linkId));
    onLinksMutated();
  }

  /// **手动**续期。上游没有续期能力时抛 `CONFLICT` / `RENEW_NOT_SUPPORTED`，
  /// 页面据此显示"该功能暂不可用"，**不谎称"已续期"**（规格 §10.1 的 F3）。
  Future<TechpieLink> renew(String linkId) async {
    final TechpieLink link = (await port.renew(linkId)).unwrap;
    onLinksMutated();
    return link;
  }
}

// ------------------------------------------------------------------ WebView 直连

/// WebView 直连的用例：**票据只在栈上**。
///
/// 它不持有 Ref，也没有任何可变字段 —— 因此票据既不可能被缓存在 provider 状态里，
/// 也不可能被"顺手"存到别处。返回的 `WebViewLaunchOutcome` **刻意不含**
/// 票据与中转 URL 字段（`test/application/techpie_webview_launcher_test.dart` 断言）。
final techpieWebViewLauncherProvider = Provider<TechpieWebViewLauncher>(
  (ref) => TechpieWebViewLauncher(
    port: ref.watch(techpieRepositoryProvider),
    webView: ref.watch(webViewProvider),
  ),
);

final class TechpieWebViewLauncher {
  TechpieWebViewLauncher({
    required this.port,
    required this.webView,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final TechpiePort port;
  final WebViewPort webView;
  final DateTime Function() _clock;

  /// 按序完成三件事，任何一步失败都给出**诚实的**结局：
  ///
  /// 1. 客户端 fail-closed 预校验目标地址（服务端仍必须再校验一次）；
  /// 2. `POST /techpie/webview-session` 换**一次性**票据（30 秒时效）；
  /// 3. 用票据换**一次性**中转 URL，立刻交给 WebView 宿主。
  ///
  /// 票据与中转 URL 都是**局部变量**，方法返回后即不可达。
  Future<WebViewLaunchOutcome> open(CampusWebEntry entry) async {
    final String? rejected = entry.targetUrlProblem;
    if (rejected != null) {
      return WebViewLaunchOutcome(
        status: WebViewLaunchStatus.targetRejected,
        entry: entry,
        problem: rejected,
      );
    }

    final DateTime requestedAt = _clock().toUtc();
    final Result<WebViewTicket> created = await port.createWebViewSession(
      // Phase 0 的四个入口都不要求绑定（W4 直连）：不传平台，服务端就不会
      // 用 409 拦住一个"其实不需要绑定"的外部链接。
      platform: entry.requiresBinding ? entry.platform : null,
      targetUrl: entry.targetUrl,
    );
    final WebViewTicket? ticket = created.valueOrNull;
    if (ticket == null) {
      return WebViewLaunchOutcome(
        status: WebViewLaunchStatus.ticketUnavailable,
        entry: entry,
        problem: created.errorOrNull?.userMessage,
      );
    }
    if (ticket.isExpiredAt(requestedAt, _clock().toUtc())) {
      return WebViewLaunchOutcome(
        status: WebViewLaunchStatus.ticketUnavailable,
        entry: entry,
        problem: '票据已超过 ${ticket.expiresInSec} 秒时效，请重试',
      );
    }

    final Result<WebViewHandoff> redeemed =
        await port.redeemWebViewTicket(ticket);
    final WebViewHandoff? handoff = redeemed.valueOrNull;
    if (handoff == null) {
      return WebViewLaunchOutcome(
        status: WebViewLaunchStatus.handoffFailed,
        entry: entry,
        problem: redeemed.errorOrNull?.userMessage,
      );
    }
    if (handoff.isExpiredAt(_clock().toUtc())) {
      return WebViewLaunchOutcome(
        status: WebViewLaunchStatus.handoffFailed,
        entry: entry,
        problem: '一次性中转链接已失效，请重试',
      );
    }

    final bool opened = await webView.openOneTimeUrl(handoff.url);
    return WebViewLaunchOutcome(
      status: opened
          ? WebViewLaunchStatus.opened
          : WebViewLaunchStatus.handoffFailed,
      entry: entry,
      problem: opened ? null : '本机暂不支持内嵌打开（原生 WebView 尚未实现）',
    );
  }
}

/// `Result<Unit>` 的"失败即抛、成功无值"。
///
/// 与 `Result.unwrap` 的区别只是**可读性**：这里调用方并不需要那个 `Unit` 值，
/// 用一个具名函数表达"我只关心它有没有失败"，比 `x.unwrap;` 这样的裸表达式清楚。
void requireOk<T>(Result<T> result) {
  if (result.isErr) {
    throw ApiException(result.errorOrNull!, traceId: result.traceIdOrNull);
  }
}
