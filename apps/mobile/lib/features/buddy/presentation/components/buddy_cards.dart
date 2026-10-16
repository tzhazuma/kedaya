import 'package:flutter/material.dart';

import '../../../../domain/models/buddy.dart';
import '../../../../domain/models/buddy_application.dart';
import '../../../../domain/models/buddy_matching.dart';
import '../../../../domain/models/buddy_profile.dart';
import '../../../../domain/models/buddy_tags.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// `buddy` 的活动图标（纯展示映射）。
IconData buddyActivityIcon(BuddyActivity activity) => switch (activity) {
  BuddyActivity.sport => Icons.sports_tennis_outlined,
  BuddyActivity.study => Icons.menu_book_outlined,
  BuddyActivity.meal => Icons.restaurant_outlined,
  BuddyActivity.travel => Icons.directions_transit_outlined,
  BuddyActivity.game => Icons.casino_outlined,
  BuddyActivity.other => Icons.groups_outlined,
};

/// 三板块分栏的 chip 条（**只有三个真实板块**，契约 §11.10-G 不含 dating）。
class BuddySectionChipBar extends StatelessWidget {
  const BuddySectionChipBar({
    required this.selected,
    required this.onSelected,
    super.key,
  });

  final BuddySection selected;
  final ValueChanged<BuddySection> onSelected;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return SizedBox(
      height: 52,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
          horizontal: KedaYaTokens.space4,
          vertical: KedaYaTokens.space2,
        ),
        children: <Widget>[
          for (final BuddySection section in buddyMatchableSections) ...<Widget>[
            if (section != buddyMatchableSections.first)
              const SizedBox(width: KedaYaTokens.space2),
            ChoiceChip(
              label: Text(section.label),
              selected: selected == section,
              showCheckmark: false,
              onSelected: (bool _) => onSelected(section),
              backgroundColor: colors.surfaceAlt,
              selectedColor: colors.brandSoft,
              side: BorderSide(color: colors.border),
              labelStyle: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                fontWeight: selected == section
                    ? KedaYaTokens.fontWeightSemibold
                    : KedaYaTokens.fontWeightRegular,
                color: selected == section ? colors.brandStrong : colors.textMuted,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// 状态徽标（`OPEN` 之外的状态才显示，避免列表里满屏"招募中"）。
class BuddyStatusBadge extends StatelessWidget {
  const BuddyStatusBadge({required this.status, super.key});

  final BuddyPostStatus status;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final Color tint = switch (status) {
      BuddyPostStatus.open => colors.success,
      BuddyPostStatus.full => colors.warning,
      BuddyPostStatus.closed => colors.textMuted,
      BuddyPostStatus.expired => colors.textMuted,
      BuddyPostStatus.cancelled => colors.danger,
      BuddyPostStatus.unknown => colors.danger,
    };
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space2,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusSm),
        border: Border.all(color: colors.border),
      ),
      child: Text(
        status.label,
        style: TextStyle(
          fontSize: KedaYaTokens.fontSizeXs,
          fontWeight: KedaYaTokens.fontWeightMedium,
          color: tint,
        ),
      ),
    );
  }
}

/// 活动卡片（列表 / 详情头部 / 推荐卡共用）。
class BuddyPostCard extends StatelessWidget {
  const BuddyPostCard({
    required this.post,
    this.onTap,
    this.trailing,
    this.showDescription = false,
    super.key,
  });

  final BuddyPost post;
  final VoidCallback? onTap;

  /// 右上角附加内容（推荐卡放分数、详情页留空）。
  final Widget? trailing;

