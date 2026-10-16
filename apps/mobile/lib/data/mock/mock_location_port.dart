import '../../domain/models/geo.dart';
import '../../domain/ports/location_port.dart';

/// 内存定位实现（mock 运行时 / 测试）。
///
/// 默认给一个**校园内**的固定点（图书馆后草坪附近），因此 mock 运行时的
/// 「使用当前位置」按钮是真的能用，而不是弹一个"定位失败"。
/// 把 [permission] 改成 [LocationPermission.denied] 就能演示降级到
/// 「在地图上点选位置」这条路径。
final class InMemoryLocationPort implements LocationPort {
  InMemoryLocationPort({
    this.fix = defaultFix,
    this.permission = LocationPermission.granted,
  });

  /// 默认定位点（WGS84）。
  static const LocationFix defaultFix = LocationFix(
    point: Wgs84Point(lat: 31.17855, lng: 121.59012),
    accuracyM: 12,
  );

  /// 返回的定位结果；`null` 表示"拿不到位置"。
  LocationFix? fix;

  LocationPermission permission;

  @override
  Future<LocationPermission> permissionStatus() async => permission;

  @override
  Future<LocationPermission> requestPermission() async => permission;

  @override
  Future<LocationFix?> currentFix() async {
    if (permission != LocationPermission.granted) return null;
    return fix;
  }
}
