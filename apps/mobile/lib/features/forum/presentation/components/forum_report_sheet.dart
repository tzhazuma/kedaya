import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../domain/models/forum.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/forum_providers.dart';

/// 打开举报弹层。
///
/// 契约 §11.2 冻结的 action 名是 `report`；`ForumActions.report` 走的就是它。
Future<void> showForumReportSheet(
  BuildContext context, {
  required ForumReportTargetType targetType,
  required String targetId,
}) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext context) =>
          ForumReportSheet(targetType: targetType, targetId: targetId),
    );

/// 举报底部弹层：选理由 + 可选补充说明 + 是否匿名。
///
/// **默认匿名**：举报是维权/治理行为，默认不暴露举报人（契约 §2.4 允许匿名）。
class ForumReportSheet extends ConsumerStatefulWidget {
  const ForumReportSheet(
      {required this.targetType, required this.targetId, super.key});

  final ForumReportTargetType targetType;
  final String targetId;

  @override
  ConsumerState<ForumReportSheet> createState() => _ForumReportSheetState();
}

class _ForumReportSheetState extends ConsumerState<ForumReportSheet> {
  final TextEditingController _note = TextEditingController();
  ForumReportReason _reason = ForumReportReason.spam;
  bool _anonymous = true;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
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
              '举报${widget.targetType.label}',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeLg,
                fontWeight: KedaYaTokens.fontWeightSemibold,
                color: colors.text,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space1),
            Text(
              '举报会进入人工队列；同一条内容被 3 个不同用户举报会自动隐藏。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.textMuted,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space3),
            Wrap(
              spacing: KedaYaTokens.space2,
              runSpacing: KedaYaTokens.space2,
              children: <Widget>[
                for (final ForumReportReason reason in ForumReportReason.values)
                  ChoiceChip(
                    label: Text(reason.label),
                    selected: _reason == reason,
                    showCheckmark: false,
                    backgroundColor: colors.surfaceAlt,
                    selectedColor: colors.brandSoft,
                    side: BorderSide(color: colors.border),
                    labelStyle: TextStyle(
                      fontSize: KedaYaTokens.fontSizeSm,
                      color: _reason == reason
                          ? colors.brandStrong
                          : colors.textMuted,
                    ),
                    onSelected: (bool _) => setState(() => _reason = reason),
                  ),
              ],
            ),
            const SizedBox(height: KedaYaTokens.space3),
            TextField(
              controller: _note,
              maxLines: 3,
              maxLength: 500,
              style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm, color: colors.text),
              decoration: InputDecoration(
                labelText: '补充说明（可选）',
                labelStyle: TextStyle(color: colors.textMuted),
                enabledBorder: OutlineInputBorder(
                  borderSide: BorderSide(color: colors.border),
                  borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
                ),
                focusedBorder: OutlineInputBorder(
                  borderSide: BorderSide(color: colors.brandStrong),
                  borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
                ),
              ),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _anonymous,
              onChanged: (bool next) => setState(() => _anonymous = next),
              title: const Text('匿名举报'),
              subtitle: const Text('匿名后你的实名身份不会与举报记录关联'),
            ),
            if (_error != null) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space2),
              Text(
                _error!,
                style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm, color: colors.danger),
              ),
            ],
            const SizedBox(height: KedaYaTokens.space3),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _busy ? null : _submit,
                child: _busy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('提交举报'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    // 跨 await 使用 context 前先取出来（use_build_context_synchronously）。
    final NavigatorState navigator = Navigator.of(context);
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(forumActionsProvider).report(
            CreateForumReportCommand(
              targetType: widget.targetType,
              targetId: widget.targetId,
              reason: _reason,
              detail: _note.text.trim().isEmpty ? null : _note.text.trim(),
              anonymous: _anonymous,
            ),
          );
      navigator.pop();
      messenger.showSnackBar(
        const SnackBar(content: Text('举报已提交，我们会尽快处理')),
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
