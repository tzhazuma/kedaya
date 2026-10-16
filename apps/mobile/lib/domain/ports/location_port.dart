/// 定位端口（`platform/` 提供实现）。
///
/// 规格 §3.2 规则 2：**采集时必须显式指定 WGS84**，绝不依赖平台默认值
/// （默认值可能随基础库/系统版本变化，而 GCJ-02 与 WGS84 在上海相差 300–700 米）。
/// 本端口的返回值只有 [Wgs84Point] 一种类型，因此"忘了指定坐标系"写不出来。
///
/// 定位失败**不是致命错误**：上报表单会降级到「在地图上点选位置」，
/// 这既是降级路径，也是用户纠正 GPS 漂移的正常手段。
library;

import '../models/geo.dart';

/// 定位权限状态。
enum LocationPermission {
  granted('granted', '已授权'),
  denied('denied', '未授权'),
  permanentlyDenied('permanently_denied', '已被拒绝（需去系统设置开启）'),
  unsupported('unsupported', '该平台不支持定位'),
  unknown('unknown', '未知');

  const LocationPermission(this.wire, this.label);

  final String wire;
  final String label;

  bool get canRequest => this == LocationPermission.denied;
}

/// 一次定位结果（WGS84）。
final class LocationFix {
  const LocationFix({required this.point, this.accuracyM, this.capturedAt});

  final Wgs84Point point;

  /// 水平精度（米），对应 `POST /items` 的 `geoAccuracyM`（合法区间 1–10000）。
  final int? accuracyM;

  final DateTime? capturedAt;

  /// 精度是否可用于上报（规格 §10.3 的 `INVALID_ACCURACY` 区间）。
  bool get hasUsableAccuracy =>
      accuracyM == null || (accuracyM! >= 1 && accuracyM! <= 10000);

  @override
  String toString() => 'LocationFix($point, ±${accuracyM ?? '?'}m)';
}

abstract interface class LocationPort {
  /// 查询权限（不触发系统弹窗）。
  Future<LocationPermission> permissionStatus();

  /// 请求权限（可能触发系统弹窗）。
  Future<LocationPermission> requestPermission();

  /// 取当前位置；不可用 / 被拒 / 超时返回 `null`（调用方降级到地图点选）。
  Future<LocationFix?> currentFix();
}
