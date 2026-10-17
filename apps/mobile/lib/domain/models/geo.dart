/// 坐标系与静态底图仿射标定（规格 `docs/features/wildlife-map.md` §3）。
///
/// ## 为什么本端完全没有 GCJ-02
///
/// 规格 §1.2 采用 **方案 B：静态校园平面图 + 叠加层**，§3.4 用
/// 「WGS84 → 局部 ENU 米制平面 → 仿射变换 → 图像像素」完成映射。
/// 也就是说：**底图是像素空间，不是 GCJ-02 地图空间**，因此
/// 那个「偏移 300–700 米、随经纬度变化」的坐标系陷阱在本端**根本不存在**。
///
/// 本文件把这个结论做成**类型层面的事实**，而不是一句注释：
///   - [GeoDatum] 只有 `wgs84` 一个成员 —— 想构造一个 GCJ-02 坐标，
///     在编译期就没有可用的类型；
///   - 所有持久化 / 渲染入口（[Wgs84Point]）都带 `datum == GeoDatum.wgs84`；
///   - 本端**不提供** `wgs84ToGcj02`，因此不可能有代码「忘记转换」而把
///     GCJ-02 写进请求体（规格 §3.2 规则 5：禁止 `gcjLat` / `gcjLng` 持久化列）。
///
/// 唯一的 GCJ-02 消费点是「在腾讯/高德地图里打开」（规格 §1.2 的逃生口）。
/// 本端**刻意不提供该按钮**：它的前提是规格 §11.1 T4 的人工控制点数据
/// （`gcj02-control-points.json`，未决问题 U4，**至今未采集**），
/// 在没有可验证的对照数据前提供一个未经验证的坐标转换，风险高于收益。
///
/// ## 为什么这里手写 cos / sqrt
///
/// 冻结契约 §7 硬规则 1：`domain` 层零框架依赖，只允许 `dart:core`；
/// 本仓库的自检脚本（`tool/selfcheck.py`）据此把 `dart:math` 也判为违规。
/// 校园尺度只需要两个数学函数，因此按纯 Dart 实现并**用单测锁住精度**
/// （见 `test/domain/wildlife_geo_test.dart`）。
library;

import 'json_read.dart';

/// 坐标基准。**只有一个成员**，见文件头注释。
enum GeoDatum {
  /// 国际标准（EPSG:4326）。服务端、数据库、本端模型的**唯一**语义。
  wgs84('WGS84');

  const GeoDatum(this.wire);

  /// 线上字符串形式。
  final String wire;
}

/// 一个 WGS84 坐标点。
///
/// 规格 §3.2 规则 5「字段命名必须自证坐标系」在 Dart 侧的做法是
/// **类型自证**：需要坐标的地方一律要求 [Wgs84Point]，而全仓库没有第二个
/// 坐标类型，因此「误用 GCJ-02」不是靠人记住，而是写不出来。
final class Wgs84Point {
  const Wgs84Point({required this.lat, required this.lng});

  /// 从 `{ "lat": 31.178, "lng": 121.59 }` 解析。
  ///
  /// 兼容 `latitude` / `longitude` 两种键名（后端若换形状不至于整条解析失败），
  /// 但**只认这两个语义**：`gcjLat` / `gcjLng` / `exactLat` / `exactLng`
  /// 这类键**永远不会被读取**（规格 §9.6 T15：响应里的精确坐标对客户端不存在）。
  factory Wgs84Point.fromJson(Map<String, Object?> json) {
    final double? lat =
        readDoubleOrNull(json, 'lat') ?? readDoubleOrNull(json, 'latitude');
    final double? lng =
        readDoubleOrNull(json, 'lng') ?? readDoubleOrNull(json, 'longitude');
    if (lat == null || lng == null) {
      throw const FormatException('坐标对象缺少 lat/lng 字段');
    }
    return Wgs84Point(lat: lat, lng: lng);
  }

  final double lat;
  final double lng;

  /// 恒为 [GeoDatum.wgs84]。
  GeoDatum get datum => GeoDatum.wgs84;

  bool isWithin(CampusBounds bounds) => bounds.contains(this);

