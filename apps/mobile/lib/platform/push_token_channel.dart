import 'package:flutter/services.dart';

import '../domain/ports/push_port.dart';

abstract interface class PushTokenPort {
  Future<String> register(PushChannel channel);
  Future<void> unregister(PushChannel channel);
}

final class MethodChannelPushTokenProvider implements PushTokenPort {
  const MethodChannelPushTokenProvider();

  static const MethodChannel _channel = MethodChannel('kedaya/push');
  static const String _hmsAppId = String.fromEnvironment('HMS_APP_ID');

  @override
  Future<String> register(PushChannel channel) async {
    final String method = switch (channel) {
      PushChannel.fcm => 'registerFcm',
      PushChannel.hms => 'registerHms',
      PushChannel.apns => 'registerApns',
      PushChannel.wechatSubscribe => throw UnsupportedError('微信订阅不走原生推送通道'),
    };
    final String? token = await _channel.invokeMethod<String>(
      method,
      channel == PushChannel.hms ? <String, Object?>{'appId': _hmsAppId} : null,
    );
    if (token == null || token.isEmpty) {
      throw StateError('原生推送通道未返回设备 token');
    }
    return token;
  }

  @override
  Future<void> unregister(PushChannel channel) async {
    final String method = switch (channel) {
      PushChannel.fcm => 'unregisterFcm',
      PushChannel.hms => 'unregisterHms',
      PushChannel.apns => 'unregister',
      PushChannel.wechatSubscribe => throw UnsupportedError('微信订阅不走原生推送通道'),
    };
    await _channel.invokeMethod<void>(
      method,
      channel == PushChannel.hms ? <String, Object?>{'appId': _hmsAppId} : null,
    );
  }
}
