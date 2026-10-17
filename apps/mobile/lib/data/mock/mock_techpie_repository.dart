import '../../domain/models/api_error.dart';
import '../../domain/models/bind_credential.dart';
import '../../domain/models/campus_capability.dart';
import '../../domain/models/campus_web_entry.dart';
import '../../domain/models/result.dart';
import '../../domain/models/techpie_link.dart';
import '../../domain/ports/techpie_port.dart';
import '../api/request_ids.dart';
import 'mock_controls.dart';
import 'techpie_fixtures.dart';

/// [TechpiePort] 的内存实现 —— 让 techpie 切片在**无后端**时可跑（契约 §7 硬规则 4）。
///
/// 真实行为而不是假数据：绑定状态机、解绑幂等、手动续期、
/// 目标地址白名单（fail-closed）、票据**一次性**与 30 秒时效、故障注入。
///
/// ⚠️ 本实现**不保存**任何传入的凭据：`bind()` 只消费 `credential.isWellFormed`，
/// 凭据值不落任何字段。`debugDumpStrings()` 可供测试断言这一点。
final class MockTechpieRepository implements TechpiePort {
  MockTechpieRepository({
    List<TechpieLink>? links,
    List<CampusWebEntry>? webEntries,
    List<CampusCapability>? catalog,
    Map<String, CampusCapabilityState> serverStates =
        const <String, CampusCapabilityState>{},
    MockControls? controls,
    DateTime Function()? clock,
    this.renewSupported = true,
  }) : controls = controls ?? MockControls(),
       _clock = clock ?? DateTime.now,
       _links = <String, TechpieLink>{
         for (final TechpieLink link in links ?? mockTechpieLinks) link.id: link,
       },
       _webEntries = List<CampusWebEntry>.unmodifiable(
         webEntries ?? phase0CampusWebEntries,
       ),
       _catalog = List<CampusCapability>.unmodifiable(
         catalog ?? mockCampusCapabilityCatalog,
       ),
       _serverStates = Map<String, CampusCapabilityState>.unmodifiable(serverStates);

  /// 可在运行时切换延迟与故障（UI 三态演示 / 测试注入）。
  final MockControls controls;

  /// 上游是否提供续期能力（F3 / R4：false 时 `renew` 返回 `RENEW_NOT_SUPPORTED`）。
  bool renewSupported;

  final DateTime Function() _clock;
  final List<CampusWebEntry> _webEntries;
  final List<CampusCapability> _catalog;
  final Map<String, CampusCapabilityState> _serverStates;

  final Map<String, TechpieLink> _links;

  /// 已签发但**尚未**兑换的票据。
  final Map<String, WebViewTicket> _pendingTickets = <String, WebViewTicket>{};

  /// 票据签发时刻（用于 30 秒时效判定）。
  final Map<String, DateTime> _issuedAt = <String, DateTime>{};

  /// 已兑换过的票据（防重放：**同一票据只允许成功一次**）。
  final Set<String> _consumedTickets = <String>{};

  int _sequence = 1003;

  /// Phase 0 的直连入口（与 `GET /techpie/webview-session/entries` 对齐的本地镜像）。
  List<CampusWebEntry> get webEntries => _webEntries;

  /// 供测试断言"凭据没有留在仓库里"：把内部状态拍平成字符串列表。
  List<String> debugDumpStrings() => <String>[
    ..._links.values.map((TechpieLink link) => link.toJson().toString()),
    ..._pendingTickets.keys,
    ..._consumedTickets,
    ..._issuedAt.keys,
  ];

  /// 已兑换票据数（测试用）。
  int get debugConsumedTicketCount => _consumedTickets.length;

