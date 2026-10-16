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
import 'package:kedaya/domain/models/wildlife_sighting.dart';
import 'package:kedaya/features/wildlife/application/wildlife_providers.dart';

/// 观测列表控制器的三态 + 游标分页 + 筛选（与 `groupbuy` / `forum` 同构）。
void main() {
  ProviderContainer containerWith(MockWildlifeRepository repository) {
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[wildlifeRepositoryProvider.overrideWithValue(repository)],
    );
    addTearDown(container.dispose);
    return container;
  }

  MockWildlifeRepository buildRepository({MockControls? controls, List<WildlifeSighting>? seed}) =>
      MockWildlifeRepository(
        controls: controls ?? MockControls(latency: Duration.zero),
        now: mockNow,
        sightings: seed,
      );

  /// 12 条已发布记录，用来验证分页。
  List<WildlifeSighting> publishedSeed() => <WildlifeSighting>[
    for (int i = 0; i < 12; i++)
      WildlifeSighting(
        id: 'wl-seed-$i',
        speciesId: mockSpeciesCat,
        speciesNameZh: '猫',
        status: WildlifeModerationStatus.published,
        geo: const Wgs84Point(lat: 31.17855, lng: 121.59010),
        observedAt: mockNow.subtract(Duration(hours: i + 1)),
        createdAt: mockNow.subtract(Duration(hours: i + 1)),
        reporterDisplayName: '鸭鸭',
      ),
  ];

  test('loading -> data：只出现已发布的记录', () async {
    final ProviderContainer container = containerWith(buildRepository());
    expect(container.read(wildlifeSightingListControllerProvider).isLoading, isTrue);

    final WildlifeSightingListState state = await container.read(
      wildlifeSightingListControllerProvider.future,
    );
    expect(state.sightings, hasLength(5));
    expect(state.total, 5);
    expect(state.hasMore, isFalse);
    expect(state.isEmpty, isFalse);
  });

  test('empty：空结果时 isEmpty 为 true', () async {
    final MockControls controls = MockControls(latency: Duration.zero)..emptyResults = true;
    final ProviderContainer container = containerWith(buildRepository(controls: controls));
    final WildlifeSightingListState state = await container.read(
      wildlifeSightingListControllerProvider.future,
    );
    expect(state.isEmpty, isTrue);
  });

  test('error：上游故障抛出 ApiException', () async {
    final MockControls controls = MockControls(latency: Duration.zero)
      ..failureMode = MockFailureMode.upstreamUnavailable;
    final ProviderContainer container = containerWith(buildRepository(controls: controls));
    await expectLater(
      container.read(wildlifeSightingListControllerProvider.future),
      throwsA(isA<ApiException>()),
    );
  });

  test('loadMore：追加下一页，且不重复', () async {
    final ProviderContainer container = containerWith(
      buildRepository(seed: publishedSeed()),
    );
    final WildlifeSightingListState first = await container.read(
      wildlifeSightingListControllerProvider.future,
    );
    expect(first.sightings, hasLength(10));
    expect(first.hasMore, isTrue);

    await container.read(wildlifeSightingListControllerProvider.notifier).loadMore();
    final WildlifeSightingListState second = container.read(
      wildlifeSightingListControllerProvider,
    ).value!;
    expect(second.sightings, hasLength(12));
    expect(second.hasMore, isFalse);
    expect(
      second.sightings.map((WildlifeSighting item) => item.id).toSet(),
      hasLength(12),
    );
  });

  test('翻页失败保留已有列表（只挂 loadMoreError）', () async {
    final MockControls controls = MockControls(latency: Duration.zero);
    final ProviderContainer container = containerWith(
      buildRepository(controls: controls, seed: publishedSeed()),
    );
    await container.read(wildlifeSightingListControllerProvider.future);

    controls.failureMode = MockFailureMode.upstreamUnavailable;
    await container.read(wildlifeSightingListControllerProvider.notifier).loadMore();

    final WildlifeSightingListState state = container.read(
      wildlifeSightingListControllerProvider,
    ).value!;
    expect(state.sightings, hasLength(10), reason: '不能把已看到的列表打回错误态');
    expect(state.loadMoreError, isNotNull);
    expect(state.isLoadingMore, isFalse);
  });

  test('物种筛选：切换后重新加载并回到 loading', () async {
    final ProviderContainer container = containerWith(buildRepository());
    await container.read(wildlifeSightingListControllerProvider.future);

    container.read(wildlifeSpeciesFilterProvider.notifier).select(mockSpeciesSwan);
    expect(container.read(wildlifeSightingListControllerProvider).isLoading, isTrue);

    final WildlifeSightingListState state = await container.read(
      wildlifeSightingListControllerProvider.future,
    );
    expect(state.speciesId, mockSpeciesSwan);
    // 已发布的黑天鹅观测只有 1 条（wl-1002）。
    expect(state.sightings, hasLength(1));
    expect(
      state.sightings.every((WildlifeSighting item) => item.speciesId == mockSpeciesSwan),
      isTrue,
    );
  });

  test('详情：待审核但属于自己的记录可见', () async {
    final ProviderContainer container = containerWith(buildRepository());
    final WildlifeSighting sighting = await container.read(
      wildlifeSightingDetailProvider('wl-1003').future,
    );
    expect(sighting.status, WildlifeModerationStatus.pending);

    await expectLater(
      container.read(wildlifeSightingDetailProvider('wl-nope').future),
      throwsA(isA<ApiException>()),
    );
  });

  test('写操作后失效读 provider（纠正物种 → 列表重取）', () async {
    final ProviderContainer container = containerWith(buildRepository());
    await container.read(wildlifeSightingListControllerProvider.future);

    final WildlifeSighting updated = await container
        .read(wildlifeActionsProvider)
        .correctSpecies('wl-1001', speciesId: mockSpeciesSwan);
    expect(updated.speciesId, mockSpeciesSwan);

    final WildlifeSightingListState state = await container.read(
      wildlifeSightingListControllerProvider.future,
    );
    expect(
      state.sightings.firstWhere((WildlifeSighting item) => item.id == 'wl-1001').speciesId,
      mockSpeciesSwan,
    );
  });

  test('撤回后详情按 NOT_FOUND 处理（空态）', () async {
    final ProviderContainer container = containerWith(buildRepository());
    await container.read(wildlifeSightingDetailProvider('wl-1007').future);
    await container.read(wildlifeActionsProvider).withdraw('wl-1007');
    await expectLater(
      container.read(wildlifeSightingDetailProvider('wl-1007').future),
      throwsA(isA<ApiException>()),
    );
  });
}
