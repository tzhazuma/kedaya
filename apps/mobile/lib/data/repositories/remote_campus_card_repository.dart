import '../../domain/models/api_request.dart';
import '../../domain/models/campus_card.dart';
import '../../domain/models/json_read.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/campus_card_port.dart';
import '../../domain/ports/kedaya_api_port.dart';
import '../api/request_ids.dart';

/// [CampusCardPort] 的远端实现（`/api/v1/campus-card/*`）。
///
/// ⚠️ **端点形状是客户端侧假设**：规格 `docs/features/techpie-integration.md` §8
/// 只覆盖 `/techpie/*`，**没有定义校园卡的任何 HTTP 端点**（§2.5 只说明了它走
/// 独立 OPENID 通道）。本端按模块 id 命名（契约 §4.2 的 `campus-card`）：
///
/// | 方法 | 假设的端点 |
/// | --- | --- |
/// | `linkStatus()` | `GET campus-card/link` |
/// | `connect(openId)` | `POST campus-card/link` |
/// | `disconnect()` | `DELETE campus-card/link` |
/// | `account()` | `GET campus-card/account` |
/// | `listTransactions()` | `GET campus-card/transactions`（游标分页） |
/// | `paymentCode()` | `POST campus-card/payment-code` |
///
/// 需要后端确认后才能定稿；在此之前 mock 适配器是唯一被验证过的实现。
final class RemoteCampusCardRepository implements CampusCardPort {
  const RemoteCampusCardRepository(this._api);

  static const String _base = 'campus-card';
  static const String _link = '$_base/link';

  final KedayaApiPort _api;

  @override
  Future<Result<CampusCardLink>> linkStatus() => _api.send<CampusCardLink>(
    const ApiRequest(path: _link, method: ApiMethod.get),
    (Object? data) => CampusCardLink.fromJson(requireJsonMap(data, what: 'campus card link')),
  );

  @override
  Future<Result<CampusCardLink>> connect({
    required String openId,
    String channel = 'wechat',
  }) => _api.send<CampusCardLink>(
    ApiRequest(
      path: _link,
      method: ApiMethod.post,
      // openId 只在这里出现一次；网络层不打印请求体（规格 §10.3）。
      body: <String, Object?>{'openId': openId, 'channel': channel},
      idempotencyKey: newIdempotencyKey(),
    ),
    (Object? data) => CampusCardLink.fromJson(requireJsonMap(data, what: 'campus card link')),
  );

  @override
  Future<Result<Unit>> disconnect() =>
      _api.sendVoid(const ApiRequest(path: _link, method: ApiMethod.delete));

  @override
  Future<Result<CampusCardAccount>> account() => _api.send<CampusCardAccount>(
    const ApiRequest(path: '$_base/account', method: ApiMethod.get),
    (Object? data) =>
        CampusCardAccount.fromJson(requireJsonMap(data, what: 'campus card account')),
  );

  @override
  Future<Result<Page<CampusCardTransaction>>> listTransactions({
    String? cursor,
    int limit = defaultPageSize,
  }) => _api.send<Page<CampusCardTransaction>>(
    ApiRequest(
      path: '$_base/transactions',
      method: ApiMethod.get,
      query: PageQuery(cursor: cursor, limit: limit).toQuery(),
    ),
    (Object? data) => Page<CampusCardTransaction>.fromJson(
      requireJsonMap(data, what: 'campus card transactions'),
      CampusCardTransaction.fromJson,
    ),
  );

  @override
  Future<Result<CampusPaymentCode>> paymentCode() => _api.send<CampusPaymentCode>(
    // 付款码是"现场签发一个短时效凭据"，因此是 POST（契约 §11.3：POST 必须带幂等键）。
    // 幂等键让"重试同一次取码"不会产生两个不同的码。
    ApiRequest(
      path: '$_base/payment-code',
      method: ApiMethod.post,
      idempotencyKey: newIdempotencyKey(),
    ),
    (Object? data) =>
        CampusPaymentCode.fromJson(requireJsonMap(data, what: 'campus card payment code')),
  );
}
