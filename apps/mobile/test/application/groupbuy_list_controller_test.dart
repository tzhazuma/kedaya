import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/data/mock/mock_groupbuy_repository.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/groupbuy_order.dart';
import 'package:kedaya/features/groupbuy/application/groupbuy_providers.dart';

/// application 层的三态测试：**只替换 domain port**，不碰 UI、不碰网络。
void main() {
  ProviderContainer containerWith(MockGroupbuyRepository repository) {
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[groupbuyRepositoryProvider.overrideWithValue(repository)],
    );
    addTearDown(container.dispose);
    return container;
  }

  test('loading -> data：列表加载成功，初态是 loading', () async {
    final ProviderContainer container = containerWith(
      MockGroupbuyRepository(controls: MockControls(latency: Duration.zero)),
    );

    expect(container.read(groupbuyListControllerProvider).isLoading, isTrue);

    final GroupbuyListState state = await container.read(
      groupbuyListControllerProvider.future,
    );
    expect(state.orders, hasLength(5));
    expect(state.isEmpty, isFalse);
    expect(state.hasMore, isFalse);
    expect(state.total, 5);
    expect(container.read(groupbuyListControllerProvider).hasValue, isTrue);
  });

  test('empty：空结果时 isEmpty 为 true（UI 渲染空态）', () async {
    final MockControls controls = MockControls(latency: Duration.zero)..emptyResults = true;
    final ProviderContainer container = containerWith(
      MockGroupbuyRepository(controls: controls),
    );

    final GroupbuyListState state = await container.read(
      groupbuyListControllerProvider.future,
    );
    expect(state.isEmpty, isTrue);
    expect(state.orders, isEmpty);
  });

  test('error：上游故障抛出 ApiException（UI 渲染错误态）', () async {
    final MockControls controls = MockControls(latency: Duration.zero)
      ..failureMode = MockFailureMode.upstreamUnavailable;
    final ProviderContainer container = containerWith(
      MockGroupbuyRepository(controls: controls),
    );

    await expectLater(
      container.read(groupbuyListControllerProvider.future),
      throwsA(isA<ApiException>()),
    );

    final Object? error = container.read(groupbuyListControllerProvider).error;
    expect(error, isA<ApiException>());
    expect((error! as ApiException).code, ApiErrorCode.upstreamUnavailable);
  });

  test('loadMore：追加下一页；翻页失败时保留已有列表', () async {
    final List<GroupbuyOrder> seed = <GroupbuyOrder>[
      for (int i = 0; i < 12; i++)
        GroupbuyOrder(
          id: 'gb-seed-$i',
          title: '拼单 $i',
          unitPriceFen: 1000 + i,
          targetQuantity: 4,
          joinedQuantity: 1,
          status: GroupbuyStatus.recruiting,
          createdAt: DateTime.utc(2026, 10, 16, 12).subtract(Duration(hours: i)),
        ),
    ];
    final MockControls controls = MockControls(latency: Duration.zero);
    final ProviderContainer container = containerWith(
      MockGroupbuyRepository(seed: seed, controls: controls),
    );

    GroupbuyListState state = await container.read(
      groupbuyListControllerProvider.future,
    );
    expect(state.orders, hasLength(10));
    expect(state.hasMore, isTrue);

    // 翻页失败：保留已加载的 10 条，只把错误挂在状态上。
    controls.failureMode = MockFailureMode.upstreamUnavailable;
    await container.read(groupbuyListControllerProvider.notifier).loadMore();
    state = container.read(groupbuyListControllerProvider).requireValue;
    expect(state.orders, hasLength(10));
    expect(state.loadMoreError, isA<ApiException>());
    expect(state.isLoadingMore, isFalse);

    // 恢复后翻页成功。
    controls.failureMode = MockFailureMode.none;
    await container.read(groupbuyListControllerProvider.notifier).loadMore();
    state = container.read(groupbuyListControllerProvider).requireValue;
    expect(state.orders, hasLength(12));
    expect(state.hasMore, isFalse);
    expect(state.loadMoreError, isNull);
  });

  test('写操作后失效读 provider：参团会刷新列表与详情', () async {
    final ProviderContainer container = containerWith(
      MockGroupbuyRepository(controls: MockControls(latency: Duration.zero)),
    );

    await container.read(groupbuyListControllerProvider.future);
    final GroupbuyOrder before = await container.read(
      groupbuyDetailProvider('gb-1001').future,
    );
    expect(before.joinedQuantity, 3);

    await container.read(groupbuyActionsProvider).join('gb-1001');

    final GroupbuyOrder after = await container.read(
      groupbuyDetailProvider('gb-1001').future,
    );
    expect(after.joinedQuantity, 4);

    final GroupbuyListState list = await container.read(
      groupbuyListControllerProvider.future,
    );
    expect(
      list.orders.firstWhere((GroupbuyOrder order) => order.id == 'gb-1001').joinedQuantity,
      4,
    );
  });
}
