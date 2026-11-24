import '../../domain/models/json_read.dart';
import '../../domain/models/mail_activity.dart';
import '../../domain/models/result.dart';
import '../../domain/models/api_request.dart';
import '../../domain/ports/kedaya_api_port.dart';
import '../../domain/ports/mail_port.dart';

/// [MailPort] 的远端实现（`/api/v1/mail/*`）。
///
/// 形状以 `services/api/src/modules/mail/mail.controller.ts` 为准：
///
/// | 方法 | 端点 | 备注 |
/// | --- | --- | --- |
/// | `link` | `POST mail/account` | 响应不回显密码 / 密文 |
/// | `unlink` | `DELETE mail/account` | 幂等 |
/// | `sync` | `POST mail/sync` | 失败保留上次结果并标 `stale` |
/// | `events` | `GET mail/events` | `{items, stale}` |
final class RemoteMailRepository implements MailPort {
  const RemoteMailRepository(this._api);

  final KedayaApiPort _api;

  @override
  Future<Result<Unit>> link(MailLinkRequest request) => _api.sendVoid(
        ApiRequest(
          path: 'mail/account',
          method: ApiMethod.post,
          body: request.toJson(),
        ),
      );

  @override
  Future<Result<Unit>> unlink() =>
      _api.sendVoid(const ApiRequest(path: 'mail/account', method: ApiMethod.delete));

  @override
  Future<Result<MailEventsSnapshot>> sync() =>
      _api.send<MailEventsSnapshot>(
        ApiRequest(path: 'mail/sync', method: ApiMethod.post),
        (Object? data) => _decodeSnapshot(data),
      );

  @override
  Future<Result<MailEventsSnapshot>> events() =>
      _api.send<MailEventsSnapshot>(
        const ApiRequest(path: 'mail/events', method: ApiMethod.get),
        (Object? data) => _decodeSnapshot(data),
      );

  /// 同步响应里 `items` 可能省略（只有计数）；此时返回空列表而不是报错 ——
  /// 计数页面另有入口，列表空态是正常结果。
  static MailEventsSnapshot _decodeSnapshot(Object? data) {
    final Map<String, Object?> map =
        requireJsonMap(data, what: 'mail events');
    if (!map.containsKey('items')) {
      return MailEventsSnapshot(items: const <MailEventItem>[], stale: map['stale'] == true);
    }
    return MailEventsSnapshot.fromJson(map);
  }
}
