import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_providers.dart';
import '../../../../data/mock/mock_controls.dart';
import '../../../../domain/models/activity.dart';
import '../../../../domain/models/api_error.dart';
import '../../../../presentation/components/async_state_view.dart';
import '../../../../presentation/components/mock_state_menu.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/activities_providers.dart';
import '../components/activity_cards.dart';

/// 校园活动列表（独立 `activities` 域）。
///
/// 三条产品约束直接体现在页面上：
/// 1. 候选活动**不会**进入日程、也**不会**触发提醒；
/// 2. 来源与状态可以叠加筛选；
/// 3. 没有可确定时刻时只展示原文，不补 `23:59`。
class ActivitiesPage extends ConsumerWidget {
  const ActivitiesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<ActivityItem>> value =
        ref.watch(filteredActivitiesProvider);
    final ActivitiesListState? listState =
        ref.watch(activitiesListControllerProvider).valueOrNull;
    final ActivityFilter filter = ref.watch(activityFilterProvider);
    final ActivitiesListController controller =
        ref.read(activitiesListControllerProvider.notifier);
    final MockControls? mockControls = ref.watch(mockControlsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('校园活动'),
        actions: <Widget>[
          if (mockControls != null)
            MockStateMenu(
              controls: mockControls,
              onChanged: () => ref.invalidate(activitiesListControllerProvider),
            ),
          IconButton(
            tooltip: '导入公众号文章',
            onPressed: () => context.push('/activities/import'),
            icon: const Icon(Icons.link_outlined),
          ),
          IconButton(
            tooltip: '校园邮箱',
            onPressed: () => context.push('/activities/mail'),
            icon: const Icon(Icons.mark_email_read_outlined),
          ),
          IconButton(
            tooltip: '刷新',
            onPressed: controller.refresh,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/activities/new'),
        icon: const Icon(Icons.add),
        label: const Text('手动添加'),
      ),
      body: SafeArea(
        child: Column(
          children: <Widget>[
            const Padding(
              padding: EdgeInsets.fromLTRB(
                KedaYaTokens.space4,
                KedaYaTokens.space3,
                KedaYaTokens.space4,
                0,
              ),
              child: ActivityIntro(),
            ),
            const SizedBox(height: KedaYaTokens.space2),
            if (listState?.refreshError != null) ...<Widget>[
              _RefreshErrorNotice(
                message: '刷新失败，显示的是上次数据：'
                    '${_messageOf(listState!.refreshError!)}',
                onRetry: controller.refresh,
              ),
              const SizedBox(height: KedaYaTokens.space1),
            ],
            const _FilterBar(),
            Expanded(
              child: RefreshIndicator(
                onRefresh: controller.refresh,
                child: AsyncStateView<List<ActivityItem>>(
                  value: value,
                  isEmpty: (List<ActivityItem> items) => items.isEmpty,
                  emptyTitle: filter.isEmpty ? '还没有活动' : '没有符合筛选的活动',
                  emptyDescription: filter.isEmpty
                      ? '从校园邮箱同步、导入单篇公众号文章，或手动添加一个活动。'
                          '候选活动确认后才会创建站内信提醒。'
                      : '试试切换到全部来源 / 全部状态，或导入一篇新的公众号文章。',
                  loadingMessage: '正在整理活动…',
                  onRetry: controller.refresh,
                  builder: (BuildContext context, List<ActivityItem> items) {
                    final bool showFooter = listState != null &&
                        (listState.hasMore ||
                            listState.isLoadingMore ||
                            listState.loadMoreError != null);
                    return ListView.separated(
                      padding: EdgeInsets.fromLTRB(
                        KedaYaTokens.space4,
                        KedaYaTokens.space3,
                        KedaYaTokens.space4,
                        KedaYaTokens.space6 +
                            MediaQuery.viewPaddingOf(context).bottom,
                      ),
                      itemCount: items.length + (showFooter ? 1 : 0),
                      separatorBuilder: (BuildContext context, int index) =>
                          const SizedBox(height: KedaYaTokens.space3),
                      itemBuilder: (BuildContext context, int index) {
                        if (index >= items.length) {
                          return _LoadMoreFooter(
                            state: listState!,
                            onLoadMore: controller.loadMore,
                          );
                        }
                        final ActivityItem item = items[index];
                        return ActivityCard(
                          key: ValueKey<String>('activity-card-${item.id}'),
                          item: item,
                          onTap: () => context.push('/activities/${item.id}'),
                        );
                      },
                    );
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 页首说明：这是“来源 → 确认 → 提醒”的中间层，不是课程 DDL。
class ActivityIntro extends StatelessWidget {
  const ActivityIntro({super.key});

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.brandSoft,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(Icons.event_available_outlined,
                  size: 18, color: colors.brandStrong),
              const SizedBox(width: KedaYaTokens.space2),
              Expanded(
                child: Text(
                  '从来源到日程，中间隔一次确认',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            '活动来自校园邮箱、公众号单篇导入与手动创建。'
            '待确认的活动不会进入日程，也不会触发提醒；'
            '确认后才会按「报名截止前 24 小时 / 开始前 1 小时」创建站内信提醒。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.text,
            ),
          ),
        ],
      ),
    );
  }
}

class _FilterBar extends ConsumerWidget {
  const _FilterBar();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ActivityFilter filter = ref.watch(activityFilterProvider);
    final StateController<ActivityFilter> controller =
        ref.read(activityFilterProvider.notifier);

    return Column(
      children: <Widget>[
        _ChipRow(
          children: <Widget>[
            _SourceChip(
              label: '全部来源',
              selected: filter.source == null,
              onSelected: () => controller.state = filter.withSource(null),
            ),
            for (final ActivitySource source in ActivitySource.values)
              _SourceChip(
                label: source.label,
                selected: filter.source == source,
                onSelected: () => controller.state = filter.withSource(source),
              ),
          ],
        ),
        _ChipRow(
          children: <Widget>[
            _StatusChip(
              label: '全部状态',
              selected: filter.status == null,
              onSelected: () => controller.state = filter.withStatus(null),
            ),
            for (final ActivityStatus status in ActivityStatus.values)
              _StatusChip(
                label: status.label,
                selected: filter.status == status,
                onSelected: () => controller.state = filter.withStatus(status),
              ),
          ],
        ),
      ],
    );
  }
}

class _ChipRow extends StatelessWidget {
  const _ChipRow({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space4,
        vertical: KedaYaTokens.space1,
      ),
      child: Row(
        children: <Widget>[
          for (int index = 0; index < children.length; index++) ...<Widget>[
            if (index > 0) const SizedBox(width: KedaYaTokens.space2),
            children[index],
          ],
        ],
      ),
    );
  }
}

String _messageOf(Object error) =>
    error is ApiException ? error.error.userMessage : '$error';

class _RefreshErrorNotice extends StatelessWidget {
  const _RefreshErrorNotice({required this.message, required this.onRetry});

  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: KedaYaTokens.space4),
      padding: const EdgeInsets.all(KedaYaTokens.space2),
      decoration: BoxDecoration(
        color: colors.warning.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
        border: Border.all(color: colors.warning.withValues(alpha: 0.35)),
      ),
      child: Row(
        children: <Widget>[
          Icon(Icons.cloud_off_outlined, size: 18, color: colors.warning),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.text,
              ),
            ),
          ),
          TextButton(
            onPressed: () => unawaited(onRetry()),
            style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
            child: const Text('重试'),
          ),
        ],
      ),
    );
  }
}

