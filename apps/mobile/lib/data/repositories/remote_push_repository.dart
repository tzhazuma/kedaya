import '../../domain/models/api_request.dart';
import '../../domain/ports/kedaya_api_port.dart';
import '../../domain/ports/push_port.dart';

final class RemotePushRepository implements PushPort {
  const RemotePushRepository(this._api);

  final KedayaApiPort _api;

  @override
  Future<PushTargetView> register(PushChannel channel, String token) async {
    final result = await _api.send(
      ApiRequest(
        path: 'notifications/push/targets',
        method: ApiMethod.post,
        body: <String, Object?>{'channel': channel.wire, 'token': token},
      ),
      _targetFromJson,
    );
    return result.unwrap;
  }

  @override
  Future<bool> revoke(PushChannel channel, String token) async {
    final result = await _api.send(
      ApiRequest(
        path: 'notifications/push/targets/revoke',
        method: ApiMethod.post,
        body: <String, Object?>{'channel': channel.wire, 'token': token},
      ),
      (Object? data) => (data! as Map<String, Object?>)['revoked']! as bool,
    );
    return result.unwrap;
  }

  @override
  Future<PushStatus> status() async {
    final result = await _api.send(
      const ApiRequest(
          path: 'notifications/push/status', method: ApiMethod.get),
      (Object? data) {
        final Map<String, Object?> json = data! as Map<String, Object?>;
        return PushStatus(
          configured: (json['configured']! as List)
              .map((Object? value) => PushChannel.fromWire(value! as String))
              .toList(),
          targets: (json['targets']! as List)
              .map((Object? value) => _targetFromJson(value))
              .toList(),
        );
      },
    );
    return result.unwrap;
  }
}

PushTargetView _targetFromJson(Object? data) {
  final Map<String, Object?> json = data! as Map<String, Object?>;
  return PushTargetView(
    channel: PushChannel.fromWire(json['channel']! as String),
    status: json['status']! as String,
    templateId: json['templateId'] as String?,
  );
}
