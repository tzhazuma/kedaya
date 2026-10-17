import '../../domain/models/api_request.dart';
import '../../domain/models/bind_credential.dart';
import '../../domain/models/campus_capability.dart';
import '../../domain/models/campus_web_entry.dart';
import '../../domain/models/json_read.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/models/techpie_link.dart';
import '../../domain/ports/kedaya_api_port.dart';
import '../../domain/ports/techpie_port.dart';
import '../api/request_ids.dart';

/// [TechpiePort] 的远端实现（`/api/v1/techpie/*`，规格 §8.1）。
///
/// 形状约定：
///   - 写操作带 `Idempotency-Key`（契约 §11.3）；
///   - 列表统一走游标分页 `Page<T>`（契约 §6.1）；
///   - **不解析任何凭据字段**：`CampusBindingSummary.fromJson` 只读白名单里的键，
///     服务端即使误加了会话串也不会被上抛（契约 §11.4 I1 的客户端镜像）。
///
/// ⚠️ 两个**客户端侧的形状假设**（规格未给出字段名，已登记进交付说明）：
///   1. `GET /techpie/capabilities` 的响应是 `{ items: [...] }` 或裸数组（两种都接受）；
///   2. `GET /techpie/webview-session/:ticket` 的响应是 `{ url, targetUrl, expiresAt }`。
final class RemoteTechpieRepository implements TechpiePort {
  const RemoteTechpieRepository(this._api);

  static const String _base = 'techpie';
  static const String _links = '$_base/links';
  static const String _webviewSessions = '$_base/webview-session';

  final KedayaApiPort _api;

  @override
  Future<Result<List<TechpieLink>>> listLinks() => _api.send<List<TechpieLink>>(
        const ApiRequest(path: _links, method: ApiMethod.get),
        (Object? data) => _decodeList<TechpieLink>(
            data, 'techpie links', TechpieLink.fromJson),
      );

  @override
  Future<Result<TechpieLink>> bind(
    CampusPlatform platform, {
    required BindCredential credential,
  }) =>
      _api.send<TechpieLink>(
        ApiRequest(
          path: _links,
          method: ApiMethod.post,
          // credential 只在这里出现一次；网络层不打印请求体（规格 §10.3）。
          body: <String, Object?>{
            'platform': platform.wire,
            'credential': credential.toWire(),
          },
          idempotencyKey: newIdempotencyKey(),
        ),
        (Object? data) =>
            TechpieLink.fromJson(requireJsonMap(data, what: 'techpie link')),
      );

  @override
  Future<Result<Unit>> unbind(String linkId) => _api.sendVoid(
        ApiRequest(path: '$_links/$linkId', method: ApiMethod.delete),
      );

  @override
  Future<Result<TechpieLink>> renew(String linkId) => _api.send<TechpieLink>(
        ApiRequest(
          path: '$_links/$linkId/renew',
          method: ApiMethod.post,
          idempotencyKey: newIdempotencyKey(),
        ),
        (Object? data) =>
            TechpieLink.fromJson(requireJsonMap(data, what: 'techpie link')),
      );

  @override
  Future<Result<List<CampusCapability>>> listCapabilities() =>
      _api.send<List<CampusCapability>>(
        const ApiRequest(path: '$_base/capabilities', method: ApiMethod.get),
        (Object? data) => _decodeList<CampusCapability>(
            data, 'techpie capabilities', CampusCapability.fromJson),
      );

  @override
  Future<Result<WebViewTicket>> createWebViewSession({
    CampusPlatform? platform,
    required String targetUrl,
  }) =>
      _api.send<WebViewTicket>(
        ApiRequest(
          path: _webviewSessions,
          method: ApiMethod.post,
          // 不传 `platform` 时服务端**不要求绑定**（Phase 0 的 W4 直连）。
          body: <String, Object?>{
            if (platform != null) 'platform': platform.wire,
            'targetUrl': targetUrl,
          },
          idempotencyKey: newIdempotencyKey(),
        ),
        (Object? data) => WebViewTicket.fromJson(
          requireJsonMap(data, what: 'techpie webview ticket'),
          platform: platform,
        ),
      );

  @override
  Future<Result<WebViewHandoff>> redeemWebViewTicket(WebViewTicket ticket) {
    final DateTime requestedAt = DateTime.now().toUtc();
    return _api.send<WebViewHandoff>(
      ApiRequest(
        // ⚠️ `services/api` 用 POST（规格 §8.4 写的是 GET）—— 跨端能跑通优先。
        path: '$_webviewSessions/${Uri.encodeComponent(ticket.ticket)}',
        method: ApiMethod.post,
        idempotencyKey: newIdempotencyKey(),
      ),
      (Object? data) => WebViewHandoff.fromJson(
        requireJsonMap(data, what: 'techpie webview handoff'),
        targetUrl: ticket.targetUrl,
        // Phase 0 的 W4 直连会返回 `expiresAt: null` → 用票据时效兜底。
        fallbackExpiresAt:
            requestedAt.add(Duration(seconds: ticket.expiresInSec)),
      ),
    );
  }

  /// 列表响应既可能是裸数组，也可能是 `{ items: [...] }` —— 两种都接受
  /// （与 `RemoteWildlifeRepository._decodeList` 同一策略：形状差异不该让整页失败）。
  List<T> _decodeList<T>(
    Object? data,
    String what,
    T Function(Map<String, Object?> item) decode,
  ) {
    if (data is List<Object?>) {
      return data
          .whereType<Map<String, Object?>>()
          .map(decode)
          .toList(growable: false);
    }
    final Map<String, Object?> map = requireJsonMap(data, what: what);
    // 契约 §6.1 的分页集合是 `{ items, nextCursor }`；有界字典常直接返回数组。
    // 两条路径都接受，但**都只读 `items`**：游标对客户端完全不透明
    // （契约 §11.10-E：不得解析、不得构造、不得假设格式）。
    return Page<T>.fromJson(map, decode).items;
  }
}
