import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/geo.dart';

/// 规格 §3.4（静态底图仿射标定）与 §3.5 V5/V7 的守门测试。
///
/// 这些测试覆盖的是**本模块最大的坑**：坐标系。规格 §3.1 说得很直接 ——
/// 坐标错了"看起来像数据错了而不是坐标系错了，极难排查"，
/// 因此必须由机器验证，而不是靠肉眼。
void main() {
  // 1 米 ≈ 1 像素；v 轴向下（所以 y 的符号是负的），原点映射到 (500, 400)。
  const BasemapAffine affine = BasemapAffine(a: 1, b: 0, c: 500, d: 0, e: -1, f: 400);
  const CampusProjection projection = CampusProjection.campus;

  group('纯 Dart 数学（domain 层禁止 dart:math）', () {
    test('geoCosDegrees 与标准余弦一致（误差 < 1e-9）', () {
      const List<double> degrees = <double>[0, 30, 45, 60, 90, 120, 180, -90, -31.178];
      const List<double> expected = <double>[
        1,
        0.8660254037844387,
        0.7071067811865476,
        0.5,
        0,
        -0.5,
        -1,
        0,
        0.8555631051927892,
      ];
      for (int i = 0; i < degrees.length; i++) {
        expect(
          geoCosDegrees(degrees[i]),
          closeTo(expected[i], 1e-9),
          reason: 'cos(${degrees[i]}°)',
        );
      }
    });

    test('geoSqrt 与标准平方根一致（相对误差 < 1e-12）', () {
      const List<double> values = <double>[0, 1, 2, 9, 10000, 0.25, 1234.5678];
      const List<double> expected = <double>[
        0,
        1,
        1.4142135623730951,
        3,
        100,
        0.5,
        35.13641700572214,
      ];
      for (int i = 0; i < values.length; i++) {
        expect(geoSqrt(values[i]), closeTo(expected[i], 1e-9), reason: 'sqrt(${values[i]})');
      }
    });
  });

  group('局部 ENU 投影（规格 §3.4 步骤 1）', () {
    test('米 → 经纬度 → 米 往返无误差（同一投影参数）', () {
      const List<LocalMeters> samples = <LocalMeters>[
        LocalMeters(x: 0, y: 0),
        LocalMeters(x: 120, y: -80),
        LocalMeters(x: -333.5, y: 456.25),
      ];
      for (final LocalMeters meters in samples) {
        final Wgs84Point point = projection.fromLocalMeters(meters);
        final LocalMeters back = projection.toLocalMeters(point);
        expect(back.distanceTo(meters), lessThan(1e-6), reason: '$meters');
      }
    });

    test('metersBetween：向北 30 m 的点，距离 ≈ 30 m', () {
      const Wgs84Point a = Wgs84Point(lat: 31.1780, lng: 121.5900);
      final Wgs84Point b = Wgs84Point(
        lat: 31.1780 + 30 / CampusProjection.defaultMetersPerDegreeLat,
        lng: 121.5900,
      );
      expect(projection.metersBetween(a, b), closeTo(30, 0.05));
    });
  });

  group('规格 §11.1 T7：30 m 的上报在图上应是 25–35 px', () {
    test('1 m ≈ 1 px 的标定下，30 m 对应 25–35 px', () {
      const Wgs84Point a = Wgs84Point(lat: 31.1780, lng: 121.5900);
      final Wgs84Point b = Wgs84Point(
        lat: 31.1780 + 30 / CampusProjection.defaultMetersPerDegreeLat,
        lng: 121.5900,
      );
      final LocalPixel pixelA = affine.pixelFor(a, projection: projection);
      final LocalPixel pixelB = affine.pixelFor(b, projection: projection);
      final double pixelDistance = pixelA.distanceTo(pixelB);
      expect(pixelDistance, greaterThan(25));
      expect(pixelDistance, lessThan(35));
    });
  });

  group('像素 ↔ 经纬度 往返（规格 §3.4 的标定结果必须可逆）', () {
    test('像素 → 经纬度 → 像素 的误差 < 1 px', () {
      const List<LocalPixel> samples = <LocalPixel>[
        LocalPixel(u: 500, v: 400),
        LocalPixel(u: 120, v: 660),
        LocalPixel(u: 880, v: 90),
        LocalPixel(u: 610.5, v: 355.25),
        LocalPixel(u: 233.75, v: 512.5),
      ];
      for (final LocalPixel pixel in samples) {
        final Wgs84Point point = affine.pointFor(pixel, projection: projection);
        final LocalPixel back = affine.pixelFor(point, projection: projection);
        expect(back.distanceTo(pixel), lessThan(1.0), reason: '往返：$pixel');
      }
    });

    test('原点映射到 (500, 400)，向北则 v 变小', () {
      final LocalPixel origin = affine.pixelFor(
        projection.origin,
        projection: projection,
      );
      expect(origin.u, closeTo(500, 1e-6));
      expect(origin.v, closeTo(400, 1e-6));

      final Wgs84Point north = projection.fromLocalMeters(
        const LocalMeters(x: 0, y: 100),
      );
      final LocalPixel northPixel = affine.pixelFor(north, projection: projection);
      expect(northPixel.v, closeTo(300, 1e-6));
    });

    test('不可逆的仿射矩阵会抛错，而不是给出错误结果', () {
      const BasemapAffine degenerate = BasemapAffine(a: 0, b: 0, c: 0, d: 0, e: 0, f: 0);
      expect(degenerate.isInvertible, isFalse);
      expect(
        () => degenerate.pointFor(const LocalPixel(u: 1, v: 1), projection: projection),
        throwsA(isA<StateError>()),
      );
    });

    test('仿射矩阵必须是 6 个数', () {
      expect(
        () => BasemapAffine.fromCoefficients(const <Object?>[1, 2, 3]),
        throwsA(isA<ArgumentError>()),
      );
      final BasemapAffine parsed = BasemapAffine.fromCoefficients(
        const <Object?>[1, 0, 500, 0, -1, 400],
      );
      expect(parsed.coefficients, <double>[1, 0, 500, 0, -1, 400]);
    });
  });

  group('最小二乘标定（规格 §3.4 步骤 3）', () {
    // 已知的"真值"仿射：带旋转与非等比缩放。
    const BasemapAffine truth = BasemapAffine(
      a: 1.02,
      b: 0.03,
      c: 480,
      d: -0.02,
      e: -0.98,
      f: 420,
    );

    /// 6 个控制点：把"真值"仿射作用在校园内分散的 6 个地标上。
    /// （规格 §3.4 要求控制点分散在四角与中心，否则外推误差会爆炸。）
    List<BasemapControlPoint> controlPoints() {
      const List<Wgs84Point> points = <Wgs84Point>[
        Wgs84Point(lat: 31.1780, lng: 121.5900),
        Wgs84Point(lat: 31.1805, lng: 121.5900),
        Wgs84Point(lat: 31.1780, lng: 121.5955),
        Wgs84Point(lat: 31.1805, lng: 121.5955),
        Wgs84Point(lat: 31.1792, lng: 121.5927),
        Wgs84Point(lat: 31.1762, lng: 121.5872),
      ];
      return <BasemapControlPoint>[
        for (final Wgs84Point point in points)
          BasemapControlPoint(
            point: point,
            pixel: truth.pixelFor(point, projection: projection),
          ),
      ];
    }

    test('无噪声时能还原仿射矩阵，RMSE ≈ 0', () {
      final BasemapCalibration calibration = calibrateBasemapAffine(
        controlPoints(),
        projection: projection,
      );
      expect(calibration.affine.a, closeTo(truth.a, 1e-6));
      expect(calibration.affine.b, closeTo(truth.b, 1e-6));
      expect(calibration.affine.c, closeTo(truth.c, 1e-6));
      expect(calibration.affine.d, closeTo(truth.d, 1e-6));
      expect(calibration.affine.e, closeTo(truth.e, 1e-6));
      expect(calibration.affine.f, closeTo(truth.f, 1e-6));
      expect(calibration.rmsePx, lessThan(1e-6));
      expect(calibration.controlPointCount, 6);
      expect(calibration.isAcceptable, isTrue);
    });

    test('控制点少于 6 个直接拒绝（规格 §3.4 步骤 3）', () {
      expect(
        () => calibrateBasemapAffine(<BasemapControlPoint>[]),
        throwsA(isA<ArgumentError>()),
      );
      final List<BasemapControlPoint> few = controlPoints().sublist(0, 5);
      expect(
        () => calibrateBasemapAffine(few, projection: projection),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('残差是 u 与 v 合并计算的 RMSE，且阈值是 5 px（不得放宽）', () {
      expect(basemapMaxRmsePx, 5);
      expect(basemapMinControlPoints, 6);
      const BasemapCalibration acceptable = BasemapCalibration(
        affine: BasemapAffine.identity,
        rmsePx: 4.9,
        controlPointCount: 6,
      );
      const BasemapCalibration tooCoarse = BasemapCalibration(
        affine: BasemapAffine.identity,
        rmsePx: 5.0,
        controlPointCount: 6,
      );
      const BasemapCalibration tooFew = BasemapCalibration(
        affine: BasemapAffine.identity,
        rmsePx: 1.0,
        controlPointCount: 5,
      );
      expect(acceptable.isAcceptable, isTrue);
      expect(tooCoarse.isAcceptable, isFalse);
      expect(tooFew.isAcceptable, isFalse);
    });
  });

  group('校园边界（规格 §3.5 V5 / T6）', () {
    test('校园内的点通过', () {
      const Wgs84Point point = Wgs84Point(lat: 31.1780, lng: 121.5900);
      expect(point.isWithin(CampusBounds.campus), isTrue);
      expect(assertInCampus(point), point);
    });

    test('校园外的点抛 CoordinateOutOfCampusException（reason 是契约取值）', () {
      const Wgs84Point outside = Wgs84Point(lat: 31.2000, lng: 121.5900);
      expect(outside.isWithin(CampusBounds.campus), isFalse);
      expect(
        () => assertInCampus(outside),
        throwsA(isA<CoordinateOutOfCampusException>()),
      );
      expect(CoordinateOutOfCampusException.reason, 'COORDINATE_OUT_OF_CAMPUS');
    });

    test('lat/lng 写反会被拒绝（这是最高频的错误）', () {
      const Wgs84Point correct = Wgs84Point(lat: 31.1780, lng: 121.5900);
      final Wgs84Point swapped = Wgs84Point(lat: correct.lng, lng: correct.lat);
      expect(swapped.isWithin(CampusBounds.campus), isFalse);
      expect(
        () => assertInCampus(swapped),
        throwsA(isA<CoordinateOutOfCampusException>()),
      );
    });

    test('Wgs84Point 自证坐标系：datum 恒为 WGS84', () {
      const Wgs84Point point = Wgs84Point(lat: 31.1780, lng: 121.5900);
      expect(point.datum, GeoDatum.wgs84);
      expect(point.datum.wire, 'WGS84');
      expect(point.toJson(), <String, Object?>{'lat': 31.178, 'lng': 121.59});
    });

    test('isCloseTo 用米做容差判断', () {
      const Wgs84Point a = Wgs84Point(lat: 31.1780, lng: 121.5900);
      final Wgs84Point near = Wgs84Point(
        lat: 31.1780 + 5 / CampusProjection.defaultMetersPerDegreeLat,
        lng: 121.5900,
      );
      expect(a.isCloseTo(near, toleranceMeters: 10), isTrue);
      expect(a.isCloseTo(near, toleranceMeters: 1), isFalse);
    });
  });
}
