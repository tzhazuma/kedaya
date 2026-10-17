import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../domain/models/groupbuy_order.dart';
import '../../../../domain/models/time_text.dart';
import '../../../../presentation/components/money_text.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 拼单卡片。
class GroupbuyOrderCard extends StatelessWidget {
  const GroupbuyOrderCard(
      {required this.order, this.onTap, this.now, super.key});

  final GroupbuyOrder order;
  final VoidCallback? onTap;

  /// 可注入的"当前时间"，让相对时间文案在测试/截图里可复现。
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final DateTime reference = now ?? DateTime.now();
    final String? deadlineText = order.deadline == null
        ? null
        : '${formatDeadline(order.deadline!, now: reference)} · '
            '${DateFormat('MM-dd HH:mm').format(order.deadline!.toLocal())}';

    return Card(
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
                  Expanded(
                    child: Text(
                      order.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: KedaYaTokens.fontSizeMd,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: KedaYaTokens.colorText,
                      ),
                    ),
                  ),
                  const SizedBox(width: KedaYaTokens.space2),
                  _StatusChip(status: order.status),
                ],
              ),
              const SizedBox(height: KedaYaTokens.space2),
              Row(
                children: <Widget>[
                  MoneyText(
                    order.unitPriceFen,
                    style: const TextStyle(
                      fontSize: KedaYaTokens.fontSizeLg,
                      fontWeight: KedaYaTokens.fontWeightBold,
                      color: KedaYaTokens.colorBrandStrong,
                    ),
                  ),
                  const SizedBox(width: KedaYaTokens.space1),
                  const Text(
                    '/ 份',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: KedaYaTokens.colorTextMuted,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    '${order.joinedQuantity}/${order.targetQuantity} 份',
                    style: const TextStyle(
                      fontSize: KedaYaTokens.fontSizeSm,
                      color: KedaYaTokens.colorTextMuted,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: KedaYaTokens.space2),
              ClipRRect(
                borderRadius: BorderRadius.circular(KedaYaTokens.radiusSm),
                child: LinearProgressIndicator(
                    value: order.progress, minHeight: 6),
              ),
              const SizedBox(height: KedaYaTokens.space2),
              Wrap(
                spacing: KedaYaTokens.space3,
                runSpacing: KedaYaTokens.space1,
                children: <Widget>[
                  if (!order.isFull)
                    _Meta(
                        icon: Icons.group_add_outlined,
                        text: '还差 ${order.remainingQuantity} 份'),
                  if (order.isFull)
                    const _Meta(icon: Icons.check_circle_outline, text: '已满员'),
                  if (order.pickupLocation != null)
                    _Meta(
                        icon: Icons.place_outlined,
                        text: order.pickupLocation!),
                  if (deadlineText != null)
                    _Meta(icon: Icons.schedule_outlined, text: deadlineText),
                  if (order.initiatorName != null)
                    _Meta(
                        icon: Icons.person_outline, text: order.initiatorName!),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});

  final GroupbuyStatus status;

  @override
  Widget build(BuildContext context) {
    final Color foreground = switch (status) {
      GroupbuyStatus.recruiting => KedaYaTokens.colorSuccess,
      GroupbuyStatus.locked => KedaYaTokens.colorWarning,
      GroupbuyStatus.completed => KedaYaTokens.colorInfo,
      GroupbuyStatus.cancelled => KedaYaTokens.colorTextMuted,
      GroupbuyStatus.unknown => KedaYaTokens.colorTextMuted,
    };
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: KedaYaTokens.space2,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: foreground.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusSm),
      ),
      child: Text(
        status.label,
        style: TextStyle(
          fontSize: KedaYaTokens.fontSizeXs,
          fontWeight: KedaYaTokens.fontWeightMedium,
          color: foreground,
        ),
      ),
    );
  }
}

class _Meta extends StatelessWidget {
  const _Meta({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(icon, size: 14, color: KedaYaTokens.colorTextMuted),
        const SizedBox(width: 4),
        Text(
          text,
          style: const TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            color: KedaYaTokens.colorTextMuted,
          ),
        ),
      ],
    );
  }
}
