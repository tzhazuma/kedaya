import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_providers.dart';
import '../../../../data/mock/mock_controls.dart';
import '../../../../domain/models/buddy.dart';
import '../../../../domain/models/buddy_application.dart';
import '../../../../presentation/components/async_state_view.dart';
import '../../../../presentation/components/mock_state_menu.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/buddy_providers.dart';
import '../components/buddy_cards.dart';

/// 找搭子首页：**三板块分栏 + 活动列表**（游标分页 + 下拉刷新 + 触底加载）。
///
/// 三态由 [AsyncStateView] 统一渲染；数据来自 `BuddyPort`，
/// 默认装配内存 mock，因此**无后端也能跑通**。
///
/// **没有 dating 板块**：分栏只有 `academic` / `daily` / `sport`
/// （契约 §11.10-G：不做 dating，且不得在 `buddy` 里悄悄加）。
class BuddyBoardPage extends ConsumerWidget {
  const BuddyBoardPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<BuddyListState> value = ref.watch(buddyListControllerProvider);
    final MockControls? mockControls = ref.watch(mockControlsProvider);
    final BuddyListController controller = ref.read(buddyListControllerProvider.notifier);
    final BuddySection section = ref.watch(buddySectionFilterProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('找搭子'),
        actions: <Widget>[
          if (mockControls != null)
            MockStateMenu(
              controls: mockControls,
              onChanged: () => ref.invalidate(buddyListControllerProvider),
            ),
          IconButton(
            tooltip: '主动推荐',
            onPressed: () => context.push('/buddy/recommend'),
            icon: const Icon(Icons.auto_awesome_outlined),
          ),
          IconButton(
            tooltip: '发布活动',
            onPressed: () => context.push('/buddy/compose'),
            icon: const Icon(Icons.edit_outlined),
          ),
          PopupMenuButton<String>(
            tooltip: '更多',
            onSelected: (String action) {
              switch (action) {
                case 'profile':
                  context.push('/buddy/profile');
                case 'applications':
                  unawaited(_showMyApplications(context));
                case 'privacy':
                  context.push('/buddy/privacy');
                case 'refresh':
                  unawaited(controller.refresh());
              }
            },
            itemBuilder: (BuildContext context) => const <PopupMenuEntry<String>>[
              PopupMenuItem<String>(value: 'profile', child: Text('我的匹配资料')),
              PopupMenuItem<String>(value: 'applications', child: Text('我的申请')),
              PopupMenuItem<String>(value: 'privacy', child: Text('隐私说明')),
              PopupMenuItem<String>(value: 'refresh', child: Text('刷新')),
            ],
          ),
        ],
      ),
      body: Column(
        children: <Widget>[
          BuddySectionChipBar(
            selected: section,
            onSelected: (BuddySection next) =>
                ref.read(buddySectionFilterProvider.notifier).select(next),
          ),
          const Divider(height: 1),
          Expanded(
            child: RefreshIndicator(
              onRefresh: controller.refresh,
              child: AsyncStateView<BuddyListState>(
                value: value,
                isEmpty: (BuddyListState state) => state.isEmpty,
                emptyTitle: '这个板块还没有活动',
                emptyDescription: '换个板块看看，或者点右上角的 ✏️ 发一个。',
                loadingMessage: '正在加载活动…',
                onRetry: controller.refresh,
                builder: (BuildContext context, BuddyListState state) =>
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
                          final BuddyPost post = state.posts[index];
                          return BuddyPostCard(
                            post: post,
                            onTap: () => context.push('/buddy/${post.id}'),
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

/// 「我的申请」底部弹层（`GET /buddy/applications`，申请人视角）。
Future<void> _showMyApplications(BuildContext context) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  builder: (BuildContext sheetContext) => const _MyApplicationsSheet(),
);

class _MyApplicationsSheet extends ConsumerWidget {
  const _MyApplicationsSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final AsyncValue<List<BuddyApplication>> applications = ref.watch(
      buddyMyApplicationsProvider,
    );
    final BuddyActions actions = ref.read(buddyActionsProvider);

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              '我的申请',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeMd,
                fontWeight: KedaYaTokens.fontWeightSemibold,
                color: colors.text,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space1),
            Text(
              '规格 §6.1：申请列表只有发起人与申请人本人能看到。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.textMuted,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space3),
            Flexible(
              child: AsyncStateView<List<BuddyApplication>>(
                value: applications,
                isEmpty: (List<BuddyApplication> items) => items.isEmpty,
                emptyTitle: '还没有申请过任何活动',
                emptyDescription: '在活动详情页点「申请加入」即可。',
                onRetry: () => ref.invalidate(buddyMyApplicationsProvider),
                builder: (BuildContext context, List<BuddyApplication> items) =>
                    ListView.separated(
                      shrinkWrap: true,
                      itemCount: items.length,
                      separatorBuilder: (BuildContext context, int index) =>
                          const SizedBox(height: KedaYaTokens.space2),
                      itemBuilder: (BuildContext context, int index) {
                        final BuddyApplication application = items[index];
                        return BuddyApplicationTile(
                          application: application,
                          isCreator: false,
                          onWithdraw: () => unawaited(
                            actions.leave(application.postId).then(
                              (BuddyApplication _) => ref.invalidate(
                                buddyMyApplicationsProvider,
                              ),
                            ),
                          ),
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

/// 列表底部：翻页入口 / 翻页错误 / 到底提示。
class _ListFooter extends StatelessWidget {
  const _ListFooter({required this.state, required this.controller});

  final BuddyListState state;
  final BuddyListController controller;

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
              onPressed: () => unawaited(controller.loadMore()),
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
            onPressed: () => unawaited(controller.loadMore()),
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
