import 'package:flutter/material.dart';

import '../../../../domain/models/facility_booking.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 所有场馆预约页面都必须出现的演示声明。
///
/// 文案固定包含「演示数据：不会真的锁定场馆」—— 这是产品要求，
/// 不能让用户以为在这里点一下，体育馆的门就真的为他留着了。
class FacilityDemoNotice extends StatelessWidget {
  const FacilityDemoNotice({super.key});

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.info.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.info.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(Icons.science_outlined, size: 18, color: colors.info),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  '演示数据：不会真的锁定场馆',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '预约只保存在本次运行的内存里，退出应用后清空；'
                  '真实预约仍需走学校场馆系统。',
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

/// 预约状态徽章：文字永远保留，不靠颜色单独表意。
class FacilityStatusBadge extends StatelessWidget {
  const FacilityStatusBadge({required this.status, super.key});

  final FacilityBookingStatus status;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final Color tone = status.isActive ? colors.success : colors.textMuted;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space2,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusPill),
        border: Border.all(color: tone.withValues(alpha: 0.4)),
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

/// 场馆图标（纯展示映射；领域模型不依赖 Flutter）。
IconData facilityVenueIcon(String venueId) => switch (venueId) {
      'badminton' => Icons.sports_tennis,
      'basketball' => Icons.sports_basketball,
      'gym' => Icons.fitness_center,
      'study-room' => Icons.menu_book_outlined,
      'discussion-room' => Icons.groups_outlined,
      'piano-room' => Icons.piano,
      _ => Icons.meeting_room_outlined,
    };

/// 小圆角信息块（详情页的「场馆信息」与表单摘要共用）。
class FacilityInfoPanel extends StatelessWidget {
  const FacilityInfoPanel({
    required this.child,
    this.tone,
    super.key,
  });

  final Widget child;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final Color background = tone ?? colors.surfaceAlt;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
      ),
      child: child,
    );
  }
}
