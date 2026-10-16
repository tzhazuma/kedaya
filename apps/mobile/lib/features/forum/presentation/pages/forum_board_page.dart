import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_providers.dart';
import '../../../../data/mock/mock_controls.dart';
import '../../../../domain/models/forum.dart';
import '../../../../presentation/components/async_state_view.dart';
import '../../../../presentation/components/mock_state_menu.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/forum_providers.dart';
import '../components/forum_post_card.dart';

/// 论坛首页：**版块筛选 + 主题列表**（游标分页 + 下拉刷新 + 触底加载）。
///
/// 三态由 [AsyncStateView] 统一渲染；数据来自 `ForumPort`，
/// 默认装配内存 mock，因此**无后端也能跑通**。
class ForumBoardPage extends ConsumerWidget {
  const ForumBoardPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<ForumListState> value = ref.watch(forumListControllerProvider);
    final MockControls? mockControls = ref.watch(mockControlsProvider);
    final ForumListController controller = ref.read(forumListControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: const Text('论坛'),
        actions: <Widget>[
          if (mockControls != null)
            MockStateMenu(
              controls: mockControls,
              onChanged: () => ref.invalidate(forumListControllerProvider),
            ),
          IconButton(
            tooltip: '发帖',
            onPressed: () => context.push('/forum/compose'),
            icon: const Icon(Icons.edit_outlined),
          ),
          IconButton(
            tooltip: '刷新',
            onPressed: () => controller.refresh(),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: Column(
        children: <Widget>[
          const _BoardFilterBar(),
          const Divider(height: 1),
          Expanded(
            child: RefreshIndicator(
              onRefresh: controller.refresh,
              child: AsyncStateView<ForumListState>(
                value: value,
                isEmpty: (ForumListState state) => state.isEmpty,
                emptyTitle: '这个版块还没有主题',
                emptyDescription: '换个版块看看，或者点右上角的 ✏️ 发第一帖。',
                loadingMessage: '正在加载主题…',
                onRetry: controller.refresh,
                builder: (BuildContext context, ForumListState state) =>
                    NotificationListener<ScrollNotification>(
                      // 触底加载：剩余不足 240px 时预取下一页。
                      onNotification: (ScrollNotification notification) {
                        if (notification.metrics.extentAfter < 240) {
                          unawaited(controller.loadMore());
                        }
                        return false;
                      },
                      child: ListView.separated(
                        padding: const EdgeInsets.all(KedaYaTokens.space4),
                        itemCount: state.posts.length + 1,
                        separatorBuilder: (BuildContext context, int index) =>
                            const SizedBox(height: KedaYaTokens.space3),
                        itemBuilder: (BuildContext context, int index) {
                          if (index == state.posts.length) {
                            return _ListFooter(state: state, controller: controller);
                          }
                          final ForumPost post = state.posts[index];
                          return ForumPostCard(
                            post: post,
                            onTap: () => context.push('/forum/${post.id}'),
                          );
                        },
                      ),
                    ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 版块筛选条（"全部" + 各版块）。切换即重新加载列表。
class _BoardFilterBar extends ConsumerWidget {
  const _BoardFilterBar();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final AsyncValue<List<ForumBoard>> boards = ref.watch(forumBoardsProvider);
    final String? selectedId = ref.watch(forumBoardFilterProvider);
    final ForumBoardFilter filter = ref.read(forumBoardFilterProvider.notifier);
    final List<ForumBoard> list = boards.valueOrNull ?? const <ForumBoard>[];

    if (boards.hasError && list.isEmpty) {
      // 版块拉取失败不应该挡住主题列表：给出可点击的重试，但列表照常展示。
      return SizedBox(
        height: 48,
        child: Row(
          children: <Widget>[
            const SizedBox(width: KedaYaTokens.space4),
            Text(
              '版块列表加载失败',
              style: TextStyle(fontSize: KedaYaTokens.fontSizeXs, color: colors.danger),
            ),
            TextButton(
              onPressed: () => ref.invalidate(forumBoardsProvider),
              child: const Text('重试'),
            ),
          ],
        ),
      );
    }

    return SizedBox(
      height: 52,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
          horizontal: KedaYaTokens.space4,
          vertical: KedaYaTokens.space2,
        ),
        children: <Widget>[
          _BoardChip(
            label: '全部',
            selected: selectedId == null,
            onSelected: () => filter.select(null),
          ),
          for (final ForumBoard board in list) ...<Widget>[
            const SizedBox(width: KedaYaTokens.space2),
            _BoardChip(
              label: board.requiresSignIn ? '${board.name} 🔒' : board.name,
              selected: selectedId == board.id,
              onSelected: () => filter.select(board.id),
            ),
          ],
        ],
      ),
    );
  }
}

class _BoardChip extends StatelessWidget {
  const _BoardChip({
    required this.label,
    required this.selected,
    required this.onSelected,
  });

  final String label;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: (bool _) => onSelected(),
      showCheckmark: false,
      backgroundColor: colors.surfaceAlt,
      selectedColor: colors.brandSoft,
      side: BorderSide(color: colors.border),
      labelStyle: TextStyle(
        fontSize: KedaYaTokens.fontSizeSm,
        fontWeight: selected ? KedaYaTokens.fontWeightSemibold : KedaYaTokens.fontWeightRegular,
        color: selected ? colors.brandStrong : colors.textMuted,
      ),
    );
  }
}

/// 列表底部：翻页入口 / 翻页错误 / 到底提示。
class _ListFooter extends StatelessWidget {
  const _ListFooter({required this.state, required this.controller});

  final ForumListState state;
  final ForumListController controller;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    if (state.loadMoreError != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: KedaYaTokens.space3),
        child: Column(
          children: <Widget>[
            Text(
              '加载更多失败：${state.loadMoreError}',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: KedaYaTokens.fontSizeSm, color: colors.danger),
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
          style: TextStyle(fontSize: KedaYaTokens.fontSizeXs, color: colors.textMuted),
        ),
      ),
    );
  }
}
