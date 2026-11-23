import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/repositories/remote_push_repository.dart';
import 'package:kedaya/domain/models/api_request.dart';
import 'package:kedaya/domain/models/result.dart';
import 'package:kedaya/domain/ports/kedaya_api_port.dart';
import 'package:kedaya/domain/ports/push_port.dart';

final class _Api implements KedayaApiPort {
  final List<ApiRequest> requests = <ApiRequest>[];

  @override
  String? get lastTraceId => null;

  @override
  Future<Result<T>> send<T>(
      ApiRequest request, T Function(Object? data) decode) async {
    requests.add(request);
    return Ok<T>(decode(<String, Object?>{
      'configured': <String>['fcm'],
      'targets': <Object?>[
        <String, Object?>{
          'channel': 'fcm',
          'templateId': null,
          'status': 'active'
        },
      ],
      'channel': 'fcm',
      'status': 'active',
      'revoked': true,
    }));
  }

  @override
  Future<Result<Unit>> sendVoid(ApiRequest request) async =>
      Ok<Unit>(Unit.instance);

  @override
  Future<Result<T>> sendMultipart<T>(ApiRequest request,
          List<ApiUploadFile> files, T Function(Object? data) decode) =>
      throw UnimplementedError();
}

void main() {
  test('设备注册、撤销和状态查询走通知推送端点', () async {
    final _Api api = _Api();
    final RemotePushRepository repository = RemotePushRepository(api);
    await repository.register(PushChannel.fcm, 'device-token');
    await repository.revoke(PushChannel.fcm, 'device-token');
    final PushStatus status = await repository.status();

    expect(api.requests.map((ApiRequest request) => request.path), <String>[
      'notifications/push/targets',
      'notifications/push/targets/revoke',
      'notifications/push/status',
    ]);
    expect(api.requests[0].body,
        <String, Object?>{'channel': 'fcm', 'token': 'device-token'});
    expect(status.configured, contains(PushChannel.fcm));
    expect(status.targets.single.channel, PushChannel.fcm);
  });
}
