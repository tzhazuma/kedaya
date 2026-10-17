import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/data/mock/mock_techpie_repository.dart';
import 'package:kedaya/data/mock/mock_webview_port.dart';
import 'package:kedaya/domain/models/campus_web_entry.dart';
import 'package:kedaya/domain/models/techpie_link.dart';
import 'package:kedaya/features/techpie/application/techpie_providers.dart';

/// WebView 直连用例的测试（规格 §8.4）。
///
/// 这一条链路上最要紧的两件事：
///   1. **票据用后即焚**：它只活在 `open()` 的栈上，
///      返回的 `WebViewLaunchOutcome` 里没有票据、也没有中转 URL；
///   2. 每一步失败都给出**诚实的**结局（拒绝 / 换不到票 / 换不到链接 / 宿主不可用），
///      绝不谎称"已打开"。
void main() {
  final DateTime base = DateTime.utc(2026, 10, 17, 2);

  MockTechpieRepository repo({DateTime Function()? clock}) =>
      MockTechpieRepository(
        controls: MockControls(latency: Duration.zero),
        clock: clock ?? () => base,
      );

  CampusWebEntry entry({
    String id = 'ecourse',
    CampusPlatform platform = CampusPlatform.cpdaily,
    String targetUrl = 'https://ecourse.shanghaitech.edu.cn/',
    bool requiresBinding = false,
  }) =>
      CampusWebEntry(
        id: id,
        title: 'E云课堂',
        description: '课程资料',
        platform: platform,
        targetUrl: targetUrl,
        requiresBinding: requiresBinding,
      );

  group('成功路径', () {
    test('创建票据 → 兑换 → 交给宿主；票据不进 outcome', () async {
      final MockTechpieRepository port = repo();
      final InMemoryWebViewPort host = InMemoryWebViewPort();
      final TechpieWebViewLauncher launcher = TechpieWebViewLauncher(
        port: port,
        webView: host,
        clock: () => base,
      );

      final WebViewLaunchOutcome outcome = await launcher.open(entry());

      expect(outcome.status, WebViewLaunchStatus.opened);
      expect(outcome.isOpened, isTrue);
      expect(outcome.problem, isNull);
      expect(host.openCount, 1);
      expect(port.debugConsumedTicketCount, 1);

      // 宿主拿到的是一次性中转 URL（含票据引用），但 **outcome 里没有它**。
      final String openedUrl = host.openedUrls.single;
      expect(openedUrl, isNot('https://ecourse.shanghaitech.edu.cn/'));
      final String ticket = Uri.parse(openedUrl).pathSegments.last;
      expect(ticket, isNotEmpty);
      expect(outcome.toString(), isNot(contains(ticket)));
      expect(outcome.problem, isNull);
    });

    test('不需要绑定的入口（W4）：不传 platform，未绑定也能打开', () async {
      final MockTechpieRepository port = repo();
      final InMemoryWebViewPort host = InMemoryWebViewPort();
      final TechpieWebViewLauncher launcher = TechpieWebViewLauncher(
        port: port,
        webView: host,
        clock: () => base,
      );

      // 四个 Phase 0 入口的 `requiresBinding` 都是 false → 请求里不带 platform。
      final WebViewLaunchOutcome outcome = await launcher.open(
        entry(platform: CampusPlatform.egate),
      );

      expect(outcome.status, WebViewLaunchStatus.opened);
      expect(host.openCount, 1);
    });

    test('每次 open 都换一张新票据（不会复用上一张）', () async {
      final MockTechpieRepository port = repo();
      final InMemoryWebViewPort host = InMemoryWebViewPort();
      final TechpieWebViewLauncher launcher = TechpieWebViewLauncher(
        port: port,
        webView: host,
        clock: () => base,
      );

      await launcher.open(entry());
      await launcher.open(entry());

      expect(host.openCount, 2);
      expect(port.debugConsumedTicketCount, 2);
      expect(host.openedUrls.toSet(), hasLength(2), reason: '两次的中转 URL 不该相同');
    });
  });

  group('失败路径都诚实', () {
    test('客户端预校验拒绝：非白名单地址 → targetRejected，且**没有**发请求', () async {
      final MockTechpieRepository port = repo();
      final InMemoryWebViewPort host = InMemoryWebViewPort();
      final TechpieWebViewLauncher launcher = TechpieWebViewLauncher(
        port: port,
        webView: host,
        clock: () => base,
      );

      final WebViewLaunchOutcome outcome = await launcher.open(
        entry(targetUrl: 'https://evil.example.com/'),
      );

      expect(outcome.status, WebViewLaunchStatus.targetRejected);
      expect(outcome.isOpened, isFalse);
      expect(outcome.problem, contains('白名单'));
      expect(port.debugConsumedTicketCount, 0);
      expect(host.openCount, 0);
    });

    test('未绑定 → ticketUnavailable，错误文案引导绑定（不是引导重新登录）', () async {
      final MockTechpieRepository port = repo();
      final InMemoryWebViewPort host = InMemoryWebViewPort();
      final TechpieWebViewLauncher launcher = TechpieWebViewLauncher(
        port: port,
        webView: host,
        clock: () => base,
      );

      // egate 在种子里是 EXPIRED，因此不可用（但用户仍然是"已登录"的）。
      final WebViewLaunchOutcome outcome = await launcher.open(
        entry(
          platform: CampusPlatform.egate,
          targetUrl: 'https://egate.shanghaitech.edu.cn/',
          requiresBinding: true,
        ),
      );

      expect(outcome.status, WebViewLaunchStatus.ticketUnavailable);
      expect(outcome.problem, contains('绑定'));
      expect(outcome.problem, isNot(contains('登录')));
      expect(port.debugConsumedTicketCount, 0);
    });

    test('票据在兑换前就过期（时钟推进）→ ticketUnavailable，且不消耗票据', () async {
      final MockTechpieRepository port = repo();
      final InMemoryWebViewPort host = InMemoryWebViewPort();
      int ticks = 0;
      final TechpieWebViewLauncher launcher = TechpieWebViewLauncher(
        port: port,
        webView: host,
        // 第一次调用 = 请求时刻，第二次调用已经过了 40 秒（> 30 秒时效）。
        clock: () => base.add(Duration(seconds: 40 * ticks++)),
      );

      final WebViewLaunchOutcome outcome = await launcher.open(entry());

      expect(outcome.status, WebViewLaunchStatus.ticketUnavailable);
      expect(outcome.problem, contains('30'));
      expect(port.debugConsumedTicketCount, 0);
      expect(host.openCount, 0);
    });

    test('宿主不可用（原生侧未实现）→ handoffFailed + 明确的降级文案', () async {
      final MockTechpieRepository port = repo();
      final InMemoryWebViewPort host = InMemoryWebViewPort(available: false);
      final TechpieWebViewLauncher launcher = TechpieWebViewLauncher(
        port: port,
        webView: host,
        clock: () => base,
      );

      final WebViewLaunchOutcome outcome = await launcher.open(entry());

      expect(outcome.status, WebViewLaunchStatus.handoffFailed);
      expect(outcome.isOpened, isFalse);
      expect(outcome.problem, contains('暂不支持'));
      // 票据确实被用掉了（说明流程走完了，只是宿主打不开）。
      expect(port.debugConsumedTicketCount, 1);
      expect(host.openCount, 0);
    });

    test('上游故障 → ticketUnavailable（透传后端文案，不伪造成功）', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..failureMode = MockFailureMode.upstreamUnavailable;
      final MockTechpieRepository port = MockTechpieRepository(
        controls: controls,
        clock: () => base,
      );
      final InMemoryWebViewPort host = InMemoryWebViewPort();
      final TechpieWebViewLauncher launcher = TechpieWebViewLauncher(
        port: port,
        webView: host,
        clock: () => base,
      );

      final WebViewLaunchOutcome outcome = await launcher.open(entry());

      expect(outcome.status, WebViewLaunchStatus.ticketUnavailable);
      expect(outcome.problem, isNotNull);
      expect(outcome.isOpened, isFalse);
    });
  });
}
