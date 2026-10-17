import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/geo.dart';
import 'package:kedaya/domain/models/wildlife.dart';

/// 底图配置的机器可检查约束（规格 §1.4）。
///
/// 为什么客户端也要校验：底图标定错了会让**所有**点位整体偏移，
/// 而这种错误"看起来像数据错了"，极难排查（规格 §3.1）。
/// 宁可整页显示"底图配置不可用"，也不要画一张标定错误的图。
void main() {
  CampusBasemap basemap({
    double rmse = 1.8,
    int controlPoints = 8,
    String attribution = '示意性自绘',
    BasemapLicense license = BasemapLicense.original,
    int widthPx = 1000,
    int heightPx = 700,
    String imageUrl = '',
  }) =>
      CampusBasemap(
        version: 'v1',
        imageUrl: imageUrl,
        widthPx: widthPx,
        heightPx: heightPx,
        affine: const BasemapAffine(a: 1, b: 0, c: 500, d: 0, e: -1, f: 400),
        calibrationRmsePx: rmse,
        controlPointCount: controlPoints,
        attribution: attribution,
        license: license,
      );

  group('规格 §1.4 的四条 CI 规则', () {
    test('合法底图可渲染', () {
      final CampusBasemap value = basemap();
      expect(value.validate(), isEmpty);
      expect(value.isRenderable, isTrue);
      expect(value.hasImage, isFalse);
    });

    test('RMSE ≥ 5 被拒绝（阈值不得放宽）', () {
      expect(
        basemap(rmse: 5).validate(),
        contains(CampusBasemap.rmseTooHigh),
      );
      expect(
        basemap(rmse: 4.99).validate(),
        isNot(contains(CampusBasemap.rmseTooHigh)),
      );
      expect(basemapMaxRmsePx, 5);
    });

    test('控制点少于 6 个被拒绝', () {
      expect(
        basemap(controlPoints: 5).validate(),
        contains(CampusBasemap.controlPointsInsufficient),
      );
      expect(basemapMinControlPoints, 6);
    });

    test('odbl 许可必须有署名', () {
      expect(
        basemap(license: BasemapLicense.odbl, attribution: '  ').validate(),
        contains(CampusBasemap.attributionRequired),
      );
      expect(
        basemap(
                license: BasemapLicense.odbl,
                attribution: '© OpenStreetMap contributors')
            .validate(),
        isEmpty,
      );
    });

    test('未知许可与非法尺寸被拒绝', () {
      expect(
        basemap(license: BasemapLicense.unknown).validate(),
        contains(CampusBasemap.licenseUnknown),
      );
      expect(
        basemap(widthPx: 0).validate(),
        contains(CampusBasemap.sizeInvalid),
      );
    });

    test('多个问题会全部列出（而不是只报第一个）', () {
      final List<String> issues = basemap(
        rmse: 9,
        controlPoints: 2,
        license: BasemapLicense.unknown,
        heightPx: -1,
      ).validate();
      expect(issues, contains(CampusBasemap.rmseTooHigh));
      expect(issues, contains(CampusBasemap.controlPointsInsufficient));
      expect(issues, contains(CampusBasemap.licenseUnknown));
      expect(issues, contains(CampusBasemap.sizeInvalid));
    });
  });

  group('解析', () {
    test('affine 是 6 元数组', () {
      final CampusBasemap value = CampusBasemap.fromJson(<String, Object?>{
        'version': 'v1',
        'imageUrl': 'https://cdn.example.com/basemap.png',
        'widthPx': 1000,
        'heightPx': 700,
        'affine': <Object?>[1, 0, 500, 0, -1, 400],
        'calibrationRmsePx': 1.8,
        'controlPointCount': 8,
        'attribution': '自绘',
        'license': 'original',
      });
      expect(value.affine.a, 1);
      expect(value.affine.e, -1);
      expect(value.hasImage, isTrue);
      expect(value.isRenderable, isTrue);
      expect(value.toJson()['affine'], <double>[1, 0, 500, 0, -1, 400]);
    });

    test('affine 不是 6 个数时抛错（而不是静默用错标定）', () {
      expect(
        () => CampusBasemap.fromJson(<String, Object?>{
          'affine': <Object?>[1, 0, 500],
        }),
        throwsA(isA<ArgumentError>()),
      );
      expect(
        () => CampusBasemap.fromJson(<String, Object?>{'affine': 'nope'}),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('缺 calibrationRmsePx 时按无穷大处理 → 一定不可渲染', () {
      final CampusBasemap value = CampusBasemap.fromJson(<String, Object?>{
        'affine': <Object?>[1, 0, 500, 0, -1, 400],
        'widthPx': 1000,
        'heightPx': 700,
      });
      expect(value.validate(), contains(CampusBasemap.rmseTooHigh));
      expect(value.isRenderable, isFalse);
    });

    test('许可标识收敛', () {
      expect(BasemapLicense.fromWire('original'), BasemapLicense.original);
      expect(BasemapLicense.fromWire('odbl'), BasemapLicense.odbl);
      expect(BasemapLicense.fromWire('school-authorized'),
          BasemapLicense.schoolAuthorized);
      expect(BasemapLicense.fromWire('whatever'), BasemapLicense.unknown);
    });
  });
}