  final bool showDescription;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Card(
      margin: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        child: Padding(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Icon(
                    buddyActivityIcon(post.activity),
                    size: 20,
                    color: colors.brandStrong,
                  ),
                  const SizedBox(width: KedaYaTokens.space2),
                  Expanded(
                    child: Text(
                      post.title,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeMd,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: colors.text,
                      ),
                    ),
                  ),
                  if (trailing != null) ...<Widget>[
                    const SizedBox(width: KedaYaTokens.space2),
                    trailing!,
                  ],
                ],
              ),
              const SizedBox(height: KedaYaTokens.space2),
              Row(
                children: <Widget>[
                  _MetaChip(label: post.section.label),
                  const SizedBox(width: KedaYaTokens.space2),
                  _MetaChip(label: post.activity.label),
                  if (post.status != BuddyPostStatus.open) ...<Widget>[
                    const SizedBox(width: KedaYaTokens.space2),
                    BuddyStatusBadge(status: post.status),
                  ],
                ],
              ),
              const SizedBox(height: KedaYaTokens.space3),
              _MetaRow(
                icon: Icons.schedule_outlined,
                text: buddyLocalFullLabel(post.startsAt) +
                    (post.durationMin == null ? '' : ' · ${post.durationMin} 分钟'),
              ),
              const SizedBox(height: KedaYaTokens.space1),
              _MetaRow(icon: Icons.place_outlined, text: post.location),
              const SizedBox(height: KedaYaTokens.space1),
              _MetaRow(
                icon: Icons.group_outlined,
                text: '${post.seatsLabel} · '
                    '${post.isFull ? '已满员' : '还缺 ${post.remainingSeats} 人'}',
              ),
              if (post.genderPreference != BuddyGenderPreference.any) ...<Widget>[
                const SizedBox(height: KedaYaTokens.space1),
                _MetaRow(
                  icon: Icons.wc_outlined,
                  text: '限${post.genderPreference.label}参加',
                ),
              ],
              if (post.minSkillLevel != null) ...<Widget>[
                const SizedBox(height: KedaYaTokens.space1),
                _MetaRow(
                  icon: Icons.trending_up_outlined,
                  text: '要求至少「${post.minSkillLevel!.label}」水平',
                ),
              ],
              if (showDescription &&
                  post.description != null &&
                  post.description!.isNotEmpty) ...<Widget>[
                const SizedBox(height: KedaYaTokens.space3),
                Text(
                  post.description!,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.textMuted,
                  ),
                ),
              ],
              if (post.tags.isNotEmpty) ...<Widget>[
                const SizedBox(height: KedaYaTokens.space3),
                Wrap(
                  spacing: KedaYaTokens.space2,
                  runSpacing: KedaYaTokens.space1,
                  children: <Widget>[
                    for (final String tag in post.tags)
                      _MetaChip(label: buddyTagLabel(tag)),
                  ],
                ),
              ],
              const SizedBox(height: KedaYaTokens.space3),
              Text(
                '发起人：${post.creator.displayName}',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  color: colors.textMuted,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 推荐卡片 —— **必须展示理由**（规格 §1.1 G3：推荐是可解释的）。
///
/// 规格 §5.7 明确要求 `matchMode` 必须暴露、让前端能诚实展示：
/// `rule` 模式下不得声称"为你智能推荐"，因此这里展示 [BuddyMatchMode.notice]。
class BuddyRecommendationCard extends StatelessWidget {
  const BuddyRecommendationCard({
    required this.recommendation,
    required this.matchMode,
    this.onTap,
    this.onFeedback,
    this.busy = false,
    super.key,
  });

  final BuddyRecommendation recommendation;
  final BuddyMatchMode matchMode;
  final VoidCallback? onTap;

  /// like / dislike / skip（规格 §5.8）。
  final ValueChanged<BuddyMatchFeedbackAction>? onFeedback;

  final bool busy;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        BuddyPostCard(
          post: recommendation.post,
          onTap: onTap,
          trailing: _ScoreBadge(
            percent: recommendation.percent,
            degraded: matchMode.isDegraded,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space2),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(KedaYaTokens.space3),
          decoration: BoxDecoration(
            color: colors.surfaceAlt,
            borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
            border: Border.all(color: colors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Icon(Icons.tips_and_updates_outlined, size: 16, color: colors.info),
                  const SizedBox(width: KedaYaTokens.space1),
                  Text(
                    '推荐理由',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      fontWeight: KedaYaTokens.fontWeightSemibold,
                      color: colors.info,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: KedaYaTokens.space1),
              Text(
                recommendation.reason,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.text,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space1),
              Text(
                matchMode.notice,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  color: colors.textMuted,
                ),
              ),
              if (onFeedback != null) ...<Widget>[
                const SizedBox(height: KedaYaTokens.space3),
                Row(
                  children: <Widget>[
                    _FeedbackButton(
                      icon: Icons.thumb_up_outlined,
                      label: '感兴趣',
                      onPressed: busy
                          ? null
                          : () => onFeedback!(BuddyMatchFeedbackAction.like),
                    ),
                    const SizedBox(width: KedaYaTokens.space2),
                    _FeedbackButton(
                      icon: Icons.thumb_down_outlined,
                      label: '不感兴趣',
                      onPressed: busy
                          ? null
                          : () => onFeedback!(BuddyMatchFeedbackAction.dislike),
                    ),
                    const SizedBox(width: KedaYaTokens.space2),
                    _FeedbackButton(
                      icon: Icons.skip_next_outlined,
                      label: '跳过',
                      onPressed: busy
                          ? null
                          : () => onFeedback!(BuddyMatchFeedbackAction.skip),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// 一条申请的卡片。
///
/// 规格 §6.1：申请人列表只有**发起人**与**申请人本人**能看到；
/// 规格 §5.6：拒绝**不给出理由**（发起人无义务解释，且理由文本会成为骚扰面）。
class BuddyApplicationTile extends StatelessWidget {
  const BuddyApplicationTile({
    required this.application,
    required this.isCreator,
    this.onAccept,
    this.onReject,
    this.onWithdraw,
    this.busy = false,
    super.key,
  });

  final BuddyApplication application;

  /// 我是否是这条申请所属帖子的发起人。
  final bool isCreator;

  final VoidCallback? onAccept;
  final VoidCallback? onReject;
  final VoidCallback? onWithdraw;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  application.displayName,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
              ),
              _MetaChip(label: application.status.label),
            ],
          ),
          if (application.message != null && application.message!.isNotEmpty) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              application.message!,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.textMuted,
              ),
            ),
          ],
          if (isCreator && application.isPending) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space3),
            Row(
              children: <Widget>[
                FilledButton(
                  onPressed: busy ? null : onAccept,
                  child: const Text('接受'),
                ),
                const SizedBox(width: KedaYaTokens.space2),
                OutlinedButton(
                  onPressed: busy ? null : onReject,
                  child: const Text('拒绝'),
                ),
                const Spacer(),
                Text(
                  '拒绝不会通知理由',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    color: colors.textMuted,
                  ),
                ),
              ],
            ),
          ],
          if (!isCreator && application.isPending && onWithdraw != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space3),
            OutlinedButton(
              onPressed: busy ? null : onWithdraw,
              child: const Text('撤回申请'),
            ),
          ],
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------ 内部

