import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/data/mock/mock_fixtures.dart';
import 'package:kedaya/data/mock/mock_location_port.dart';
import 'package:kedaya/data/mock/mock_media_picker.dart';
import 'package:kedaya/data/mock/mock_wildlife_repository.dart';
import 'package:kedaya/data/mock/wildlife_fixtures.dart';
import 'package:kedaya/domain/models/geo.dart';
import 'package:kedaya/domain/models/wildlife.dart';
import 'package:kedaya/domain/models/wildlife_sighting.dart';
import 'package:kedaya/domain/ports/location_port.dart';
import 'package:kedaya/features/wildlife/application/wildlife_report_controller.dart';

/// 上报流程的编排测试（规格 §4.5 / §5.2 / §5.5 / §8.2 / §10.3）。
///
/// 这条链路里最容易漏的几件事都在这里被锁住：
///   1. 照片**先上传**拿 mediaId，再创建 sighting；
///   2. 重试**复用** clientPhotoId（幂等）；
///   3. 伦理确认是**表单校验**（缺它只拒绝该次提交）；
///   4. 低置信度**不预选**物种；
///   5. 手动命名遇到同名时**复用**已有个体，而不是卡住用户。
void main() {
  ProviderContainer containerWith({
    MockWildlifeRepository? repository,
    InMemoryMediaPicker? picker,
    InMemoryLocationPort? location,
  }) {
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[
        wildlifeRepositoryProvider.overrideWithValue(
          repository ??
              MockWildlifeRepository(
                controls: MockControls(latency: Duration.zero),
                now: mockNow,
              ),
        ),
        mediaPickerProvider.overrideWithValue(picker ?? InMemoryMediaPicker()),
        locationProvider.overrideWithValue(location ?? InMemoryLocationPort()),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  WildlifeReportController controllerOf(ProviderContainer container) =>
      container.read(wildlifeReportControllerProvider.notifier);

  WildlifeReportState stateOf(ProviderContainer container) =>
      container.read(wildlifeReportControllerProvider);

  test('默认值：发现时间默认"现在"（可注入固定时刻）', () {
    final ProviderContainer container = containerWith();
    expect(stateOf(container).observedAt, isNull);
    controllerOf(container).ensureDefaults(now: mockNow);
    expect(stateOf(container).observedAt, mockNow);
    // 再调一次不会覆盖用户已经改过的时间。
    controllerOf(container)
        .setObservedAt(mockNow.subtract(const Duration(hours: 3)));
    controllerOf(container).ensureDefaults(now: mockNow);
    expect(stateOf(container).observedAt,
        mockNow.subtract(const Duration(hours: 3)));
  });

  test('选图 → 自动上传 → 拿到 mediaId；提交前还差物种与伦理确认', () async {
    final ProviderContainer container = containerWith();
    await controllerOf(container).pickPhotos();

    final WildlifeReportState state = stateOf(container);
    expect(state.photos, hasLength(1));
    expect(state.photos.single.isUploaded, isTrue);
    expect(state.mediaIds, hasLength(1));
    expect(state.hasPhoto, isTrue);
    expect(state.canSubmit, isFalse);
    expect(state.blockingReason, contains('物种'));
  });

  test('取消选图不是错误：只给一句提示', () async {
    final ProviderContainer container = containerWith(
      picker: InMemoryMediaPicker(mode: InMemoryMediaPickerMode.none),
    );
    await controllerOf(container).pickPhotos();
    final WildlifeReportState state = stateOf(container);
    expect(state.photos, isEmpty);
    expect(state.formNotice, contains('没有选择照片'));
  });

  test('上传失败 → 照片标记失败；重试**复用**同一个 clientPhotoId（幂等）', () async {
    final MockWildlifeRepository repository = MockWildlifeRepository(
      controls: MockControls(latency: Duration.zero)
        ..failureMode = MockFailureMode.upstreamUnavailable,
      now: mockNow,
    );
    final ProviderContainer container = containerWith(repository: repository);
    await controllerOf(container).pickPhotos();

    WildlifeReportState state = stateOf(container);
    expect(state.photos.single.hasFailed, isTrue);
    expect(state.hasUploadFailure, isTrue);
    expect(state.mediaIds, isEmpty);
    expect(repository.mediaCount, 0);

    // 恢复网络后重试：clientPhotoId 没变，因此只存一份。
    repository.controls.failureMode = MockFailureMode.none;
    final String clientPhotoId = state.photos.single.clientPhotoId;
    await controllerOf(container).retryPhoto(clientPhotoId);

    state = stateOf(container);
    expect(state.photos.single.isUploaded, isTrue);
    expect(state.photos.single.clientPhotoId, clientPhotoId);
    expect(state.photos.single.attempts, 2);
    expect(repository.mediaCount, 1);
  });

  test('定位：用当前位置会带上精度并自动判定区域', () async {
    final ProviderContainer container = containerWith();
    await controllerOf(container).useCurrentLocation();
    final WildlifeReportState state = stateOf(container);
    expect(state.geo, isNotNull);
    expect(state.geoAccuracyM, 12);
    expect(state.locationSource, WildlifeLocationSource.gps);
    // 默认 mock 定位点在图书馆后草坪附近。
    expect(state.zoneId, mockZoneLibraryLawn);
  });

  test('定位被拒 → 提示改用地图点选（不阻塞）', () async {
    final ProviderContainer container = containerWith(
      location: InMemoryLocationPort(permission: LocationPermission.denied),
    );
    await controllerOf(container).useCurrentLocation();
    final WildlifeReportState state = stateOf(container);
    expect(state.geo, isNull);
    expect(state.formNotice, contains('在地图上点选'));
  });

  test('地图点选：坐标 + 自动区域（命中 forbidden 区域时 UI 会出警告条）', () async {
    final ProviderContainer container = containerWith();
    // 人工湖中心附近（forbidden 区域）。
    await controllerOf(container).setLocationFromMap(
      const Wgs84Point(lat: 31.17720, lng: 121.59130),
    );
    final WildlifeReportState state = stateOf(container);
    expect(state.locationSource, WildlifeLocationSource.map);
    expect(state.zoneId, mockZoneLake);
  });

  test('自动分类：低置信度不预选；无能力时降级为 fallback', () async {
    final MockWildlifeRepository disabled = MockWildlifeRepository(
      controls: MockControls(latency: Duration.zero),
      now: mockNow,
    );
    final ProviderContainer container = containerWith(repository: disabled);
    await controllerOf(container).pickPhotos();
    await controllerOf(container).requestClassify();
    WildlifeReportState state = stateOf(container);
    expect(state.classify!.available, isFalse);
    expect(state.classifiedBy, ClassifiedBy.fallback);
    expect(state.speciesId, isNull, reason: '无能力时不得预选');
    expect(state.formNotice, contains('手动选择物种'));

    // 换成有能力的服务端，但置信度被压到 0.42。
    final MockWildlifeRepository enabled = MockWildlifeRepository(
      controls: MockControls(latency: Duration.zero),
      now: mockNow,
      classifierEnabled: true,
    )..classifierForcedConfidence = 0.42;
    final ProviderContainer second = containerWith(repository: enabled);
    await controllerOf(second).pickPhotos();
    await controllerOf(second).requestClassify();
    state = stateOf(second);
    expect(state.classify!.available, isTrue);
    expect(state.classifiedBy, ClassifiedBy.visionApi);
    expect(state.speciesId, isNull, reason: '置信度 < 0.60 不预选');
    expect(state.autoSpeciesId, isNotNull);
  });

  test('高置信度会预选，用户改选后 classifiedBy 变回 manual', () async {
    final MockWildlifeRepository repository = MockWildlifeRepository(
      controls: MockControls(latency: Duration.zero),
      now: mockNow,
      classifierEnabled: true,
    )..classifierForcedConfidence = 0.9;
    final ProviderContainer container = containerWith(repository: repository);
    await controllerOf(container).pickPhotos();
    await controllerOf(container).requestClassify();

    WildlifeReportState state = stateOf(container);
    expect(state.speciesId, state.autoSpeciesId);
    expect(state.classifiedBy, ClassifiedBy.visionApi);

    // 用户改成别的物种 → 记为手动（服务端据此记录 correctedFromSpeciesId）。
    final String other = state.autoSpeciesId == mockSpeciesCat
        ? mockSpeciesSwan
        : mockSpeciesCat;
    controllerOf(container).setSpecies(other);
    state = stateOf(container);
    expect(state.speciesId, other);
    expect(state.classifiedBy, ClassifiedBy.manual);
  });

  test('未勾选伦理确认 → 提交被拒，且**不**发请求', () async {
    final MockWildlifeRepository repository = MockWildlifeRepository(
      controls: MockControls(latency: Duration.zero),
      now: mockNow,
    );
    final ProviderContainer container = containerWith(repository: repository);
    controllerOf(container)
        .setObservedAt(mockNow.subtract(const Duration(hours: 1)));
    controllerOf(container).setSpecies(mockSpeciesCat);
    await controllerOf(container).setLocationFromMap(
      const Wgs84Point(lat: 31.17855, lng: 121.59010),
    );

    final WildlifeReportState before = stateOf(container);
    expect(before.canSubmit, isFalse);
    expect(before.blockingReason, contains(wildlifeEthicsAckLabel));

    await controllerOf(container).submit();
    final WildlifeReportState after = stateOf(container);
    expect(after.submitted, isNull);
    expect(after.submitError, contains(wildlifeEthicsAckLabel));
    expect(repository.sightingsSnapshot(),
        hasLength(mockWildlifeSightings.length));
  });

  test('完整流程：勾选伦理后提交成功，状态是 PENDING（不假装已发布）', () async {
    final MockWildlifeRepository repository = MockWildlifeRepository(
      controls: MockControls(latency: Duration.zero),
      now: mockNow,
    );
    final ProviderContainer container = containerWith(repository: repository);
    final WildlifeReportController controller = controllerOf(container);

    await controller.pickPhotos();
    controller.setObservedAt(mockNow.subtract(const Duration(hours: 2)));
    await controller
        .setLocationFromMap(const Wgs84Point(lat: 31.17855, lng: 121.59010));
    controller.setSpecies(mockSpeciesCat);
    controller.setNote('在草坪长椅下面，两只');
    controller.setEthicsAcknowledged(true);

    expect(stateOf(container).canSubmit, isTrue);
    await controller.submit();

    final WildlifeReportState state = stateOf(container);
    expect(state.submitError, isNull);
    expect(state.isDone, isTrue);
    final WildlifeSighting created = state.submitted!;
    expect(created.status, WildlifeModerationStatus.pending);
    // 照片已经关联（服务端把 mediaId 变成了 photoUrls）。
    expect(created.photoUrls, hasLength(state.mediaIds.length));
    expect(created.photoUrls, hasLength(1));
    expect(created.zoneId, mockZoneLibraryLawn);
    expect(created.note, '在草坪长椅下面，两只');
  });

  test('手动命名：同名个体已存在时**复用**而不是报错', () async {
    final ProviderContainer container = containerWith();
    final WildlifeReportController controller = controllerOf(container);
    controller.setObservedAt(mockNow.subtract(const Duration(hours: 1)));
    controller.setSpecies(mockSpeciesCat);
    await controller
        .setLocationFromMap(const Wgs84Point(lat: 31.17855, lng: 121.59010));
    controller.setEthicsAcknowledged(true);
    // 「大橘」在 mock 里已存在（同物种同名 → 服务端会返回 CONFLICT）。
    controller.setIndividualName('大橘');

    await controller.submit();
    final WildlifeReportState state = stateOf(container);
    expect(state.submitError, isNull);
    expect(state.submitted!.individualId, 'wi-daju');
    expect(state.submitted!.individualName, '大橘');
  });

  test('手动命名：新名字会创建个体（PENDING）并关联', () async {
    final MockWildlifeRepository repository = MockWildlifeRepository(
      controls: MockControls(latency: Duration.zero),
      now: mockNow,
    );
    final ProviderContainer container = containerWith(repository: repository);
    final WildlifeReportController controller = controllerOf(container);
    controller.setObservedAt(mockNow.subtract(const Duration(hours: 1)));
    controller.setSpecies(mockSpeciesCat);
    await controller
        .setLocationFromMap(const Wgs84Point(lat: 31.17855, lng: 121.59010));
    controller.setEthicsAcknowledged(true);
    controller.setIndividualName('三花');

    await controller.submit();
    expect(stateOf(container).submitted!.individualName, '三花');
    expect(
      repository
          .individualsSnapshot()
          .any((WildlifeIndividual item) => item.name == '三花'),
      isTrue,
    );
  });

  test('服务端拒绝时把中文原因显示出来，且不进入成功态', () async {
    final MockWildlifeRepository repository = MockWildlifeRepository(
      controls: MockControls(latency: Duration.zero),
      now: mockNow,
    );
    final ProviderContainer container = containerWith(repository: repository);
    final WildlifeReportController controller = controllerOf(container);
    controller.setObservedAt(mockNow.subtract(const Duration(hours: 1)));
    controller.setSpecies(mockSpeciesCat);
    // 校园外坐标：客户端预校验就会拦下来。
    await controller
        .setLocationFromMap(const Wgs84Point(lat: 39.9, lng: 116.4));
    controller.setEthicsAcknowledged(true);

    await controller.submit();
    final WildlifeReportState state = stateOf(container);
    expect(state.submitted, isNull);
    expect(state.submitError, contains('校园'));
    expect(state.isSubmitting, isFalse);
  });

  test('健康异常会走"不等待审核"的告警路径', () async {
    final MockWildlifeRepository repository = MockWildlifeRepository(
      controls: MockControls(latency: Duration.zero),
      now: mockNow,
    );
    final ProviderContainer container = containerWith(repository: repository);
    final WildlifeReportController controller = controllerOf(container);
    controller.setObservedAt(mockNow.subtract(const Duration(hours: 1)));
    controller.setSpecies(mockSpeciesCat);
    await controller
        .setLocationFromMap(const Wgs84Point(lat: 31.17855, lng: 121.59010));
    controller.setEthicsAcknowledged(true);
    controller.toggleHealthConcern();
    controller.toggleAnonymous();

    await controller.submit();
    final WildlifeSighting created = stateOf(container).submitted!;
    expect(created.healthConcern, isTrue);
    expect(created.isAnonymous, isTrue);
    expect(repository.healthAlerts, <String>[created.id]);
  });

  test('reset 清空表单（提交后"再报一条"）', () async {
    final ProviderContainer container = containerWith();
    final WildlifeReportController controller = controllerOf(container);
    controller.setSpecies(mockSpeciesCat);
    controller.setEthicsAcknowledged(true);
    expect(stateOf(container).speciesId, mockSpeciesCat);
    controller.reset();
    expect(stateOf(container).speciesId, isNull);
    expect(stateOf(container).ethicsAcknowledged, isFalse);
  });
}
