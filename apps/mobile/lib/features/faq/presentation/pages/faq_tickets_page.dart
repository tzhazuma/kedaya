import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/app_providers.dart';
import '../../../../data/mock/mock_controls.dart';
import '../../../../domain/models/faq.dart';
import '../../../../domain/models/time_text.dart';
import '../../../../presentation/components/async_state_view.dart';
import '../../../../presentation/components/mock_state_menu.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/faq_providers.dart';

/// 我的工单页：列表 + 提交工单。
///
/// 契约 §2.8：未登录也可提交（此时 `userId` 为 null）；
/// `contact` 只收邮箱/微信号，**不存明文手机号**（校验在 domain 的
/// [faqTicketContactError]，UI 与 mock/远端共用同一条规则）。
class FaqTicketsPage extends ConsumerWidget {
  const FaqTicketsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<FaqTicketListState> value =
        ref.watch(faqTicketsControllerProvider);
    final MockControls? mockControls = ref.watch(mockControlsProvider);
    final FaqTicketsController controller =
        ref.read(faqTicketsControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: const Text('我的工单'),
        actions: <Widget>[
          if (mockControls != null)
            MockStateMenu(
              controls: mockControls,
              onChanged: () => ref.invalidate(faqTicketsControllerProvider),
            ),
          IconButton(
            tooltip: '提交工单',
            onPressed: () => showSubmitTicketDialog(context),
            icon: const Icon(Icons.add_comment_outlined),
          ),
          IconButton(
            tooltip: '刷新',
            onPressed: () => controller.refresh(),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: controller.refresh,
        child: AsyncStateView<FaqTicketListState>(
          value: value,
          isEmpty: (FaqTicketListState state) => state.isEmpty,
          emptyTitle: '还没有提交过工单',
          emptyDescription: '先在「常见问题」里搜一搜；搜不到就点右上角提交工单，'
              '一般 1–2 个工作日回复。',
          loadingMessage: '正在加载工单…',
          onRetry: controller.refresh,
          builder: (BuildContext context, FaqTicketListState state) =>
              ListView.separated(
            padding: const EdgeInsets.all(KedaYaTokens.space4),
            itemCount: state.tickets.length,
            separatorBuilder: (BuildContext context, int index) =>
                const SizedBox(height: KedaYaTokens.space3),
            itemBuilder: (BuildContext context, int index) =>
                _TicketCard(ticket: state.tickets[index]),
          ),
        ),
      ),
    );
  }
}

class _TicketCard extends StatelessWidget {
  const _TicketCard({required this.ticket});

  final FaqTicket ticket;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final (Color background, Color foreground) = switch (ticket.status) {
      FaqTicketStatus.answered => (colors.brandSoft, colors.brandStrong),
      FaqTicketStatus.closed => (colors.surfaceAlt, colors.textMuted),
      _ => (colors.surfaceAlt, colors.text),
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: KedaYaTokens.space2,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: background,
                    borderRadius: BorderRadius.circular(KedaYaTokens.radiusSm),
                  ),
                  child: Text(
                    ticket.status.label,
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      fontWeight: KedaYaTokens.fontWeightMedium,
                      color: foreground,
                    ),
                  ),
                ),
                const Spacer(),
                Text(
                  formatRelativeTime(ticket.createdAt),
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    color: colors.textMuted,
                  ),
                ),
              ],
            ),
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              ticket.question,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.text,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              '联系方式：${ticket.contact}',
              style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs, color: colors.textMuted),
            ),
            if (ticket.hasAnswer) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space3),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(KedaYaTokens.space3),
                decoration: BoxDecoration(
                  color: colors.surfaceAlt,
                  borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      '官方回复',
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeXs,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: colors.textMuted,
                      ),
                    ),
                    const SizedBox(height: KedaYaTokens.space1),
                    Text(
                      ticket.answer!,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeSm,
                        height: KedaYaTokens.lineHeightNormal,
                        color: colors.text,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// 打开提交工单对话框；提交成功后返回 true。
Future<bool?> showSubmitTicketDialog(BuildContext context) => showDialog<bool>(
      context: context,
      builder: (BuildContext context) => const _SubmitTicketDialog(),
    );

class _SubmitTicketDialog extends ConsumerStatefulWidget {
  const _SubmitTicketDialog();

  @override
  ConsumerState<_SubmitTicketDialog> createState() =>
      _SubmitTicketDialogState();
}

class _SubmitTicketDialogState extends ConsumerState<_SubmitTicketDialog> {
  final TextEditingController _contact = TextEditingController();
  final TextEditingController _question = TextEditingController();
  bool _busy = false;
  bool _submitted = false;
  String? _error;

  @override
  void dispose() {
    _contact.dispose();
    _question.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final FaqTicketDraft draft = FaqTicketDraft(
      contact: _contact.text,
      question: _question.text,
    );
    return AlertDialog(
      title: const Text('提交工单'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              '留下邮箱或微信号即可，请不要填手机号（我们不会存明文手机号）。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.textMuted,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space3),
            TextField(
              controller: _contact,
              style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm, color: colors.text),
              decoration: InputDecoration(
                labelText: '联系方式',
                hintText: 'you@shanghaitech.edu.cn 或 微信号',
                labelStyle: TextStyle(color: colors.textMuted),
                hintStyle: TextStyle(color: colors.textMuted),
              ),
              onChanged: (String _) => setState(() {}),
            ),
            if (_submitted && draft.contactError != null)
              _DialogError(message: draft.contactError!),
            const SizedBox(height: KedaYaTokens.space3),
            TextField(
              controller: _question,
              maxLines: 4,
              maxLength: 2000,
              style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm, color: colors.text),
              decoration: InputDecoration(
                labelText: '问题描述',
                labelStyle: TextStyle(color: colors.textMuted),
                counterText: '',
              ),
              onChanged: (String _) => setState(() {}),
            ),
            if (_submitted && draft.questionError != null)
              _DialogError(message: draft.questionError!),
            if (_error != null) _DialogError(message: _error!),
          ],
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(false),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: _busy ? null : () => _submit(draft),
          child: _busy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('提交'),
        ),
      ],
    );
  }

  Future<void> _submit(FaqTicketDraft draft) async {
    setState(() {
      _submitted = true;
      _error = null;
    });
    if (!draft.isValid) return;

    final NavigatorState navigator = Navigator.of(context);
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await ref.read(faqTicketActionsProvider).submit(draft.toCommand());
      navigator.pop(true);
      messenger.showSnackBar(
        const SnackBar(content: Text('工单已提交，我们会在 1–2 个工作日内回复')),
      );
    } on Object catch (error) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = '$error';
        });
      }
    }
  }
}

class _DialogError extends StatelessWidget {
  const _DialogError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: KedaYaTokens.space1),
        child: Text(
          message,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            color: context.kedayaColors.danger,
          ),
        ),
      );
}