  /// 与另一点的球面距离是否在容差内（用于测试与 mock 断言）。
  bool isCloseTo(Wgs84Point other, {double toleranceMeters = 1}) =>
      CampusProjection.campus.metersBetween(this, other) <= toleranceMeters;

  Wgs84Point copyWith({double? lat, double? lng}) =>
      Wgs84Point(lat: lat ?? this.lat, lng: lng ?? this.lng);

  Map<String, Object?> toJson() => <String, Object?>{'lat': lat, 'lng': lng};

  @override
  bool operator ==(Object other) =>
      other is Wgs84Point && other.lat == lat && other.lng == lng;

  @override
  int get hashCode => Object.hash(lat, lng);

  @override
  String toString() => 'Wgs84Point($lat, $lng)';
}

/// 局部 ENU 米制平面上的点（x 向东、y 向北）。
final class LocalMeters {
  const LocalMeters({required this.x, required this.y});

  final double x;
  final double y;

  double distanceTo(LocalMeters other) {
    final double dx = other.x - x;
    final double dy = other.y - y;
    return geoSqrt(dx * dx + dy * dy);
  }

  @override
  String toString() =>
      'LocalMeters(${x.toStringAsFixed(2)}, ${y.toStringAsFixed(2)})';
}

/// 底图图片上的像素坐标（u 向右、v 向下，原点在图片左上角）。
final class LocalPixel {
  const LocalPixel({required this.u, required this.v});

  final double u;
  final double v;

  double distanceTo(LocalPixel other) {
    final double du = other.u - u;
    final double dv = other.v - v;
    return geoSqrt(du * du + dv * dv);
  }

  @override
  String toString() =>
      'LocalPixel(${u.toStringAsFixed(2)}, ${v.toStringAsFixed(2)})';
}

/// WGS84 → 局部米制平面的等距圆柱近似（规格 §3.4 步骤 1）。
///
/// 近似误差：1 km 尺度上相对误差 < 0.01%（约 0.1 m），**远小于 GPS 本身的
/// 5–20 m 误差**，因此不引入 proj4 / PostGIS（规格 §3.4 的「用数学分析替代依赖」）。
final class CampusProjection {
  const CampusProjection({
    required this.origin,
    this.metersPerDegreeLat = defaultMetersPerDegreeLat,
    this.metersPerDegreeLngAtEquator = defaultMetersPerDegreeLngAtEquator,
  });

  /// 纬度 1 度 ≈ 110.54 km。
  static const double defaultMetersPerDegreeLat = 110540;

  /// 赤道上经度 1 度 ≈ 111.32 km（实际值需乘 `cos(lat)`）。
  static const double defaultMetersPerDegreeLngAtEquator = 111320;

  /// 校园投影原点。
  ///
  /// ⚠️ **占位值**：规格 §12 U3 —— 校园原点与边界框的实测值**至今未知**，
  /// 本文档与代码用的都是规格给出的占位值。实测后只需替换这一处常量
  /// （[CampusBounds.campus] 同理），映射逻辑不变。
  static const CampusProjection campus = CampusProjection(
    origin: Wgs84Point(lat: 31.1780, lng: 121.5900),
  );

  final Wgs84Point origin;
  final double metersPerDegreeLat;
  final double metersPerDegreeLngAtEquator;

  /// 该纬度上经度 1 度对应的米数（`cos(lat)` 由纯 Dart 实现，见 [geoCosDegrees]）。
  double get metersPerDegreeLng =>
      metersPerDegreeLngAtEquator * geoCosDegrees(origin.lat);

  LocalMeters toLocalMeters(Wgs84Point point) => LocalMeters(
        x: (point.lng - origin.lng) * metersPerDegreeLng,
        y: (point.lat - origin.lat) * metersPerDegreeLat,
      );

  Wgs84Point fromLocalMeters(LocalMeters meters) => Wgs84Point(
        lat: origin.lat + meters.y / metersPerDegreeLat,
        lng: origin.lng + meters.x / metersPerDegreeLng,
      );