class _MetaRow extends StatelessWidget {
  const _MetaRow({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Icon(icon, size: 16, color: colors.textMuted),
        const SizedBox(width: KedaYaTokens.space2),
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              color: colors.textMuted,
            ),
          ),
        ),
      ],
    );
  }
}

class _MetaChip extends StatelessWidget {
  const _MetaChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space2,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusSm),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: KedaYaTokens.fontSizeXs,
          color: colors.textMuted,
        ),
      ),
    );
  }
}

class _ScoreBadge extends StatelessWidget {
  const _ScoreBadge({required this.percent, required this.degraded});

  final int percent;

  /// 降级档（`hash` / `rule` / `unknown`）下不展示"匹配度"这种暗示语义能力的措辞。
  final bool degraded;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: <Widget>[
        Text(
          degraded ? '规则分' : '匹配度',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            color: colors.textMuted,
          ),
        ),
        Text(
          '$percent',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeLg,
            fontWeight: KedaYaTokens.fontWeightBold,
            color: colors.brandStrong,
          ),
        ),
      ],
    );
  }
}

class _FeedbackButton extends StatelessWidget {
  const _FeedbackButton({
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => Expanded(
    child: OutlinedButton.icon(
      onPressed: onPressed,
      icon: Icon(icon, size: 16),
      label: Text(
        label,
        style: const TextStyle(fontSize: KedaYaTokens.fontSizeXs),
      ),
    ),
  );
}