  @override
  Future<Result<List<TechpieLink>>> listLinks() async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<List<TechpieLink>>();
    if (controls.emptyResults) return Ok<List<TechpieLink>>(const <TechpieLink>[]);
    return Ok<List<TechpieLink>>(_sortedLinks());
  }

  @override
  Future<Result<TechpieLink>> bind(
    CampusPlatform platform, {
    required BindCredential credential,
  }) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<TechpieLink>();
    if (!platform.isCampusCapability) {
      return _err<TechpieLink>(
        ApiErrorCode.validationFailed,
        '统一身份认证属于第一级身份，不是可绑定的校园系统',
        reason: 'UNKNOWN_PLATFORM',
      );
    }
    if (!credential.isWellFormed) {
      return _err<TechpieLink>(
        ApiErrorCode.validationFailed,
        '凭据形态不完整（${credential.redactedLabel}）',
        reason: 'CREDENTIAL_EMPTY',
      );
    }
    final TechpieLink? existing = _linkForPlatform(platform);
    if (existing != null && existing.status.isLinked) {
      return _err<TechpieLink>(
        ApiErrorCode.conflict,
        '该平台已经绑定',
        reason: 'ALREADY_LINKED',
      );
    }
    final String id = existing?.id ?? 'tp-${_sequence++}';
    final TechpieLink link = TechpieLink(
      id: id,
      summary: CampusBindingSummary(
        platform: platform,
        status: CampusBindingStatus.linked,
        externalUserId: '20240001',
        expiresAt: _clock().toUtc().add(const Duration(days: 30)),
        lastSyncAt: _clock().toUtc(),
      ),
    );
    _links[id] = link;
    // 刻意不保存 credential：这里连局部变量都不留（只用了 isWellFormed）。
    return Ok<TechpieLink>(link);
  }

  @override
  Future<Result<Unit>> unbind(String linkId) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<Unit>();
    // 解绑幂等：不存在也返回成功（DELETE 的语义）。
    _links.remove(linkId);
    return Ok<Unit>(Unit.instance);
  }

  @override
  Future<Result<TechpieLink>> renew(String linkId) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<TechpieLink>();
    final TechpieLink? link = _links[linkId];
    if (link == null) {
      return _err<TechpieLink>(ApiErrorCode.notFound, '绑定不存在或不属于你');
    }
    if (!renewSupported) {
      // F3 / R4：上游没有续期能力 —— **不谎称"已续期"**。
      return _err<TechpieLink>(
        ApiErrorCode.conflict,
        '该平台的上游没有提供续期能力',
        reason: 'RENEW_NOT_SUPPORTED',
      );
    }
    if (!link.canRenew) {
      return _err<TechpieLink>(
        ApiErrorCode.conflict,
        '当前状态不可续期',
        reason: 'RENEW_NOT_ALLOWED',
      );
    }
    final TechpieLink renewed = link.copyWith(
      summary: link.summary.copyWith(
        status: CampusBindingStatus.linked,
        expiresAt: _clock().toUtc().add(const Duration(days: 30)),
        lastSyncAt: _clock().toUtc(),
      ),
    );
    _links[linkId] = renewed;
    return Ok<TechpieLink>(renewed);
  }

  @override
  Future<Result<List<CampusCapability>>> listCapabilities() async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<List<CampusCapability>>();
    }
    // 服务端只**覆盖**它明确知道的状态；其余留给客户端按绑定情况推导
    // （推导规则是纯函数 `resolveCampusCapabilities`，不在 mock 里重写一遍）。
    final List<CampusCapability> resolved = _catalog
        .map((CampusCapability capability) {
          final CampusCapabilityState? override = _serverStates[capability.id];
          return override == null ? capability : capability.withState(override);
        })
        .toList(growable: false);
    return Ok<List<CampusCapability>>(resolved);
  }

  @override
  Future<Result<WebViewTicket>> createWebViewSession({
    CampusPlatform? platform,
    required String targetUrl,
  }) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<WebViewTicket>();
    // 服务端侧校验（规格 §8.4 的校验表；客户端传的 targetUrl 一律不可信）。
    final Uri? uri = Uri.tryParse(targetUrl.trim());
    if (uri == null || uri.scheme.toLowerCase() != 'https') {
      return _err<WebViewTicket>(
        ApiErrorCode.validationFailed,
        '目标地址必须是 https',
        reason: 'TARGET_URL_MUST_BE_HTTPS',
      );
    }
    final String? problem = campusTargetUrlProblem(targetUrl);
    if (problem != null) {
      return _err<WebViewTicket>(
        ApiErrorCode.forbidden,
        problem,
        reason: 'TARGET_URL_NOT_ALLOWED',
      );
    }
    // `platform == null` = Phase 0 的 W4 直连：**不要求绑定**
    // （与 `services/api` 的 `resolvePlatform()` 一致）。
    if (platform != null) {
      final TechpieLink? link = _linkForPlatform(platform);
      final DateTime now = _clock().toUtc();
      if (link == null || !link.isUsableAt(now)) {
        // I4：已登录但未绑定是**合法状态** → 409，不是 401。
        return _err<WebViewTicket>(
          ApiErrorCode.campusBindingRequired,
          '请先绑定 ${platform.label} 后再打开校园系统页面',
          reason: 'CAMPUS_BINDING_REQUIRED',
        );
      }
    }
    final String value = newRequestId('wvt');
    final WebViewTicket ticket = WebViewTicket(
      ticket: value,
      expiresInSec: WebViewTicket.defaultTicketTtlSec,
      targetUrl: targetUrl,
      platform: platform,
    );
    _pendingTickets[value] = ticket;
    _issuedAt[value] = now;
    return Ok<WebViewTicket>(ticket);
  }

  @override
  Future<Result<WebViewHandoff>> redeemWebViewTicket(WebViewTicket ticket) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<WebViewHandoff>();
    final String value = ticket.ticket;
    if (_consumedTickets.contains(value)) {
      // 防重放：一次性票据用后即焚。
      return _err<WebViewHandoff>(
        ApiErrorCode.conflict,
        '该票据已经使用过',
        reason: 'TICKET_ALREADY_USED',
      );
    }
    final WebViewTicket? pending = _pendingTickets[value];
    if (pending == null) {
      return _err<WebViewHandoff>(
        ApiErrorCode.notFound,
        '票据不存在或已失效',
        reason: 'TICKET_NOT_FOUND',
      );
    }
    final DateTime issuedAt = _issuedAt[value] ?? _clock().toUtc();
    final DateTime now = _clock().toUtc();
    if (ticket.isExpiredAt(issuedAt, now)) {
      _pendingTickets.remove(value);
      return _err<WebViewHandoff>(
        ApiErrorCode.conflict,
        '票据已超过 ${ticket.expiresInSec} 秒时效',
        reason: 'TICKET_EXPIRED',
      );
    }
    _pendingTickets.remove(value);
    _consumedTickets.add(value);
    return Ok<WebViewHandoff>(
      WebViewHandoff(
        // 中转页由服务端注入会话后 302 到目标；**客户端从不接触校园会话**。
        url: 'https://api.kedaya.app/wv/$value',
        targetUrl: ticket.targetUrl,
        expiresAt: issuedAt.add(Duration(seconds: ticket.expiresInSec)),
      ),
    );
  }

  List<TechpieLink> _sortedLinks() {
    final List<TechpieLink> items = _links.values.toList(growable: false);
    items.sort((TechpieLink a, TechpieLink b) => a.id.compareTo(b.id));
    return items;
  }

  TechpieLink? _linkForPlatform(CampusPlatform platform) {
    for (final TechpieLink link in _links.values) {
      if (link.platform == platform) return link;
    }
    return null;
  }

  Err<T> _err<T>(ApiErrorCode code, String message, {String? reason}) => Err<T>(
    ApiError(
      code: code,
      message: message,
      details: reason == null ? null : <String, Object?>{'reason': reason},
    ),
    traceId: MockControls.traceId,
  );
}