  /// 两点距离（米）。等距圆柱 + 中点纬度，校园尺度误差可忽略。
  double metersBetween(Wgs84Point a, Wgs84Point b) {
    final double cosLat = geoCosDegrees((a.lat + b.lat) / 2);
    final double dx = (b.lng - a.lng) * metersPerDegreeLngAtEquator * cosLat;
    final double dy = (b.lat - a.lat) * metersPerDegreeLat;
    return geoSqrt(dx * dx + dy * dy);
  }

  @override
  String toString() => 'CampusProjection(origin: $origin)';
}

/// 校园边界框（规格 §3.5 V5 的 `CAMPUS_BBOX`）。
///
/// ⚠️ **占位值**（规格 §12 U3）。它的作用是**机器拦截 lat/lng 写反**：
/// 在上科大（lat≈31, lng≈121），两个字段互换后坐标会落到地球另一处，
/// 「必须在校园内」这条断言能立刻抓住它。
final class CampusBounds {
  const CampusBounds({
    required this.minLat,
    required this.maxLat,
    required this.minLng,
    required this.maxLng,
  });

  static const CampusBounds campus = CampusBounds(
    minLat: 31.170,
    maxLat: 31.186,
    minLng: 121.582,
    maxLng: 121.598,
  );

  final double minLat;
  final double maxLat;
  final double minLng;
  final double maxLng;

  bool contains(Wgs84Point point) =>
      point.lat >= minLat &&
      point.lat <= maxLat &&
      point.lng >= minLng &&
      point.lng <= maxLng;

  @override
  String toString() => 'CampusBounds(lat $minLat–$maxLat, lng $minLng–$maxLng)';
}

/// 写入路径的坐标越界异常（规格 §3.5 V5：返回
/// `VALIDATION_FAILED` / `COORDINATE_OUT_OF_CAMPUS`，HTTP 422）。
final class CoordinateOutOfCampusException implements Exception {
  const CoordinateOutOfCampusException(this.point,
      {this.bounds = CampusBounds.campus});

  /// 服务端 `details.reason` 的规范取值。
  static const String reason = 'COORDINATE_OUT_OF_CAMPUS';

  final Wgs84Point point;
  final CampusBounds bounds;

  String get message => '坐标不在校园范围内（$reason）：$point 不在 $bounds 内';

  @override
  String toString() => message;
}

/// 所有**写入路径**都必须过的坐标校验（规格 §3.5 V5）。
Wgs84Point assertInCampus(
  Wgs84Point point, {
  CampusBounds bounds = CampusBounds.campus,
}) {
  if (!bounds.contains(point)) {
    throw CoordinateOutOfCampusException(point, bounds: bounds);
  }
  return point;
}

/// 底图仿射标定矩阵：`[u, v]ᵀ = [[a, b, c], [d, e, f]] · [x, y, 1]ᵀ`（规格 §3.4 步骤 2）。
final class BasemapAffine {
  const BasemapAffine({
    required this.a,
    required this.b,
    required this.c,
    required this.d,
    required this.e,
    required this.f,
  });

  /// 从 6 元数组 `[a, b, c, d, e, f]` 构造（与契约 §1.4 的 wire 形状一致）。
  factory BasemapAffine.fromCoefficients(List<Object?> coefficients) {
    if (coefficients.length != 6) {
      throw ArgumentError.value(
        coefficients,
        'coefficients',
        '底图仿射矩阵必须是 6 个数 [a, b, c, d, e, f]',
      );
    }
    double at(int index) {
      final Object? value = coefficients[index];
      if (value is num) return value.toDouble();
      throw FormatException('affine[$index] 期望数字，实际为 $value');
    }

    return BasemapAffine(
      a: at(0),
      b: at(1),
      c: at(2),
      d: at(3),
      e: at(4),
      f: at(5),
    );
  }

  /// 恒等（1 米 ≈ 1 像素，原点重合）—— 测试与「示意图 = 像素图」的默认标定。
  static const BasemapAffine identity =
      BasemapAffine(a: 1, b: 0, c: 0, d: 0, e: 1, f: 0);

  final double a;
  final double b;
  final double c;
  final double d;
  final double e;
  final double f;

  List<double> get coefficients => <double>[a, b, c, d, e, f];

