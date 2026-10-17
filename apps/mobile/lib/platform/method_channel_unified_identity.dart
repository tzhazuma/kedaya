import 'package:flutter/services.dart';

import '../domain/ports/platform_ports.dart';

/// [UnifiedIdentityPort] 的原生实现：通过 MethodChannel 让原生宿主拉起
/// 学校统一身份认证（CAS / Egate OAuth）页面并回传授权码。
///
/// **原生侧契约**（iOS / Android / 鸿蒙各实现一次）：
/// ```
/// channel : kedaya/unified_identity
/// method  : requestAuthorizationCode
/// 返回    : String（授权码）或 null（用户取消）
/// ```
///
/// 未实现该 channel 的平台（例如未接入的桌面端）会抛 `MissingPluginException`；
/// 这里收敛为 null（等同"用户取消"），由上层决定降级策略，而不是崩溃。
final class MethodChannelUnifiedIdentity implements UnifiedIdentityPort {
  const MethodChannelUnifiedIdentity({MethodChannel channel = _defaultChannel})
      : _channel = channel;

  static const MethodChannel _defaultChannel =
      MethodChannel('kedaya/unified_identity');

  final MethodChannel _channel;

  @override
  Future<String?> requestAuthorizationCode() async {
    try {
      return await _channel.invokeMethod<String>('requestAuthorizationCode');
    } on MissingPluginException {
      return null;
    } on PlatformException {
      return null;
    }
  }
}
