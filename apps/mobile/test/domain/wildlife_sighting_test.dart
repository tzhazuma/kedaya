import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/api_request.dart';
import 'package:kedaya/domain/models/geo.dart';
import 'package:kedaya/domain/models/wildlife.dart';
import 'package:kedaya/domain/models/wildlife_sighting.dart';

/// 观测模型 / 上报草稿校验 / 图片限制 / 自动分类阈值的纯逻辑测试。
///
/// 规格 §10.3 的字段校验表、§4.2 的图片限制、§5.5 的置信度分档
/// 都在这里被逐条锁住 —— 这些规则**不该散落在表单 widget 的 if 里**。
void main() {
  final DateTime now = DateTime.utc(2026, 10, 16, 12);
  const Set<String> knownSpecies = <String>{'sp-cat', 'sp-swan'};
  const Wgs84Point campusPoint = Wgs84Point(lat: 31.17855, lng: 121.59012);

  WildlifeSightingDraft draft({
    String speciesId = 'sp-cat',
    DateTime? observedAt,
    Wgs84Point geo = campusPoint,
    int? geoAccuracyM = 12,
    List<String> mediaIds = const <String>[],
    String? note,
    bool ethicsAcknowledged = true,
    ClassifiedBy classifiedBy = ClassifiedBy.manual,
    String? autoSpeciesId,
  }) => WildlifeSightingDraft(
    speciesId: speciesId,
    observedAt: observedAt ?? now.subtract(const Duration(hours: 1)),
    geo: geo,
    geoAccuracyM: geoAccuracyM,
    mediaIds: mediaIds,
    note: note,
    ethicsAcknowledged: ethicsAcknowledged,
    classifiedBy: classifiedBy,
    autoSpeciesId: autoSpeciesId,
  );

  WildlifeValidationResult validate(WildlifeSightingDraft value) =>
      value.validate(now: now, knownSpeciesIds: knownSpecies);

  group('模型解析与序列化', () {
    test('状态大小写不敏感收敛，未知状态不公开', () {
      expect(
        WildlifeModerationStatus.fromWire('published'),
        WildlifeModerationStatus.published,
      );
      expect(
        WildlifeModerationStatus.fromWire('PENDING'),
        WildlifeModerationStatus.pending,
      );
      expect(
        WildlifeModerationStatus.fromWire('whatever'),
        WildlifeModerationStatus.unknown,
      );
      expect(WildlifeModerationStatus.unknown.isPublic, isFalse);
      expect(WildlifeModerationStatus.published.isPublic, isTrue);
    });

    test('发现时间与上报时间分离（需求 R4）', () {
      final WildlifeSighting sighting = WildlifeSighting.fromJson(<String, Object?>{
        'id': 'wl-1',
        'species': 'sp-cat',
        'status': 'PUBLISHED',
        'observedAt': '2026-10-16T01:00:00.000Z',
        'observedAtFuzzed': '2026-10-16T01:00:00.000Z',
        'createdAt': '2026-10-16T09:00:00.000Z',
        'geo': <String, Object?>{'lat': 31.178, 'lng': 121.59},
      });
      expect(sighting.observedAt, DateTime.utc(2026, 10, 16, 1));
      expect(sighting.createdAt, DateTime.utc(2026, 10, 16, 9));
      expect(sighting.reportingDelay, const Duration(hours: 8));
    });

    test('缺 createdAt 时退化为 observedAt（不让整条解析失败）', () {
      final WildlifeSighting sighting = WildlifeSighting.fromJson(<String, Object?>{
        'id': 'wl-1',
        'species': 'sp-cat',
        'observedAt': '2026-10-16T01:00:00.000Z',
        'geo': <String, Object?>{'lat': 31.178, 'lng': 121.59},
      });
      expect(sighting.createdAt, sighting.observedAt);
      expect(sighting.status, WildlifeModerationStatus.pending);
      expect(sighting.classifiedBy, ClassifiedBy.manual);
    });

    test('敏感区没有 geo 时 hasGeo=false，位置文案改为"不公开坐标"', () {
      final WildlifeSighting sighting = WildlifeSighting.fromJson(<String, Object?>{
        'id': 'wl-sensitive',
        'species': 'sp-cat',
        'status': 'PUBLISHED',
        'observedAt': '2026-10-16T01:00:00.000Z',
        'zoneId': 'wz-dorm',
        'geo': null,
      });
      expect(sighting.hasGeo, isFalse);
      expect(sighting.locationLabel, contains('不公开坐标'));
      expect(sighting.toJson().containsKey('geo'), isFalse);
    });

    test('自动分类来源决定是否显示"仅供参考"', () {
      final WildlifeSighting manual = WildlifeSighting(
        id: 'a',
        speciesId: 'sp-cat',
        status: WildlifeModerationStatus.published,
        geo: campusPoint,
        observedAt: now,
        createdAt: now,
      );
      expect(manual.isAutoClassified, isFalse);
      expect(manual.classificationNotice, isEmpty);

      final WildlifeSighting auto = manual.copyWith(
        classifiedBy: ClassifiedBy.visionApi,
        autoSpeciesId: 'sp-swan',
        autoConfidence: 0.71,
      );
      expect(auto.isAutoClassified, isTrue);
      expect(auto.classificationNotice, contains('仅供参考'));
      expect(auto.classifiedByLabel, '自动识别');
    });

    test('纠正闭环：correctedFromSpeciesId 标记"被纠正过"', () {
      final WildlifeSighting corrected = WildlifeSighting(
        id: 'a',
        speciesId: 'sp-swan',
        status: WildlifeModerationStatus.published,
        geo: campusPoint,
        observedAt: now,
        createdAt: now,
        autoSpeciesId: 'sp-cat',
        classifiedBy: ClassifiedBy.visionApi,
        correctedFromSpeciesId: 'sp-cat',
      );
      expect(corrected.wasCorrected, isTrue);
      expect(corrected.autoSpeciesId, 'sp-cat');
    });

    test('查询参数收敛（丢弃空值、带上 limit）', () {
      expect(
        const WildlifeSightingQuery(speciesId: 'sp-cat', limit: 10).toQuery(),
        <String, Object?>{'limit': 10, 'species': 'sp-cat'},
      );
      expect(
        const WildlifeSightingQuery(healthConcernOnly: true).toQuery(),
        <String, Object?>{'limit': defaultPageSize, 'healthConcern': true},
      );
    });
  });

  group('上报草稿校验（规格 §10.3 的字段校验表）', () {
    test('合法草稿通过', () {
      expect(validate(draft()).isValid, isTrue);
    });

    test('未知物种 → UNKNOWN_SPECIES', () {
      final WildlifeValidationResult result = validate(draft(speciesId: 'sp-nope'));
      expect(result.has(reasonUnknownSpecies), isTrue);
      expect(result.isValid, isFalse);
    });

    test('发现时间超出 30 天或晚于当前时间 → OBSERVED_AT_OUT_OF_RANGE', () {
      expect(
        validate(draft(observedAt: now.add(const Duration(hours: 1)))).has(
          reasonObservedAtOutOfRange,
        ),
        isTrue,
      );
      // 允许 5 分钟时钟漂移。
      expect(
        validate(draft(observedAt: now.add(const Duration(minutes: 3)))).isValid,
        isTrue,
      );
      expect(
        validate(draft(observedAt: now.subtract(const Duration(days: 31)))).has(
          reasonObservedAtOutOfRange,
        ),
        isTrue,
      );
    });

    test('校园外坐标 → COORDINATE_OUT_OF_CAMPUS（lat/lng 写反也在这里被拦）', () {
      expect(
        validate(draft(geo: const Wgs84Point(lat: 39.9, lng: 116.4))).has(
          reasonCoordinateOutOfCampus,
        ),
        isTrue,
      );
      expect(
        validate(draft(geo: const Wgs84Point(lat: 121.59, lng: 31.178))).has(
          reasonCoordinateOutOfCampus,
        ),
        isTrue,
      );
    });

    test('精度越界 → INVALID_ACCURACY；null 视为未提供', () {
      expect(validate(draft(geoAccuracyM: 0)).has(reasonInvalidAccuracy), isTrue);
      expect(validate(draft(geoAccuracyM: 10001)).has(reasonInvalidAccuracy), isTrue);
      expect(validate(draft(geoAccuracyM: null)).isValid, isTrue);
    });

    test('照片超过 3 张 → MEDIA_ALREADY_LINKED（契约 photoUrls ≤3）', () {
      expect(
        validate(
          draft(mediaIds: const <String>['a', 'b', 'c', 'd']),
        ).has(reasonMediaAlreadyLinked),
        isTrue,
      );
      expect(validate(draft(mediaIds: const <String>['a', 'b', 'c'])).isValid, isTrue);
    });

    test('备注超过 200 字 → CONTENT_REJECTED', () {
      expect(
        validate(
          draft(note: _repeat('鸭', maxSightingNoteLength + 1)),
        ).has(reasonContentRejected),
        isTrue,
      );
      expect(validate(draft(note: _repeat('鸭', maxSightingNoteLength))).isValid, isTrue);
    });

    test('未勾选伦理确认 → ETHICS_NOT_ACKNOWLEDGED（且只是这次提交被拒）', () {
      final WildlifeValidationResult result = validate(
        draft(ethicsAcknowledged: false),
      );
      expect(result.has(reasonEthicsNotAcknowledged), isTrue);
      expect(result.firstMessage, contains(wildlifeEthicsAckLabel));
    });

    test('分类来源未知 → INVALID_CLASSIFIER_SOURCE', () {
      expect(
        validate(draft(classifiedBy: ClassifiedBy.unknown)).has(
          reasonInvalidClassifierSource,
        ),
        isTrue,
      );
    });

    test('autoSpeciesId 指向不存在的物种 → UNKNOWN_SPECIES', () {
      expect(
        validate(draft(autoSpeciesId: 'sp-nope')).has(reasonUnknownSpecies),
        isTrue,
      );
      expect(validate(draft(autoSpeciesId: 'sp-swan')).isValid, isTrue);
    });

    test('请求体：ethicsAcknowledged 恒为 true，且字段名与规格 §10.3 一致', () {
      final Map<String, Object?> json = draft(
        mediaIds: const <String>['wm-1'],
      ).toJson();
      expect(json['ethicsAcknowledged'], isTrue);
      expect(json['species'], 'sp-cat');
      expect(json['mediaIds'], <String>['wm-1']);
      expect(json['geo'], <String, Object?>{'lat': 31.17855, 'lng': 121.59012});
      expect(json['classifiedBy'], 'manual');
      expect(json.containsKey('reporterId'), isFalse);
    });
  });

  group('图片限制与魔数嗅探（规格 §4.2 / §11.5 T36）', () {
    test('JPEG / PNG / WebP 的文件头能被识别', () {
      expect(
        looksLikeImage(<int>[0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0]),
        isTrue,
      );
      expect(
        looksLikeImage(<int>[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]),
        isTrue,
      );
      expect(
        looksLikeImage(<int>[
          0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
        ]),
        isTrue,
      );
      expect(sniffMimeType(<int>[0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 'image/jpeg');
    });

    test('改了扩展名的文本文件会被拒（不信任 Content-Type）', () {
      final UploadWildlifeMediaCommand command = UploadWildlifeMediaCommand(
        bytes: 'hello world!'.codeUnits,
        clientPhotoId: 'cp-1',
        fileName: 'cat.jpg',
        mimeType: 'image/jpeg',
      );
      expect(looksLikeImage(command.bytes), isFalse);
      expect(command.validate().has(reasonMediaUnsupportedType), isTrue);
    });

    test('超过 5 MB → MEDIA_TOO_LARGE', () {
      final UploadWildlifeMediaCommand command = UploadWildlifeMediaCommand(
        bytes: <int>[0xFF, 0xD8, 0xFF, ...List<int>.filled(maxMediaBytes, 0)],
        clientPhotoId: 'cp-1',
      );
      expect(command.validate().has(reasonMediaTooLarge), isTrue);
    });

    test('空文件 / 缺幂等键都会被拒', () {
      expect(
        UploadWildlifeMediaCommand(
          bytes: const <int>[],
          clientPhotoId: 'cp-1',
        ).validate().has(reasonMediaUnsupportedType),
        isTrue,
      );
      expect(
        UploadWildlifeMediaCommand(
          bytes: const <int>[0xFF, 0xD8, 0xFF, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          clientPhotoId: '  ',
        ).validate().has(reasonIdempotencyKeyRequired),
        isTrue,
      );
    });
  });

  group('自动分类的置信度分档（规格 §5.5 / §11.6 T44）', () {
    test('≥0.85 很确定；0.60–0.85 可能是；<0.60 无法确定', () {
      expect(
        const WildlifeClassifySuggestion(speciesId: 'sp-swan', confidence: 0.9).confidenceLabel,
        '很确定',
      );
      expect(
        const WildlifeClassifySuggestion(speciesId: 'sp-swan', confidence: 0.7).confidenceLabel,
        '可能是',
      );
      expect(
        const WildlifeClassifySuggestion(speciesId: 'sp-swan', confidence: 0.4).confidenceLabel,
        '无法确定',
      );
    });

    test('低置信度不预选 —— 即使服务端错误地给了 preselected: true', () {
      const WildlifeClassifySuggestion low = WildlifeClassifySuggestion(
        speciesId: 'sp-swan',
        confidence: 0.5,
        serverPreselected: true,
      );
      expect(low.shouldPreselect, isFalse);

      const WildlifeClassifySuggestion high = WildlifeClassifySuggestion(
        speciesId: 'sp-swan',
        confidence: 0.9,
        serverPreselected: false,
      );
      expect(high.shouldPreselect, isFalse);

      const WildlifeClassifySuggestion ok = WildlifeClassifySuggestion(
        speciesId: 'sp-swan',
        confidence: 0.9,
      );
      expect(ok.shouldPreselect, isTrue);
      expect(classifyPreselectMinConfidence, 0.6);
      expect(classifyCertainMinConfidence, 0.85);
    });

    test('无能力时是空数组 + 降级文案，不是错误（T43）', () {
      const WildlifeClassifyResult result = WildlifeClassifyResult.unavailable;
      expect(result.available, isFalse);
      expect(result.isEmpty, isTrue);
      expect(result.top, isNull);
      expect(result.preselection, isNull);
      expect(result.fallbackNotice, contains('手动选择物种'));
    });

    test('结果按置信度降序，并容忍 suggestions 键名', () {
      final WildlifeClassifyResult result = WildlifeClassifyResult.fromJson(<String, Object?>{
        'suggestions': <Object?>[
          <String, Object?>{'speciesId': 'sp-cat', 'confidence': 0.4},
          <String, Object?>{'speciesId': 'sp-swan', 'confidence': 0.8},
        ],
      });
      expect(result.available, isTrue);
      expect(result.top!.speciesId, 'sp-swan');
      expect(result.preselection!.speciesId, 'sp-swan');
      expect(result.sortedByConfidence.first.confidence, 0.8);
    });

    test('分类请求体只有 mediaId 与 topK', () {
      expect(
        const WildlifeClassifyRequest(mediaId: 'wm-1').toJson(),
        <String, Object?>{'mediaId': 'wm-1', 'topK': 3},
      );
    });
  });

  group('伦理提示的规模约束（规格 §8.2：≤5 条，每条 ≤20 字）', () {
    test('条目数与长度都在限制内', () {
      expect(wildlifeEthicsRules.length, lessThanOrEqualTo(5));
      for (final String rule in wildlifeEthicsRules) {
        expect(rule.length, lessThanOrEqualTo(20), reason: rule);
      }
    });

    test('覆盖规格 §8.1 的关键约束', () {
      final String all = wildlifeEthicsRules.join('|');
      expect(all, contains('投喂'));
      expect(all, contains('追撵'));
      expect(all, contains('引诱'));
      expect(all, contains('闪光灯'));
      expect(all, contains('巢'));
    });
  });

  group('命名个体（规格 §2.8 / R6）', () {
    test('名字与物种都要校验', () {
      expect(
        const CreateWildlifeIndividualCommand(name: '', speciesId: 'sp-cat')
            .validate()
            .has(reasonIndividualNameInvalid),
        isTrue,
      );
      expect(
        CreateWildlifeIndividualCommand(
          name: _repeat('鸭', maxIndividualNameLength + 1),
          speciesId: 'sp-cat',
        ).validate().has(reasonIndividualNameInvalid),
        isTrue,
      );
      expect(
        const CreateWildlifeIndividualCommand(name: '大橘', speciesId: '')
            .validate()
            .has(reasonUnknownSpecies),
        isTrue,
      );
      expect(
        const CreateWildlifeIndividualCommand(name: '大橘', speciesId: 'sp-cat')
            .validate()
            .isValid,
        isTrue,
      );
    });

    test('只有已审核且启用的个体才公开', () {
      const WildlifeIndividual pending = WildlifeIndividual(
        id: 'wi-1',
        name: '小黑',
        speciesId: 'sp-cat',
      );
      const WildlifeIndividual published = WildlifeIndividual(
        id: 'wi-2',
        name: '大橘',
        speciesId: 'sp-cat',
        status: WildlifeModerationStatus.published,
      );
      const WildlifeIndividual disabled = WildlifeIndividual(
        id: 'wi-3',
        name: '退役猫',
        speciesId: 'sp-cat',
        status: WildlifeModerationStatus.published,
        isActive: false,
      );
      expect(pending.isPublic, isFalse);
      expect(published.isPublic, isTrue);
      expect(disabled.isPublic, isFalse);
    });
  });
}

/// Dart 没有 `String * int`：重复字符串用它。
String _repeat(String unit, int times) => List<String>.filled(times, unit).join();