  /// 行列式；为 0 表示退化（标定点共线 / 底图被压扁）。
  double get determinant => a * e - b * d;

  bool get isInvertible => determinant.abs() > 1e-12;

  LocalPixel pixelForMeters(LocalMeters meters) => LocalPixel(
        u: a * meters.x + b * meters.y + c,
        v: d * meters.x + e * meters.y + f,
      );

  LocalMeters metersForPixel(LocalPixel pixel) {
    final double det = determinant;
    if (det.abs() < 1e-12) {
      throw StateError('底图仿射矩阵不可逆（行列式 ≈ 0），标定点可能共线');
    }
    final double du = pixel.u - c;
    final double dv = pixel.v - f;
    return LocalMeters(x: (e * du - b * dv) / det, y: (-d * du + a * dv) / det);
  }

  /// WGS84 → 像素。
  LocalPixel pixelFor(
    Wgs84Point point, {
    CampusProjection projection = CampusProjection.campus,
  }) =>
      pixelForMeters(projection.toLocalMeters(point));

  /// 像素 → WGS84（用于「在地图上点选位置」）。
  Wgs84Point pointFor(
    LocalPixel pixel, {
    CampusProjection projection = CampusProjection.campus,
  }) =>
      projection.fromLocalMeters(metersForPixel(pixel));

  @override
  String toString() =>
      'BasemapAffine([${coefficients.map((double v) => v.toStringAsFixed(6)).join(', ')}])';
}

/// 一个控制点：地标的实测 WGS84 坐标 + 在底图上的像素坐标（规格 §3.4 步骤 3）。
final class BasemapControlPoint {
  const BasemapControlPoint({required this.point, required this.pixel});

  final Wgs84Point point;
  final LocalPixel pixel;
}

/// 标定结果。
final class BasemapCalibration {
  const BasemapCalibration({
    required this.affine,
    required this.rmsePx,
    required this.controlPointCount,
  });

  final BasemapAffine affine;

  /// 残差 RMSE（像素），对 u 与 v **合并**计算（规格 §3.4 步骤 3）。
  final double rmsePx;

  final int controlPointCount;

  /// 规格 §1.4 的 CI 阈值：`rmsePx < 5` 且控制点数 ≥ 6。
  bool get isAcceptable =>
      rmsePx < basemapMaxRmsePx && controlPointCount >= basemapMinControlPoints;

  @override
  String toString() =>
      'BasemapCalibration(rmse=${rmsePx.toStringAsFixed(3)}px, n=$controlPointCount)';
}

/// 规格 §1.4：标定残差上限（像素）。**不得放宽**（§3.4 步骤 5）。
const double basemapMaxRmsePx = 5;

/// 规格 §1.4：控制点数量下限。
const int basemapMinControlPoints = 6;

