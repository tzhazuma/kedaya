import 'package:flutter/material.dart';

import '../../../../domain/models/wellbeing_booking.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 一条本机预约的卡片。
///
/// 只展示用户自己填写的内容与「已提交（演示）」；不出现咨询师姓名、
/// 诊断结论、风险等级或任何假的排班确认。
class WellbeingBookingCard extends StatelessWidget {
  const WellbeingBookingCard({required this.booking, super.key});

  final WellbeingBooking booking;

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
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Text(
                  '${booking.timeWindow.label} · ${booking.mode.label}',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeMd,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
              ),
              const SizedBox(width: KedaYaTokens.space2),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: KedaYaTokens.space2,
                  vertical: KedaYaTokens.space1,
                ),
                decoration: BoxDecoration(
                  color: colors.brandSoft,
                  borderRadius: BorderRadius.circular(KedaYaTokens.radiusPill),
                ),
                child: Text(
                  booking.status.label,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    fontWeight: KedaYaTokens.fontWeightMedium,
                    color: colors.text,
                  ),
                ),
              ),
            ],
          ),
          if (booking.topic != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              '想聊：${booking.topic}',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.text,
              ),
            ),
          ],
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            '提交时间：${formatWellbeingTimestamp(booking.createdAt)}',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.textMuted,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            booking.contactAllowed ? '联系方式：愿意，由学校心理中心通过校园账号联系' : '联系方式：暂不留下',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.textMuted,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            '本机记录 · 不是真实排班确认',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}
