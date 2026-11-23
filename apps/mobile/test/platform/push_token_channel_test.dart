import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/ports/push_port.dart';
import 'package:kedaya/platform/push_token_channel.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('Dart 按渠道调用原生 token 注册，并透传 HMS appId', () async {
    const MethodChannel channel = MethodChannel('kedaya/push');
    final List<MethodCall> calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (MethodCall call) async {
      calls.add(call);
      return 'native-token';
    });
    addTearDown(() => TestDefaultBinaryMessengerBinding
        .instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null));

    const MethodChannelPushTokenProvider provider =
        MethodChannelPushTokenProvider();
    expect(await provider.register(PushChannel.fcm), 'native-token');
    expect(await provider.register(PushChannel.hms), 'native-token');
    expect(calls.map((MethodCall call) => call.method),
        <String>['registerFcm', 'registerHms']);
    expect(calls[1].arguments, containsPair('appId', isA<String>()));
  });
}
