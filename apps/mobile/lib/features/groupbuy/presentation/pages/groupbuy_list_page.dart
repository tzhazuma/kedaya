import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_providers.dart';
import '../../../../data/mock/mock_controls.dart';
import '../../../../data/mock/mock_failure.dart';
import '../../../../domain/models/groupbuy_order.dart';
import '../../../../presentation/components/async_state_view.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/groupbuy_providers.dart';
import '../components/groupbuy_order_card.dart';

/// 拼单列表页（垂直切片的入口）。
///
/// 三态：loading / error / empty 由 [AsyncStateView] 统一渲染；
/// 数据来自 `GroupbuyPort`，默认装配的是内存 mock，因此**无后端也能跑通**。
class GroupbuyListPage extends ConsumerWidget {
  const GroupbuyListPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<GroupbuyListState> value = ref.watch(groupbuyListControllerProvider);
    final MockControls? mockControls = ref.watch(mockControlsProvider);
    final GroupbuyListController controller = ref.read(
      groupbuyListControllerProvider.notifier,
    );

    return Scaffold(
      appBar: AppBar(
        title: const Text('拼单'),
        actions: <Widget>[
          if (mockControls != null)
            _MockStateMenu(
              controls: mockControls,
              onChanged: () => ref.invalidate(groupbuyListControllerProvider),
            ),
          IconButton(
            tooltip: '刷新',
            onPressed: () => controller.refresh(),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: controller.refresh,
        child: AsyncStateView<GroupbuyListState>(
          value: value,
          isEmpty: (GroupbuyListState state) => state.isEmpty,
          emptyTitle: '还没有拼单',
          emptyDescription: '换个筛选条件，或者下拉刷新试试。',
          loadingMessage: '正在加载拼单…',
          onRetry: controller.refresh,
          builder: (BuildContext context, GroupbuyListState state) => ListView.separated(
            padding: const EdgeInsets.all(KedaYaTokens.space4),
            itemCount: state.orders.length + 1,
            separatorBuilder: (BuildContext context, int index) =>
                const SizedBox(height: KedaYaTokens.space3),
            itemBuilder: (BuildContext context, int index) {
              if (index == state.orders.length) {
                return _ListFooter(state: state, controller: controller);
              }
              final GroupbuyOrder order = state.orders[index];
              return GroupbuyOrderCard(
                order: order,
                onTap: () => context.push('/groupbuy/${order.id}'),
              );
            },
          ),
        ),
      ),
    );
  }
}

/// 列表底部：翻页入口 / 翻页错误 / 到底提示。
class _ListFooter extends StatelessWidget {
  const _ListFooter({required this.state, required this.controller});

  final GroupbuyListState state;
  final GroupbuyListController controller;

  @override
  Widget build(BuildContext context) {
    if (state.loadMoreError != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: KedaYaTokens.space3),
        child: Column(
          children: <Widget>[
            Text(
              '加载更多失败：${state.loadMoreError}',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                color: KedaYaTokens.colorDanger,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space2),
            OutlinedButton(
              onPressed: () => controller.loadMore(),
              child: const Text('重试'),
            ),
          ],
        ),
      );
    }
    if (state.isLoadingMore) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: KedaYaTokens.space3),
        child: KedaYaLoadingState(),
      );
    }
    if (state.hasMore) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: KedaYaTokens.space3),
        child: Center(
          child: OutlinedButton(
            onPressed: () => controller.loadMore(),
            child: const Text('加载更多'),
          ),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: KedaYaTokens.space3),
      child: Center(
        child: Text(
          state.total == null ? '没有更多了' : '共 ${state.total} 条 · 没有更多了',
          style: const TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            color: KedaYaTokens.colorTextMuted,
          ),
        ),
      ),
    );
  }
}

/// mock 三态演示开关（真实运行时不存在此入口）。
class _MockStateMenu extends StatelessWidget {
  const _MockStateMenu({required this.controls, required this.onChanged});

  final MockControls controls;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      tooltip: 'mock 三态演示',
      icon: const Icon(Icons.science_outlined),
      onSelected: (String value) {
        controls.emptyResults = value == 'empty';
        controls.failureMode = value == 'error'
            ? MockFailureMode.upstreamUnavailable
            : MockFailureMode.none;
        onChanged();
      },
      itemBuilder: (BuildContext context) => const <PopupMenuEntry<String>>[
        PopupMenuItem<String>(value: 'normal', child: Text('正常数据')),
        PopupMenuItem<String>(value: 'empty', child: Text('空列表（empty 态）')),
        PopupMenuItem<String>(value: 'error', child: Text('上游故障（error 态）')),
      ],
    );
  }
}
