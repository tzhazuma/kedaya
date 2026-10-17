import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/data/mock/mock_fixtures.dart';
import 'package:kedaya/data/mock/mock_wildlife_repository.dart';
import 'package:kedaya/data/mock/wildlife_fixtures.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/geo.dart';
import 'package:kedaya/domain/models/wildlife.dart';
import 'package:kedaya/features/wildlife/application/wildlife_providers.dart';

/// application 层的三态测试：**只替换 domain port**，不碰 UI、不碰网络。
void main() {
  ProviderContainer containerWith(MockWildlifeRepository repository) {
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[
        wildlifeRepositoryProvider.overrideWithValue(repository)
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  MockWildlifeRepository buildRepository(
          {MockControls? controls, CampusBasemap? basemap}) =>
      MockWildlifeRepository(
        controls: controls ?? MockControls(latency: Duration.zero),
        now: mockNow,
        basemap: basemap,
      );

  test('loading -> data：底图 + 区域 + 热点 + 轨迹一次到位', () async {
    final ProviderContainer container = containerWith(buildRepository());

    expect(container.read(wildlifeMapControllerProvider).isLoading, isTrue);

    final WildlifeMapState state = await container.read(
      wildlifeMapControllerProvider.future,
    );
    expect(state.basemap.version, 'mock-sketch-v1');
    expect(state.species, hasLength(7));
    expect(state.zones, hasLength(4));
    // 敏感区的热点不公开。
    expect(state.spots, hasLength(3));
    expect(state.tracks, hasLength(2));
    expect(state.isEmpty, isFalse);
    expect(state.publicZones, hasLength(3));
    expect(state.sensitiveZones, hasLength(1));
    expect(state.aggregationNotice, contains('历史聚合'));
    expect(container.read(wildlifeMapControllerProvider).hasValue, isTrue);
  });

  test('empty：空结果时 isEmpty 为 true（UI 渲染空态）', () async {
    final MockControls controls = MockControls(latency: Duration.zero)
      ..emptyResults = true;
    final ProviderContainer container =
        containerWith(buildRepository(controls: controls));

    final WildlifeMapState state = await container.read(
      wildlifeMapControllerProvider.future,
    );
    expect(state.isEmpty, isTrue);
    expect(state.zones, isEmpty);
    expect(state.spots, isEmpty);
    expect(state.tracks, isEmpty);
  });

  test('error：上游故障抛出 ApiException（UI 渲染错误态）', () async {
    final MockControls controls = MockControls(latency: Duration.zero)
      ..failureMode = MockFailureMode.upstreamUnavailable;
    final ProviderContainer container =
        containerWith(buildRepository(controls: controls));

    await expectLater(
      container.read(wildlifeMapControllerProvider.future),
      throwsA(isA<ApiException>()),
    );
    final Object? error = container.read(wildlifeMapControllerProvider).error;
    expect(error, isA<ApiException>());
    expect((error! as ApiException).code, ApiErrorCode.upstreamUnavailable);
  });

  test('物种筛选会重新加载，并且只保留该物种的热点与轨迹', () async {
    final ProviderContainer container = containerWith(buildRepository());
    final WildlifeMapState all =
        await container.read(wildlifeMapControllerProvider.future);
    expect(all.spots, hasLength(3));

    container
        .read(wildlifeSpeciesFilterProvider.notifier)
        .select(mockSpeciesSwan);
    final WildlifeMapState filtered = await container.read(
      wildlifeMapControllerProvider.future,
    );
    expect(filtered.selectedSpeciesId, mockSpeciesSwan);
    expect(filtered.spots.single.id, 'ws-lake-swan');
    expect(filtered.tracks.single.id, 'wt-lake-swan');
    expect(filtered.selectedSpecies!.displayName, '黑天鹅');

    // 切回全部。
    container.read(wildlifeSpeciesFilterProvider.notifier).select(null);
    final WildlifeMapState back =
        await container.read(wildlifeMapControllerProvider.future);
    expect(back.spots, hasLength(3));
    expect(back.selectedSpecies, isNull);
  });

  test('底图标定不合法 → 整页错误态（不画错图）', () async {
    final ProviderContainer container = containerWith(
      buildRepository(
        basemap: CampusBasemap(
          version: 'broken',
          widthPx: 1000,
          heightPx: 700,
          affine: BasemapAffine.identity,
          // RMSE 超阈值 + 控制点不足。
          calibrationRmsePx: 9,
          controlPointCount: 3,
        ),
      ),
    );

    await expectLater(
      container.read(wildlifeMapControllerProvider.future),
      throwsA(isA<ApiException>()),
    );
    final ApiException error =
        container.read(wildlifeMapControllerProvider).error! as ApiException;
    expect(error.error.message, contains(CampusBasemap.rmseTooHigh));
    expect(
        error.error.message, contains(CampusBasemap.controlPointsInsufficient));
  });

  test('refresh 后仍是数据态', () async {
    final ProviderContainer container = containerWith(buildRepository());
    await container.read(wildlifeMapControllerProvider.future);
    await container.read(wildlifeMapControllerProvider.notifier).refresh();
    expect(container.read(wildlifeMapControllerProvider).hasValue, isTrue);
  });

  test('独立的只读 provider：物种字典 / 区域列表 / 底图', () async {
    final ProviderContainer container = containerWith(buildRepository());
    expect(await container.read(wildlifeSpeciesProvider.future), hasLength(7));
    expect(await container.read(wildlifeZonesProvider.future), hasLength(4));
    expect((await container.read(wildlifeBasemapProvider.future)).isRenderable,
        isTrue);
    expect(await container.read(wildlifeTracksProvider.future), hasLength(2));
    expect(
      (await container.read(wildlifeZoneDetailProvider(mockZoneLake).future))
          .name,
      contains('人工湖'),
    );
    expect(
      (await container.read(wildlifeTrackDetailProvider('wt-lake-swan').future))
          .isInferred,
      isTrue,
    );
    expect(
      await container.read(wildlifeIndividualsProvider(mockSpeciesCat).future),
      hasLength(1),
    );
  });
}
