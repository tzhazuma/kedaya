import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../application/session_controller.dart';
import '../../../../domain/models/buddy.dart';
import '../../../../domain/models/buddy_matching.dart';
import '../../../../presentation/components/async_state_view.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/buddy_providers.dart';
import '../components/buddy_cards.dart';

/// 主动推荐页（规格 §5.7）。
///
/// **本页最重要的约束：展示理由，不只给分数**（规格 §1.1 G3：
/// 「推荐是**可解释**的 —— 每条推荐必须给出中文理由」）。
/// 因此每张卡片都带「推荐理由」区块；分数只是辅助。
///
/// 第二个约束是**诚实**：`matchMode` 必须暴露，`rule` / `hash` 降级档下
/// 不得声称"为你智能推荐"（规格 §5.7 原话：「让前端能诚实展示」）。
class BuddyRecommendPage extends ConsumerWidget {
  const BuddyRecommendPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<BuddyRecommendState> value = ref.watch(
      buddyRecommendControllerProvider,
    );
    final BuddyRecommendController controller = ref.read(
      buddyRecommendControllerProvider.notifier,
    );
    final BuddySection section = ref.watch(buddySectionFilterProvider);
    final String? myUserId =
        ref.watch(sessionControllerProvider).valueOrNull?.user.userId;

    return Scaffold(
      appBar: AppBar(
        title: const Text('为你推荐'),
        actions: <Widget>[
          IconButton(
            tooltip: '我的匹配资料',
            onPressed: () => context.push('/buddy/profile'),
            icon: const Icon(Icons.tune_outlined),
          ),
          IconButton(
            tooltip: '刷新',
            onPressed: () => unawaited(controller.refresh()),
            icon: const Icon(Icons.refresh),
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
              child: AsyncStateView<BuddyRecommendState>(
                value: value,
                isEmpty: (BuddyRecommendState state) => state.isEmpty,
                emptyTitle: '这个板块暂时没有可推荐的活动',
                emptyDescription: '可以先去「我的匹配资料」补充兴趣与可用时段，'
                    '或者直接看活动列表。',
                loadingMessage: '正在计算推荐…',
                onRetry: controller.refresh,
                builder: (BuildContext context, BuddyRecommendState state) =>
                    NotificationListener<ScrollNotification>(
                  onNotification: (ScrollNotification notification) {
                    if (notification.metrics.extentAfter < 240) {
                      unawaited(controller.loadMore());
                    }
                    return false;
                  },
                  child: ListView.separated(
                    padding: const EdgeInsets.all(KedaYaTokens.space4),
                    itemCount: state.items.length + 2,
                    separatorBuilder: (BuildContext context, int index) =>
                        const SizedBox(height: KedaYaTokens.space3),
                    itemBuilder: (BuildContext context, int index) {
                      if (index == 0) {
                        return _MatchModeNotice(mode: state.matchMode);
                      }
                      if (index == state.items.length + 1) {
                        return _ListFooter(
                            state: state, controller: controller);
                      }
                      final BuddyRecommendation recommendation =
                          state.items[index - 1];
                      return BuddyRecommendationCard(
                        recommendation: recommendation,
                        matchMode: state.matchMode,
                        onTap: () =>
                            context.push('/buddy/${recommendation.post.id}'),
                        onFeedback: (BuddyMatchFeedbackAction action) =>
                            unawaited(
                          _sendFeedback(
                            context,
                            ref,
                            recommendation: recommendation,
                            section: state.section,
                            action: action,
                            myUserId: myUserId,
                          ),
                        ),
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

  Future<void> _sendFeedback(
    BuildContext context,
    WidgetRef ref, {
    required BuddyRecommendation recommendation,
    required BuddySection section,
    required BuddyMatchFeedbackAction action,
    required String? myUserId,
  }) async {
    try {
      await ref.read(buddyActionsProvider).submitFeedback(
            BuddyMatchFeedback(
              // 反馈者由服务端从 JWT 取；这里只是为了满足模型的必填字段。
              userId: myUserId ?? '',
              targetPostId: recommendation.post.id,
              section: section,
              action: action,
              createdAt: DateTime.now(),
            ),
          );
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('已记录「${action.label}」，下次推荐会体现')),
      );
    } on Object catch (error) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('$error')));
    }
  }
}

/// 匹配模式提示条 —— 诚实展示当前推荐是怎么算出来的（规格 §5.7）。
class _MatchModeNotice extends StatelessWidget {
  const _MatchModeNotice({required this.mode});

  final BuddyMatchMode mode;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            mode.isDegraded ? Icons.info_outline : Icons.auto_awesome,
            size: 18,
            color: mode.isDegraded ? colors.warning : colors.brandStrong,
          ),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  mode.notice,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
                const SizedBox(height: KedaYaTokens.space1),
                Text(
                  '推荐模式：${mode.wire}（服务端下发，客户端不改写）。'
                  '没填匹配资料时不会报错，而是按开始时间排序。',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.textMuted,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ListFooter extends StatelessWidget {
  const _ListFooter({required this.state, required this.controller});

  final BuddyRecommendState state;
  final BuddyRecommendController controller;

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
              style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm, color: colors.danger),
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
          '没有更多推荐了',
          style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs, color: colors.textMuted),
        ),
      ),
    );
  }
}
