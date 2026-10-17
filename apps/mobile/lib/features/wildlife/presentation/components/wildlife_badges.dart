import 'package:flutter/material.dart';

import '../../../../domain/models/wildlife.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 投喂政策徽章（规格 §8.3：`allowed` 绿 / `discouraged` 黄 / `forbidden` 红）。
///
/// 颜色由 [FeedingPolicy.tone] 这个**语义**映射而来，domain 层不出现任何色值；
/// 亮暗两套自动跟随 [KedaYaColors]。
class WildlifeFeedingBadge extends StatelessWidget {
  const WildlifeFeedingBadge({required this.policy, super.key});

  final FeedingPolicy policy;

  @override
  Widget build(BuildContext context) {
    final Color tone = feedingToneColor(policy, context.kedayaColors);
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space2,
        vertical: KedaYaTokens.space1,
      ),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusPill),
        border: Border.all(color: tone.withValues(alpha: 0.6)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(_feedingIcon(policy), size: 14, color: tone),
          const SizedBox(width: KedaYaTokens.space1),
          Text(
            policy.label,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              fontWeight: KedaYaTokens.fontWeightSemibold,
              color: tone,
            ),
          ),
        ],
      ),
    );
  }
}

/// 语义色 → 设计令牌。**唯一**的颜色映射点（组件与画笔共用）。
Color feedingToneColor(FeedingPolicy policy, KedaYaColors colors) =>
    switch (policy.tone) {
      FeedingBadgeTone.success => colors.success,
      FeedingBadgeTone.warning => colors.warning,
      FeedingBadgeTone.danger => colors.danger,
      FeedingBadgeTone.muted => colors.textMuted,
    };

IconData _feedingIcon(FeedingPolicy policy) => switch (policy) {
      FeedingPolicy.allowed => Icons.check_circle_outline,
      FeedingPolicy.discouraged => Icons.info_outline,
      FeedingPolicy.forbidden => Icons.do_not_disturb_on_outlined,
      FeedingPolicy.unknown => Icons.help_outline,
    };

/// 审核状态徽章（待审核 / 已发布 / 未通过）。
class WildlifeStatusBadge extends StatelessWidget {
  const WildlifeStatusBadge({required this.status, super.key});

  final WildlifeModerationStatus status;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final Color tone = switch (status) {
      WildlifeModerationStatus.published => colors.success,
      WildlifeModerationStatus.pending => colors.warning,
      WildlifeModerationStatus.rejected => colors.danger,
      WildlifeModerationStatus.unknown => colors.textMuted,
    };
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space2,
        vertical: KedaYaTokens.space1,
      ),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusSm),
      ),
      child: Text(
        status.label,
        style: TextStyle(
          fontSize: KedaYaTokens.fontSizeXs,
          fontWeight: KedaYaTokens.fontWeightMedium,
          color: tone,
        ),
      ),
    );
  }
}

/// 通用小标签（物种 / 区域 / 个体名 / 时段）。
class WildlifePill extends StatelessWidget {
  const WildlifePill({
    required this.text,
    this.icon,
    this.tone,
    super.key,
  });

  final String text;
  final IconData? icon;

  /// null = 用中性色（`textMuted`）。
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final Color color = tone ?? colors.textMuted;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space2,
        vertical: KedaYaTokens.space1,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusPill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (icon != null) ...<Widget>[
            Icon(icon, size: 13, color: color),
            const SizedBox(width: KedaYaTokens.space1),
          ],
          Text(
            text,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: color,
              fontWeight: KedaYaTokens.fontWeightMedium,
            ),
          ),
        ],
      ),
    );
  }
}

/// **推断轨迹**的显著标注（规格 §6.1 / §11.3 T18）。
///
/// 这是本模块最重要的一条文案约束：**所有面向用户的轨迹文案必须写"推断"**。
/// 因此它被做成一个**独立组件**，而不是让每个页面自己拼字符串 ——
/// 页面只要用了 [WildlifeInferredTrackBanner]，就不可能漏掉这句话。
class WildlifeInferredTrackBanner extends StatelessWidget {
  const WildlifeInferredTrackBanner({
    required this.disclaimer,
    this.sightingCount,
    this.margin = const EdgeInsets.symmetric(vertical: KedaYaTokens.space2),
    super.key,
  });

  final String disclaimer;
  final int? sightingCount;
  final EdgeInsets margin;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      margin: margin,
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.warning.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.warning.withValues(alpha: 0.5)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(Icons.timeline, size: 18, color: colors.warning),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  '推断轨迹 · 非实测路径',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.warning,
                  ),
                ),
                const SizedBox(height: KedaYaTokens.space1),
                Text(
                  sightingCount == null
                      ? disclaimer
                      : '$disclaimer（基于 $sightingCount 次上报推断）',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.text,
                  ),
                ),
                const SizedBox(height: KedaYaTokens.space1),
                Text(
                  '数据来自同学偶发上报，不是 GPS 项圈；两次上报之间的行踪我们不知道，'
                  '也不会用插值编造。',
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

/// 位置模糊化说明（规格 §9：**不能声称"完全匿名"**，只能说模糊到片区级）。
class WildlifePrivacyNotice extends StatelessWidget {
  const WildlifePrivacyNotice({
    required this.hasGeo,
    this.margin = const EdgeInsets.symmetric(vertical: KedaYaTokens.space2),
    super.key,
  });

  /// 该记录是否公开了坐标（敏感区为 false）。
  final bool hasGeo;

  final EdgeInsets margin;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      margin: margin,
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(Icons.privacy_tip_outlined, size: 16, color: colors.textMuted),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Text(
              hasGeo
                  ? '位置已模糊化到片区级（约百米），不显示精确坐标。'
                  : '该区域是敏感区（宿舍 / 保育区）：只公开所属区域，不公开任何坐标。',
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

/// 热点是**历史聚合**、不是实时位置的说明（规格 §8.1 E10）。
class WildlifeAggregationNotice extends StatelessWidget {
  const WildlifeAggregationNotice({this.delayHours, super.key});

  final int? delayHours;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final int hours = delayHours ?? defaultAggregationDelayHours;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Icon(Icons.schedule, size: 14, color: colors.textMuted),
        const SizedBox(width: KedaYaTokens.space1),
        Expanded(
          child: Text(
            '热点为历史聚合（至少延迟 $hours 小时），不显示实时位置，也不提供聚集围观功能。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.textMuted,
            ),
          ),
        ),
      ],
    );
  }
}

/// 疑似受伤的处置提示（规格 §8.1 E7：**不得自行处理**）。
class WildlifeHealthConcernNotice extends StatelessWidget {
  const WildlifeHealthConcernNotice({super.key});

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.danger.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.danger.withValues(alpha: 0.5)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(Icons.health_and_safety_outlined,
              size: 18, color: colors.danger),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Text(
              wildlifeHealthConcernNotice,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.text,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
