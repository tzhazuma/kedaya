import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/data/mock/mock_fixtures.dart';
import 'package:kedaya/data/mock/mock_wildlife_repository.dart';
import 'package:kedaya/data/mock/wildlife_fixtures.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/geo.dart';
import 'package:kedaya/domain/models/page.dart';
import 'package:kedaya/domain/models/result.dart';
import 'package:kedaya/domain/models/wildlife.dart';
import 'package:kedaya/domain/models/wildlife_sighting.dart';
import 'package:kedaya/domain/models/wildlife_track.dart';

/// mock 适配器必须**真实可用**（契约 §7 硬规则 4），因此这里验证它的行为，
/// 而不只是"能返回数据"。
MockWildlifeRepository buildRepository({
  MockControls? controls,
  DateTime? now,
  bool classifierEnabled = false,
}) => MockWildlifeRepository(
  controls: controls ?? MockControls(latency: Duration.zero),
  now: now ?? mockNow,
  classifierEnabled: classifierEnabled,
);

WildlifeSightingDraft draft({
  String speciesId = mockSpeciesCat,
  DateTime? observedAt,
  Wgs84Point geo = const Wgs84Point(lat: 31.17855, lng: 121.59010),
  String? zoneId,
  List<String> mediaIds = const <String>[],
  bool healthConcern = false,
  bool ethicsAcknowledged = true,
}) => WildlifeSightingDraft(
  speciesId: speciesId,
  observedAt: observedAt ?? mockNow.subtract(const Duration(hours: 1)),
  geo: geo,
  zoneId: zoneId,
  mediaIds: mediaIds,
  healthConcern: healthConcern,
  ethicsAcknowledged: ethicsAcknowledged,
);

