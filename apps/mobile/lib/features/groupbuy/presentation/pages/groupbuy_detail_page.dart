import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../../domain/models/api_error.dart';
import '../../../../domain/models/groupbuy_order.dart';
import '../../../../domain/models/money.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/components/money_text.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/groupbuy_providers.dart';

/// 拼单详情页。
///
/// 三态：loading（骨架）/ error（可重试）/ empty（`NOT_FOUND` → "已下架或不存在"）。
class GroupbuyDetailPage extends ConsumerWidget {
  const GroupbuyDetailPage({required this.orderId, super.key});

  final String orderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<GroupbuyOrder> value = ref.watch(groupbuyDetailProvider(orderId));
    return KedaYaPageScaffold(
      title: '拼单详情',
      padding: EdgeInsets.zero,
      child: value.when(
        data: (GroupbuyOrder order) => _DetailBody(order: order),
        loading: () => const KedaYaLoadingState(message: '正在加载拼单详情…'),
        error: (Object error, StackTrace stackTrace) => _buildError(context, ref, error),
      ),
    );
  }

  Widget _buildError(BuildContext context, WidgetRef ref, Object error) {
    // "不存在/已下架"是空态，不是错误态。
    if (error is ApiException && error.code == ApiErrorCode.notFound) {
      return const KedaYaEmptyState(
        title: '该拼单不存在或已下架',
        description: '它可能已被发起人取消，或已超过截止时间。',
        icon: Icons.remove_shopping_cart_outlined,
      );
    }
    return KedaYaErrorState(
      error: error,
      onRetry: () => ref.invalidate(groupbuyDetailProvider(orderId)),
    );
  }
}

class _DetailBody extends StatelessWidget {
  const _DetailBody({required this.order});

  final GroupbuyOrder order;

  @override
  Widget build(BuildContext context) {
    final DateFormat dateFormat = DateFormat('yyyy-MM-dd HH:mm');
    return ListView(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      children: <Widget>[
        Text(
          order.title,
          style: const TextStyle(
            fontSize: KedaYaTokens.fontSizeXl,
            fontWeight: KedaYaTokens.fontWeightBold,
            color: KedaYaTokens.colorText,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space2),
        Row(
          children: <Widget>[
            _Pill(text: order.status.label),
            const SizedBox(width: KedaYaTokens.space2),
            if (order.isFull) const _Pill(text: '已满员'),
          ],
        ),
        const SizedBox(height: KedaYaTokens.space5),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(KedaYaTokens.space4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: <Widget>[
                    MoneyText(
                      order.unitPriceFen,
                      style: const TextStyle(
                        fontSize: KedaYaTokens.fontSizeDisplay,
                        fontWeight: KedaYaTokens.fontWeightBold,
                        color: KedaYaTokens.colorBrandStrong,
                      ),
                    ),
                    const SizedBox(width: KedaYaTokens.space1),
                    const Padding(
                      padding: EdgeInsets.only(bottom: 6),
                      child: Text(
                        '/ 份',
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeSm,
                          color: KedaYaTokens.colorTextMuted,
                        ),
                      ),
                    ),
                    const Spacer(),
                    Text(
                      '成团总额 ¥${order.totalYuan}',
                      style: const TextStyle(
                        fontSize: KedaYaTokens.fontSizeSm,
                        color: KedaYaTokens.colorTextMuted,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: KedaYaTokens.space4),
                ClipRRect(
                  borderRadius: BorderRadius.circular(KedaYaTokens.radiusSm),
                  child: LinearProgressIndicator(value: order.progress, minHeight: 8),
                ),
                const SizedBox(height: KedaYaTokens.space2),
                Text(
                  '已参团 ${order.joinedQuantity} 份 / 目标 ${order.targetQuantity} 份'
                  '${order.isFull ? '' : ' · 还差 ${order.remainingQuantity} 份'}',
                  style: const TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    color: KedaYaTokens.colorTextMuted,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: KedaYaTokens.space4),
        if (order.description != null) ...<Widget>[
          const _FieldLabel('说明'),
          Text(
            order.description!,
            style: const TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              height: KedaYaTokens.lineHeightLoose,
              color: KedaYaTokens.colorText,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space4),
        ],
        const _FieldLabel('取货地点'),
        Text(
          order.pickupLocation ?? '未填写',
          style: const TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            color: KedaYaTokens.colorText,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space4),
        const _FieldLabel('截止时间'),
        Text(
          order.deadline == null
              ? '未设置'
              : '${dateFormat.format(order.deadline!.toLocal())}'
                    '${order.isExpiredAt(DateTime.now()) ? '（已截止）' : ''}',
          style: const TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            color: KedaYaTokens.colorText,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space4),
        const _FieldLabel('发起人'),
        Text(
          order.initiatorName ?? order.initiatorId ?? '未知',
          style: const TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            color: KedaYaTokens.colorText,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space6),
        _JoinButton(order: order),
        const SizedBox(height: KedaYaTokens.space3),
        Text(
          '金额单位为整数分（契约 §6.1），展示时才转元：'
          '${order.unitPriceFen} 分 = ¥${Money.fenToYuan(order.unitPriceFen)}',
          style: const TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            color: KedaYaTokens.colorTextMuted,
          ),
        ),
      ],
    );
  }
}

/// 参团按钮：自带 busy 态与错误提示（写操作的失败必须可见）。
class _JoinButton extends ConsumerStatefulWidget {
  const _JoinButton({required this.order});

  final GroupbuyOrder order;

  @override
  ConsumerState<_JoinButton> createState() => _JoinButtonState();
}

class _JoinButtonState extends ConsumerState<_JoinButton> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final GroupbuyOrder order = widget.order;
    final bool canJoin = order.status == GroupbuyStatus.recruiting && !order.isFull;
    return SizedBox(
      width: double.infinity,
      child: FilledButton(
        onPressed: !canJoin || _busy ? null : _join,
        child: _busy
            ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : Text(canJoin ? '参团 1 份' : '当前状态不可参团'),
      ),
    );
  }

  Future<void> _join() async {
    setState(() => _busy = true);
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    try {
      final GroupbuyOrder updated = await ref
          .read(groupbuyActionsProvider)
          .join(widget.order.id);
      messenger.showSnackBar(
        SnackBar(content: Text('参团成功，当前 ${updated.joinedQuantity} 份')),
      );
    } on Object catch (error) {
      messenger.showSnackBar(SnackBar(content: Text('$error')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: KedaYaTokens.space1),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: KedaYaTokens.fontSizeXs,
        fontWeight: KedaYaTokens.fontWeightSemibold,
        color: KedaYaTokens.colorTextMuted,
      ),
    ),
  );
}

class _Pill extends StatelessWidget {
  const _Pill({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(
      horizontal: KedaYaTokens.space2,
      vertical: 2,
    ),
    decoration: BoxDecoration(
      color: KedaYaTokens.colorSurfaceAlt,
      borderRadius: BorderRadius.circular(KedaYaTokens.radiusSm),
    ),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: KedaYaTokens.fontSizeXs,
        color: KedaYaTokens.colorText,
      ),
    ),
  );
}
