import 'package:flutter/material.dart';

import '../../../../domain/models/teabreak.dart';
import '../../../../domain/models/time_text.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 茶歇卡片：一条信息在列表里的全部可判读字段。
///
/// 设计取舍：**时效（freshness）与开放程度（access）必须同时可见**，
/// 而且不能只靠颜色区分 —— 徽章一律带文字（色弱 / 截图 / 屏幕阅读器都还能读）。
class TeabreakCard extends StatelessWidget {
  const TeabreakCard({
    required this.teabreak,
    required this.now,
    this.onConfirm,
    this.isConfirming = false,
    super.key,
  });

  final Teabreak teabreak;

  /// 注入「现在」：时效与倒计时都据此计算（测试里可复现）。
  final DateTime now;

  /// 「确认还有」的回调；`null` 表示不显示该按钮（例如已结束）。
  final VoidCallback? onConfirm;

  /// 本次确认请求进行中（防重复点击）。
  final bool isConfirming;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final TeabreakStatus status = teabreak.statusAt(now);
    final bool isOver = status.freshness == TeabreakFreshness.over;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: Text(
                    teabreak.conferenceName,
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeMd,
                      fontWeight: KedaYaTokens.fontWeightSemibold,
                      color: isOver ? colors.textMuted : colors.text,
                      height: KedaYaTokens.lineHeightNormal,
                    ),
                  ),
                ),
                const SizedBox(width: KedaYaTokens.space2),
                TeabreakBadge(
                  text: status.freshness.label,
                  tone: _freshnessTone(status.freshness, colors),
                ),
              ],
            ),
            const SizedBox(height: KedaYaTokens.space2),
            Row(
              children: <Widget>[
                Icon(Icons.place_outlined, size: 16, color: colors.textMuted),
                const SizedBox(width: KedaYaTokens.space1),
                Expanded(
                  child: Text(
                    teabreak.venue,
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeSm,
                      color: colors.textMuted,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: KedaYaTokens.space1),
            Row(
              children: <Widget>[
                Icon(Icons.local_cafe_outlined,
                    size: 16, color: colors.textMuted),
                const SizedBox(width: KedaYaTokens.space1),
                Expanded(
                  child: Text(
                    '茶歇 ${formatTeaWindow(teabreak, now)}',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeSm,
                      color: colors.text,
                    ),
                  ),
                ),
                Text(
                  describeTeabreakTiming(teabreak, status, now),
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    fontWeight: KedaYaTokens.fontWeightMedium,
                    color: status.worthGoing ? colors.brandStrong : colors.textMuted,
                  ),
                ),
              ],
            ),
            const SizedBox(height: KedaYaTokens.space3),
            Wrap(
              spacing: KedaYaTokens.space2,
              runSpacing: KedaYaTokens.space1,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: <Widget>[
                TeabreakBadge(
                  text: teabreak.access.label,
                  tone: _accessTone(teabreak.access, colors),
                  icon: Icons.meeting_room_outlined,
                ),
                Text(
                  describeSinceConfirm(status.sinceLastConfirmMs),
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    color: colors.textMuted,
                  ),
                ),
                if (teabreak.confirms.isNotEmpty)
                  Text(
                    '${teabreak.confirms.length} 人确认过',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: colors.textMuted,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              teabreak.access.hint,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.textMuted,
              ),
            ),
            if (teabreak.note != null) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space2),
              Text(
                teabreak.note!,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.text,
                ),
              ),
            ],
            const SizedBox(height: KedaYaTokens.space3),
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    '${teabreak.postedBy} 发布',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: colors.textMuted,
                    ),
                  ),
                ),
                if (onConfirm != null)
                  FilledButton.tonalIcon(
                    onPressed: isConfirming ? null : onConfirm,
                    icon: isConfirming
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.verified_outlined, size: 16),
                    label: const Text('确认还有'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// 小徽章（文字永远保留 —— 不允许"只靠颜色"表意）。
class TeabreakBadge extends StatelessWidget {
  const TeabreakBadge({
    required this.text,
    required this.tone,
    this.icon,
    super.key,
  });

  final String text;
  final Color tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
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
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (icon != null) ...<Widget>[
            Icon(icon, size: 12, color: tone),
            const SizedBox(width: 3),
          ],
          Text(
            text,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              fontWeight: KedaYaTokens.fontWeightMedium,
              color: tone,
            ),
          ),
        ],
      ),
    );
  }
}

/// 「今天 14:30–15:00」/「昨天 15:30–16:00」/「10月24日 15:30–16:00」。
///
/// 只给时段不够用：昨天的茶歇和今天的茶歇时段可能一模一样，所以非当天的
/// 条目一定带日期前缀。
String formatTeaWindow(Teabreak teabreak, DateTime now) {
  final String prefix = _dayPrefix(teabreak.teaStartsAt, now);
  return '$prefix${_hhmm(teabreak.teaStartsAt)}–${_hhmm(teabreak.teaEndsAt)}';
}

String _dayPrefix(DateTime start, DateTime now) {
  final DateTime localStart = start.isUtc ? start.toLocal() : start;
  final DateTime localNow = now.isUtc ? now.toLocal() : now;
  if (isSameDay(localStart, localNow)) return '今天 ';
  if (isSameDay(localStart, localNow.subtract(const Duration(days: 1)))) {
    return '昨天 ';
  }
  return '${localStart.month}月${localStart.day}日 ';
}

String _hhmm(DateTime value) {
  final DateTime local = value.isUtc ? value.toLocal() : value;
  final String hour = local.hour.toString().padLeft(2, '0');
  final String minute = local.minute.toString().padLeft(2, '0');
  return '$hour:$minute';
}

Color _freshnessTone(TeabreakFreshness freshness, KedaYaColors colors) =>
    switch (freshness) {
      TeabreakFreshness.fresh => colors.success,
      TeabreakFreshness.stale => colors.warning,
      TeabreakFreshness.notStarted => colors.info,
      TeabreakFreshness.over => colors.textMuted,
    };

Color _accessTone(TeabreakAccess access, KedaYaColors colors) =>
    switch (access) {
      TeabreakAccess.open => colors.success,
      TeabreakAccess.registered => colors.warning,
      TeabreakAccess.unknown => colors.textMuted,
    };