class _LoadMoreFooter extends StatelessWidget {
  const _LoadMoreFooter({required this.state, required this.onLoadMore});

  final ActivitiesListState state;
  final Future<void> Function() onLoadMore;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    if (state.loadMoreError != null) {
      return Column(
        children: <Widget>[
          Text(
            '加载更多失败：${_messageOf(state.loadMoreError!)}',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.warning,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space1),
          OutlinedButton(
            key: const Key('activities-load-more'),
            onPressed: () => unawaited(onLoadMore()),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
            ),
            child: const Text('重试加载更多'),
          ),
        ],
      );
    }
    if (state.isLoadingMore) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: KedaYaTokens.space3),
        child: Center(
          child: SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      );
    }
    return OutlinedButton(
      key: const Key('activities-load-more'),
      onPressed: () => unawaited(onLoadMore()),
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(48),
      ),
      child: const Text('加载更多活动'),
    );
  }
}

class _SourceChip extends StatelessWidget {
  const _SourceChip({
    required this.label,
    required this.selected,
    required this.onSelected,
  });

  final String label;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) => ChoiceChip(
        label: Text(label),
        selected: selected,
        onSelected: (bool _) => onSelected(),
        materialTapTargetSize: MaterialTapTargetSize.padded,
      );
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({
    required this.label,
    required this.selected,
    required this.onSelected,
  });

  final String label;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) => ChoiceChip(
        label: Text(label),
        selected: selected,
        onSelected: (bool _) => onSelected(),
        materialTapTargetSize: MaterialTapTargetSize.padded,
      );
}