/// 最小二乘标定 6 参数仿射（规格 §3.4 步骤 3）。
///
/// 对 u 与 v 各解一个 3 参数线性最小二乘（正规方程 `θ = (AᵀA)⁻¹ Aᵀb`）。
/// 控制点少于 [basemapMinControlPoints] 直接抛错 —— 规格明确「≥6 个控制点，
/// 且要分散在四角与中心」，少于 6 个的标定不该被接受。
BasemapCalibration calibrateBasemapAffine(
  List<BasemapControlPoint> controlPoints, {
  CampusProjection projection = CampusProjection.campus,
}) {
  if (controlPoints.length < basemapMinControlPoints) {
    throw ArgumentError.value(
      controlPoints.length,
      'controlPoints',
      '底图标定至少需要 $basemapMinControlPoints 个控制点（规格 §3.4 步骤 3）',
    );
  }

  final List<List<double>> normal = <List<double>>[
    <double>[0, 0, 0],
    <double>[0, 0, 0],
    <double>[0, 0, 0],
  ];
  final List<double> rhsU = <double>[0, 0, 0];
  final List<double> rhsV = <double>[0, 0, 0];

  for (final BasemapControlPoint control in controlPoints) {
    final LocalMeters meters = projection.toLocalMeters(control.point);
    final List<double> row = <double>[meters.x, meters.y, 1];
    for (int i = 0; i < 3; i++) {
      for (int j = 0; j < 3; j++) {
        normal[i][j] += row[i] * row[j];
      }
      rhsU[i] += row[i] * control.pixel.u;
      rhsV[i] += row[i] * control.pixel.v;
    }
  }

  final List<double> thetaU = _solve3(normal, rhsU);
  final List<double> thetaV = _solve3(normal, rhsV);

  final BasemapAffine affine = BasemapAffine(
    a: thetaU[0],
    b: thetaU[1],
    c: thetaU[2],
    d: thetaV[0],
    e: thetaV[1],
    f: thetaV[2],
  );

  double sumSquares = 0;
  for (final BasemapControlPoint control in controlPoints) {
    final LocalMeters meters = projection.toLocalMeters(control.point);
    final LocalPixel predicted = affine.pixelForMeters(meters);
    final double du = predicted.u - control.pixel.u;
    final double dv = predicted.v - control.pixel.v;
    sumSquares += du * du + dv * dv;
  }
  // 残差向量长度是控制点数的 2 倍（u 与 v 合并），因此除以 2n。
  final double rmse = geoSqrt(sumSquares / (controlPoints.length * 2));

  return BasemapCalibration(
    affine: affine,
    rmsePx: rmse,
    controlPointCount: controlPoints.length,
  );
}

/// 解 3×3 线性方程组（列主元高斯消元）。
List<double> _solve3(List<List<double>> matrix, List<double> rhs) {
  final List<List<double>> work = <List<double>>[
    for (int i = 0; i < 3; i++) <double>[...matrix[i], rhs[i]],
  ];

  for (int column = 0; column < 3; column++) {
    int pivot = column;
    for (int row = column + 1; row < 3; row++) {
      if (work[row][column].abs() > work[pivot][column].abs()) pivot = row;
    }
    if (work[pivot][column].abs() < 1e-12) {
      throw StateError('标定方程退化：控制点共线或重合（规格 §3.4 步骤 5 要求重新标定）');
    }
    final List<double> swap = work[column];
    work[column] = work[pivot];
    work[pivot] = swap;

    for (int row = 0; row < 3; row++) {
      if (row == column) continue;
      final double factor = work[row][column] / work[column][column];
      for (int k = column; k <= 3; k++) {
        work[row][k] -= factor * work[column][k];
      }
    }
  }

  return <double>[
    work[0][3] / work[0][0],
    work[1][3] / work[1][1],
    work[2][3] / work[2][2],
  ];
}

// ------------------------------------------------------------------ 纯 Dart 数学
//
// `domain` 层禁止 `dart:math`（冻结契约 §7 硬规则 1 + `tool/selfcheck.py`），
// 因此下面两个函数按纯 `dart:core` 实现。精度由单测锁定：
//   - `geoCosDegrees` 在 [-360°, 360°] 上与 `math.cos` 的最大绝对误差 ~2e-14；
//   - `geoSqrt` 的相对误差 ~1e-16。
// 这两条数值在实现时用 Python 独立复算过（见交付说明的替代验证）。

/// 纯 `dart:core` 的余弦（输入为**度**）。
double geoCosDegrees(double degrees) => _cosRadians(degrees * _pi / 180.0);

/// 纯 `dart:core` 的平方根（牛顿迭代；`value <= 0` 返回 0）。
double geoSqrt(double value) {
  if (value <= 0) return 0;
  double guess = value;
  for (int i = 0; i < 40; i++) {
    guess = 0.5 * (guess + value / guess);
  }
  return guess;
}

const double _pi = 3.14159265358979323846;
const double _twoPi = 2 * _pi;

/// 余弦：先把角度归约到 [-π, π]，再展开 12 项泰勒级数（到 `r²⁴/24!`）。
double _cosRadians(double radians) {
  final double reduced = radians - (radians / _twoPi).roundToDouble() * _twoPi;
  double term = 1;
  double total = 1;
  for (int k = 1; k <= 12; k++) {
    term = -term * reduced * reduced / ((2 * k - 1) * (2 * k));
    total += term;
  }
  return total;
}
