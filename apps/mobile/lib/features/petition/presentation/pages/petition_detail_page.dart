import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/petition_ticket.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/petition_providers.dart';
import '../components/petition_widgets.dart';
import '../petition_paths.dart';

/// 诉求详情：正文 + 状态时间线 + 回复（若有）+ 撤回（仅「已提交」）。
class PetitionDetailPage extends ConsumerWidget {
  const PetitionDetailPage({required this.ticketId, super.key});

  final String ticketId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final PetitionTicket? ticket = ref.watch(petitionTicketProvider(ticketId));

    if (ticket == null) {
      return KedaYaPageScaffold(
        title: '诉求详情',
        child: KedaYaEmptyState(
          icon: Icons.search_off,
          title: '这条记录不在本机',
          description: '可能已经被撤回，或者是在另一台设备上保存的。'
              '演示版没有云端同步，换设备就看不到。',
          onRetry: () => context.go(PetitionRoutes.list),
          retryLabel: '回到我的提交',
        ),
      );
    }

    final KedaYaColors colors = context.kedayaColors;

    return KedaYaPageScaffold(
      title: '诉求详情',
      child: ListView(
        children: <Widget>[
          const PetitionDemoNotice(),
          const SizedBox(height: KedaYaTokens.space4),
          Row(
            children: <Widget>[
              PetitionCategoryBadge(category: ticket.category),
              const SizedBox(width: KedaYaTokens.space2),
              PetitionStatusBadge(status: ticket.status),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space3),
          Text(
            ticket.title,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXl,
              fontWeight: KedaYaTokens.fontWeightBold,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            '提交于 ${formatPetitionDateTime(ticket.submittedAt)}',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.textMuted,
            ),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: KedaYaTokens.space4),
            child: Divider(height: 1),
          ),
          Text(
            ticket.body,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              height: KedaYaTokens.lineHeightLoose,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space5),
          _sectionTitle(context, '处理进度'),
          const SizedBox(height: KedaYaTokens.space3),
          PetitionTimeline(ticket: ticket),
          if (ticket.reply != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space5),
            _sectionTitle(context, '回复内容'),
            const SizedBox(height: KedaYaTokens.space2),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(KedaYaTokens.space3),
              decoration: BoxDecoration(
                color: colors.success.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
                border: Border.all(
                  color: colors.success.withValues(alpha: 0.35),
                ),
              ),
              child: Text(
                ticket.reply!,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  height: KedaYaTokens.lineHeightLoose,
                  color: colors.text,
                ),
              ),
            ),
          ] else if (ticket.status == PetitionStatus.replied) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space5),
            _sectionTitle(context, '回复内容'),
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              '状态是「已回复」，但没有留下文字内容。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                color: colors.textMuted,
              ),
            ),
          ],
          const SizedBox(height: KedaYaTokens.space5),
          _ContactBoundary(ticket: ticket),
          const SizedBox(height: KedaYaTokens.space5),
          if (ticket.canWithdraw)
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                key: const Key('petition-withdraw-button'),
                onPressed: () => _withdraw(context, ref, ticket),
                style: OutlinedButton.styleFrom(
                  foregroundColor: colors.danger,
                  side: BorderSide(
                    color: colors.danger.withValues(alpha: 0.5),
                  ),
                ),
                icon: const Icon(Icons.delete_outline, size: 18),
                label: const Text('撤回这条提交'),
              ),
            )
          else
            Text(
              '「${ticket.status.label}」的记录不能撤回：'
              '已经进入处理或已有回复。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.textMuted,
              ),
            ),
          if (ticket.canWithdraw) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              '撤回只删除本机记录，不影响任何部门（演示版没有发送过）。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.textMuted,
              ),
            ),
          ],
          const SizedBox(height: KedaYaTokens.space5),
        ],
      ),
    );
  }

  Future<void> _withdraw(
    BuildContext context,
    WidgetRef ref,
    PetitionTicket ticket,
  ) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('撤回这条提交？'),
        content: const Text(
          '撤回后会从本机删除，无法恢复。'
          '演示版没有发送给任何部门，所以也不需要在别处撤销。',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('撤回'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;

    try {
      await ref.read(petitionTicketsProvider.notifier).withdraw(ticket.id);
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已撤回，这条记录已从本机删除。')),
      );
      if (context.canPop()) {
        context.pop(true);
      } else {
        context.go(PetitionRoutes.list);
      }
    } on Object catch (error) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            error is StateError ? error.message : '撤回失败：$error',
          ),
        ),
      );
    }
  }

  Widget _sectionTitle(BuildContext context, String text) => Text(
        text,
        style: TextStyle(
          fontSize: KedaYaTokens.fontSizeMd,
          fontWeight: KedaYaTokens.fontWeightSemibold,
          color: context.kedayaColors.text,
        ),
      );
}

/// 联系方式 / 匿名边界：只在本机展示，说清楚哪一项没有保存。
class _ContactBoundary extends StatelessWidget {
  const _ContactBoundary({required this.ticket});

  final PetitionTicket ticket;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final String text;
    final IconData icon;
    if (ticket.anonymous) {
      icon = Icons.visibility_off_outlined;
      text = '匿名提交：这条记录没有保存联系方式。';
    } else if (ticket.contact != null) {
      icon = Icons.contact_mail_outlined;
      text = '联系方式：${ticket.contact!}（只保存在本机）';
    } else {
      icon = Icons.contact_mail_outlined;
      text = '未填写联系方式。';
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
        border: Border.all(color: colors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(icon, size: 18, color: colors.textMuted),
          const SizedBox(width: KedaYaTokens.space2),
          Expanded(
            child: Text(
              text,
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
