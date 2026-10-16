import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../application/session_controller.dart';
import '../../../../domain/models/buddy.dart';
import '../../../../domain/models/buddy_application.dart';
import '../../../../presentation/components/async_state_view.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/buddy_providers.dart';
import '../components/buddy_cards.dart';

/// 活动详情 + **申请 / 审批 / 关闭**（规格 §5.5 / §5.6 / §6.1 / §6.2）。
///
/// 三种视角在同一个页面里按「我是不是发起人」分叉：
///
/// | 视角 | 能看到什么 |
/// | --- | --- |
/// | 发起人 | 申请列表（含 `message`）+ 接受/拒绝 + 关闭活动 |
/// | 申请人本人 | 自己的申请状态（可撤回）+ 申请入口 |
/// | 其他已登录用户 | 活动信息 + 申请入口；**看不到**任何人的申请与联系方式 |
class BuddyPostDetailPage extends ConsumerWidget {
  const BuddyPostDetailPage({required this.postId, super.key});

  final String postId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<BuddyPost> post = ref.watch(buddyPostProvider(postId));
    final String? myUserId = ref.watch(sessionControllerProvider).valueOrNull?.user.userId;

    return Scaffold(
      appBar: AppBar(
        title: const Text('活动详情'),
        actions: <Widget>[
          IconButton(
            tooltip: '刷新',
            onPressed: () {
              ref.invalidate(buddyPostProvider(postId));
              ref.invalidate(buddyPostApplicationsProvider(postId));
              ref.invalidate(buddyMyApplicationsProvider);
            },
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: AsyncStateView<BuddyPost>(
        value: post,
        onRetry: () => ref.invalidate(buddyPostProvider(postId)),
        emptyTitle: '这个活动不存在或不可见',
        emptyDescription: '它可能已被取消，或者链接失效了。',
        loadingMessage: '正在加载活动…',
        builder: (BuildContext context, BuddyPost value) => ListView(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          children: <Widget>[
            BuddyPostCard(post: value, showDescription: true),
            const SizedBox(height: KedaYaTokens.space4),
            const _ContactExchangeNotice(),
            const SizedBox(height: KedaYaTokens.space4),
            if (myUserId != null && value.isCreatedBy(myUserId))
              _CreatorSection(post: value)
            else
              _ApplicantSection(post: value, myUserId: myUserId),
            const SizedBox(height: KedaYaTokens.space5),
            const _ProfilePrivacyNotice(),
          ],
        ),
      ),
    );
  }
}

/// 规格 §6.2：联系方式**不存**在 `BuddyPost` 上，只在申请被 `ACCEPTED` 后
/// 通过 `notifications` 交换。
class _ContactExchangeNotice extends StatelessWidget {
  const _ContactExchangeNotice();

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
        border: Border.all(color: colors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(Icons.lock_outline, size: 18, color: colors.info),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Text(
              '活动说明里不允许填写联系方式（会被拒绝），页面也不展示任何人的联系方式。'
              '申请被发起人接受后，系统会通过站内通知帮双方交换（规格 §6.2）。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.textMuted,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 规格 §6.1：`BuddyProfile` 对**任何人**都不可见，包括发帖人；
/// 它只被算法使用，输出只有分数 + 聚合后的理由短语。
class _ProfilePrivacyNotice extends StatelessWidget {
  const _ProfilePrivacyNotice();

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Text(
      '匹配资料（兴趣 / 可用时段）对任何人都不直接可见，包括发起人 —— '
      '它只被算法使用，展示出来的只有「推荐理由」这种聚合短语（规格 §6.1）。',
      style: TextStyle(
        fontSize: KedaYaTokens.fontSizeXs,
        height: KedaYaTokens.lineHeightNormal,
        color: colors.textMuted,
      ),
    );
  }
}

// ------------------------------------------------------------------ 发起人视角

class _CreatorSection extends ConsumerWidget {
  const _CreatorSection({required this.post});

  final BuddyPost post;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final AsyncValue<List<BuddyApplication>> applications = ref.watch(
      buddyPostApplicationsProvider(post.id),
    );
    final BuddyActions actions = ref.read(buddyActionsProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          '我发布的',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: colors.text,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space2),
        Row(
          children: <Widget>[
            Expanded(
              child: OutlinedButton.icon(
                onPressed: post.status.canBeClosed
                    ? () => unawaited(
                        _runAction(context, () async {
                          await actions.closePost(post.id);
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('活动已关闭')),
                            );
                          }
                        }),
                      )
                    : null,
                icon: const Icon(Icons.lock_outline, size: 18),
                label: Text(
                  post.status.canBeClosed ? '关闭招募' : '当前状态不能关闭',
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: KedaYaTokens.space5),
        Text(
          '收到的申请',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: colors.text,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space1),
        Text(
          '规格 §5.6：接受后名额 +1（满员自动转「已满员」）；拒绝**不给出理由**。',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            color: colors.textMuted,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space3),
        AsyncStateView<List<BuddyApplication>>(
          value: applications,
          isEmpty: (List<BuddyApplication> items) => items.isEmpty,
          emptyTitle: '还没有人申请',
          emptyDescription: '把链接分享给同学，或者等推荐把人带来。',
          onRetry: () => ref.invalidate(buddyPostApplicationsProvider(post.id)),
          builder: (BuildContext context, List<BuddyApplication> items) => Column(
            children: <Widget>[
              for (final BuddyApplication application in items) ...<Widget>[
                BuddyApplicationTile(
                  application: application,
                  isCreator: true,
                  onAccept: () => unawaited(
                    _runAction(
                      context,
                      () => actions.decide(
                        BuddyDecideCommand(
                          postId: post.id,
                          applicationId: application.id,
                          decision: BuddyDecision.accepted,
                        ),
                      ),
                    ),
                  ),
                  onReject: () => unawaited(
                    _runAction(
                      context,
                      () => actions.decide(
                        BuddyDecideCommand(
                          postId: post.id,
                          applicationId: application.id,
                          decision: BuddyDecision.rejected,
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: KedaYaTokens.space2),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

// ------------------------------------------------------------------ 申请人视角

class _ApplicantSection extends ConsumerWidget {
  const _ApplicantSection({required this.post, required this.myUserId});

  final BuddyPost post;
  final String? myUserId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final AsyncValue<List<BuddyApplication>> mine = ref.watch(buddyMyApplicationsProvider);
    final BuddyActions actions = ref.read(buddyActionsProvider);
    final List<BuddyApplication> items = mine.valueOrNull ?? const <BuddyApplication>[];
    final BuddyApplication? application = _find(items, post.id, myUserId);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        if (application != null) ...<Widget>[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(KedaYaTokens.space4),
            decoration: BoxDecoration(
              color: colors.surface,
              borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
              border: Border.all(color: colors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  '我的申请：${application.status.label}',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
                if (application.status == BuddyApplicationStatus.accepted) ...<Widget>[
                  const SizedBox(height: KedaYaTokens.space1),
                  Text(
                    '已加入。联系方式会通过站内通知交换（规格 §6.2）。',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: colors.textMuted,
                    ),
                  ),
                ],
                if (application.status == BuddyApplicationStatus.rejected) ...<Widget>[
                  const SizedBox(height: KedaYaTokens.space1),
                  Text(
                    '发起人没有接受这次申请（不会给出理由）。',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: colors.textMuted,
                    ),
                  ),
                ],
                if (application.isPending) ...<Widget>[
                  const SizedBox(height: KedaYaTokens.space3),
                  OutlinedButton(
                    onPressed: () => unawaited(
                      _runAction(context, () => actions.leave(post.id)),
                    ),
                    child: const Text('撤回申请'),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
        ],
        if (post.canJoin && (application == null || !application.isPending))
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: () => unawaited(_openJoinSheet(context, ref, post)),
              icon: const Icon(Icons.person_add_alt, size: 18),
              label: const Text('申请加入'),
            ),
          )
        else if (!post.canJoin)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(KedaYaTokens.space4),
            decoration: BoxDecoration(
              color: colors.surfaceAlt,
              borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
            ),
            child: Text(
              switch (post.status) {
                BuddyPostStatus.full => '这个活动已经满员了。',
                BuddyPostStatus.closed => '发起人已经关闭了招募。',
                BuddyPostStatus.expired => '这个活动已经过期了。',
                BuddyPostStatus.cancelled => '这个活动已被取消。',
                BuddyPostStatus.open => '这个活动暂时不能申请。',
                BuddyPostStatus.unknown => '这个活动状态未知，暂不能申请。',
              },
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                color: colors.textMuted,
              ),
            ),
          ),
      ],
    );
  }

  BuddyApplication? _find(
    List<BuddyApplication> items,
    String postId,
    String? myUserId,
  ) {
    for (final BuddyApplication item in items) {
      if (item.postId != postId) continue;
      // 未登录时无从判断归属，退化为"第一个同帖申请"
      // （服务端本就不会下发别人的申请，规格 §6.1）。
      if (myUserId == null || item.isFrom(myUserId)) return item;
    }
    return null;
  }

  Future<void> _openJoinSheet(
    BuildContext context,
    WidgetRef ref,
    BuddyPost post,
  ) async {
    final BuddyActions actions = ref.read(buddyActionsProvider);
    final String? message = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext sheetContext) => const _JoinSheet(),
    );
    if (message == null || !context.mounted) return;
    await _runAction(
      context,
      () => actions.join(
        BuddyJoinCommand(
          postId: post.id,
          message: message.isEmpty ? null : message,
        ),
      ),
    );
  }
}

/// 申请留言输入（可选，≤200 字，且**不允许**写联系方式 —— 规格 §6.2/§6.4）。
class _JoinSheet extends StatefulWidget {
  const _JoinSheet();

  @override
  State<_JoinSheet> createState() => _JoinSheetState();
}

class _JoinSheetState extends State<_JoinSheet> {
  final TextEditingController _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final String message = _controller.text;
    final String? error = BuddyJoinCommand(message: message).messageError;

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: KedaYaTokens.space4,
          right: KedaYaTokens.space4,
          top: KedaYaTokens.space4,
          bottom: MediaQuery.viewInsetsOf(context).bottom + KedaYaTokens.space4,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              '申请加入',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeMd,
                fontWeight: KedaYaTokens.fontWeightSemibold,
                color: colors.text,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space1),
            Text(
              '留言只有发起人能看到。不要写联系方式 —— 通过后系统会自动交换（规格 §6.2）。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.textMuted,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space3),
            TextField(
              controller: _controller,
              maxLines: 3,
              maxLength: buddyApplicationMessageMaxLength,
              onChanged: (String _) => setState(() {}),
              decoration: const InputDecoration(
                hintText: '例如：我也常打，一起？',
                border: OutlineInputBorder(),
              ),
            ),
            if (error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: KedaYaTokens.space2),
                child: Text(
                  error,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    color: colors.danger,
                  ),
                ),
              ),
            Row(
              children: <Widget>[
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('取消'),
                  ),
                ),
                const SizedBox(width: KedaYaTokens.space3),
                Expanded(
                  child: FilledButton(
                    onPressed: error != null
                        ? null
                        : () => Navigator.of(context).pop(message.trim()),
                    child: const Text('提交申请'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// 统一的动作包装：失败时把 `ApiException` 的**用户可读文案**弹出来。
Future<void> _runAction(BuildContext context, Future<void> Function() action) async {
  try {
    await action();
  } on Object catch (error) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$error')));
  }
}