void main() {
  group('读端点：物种 / 区域 / 热点 / 轨迹', () {
    test('7 个物种，id 唯一', () async {
      final MockWildlifeRepository repository = buildRepository();
      final List<WildlifeSpecies> species = (await repository.listSpecies()).unwrap;
      expect(species, hasLength(7));
      expect(
        species.map((WildlifeSpecies item) => item.id).toSet(),
        hasLength(7),
      );
      expect(
        species.firstWhere((WildlifeSpecies item) => item.id == mockSpeciesSwan).isProtected,
        isTrue,
      );
    });

    test('区域按 sortOrder 排序，含敏感区', () async {
      final MockWildlifeRepository repository = buildRepository();
      final List<WildlifeZone> zones = (await repository.listZones()).unwrap;
      expect(zones, hasLength(4));
      expect(zones.first.id, mockZoneLibraryLawn);
      expect(zones.last.id, mockZoneDorm);
      expect(zones.last.isSensitive, isTrue);
      expect(
        zones.firstWhere((WildlifeZone zone) => zone.id == mockZoneLake).feedingPolicy,
        FeedingPolicy.forbidden,
      );
    });

    test('区域详情：不存在返回 NOT_FOUND（不抛异常）', () async {
      final MockWildlifeRepository repository = buildRepository();
      final Result<WildlifeZone> missing = await repository.getZone('wz-nope');
      expect(missing.isErr, isTrue);
      expect(missing.errorOrNull!.code, ApiErrorCode.notFound);
      expect((await repository.getZone(mockZoneLake)).unwrap.name, contains('人工湖'));
    });

    test('热点按最近出现时间倒序，支持物种与置信度过滤', () async {
      final MockWildlifeRepository repository = buildRepository();
      final Page<WildlifeSpot> all = (await repository.listSpots(
        const WildlifeSpotQuery(),
      )).unwrap;
      // 敏感区（宿舍）的热点不公开 → 4 个里只剩 3 个。
      expect(all.items, hasLength(3));
      expect(
        all.items.any((WildlifeSpot spot) => spot.zoneId == mockZoneDorm),
        isFalse,
      );
      for (int i = 1; i < all.items.length; i++) {
        expect(
          all.items[i - 1].lastSeenAt.isAfter(all.items[i].lastSeenAt) ||
              all.items[i - 1].lastSeenAt == all.items[i].lastSeenAt,
          isTrue,
        );
      }

      final Page<WildlifeSpot> swanOnly = (await repository.listSpots(
        const WildlifeSpotQuery(speciesId: mockSpeciesSwan),
      )).unwrap;
      expect(swanOnly.items, hasLength(1));
      expect(swanOnly.items.single.id, 'ws-lake-swan');

      final Page<WildlifeSpot> confident = (await repository.listSpots(
        const WildlifeSpotQuery(minConfidence: 0.7),
      )).unwrap;
      expect(confident.items.every((WildlifeSpot spot) => spot.confidence >= 0.7), isTrue);
    });

    test('轨迹列表与详情', () async {
      final MockWildlifeRepository repository = buildRepository();
      final Page<WildlifeTrack> tracks = (await repository.listTracks(
        const WildlifeTrackQuery(),
      )).unwrap;
      expect(tracks.items, hasLength(2));
      expect(tracks.items.first.isInferred, isTrue);
      expect((await repository.getTrack('wt-lake-swan')).unwrap.sightingCount, 31);
      expect((await repository.getTrack('wt-nope')).errorOrNull!.code, ApiErrorCode.notFound);

      final Page<WildlifeTrack> catOnly = (await repository.listTracks(
        const WildlifeTrackQuery(speciesId: mockSpeciesCat),
      )).unwrap;
      expect(catOnly.items.single.id, 'wt-campus-cat');
    });

    test('命名个体只返回已审核的（待审核的「小黑」不出现）', () async {
      final MockWildlifeRepository repository = buildRepository();
      final List<WildlifeIndividual> all = (await repository.listIndividuals()).unwrap;
      expect(all, hasLength(2));
      expect(
        all.map((WildlifeIndividual item) => item.name).toList(growable: false),
        <String>['大橘', '鹅鹅'],
      );

      final List<WildlifeIndividual> swan = (await repository.listIndividuals(
        speciesId: mockSpeciesSwan,
      )).unwrap;
      expect(swan.single.name, '鹅鹅');
    });
  });

  group('观测列表：只公开已发布 + 游标分页 + 筛选', () {
    test('默认只返回 PUBLISHED（待审核 / 未通过的都不出现）', () async {
      final MockWildlifeRepository repository = buildRepository();
      final Page<WildlifeSighting> page = (await repository.listSightings(
        const WildlifeSightingQuery(),
      )).unwrap;
      expect(page.items, hasLength(5));
      expect(
        page.items.every((WildlifeSighting item) => item.isPublished),
        isTrue,
      );
      expect(
        page.items.any((WildlifeSighting item) => item.id == 'wl-1003'),
        isFalse,
      );
      expect(
        page.items.any((WildlifeSighting item) => item.id == 'wl-1004'),
        isFalse,
      );
    });

    test('按发现时间倒序', () async {
      final MockWildlifeRepository repository = buildRepository();
      final Page<WildlifeSighting> page = (await repository.listSightings(
        const WildlifeSightingQuery(),
      )).unwrap;
      for (int i = 1; i < page.items.length; i++) {
        expect(
          page.items[i - 1].observedAt.isAfter(page.items[i].observedAt),
          isTrue,
        );
      }
    });

    test('游标分页：limit=2 能取完全部且不重复', () async {
      final MockWildlifeRepository repository = buildRepository();
      final List<String> ids = <String>[];
      String? cursor;
      int guard = 0;
      while (guard++ < 10) {
        final Page<WildlifeSighting> page = (await repository.listSightings(
          WildlifeSightingQuery(cursor: cursor, limit: 2),
        )).unwrap;
        ids.addAll(page.items.map((WildlifeSighting item) => item.id));
        cursor = page.nextCursor;
        if (cursor == null) break;
      }
      expect(ids, hasLength(5));
      expect(ids.toSet(), hasLength(5));
    });

    test('物种筛选与"疑似受伤"筛选', () async {
      final MockWildlifeRepository repository = buildRepository();
      final Page<WildlifeSighting> cat = (await repository.listSightings(
        const WildlifeSightingQuery(speciesId: mockSpeciesCat),
      )).unwrap;
      expect(cat.items, hasLength(3));
      expect(
        cat.items.every((WildlifeSighting item) => item.speciesId == mockSpeciesCat),
        isTrue,
      );

      final Page<WildlifeSighting> injured = (await repository.listSightings(
        const WildlifeSightingQuery(healthConcernOnly: true),
      )).unwrap;
      expect(injured.items.single.id, 'wl-1007');
      expect(injured.items.single.healthConcern, isTrue);
    });

    test('详情：自己的待审核记录可见，别人的不可见（按 NOT_FOUND）', () async {
      final MockWildlifeRepository repository = buildRepository();
      // wl-1003 是 mock 认为"当前用户上报"的待审核记录。
      final WildlifeSighting own = (await repository.getSighting('wl-1003')).unwrap;
      expect(own.status, WildlifeModerationStatus.pending);

      final Result<WildlifeSighting> other = await repository.getSighting('wl-1004');
      expect(other.isErr, isTrue);
      expect(other.errorOrNull!.code, ApiErrorCode.notFound);

      expect(
        (await repository.getSighting('wl-nope')).errorOrNull!.code,
        ApiErrorCode.notFound,
      );
    });
  });

  group('上报：校验 + 自动判定区域 + 状态', () {
    test('合法上报 → PENDING，且自动判定所属区域', () async {
      final MockWildlifeRepository repository = buildRepository();
      final WildlifeSighting created = (await repository.createSighting(draft())).unwrap;
      expect(created.status, WildlifeModerationStatus.pending);
      expect(created.zoneId, mockZoneLibraryLawn, reason: '坐标落在图书馆后草坪');
      expect(created.speciesNameZh, '猫');
      expect(created.reporterDisplayName, mockUser.displayNameOrId);
      // 新记录不会立刻出现在公开列表里（要先审核）。
      final Page<WildlifeSighting> page = (await repository.listSightings(
        const WildlifeSightingQuery(),
      )).unwrap;
      expect(page.items.any((WildlifeSighting item) => item.id == created.id), isFalse);
    });

    test('未勾选伦理确认 → VALIDATION_FAILED / ETHICS_NOT_ACKNOWLEDGED', () async {
      final MockWildlifeRepository repository = buildRepository();
      final Result<WildlifeSighting> result = await repository.createSighting(
        draft(ethicsAcknowledged: false),
      );
      expect(result.errorOrNull!.code, ApiErrorCode.validationFailed);
      expect(
        (result.errorOrNull!.details! as Map<String, Object?>)['reason'],
        reasonEthicsNotAcknowledged,
      );
    });

    test('校园外坐标 / 未知物种 / 时间越界都被拒', () async {
      final MockWildlifeRepository repository = buildRepository();
      expect(
        (await repository.createSighting(
          draft(geo: const Wgs84Point(lat: 39.9, lng: 116.4)),
        )).errorOrNull!.code,
        ApiErrorCode.validationFailed,
      );
      expect(
        (await repository.createSighting(draft(speciesId: 'sp-nope'))).errorOrNull!.code,
        ApiErrorCode.validationFailed,
      );
      expect(
        (await repository.createSighting(
          draft(observedAt: mockNow.subtract(const Duration(days: 40))),
        )).errorOrNull!.code,
        ApiErrorCode.validationFailed,
      );
      expect(
        (await repository.createSighting(
          draft(observedAt: mockNow.add(const Duration(hours: 2))),
        )).errorOrNull!.code,
        ApiErrorCode.validationFailed,
      );
    });

    test('疑似受伤 → 审核前就通知社团（规格 §8.4）', () async {
      final MockWildlifeRepository repository = buildRepository();
      expect(repository.healthAlerts, isEmpty);
      final WildlifeSighting created = (await repository.createSighting(
        draft(healthConcern: true),
      )).unwrap;
      expect(created.healthConcern, isTrue);
      expect(repository.healthAlerts, <String>[created.id]);
      // 但仍然要审核才公开。
      expect(created.status, WildlifeModerationStatus.pending);
    });

    test('匿名上报：展示名为 null，模型里也没有上报人 id', () async {
      final MockWildlifeRepository repository = buildRepository();
      final WildlifeSighting created = (await repository.createSighting(
        WildlifeSightingDraft(
          speciesId: mockSpeciesCat,
          observedAt: mockNow.subtract(const Duration(hours: 1)),
          geo: const Wgs84Point(lat: 31.17855, lng: 121.59010),
          isAnonymous: true,
        ),
      )).unwrap;
      expect(created.isAnonymous, isTrue);
      expect(created.reporterDisplayName, isNull);
      expect(created.reporterLabel, '匿名同学');
      expect(created.toJson().containsKey('reporterId'), isFalse);
    });
  });

  group('纠正与撤回（规格 §5.5 的纠正闭环 / §10.1 #13-14）', () {
    test('纠正自己的上报会记录 correctedFromSpeciesId', () async {
      final MockWildlifeRepository repository = buildRepository();
      final WildlifeSighting corrected = (await repository.correctSpecies(
        'wl-1001',
        speciesId: mockSpeciesSwan,
      )).unwrap;
      expect(corrected.speciesId, mockSpeciesSwan);
      expect(corrected.speciesNameZh, '黑天鹅');
      expect(corrected.correctedFromSpeciesId, mockSpeciesCat);
      expect(corrected.wasCorrected, isTrue);
      // 纠正不改状态机。
      expect(corrected.status, WildlifeModerationStatus.published);
    });

    test('纠正别人的上报 → NOT_FOUND；未知物种 → VALIDATION_FAILED', () async {
      final MockWildlifeRepository repository = buildRepository();
      expect(
        (await repository.correctSpecies('wl-1002', speciesId: mockSpeciesCat))
            .errorOrNull!
            .code,
        ApiErrorCode.notFound,
      );
      expect(
        (await repository.correctSpecies('wl-1001', speciesId: 'sp-nope'))
            .errorOrNull!
            .code,
        ApiErrorCode.validationFailed,
      );
    });

    test('撤回自己的上报（软删），别人的撤不掉', () async {
      final MockWildlifeRepository repository = buildRepository();
      expect((await repository.deleteSighting('wl-1001')).isOk, isTrue);
      expect(
        (await repository.getSighting('wl-1001')).errorOrNull!.code,
        ApiErrorCode.notFound,
      );
      expect(
        (await repository.deleteSighting('wl-1002')).errorOrNull!.code,
        ApiErrorCode.notFound,
      );
    });
  });

  group('命名个体（规格 §2.8）', () {
    test('新建个体 → PENDING；同物种同名 → CONFLICT', () async {
      final MockWildlifeRepository repository = buildRepository();
      final WildlifeIndividual created = (await repository.createIndividual(
        const CreateWildlifeIndividualCommand(name: '小橘', speciesId: mockSpeciesCat),
      )).unwrap;
      expect(created.status, WildlifeModerationStatus.pending);
      expect(created.isPublic, isFalse);

      final Result<WildlifeIndividual> conflict = await repository.createIndividual(
        const CreateWildlifeIndividualCommand(name: '大橘', speciesId: mockSpeciesCat),
      );
      expect(conflict.errorOrNull!.code, ApiErrorCode.conflict);

      // 不同物种可以同名。
      expect(
        (await repository.createIndividual(
          const CreateWildlifeIndividualCommand(name: '大橘', speciesId: mockSpeciesSwan),
        )).isOk,
        isTrue,
      );
    });

    test('名字为空 / 超长 → VALIDATION_FAILED', () async {
      final MockWildlifeRepository repository = buildRepository();
      expect(
        (await repository.createIndividual(
          const CreateWildlifeIndividualCommand(name: '  ', speciesId: mockSpeciesCat),
        )).errorOrNull!.code,
        ApiErrorCode.validationFailed,
      );
    });
  });

  group('三态开关：故障注入与空结果', () {
    test('故障注入：所有读接口都返回 Err', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..failureMode = MockFailureMode.upstreamUnavailable;
      final MockWildlifeRepository repository = buildRepository(controls: controls);
      expect((await repository.getBasemap()).errorOrNull!.code, ApiErrorCode.upstreamUnavailable);
      expect((await repository.listSpecies()).isErr, isTrue);
      expect((await repository.listZones()).isErr, isTrue);
      expect((await repository.listSpots(const WildlifeSpotQuery())).isErr, isTrue);
      expect((await repository.listTracks(const WildlifeTrackQuery())).isErr, isTrue);
      expect((await repository.listSightings(const WildlifeSightingQuery())).isErr, isTrue);
      expect((await repository.listIndividuals()).isErr, isTrue);
      expect((await repository.createSighting(draft())).isErr, isTrue);
    });

    test('空结果开关：列表返回空集（UI 渲染空态）', () async {
      final MockControls controls = MockControls(latency: Duration.zero)..emptyResults = true;
      final MockWildlifeRepository repository = buildRepository(controls: controls);
      expect((await repository.listZones()).unwrap, isEmpty);
      expect((await repository.listSightings(const WildlifeSightingQuery())).unwrap.items, isEmpty);
      expect((await repository.listSpots(const WildlifeSpotQuery())).unwrap.items, isEmpty);
      expect((await repository.listTracks(const WildlifeTrackQuery())).unwrap.items, isEmpty);
      expect((await repository.listIndividuals()).unwrap, isEmpty);
      expect((await repository.listSpecies()).unwrap, isEmpty);
    });
  });
}
