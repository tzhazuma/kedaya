import 'package:flutter/services.dart';

import '../domain/models/geo.dart';
import '../domain/ports/location_port.dart';

/// [LocationPort] 的原生实现：通过 MethodChannel 让原生宿主提供定位。
///
/// **原生侧契约**（iOS / Android / 鸿蒙各实现一次）：
/// ```
/// channel : kedaya/location
/// method  : permissionStatus  -> String（granted | denied | permanently_denied | unsupported）
/// method  : requestPermission -> String（同上）
/// method  : currentFix        -> Map | null
///            { lat: double, lng: double, accuracyM: int? }
/// ```
///
/// ⚠️ **原生侧实现未写**（与 `MethodChannelUnifiedIdentity` 的现状一致）：
/// 本工作流的写作用域只有 Dart 侧骨架，`android/` `ios/` `ohos/` 目录都还没生成。
/// 因此真实运行时 [currentFix] 会返回 `null`，UI 自动降级到「在地图上点选位置」——
/// 这条降级路径是**完整可用**的，不是占位。
///
/// 为什么不用 `geolocator` 之类的插件：本端已经在 mock 运行时验证了整条上报链路，
/// 再加一个平台插件只会增加无法在本机验证的编译面。需要真机 GPS 时按上面的
/// channel 契约实现原生侧即可，Dart 侧**不需要改**。
///
/// **坐标系**：契约要求原生侧返回 **WGS84**（规格 §3.2 规则 2：显式指定，
/// 绝不依赖默认值）。返回类型只有 [Wgs84Point]，因此"忘了指定坐标系"写不出来。
final class MethodChannelLocation implements LocationPort {
  const MethodChannelLocation({MethodChannel channel = _defaultChannel})
      : _channel = channel;

  static const MethodChannel _defaultChannel = MethodChannel('kedaya/location');

  final MethodChannel _channel;

  @override
  Future<LocationPermission> permissionStatus() async {
    try {
      return _parsePermission(
          await _channel.invokeMethod<String>('permissionStatus'));
    } on MissingPluginException {
      return LocationPermission.unsupported;
    } on PlatformException {
      return LocationPermission.unknown;
    }
  }

  @override
  Future<LocationPermission> requestPermission() async {
    try {
      return _parsePermission(
          await _channel.invokeMethod<String>('requestPermission'));
    } on MissingPluginException {
      return LocationPermission.unsupported;
    } on PlatformException {
      return LocationPermission.unknown;
    }
  }

  @override
  Future<LocationFix?> currentFix() async {
    try {
      final Map<Object?, Object?>? raw =
          await _channel.invokeMethod<Map<Object?, Object?>>('currentFix');
      if (raw == null) return null;
      final Object? lat = raw['lat'];
      final Object? lng = raw['lng'];
      if (lat is! num || lng is! num) return null;
      final Object? accuracy = raw['accuracyM'];
      return LocationFix(
        point: Wgs84Point(lat: lat.toDouble(), lng: lng.toDouble()),
        accuracyM: accuracy is num ? accuracy.round() : null,
      );
    } on MissingPluginException {
      return null;
    } on PlatformException {
      return null;
    }
  }

  LocationPermission _parsePermission(String? wire) => switch (wire) {
        'granted' => LocationPermission.granted,
        'denied' => LocationPermission.denied,
        'permanently_denied' => LocationPermission.permanentlyDenied,
        'unsupported' => LocationPermission.unsupported,
        _ => LocationPermission.unknown,
      };
}
