import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../domain/models/api_error.dart';
import '../../../../domain/models/wellbeing_booking.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/wellbeing_providers.dart';
import '../components/wellbeing_consent_gate.dart';
import '../components/wellbeing_crisis_card.dart';

/// 预约一次谈话。
///
/// 表单只收集四样东西：时间段、方式、可选话题、是否愿意留联系方式。
/// **不收集**手机号/微信号/QQ 号，也不做任何量表或风险评分。
class WellbeingBookingPage extends ConsumerStatefulWidget {
  const WellbeingBookingPage({super.key});

  @override
  ConsumerState<WellbeingBookingPage> createState() =>
      _WellbeingBookingPageState();
}

class _WellbeingBookingPageState extends ConsumerState<WellbeingBookingPage> {
  final TextEditingController _topic = TextEditingController();

  WellbeingTimeWindow? _timeWindow;
  WellbeingTalkMode? _mode;
  bool _contactAllowed = false;
  Map<WellbeingBookingField, String> _problems =
      const <WellbeingBookingField, String>{};
  bool _submitting = false;

  @override
  void dispose() {
    _topic.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final WellbeingBookingDraft draft = WellbeingBookingDraft(
      timeWindow: _timeWindow,
      mode: _mode,
      topic: _topic.text,
      contactAllowed: _contactAllowed,
    );
    final Map<WellbeingBookingField, String> problems = draft.validate();
    setState(() => _problems = problems);
    if (problems.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('还有 ${problems.length} 处需要确认')),
      );
      return;
    }

    setState(() => _submitting = true);
    try {
      await ref.read(wellbeingBookingsProvider.notifier).submit(draft);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('已提交（演示）。记录只保存在本机，可随时清空。'),
        ),
      );
      Navigator.of(context).maybePop(true);
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_messageOf(error))),
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  String _messageOf(Object error) =>
      error is ApiException ? error.error.userMessage : '$error';

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;

    return KedaYaPageScaffold(
      title: '预约一次谈话',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const WellbeingCrisisCard(compact: true),
          const SizedBox(height: KedaYaTokens.space3),
          Expanded(
            child: WellbeingConsentGate(
              builder: (BuildContext context) => ListView(
                padding: EdgeInsets.zero,
                children: <Widget>[
                  Text(
                    '这里只做倾听与预约：不做诊断、不做治疗，也不做量表评分。',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeSm,
                      height: KedaYaTokens.lineHeightNormal,
                      fontWeight: KedaYaTokens.fontWeightMedium,
                      color: colors.text,
                    ),
                  ),
                  const SizedBox(height: KedaYaTokens.space4),
                  _label(context, '希望的时间段（必选）'),
                  Wrap(
                    spacing: KedaYaTokens.space2,
                    runSpacing: KedaYaTokens.space2,
                    children: <Widget>[
                      for (final WellbeingTimeWindow value
                          in WellbeingTimeWindow.values)
                        ChoiceChip(
                          label: Text(value.label),
                          selected: _timeWindow == value,
                          onSelected: (bool _) =>
                              setState(() => _timeWindow = value),
                        ),
                    ],
                  ),
                  _fieldError(
                    context,
                    _problems[WellbeingBookingField.timeWindow],
                  ),
                  const SizedBox(height: KedaYaTokens.space3),
                  _label(context, '希望的方式（必选）'),
                  Wrap(
                    spacing: KedaYaTokens.space2,
                    runSpacing: KedaYaTokens.space2,
                    children: <Widget>[
                      for (final WellbeingTalkMode value
                          in WellbeingTalkMode.values)
                        ChoiceChip(
                          label: Text(value.label),
                          selected: _mode == value,
                          onSelected: (bool _) => setState(() => _mode = value),
                        ),
                    ],
                  ),
                  _fieldError(context, _problems[WellbeingBookingField.mode]),
                  const SizedBox(height: KedaYaTokens.space3),
                  _label(context, '想聊的话题（可选，≤200 字）'),
                  TextField(
                    controller: _topic,
                    maxLength: wellbeingBookingTopicMaxLength,
                    maxLines: 4,
                    decoration: const InputDecoration(
                      hintText: '想聊什么都可以，也可以什么都不写',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  _fieldError(context, _problems[WellbeingBookingField.topic]),
                  const SizedBox(height: KedaYaTokens.space2),
                  Container(
                    decoration: BoxDecoration(
                      color: colors.surfaceAlt,
                      borderRadius:
                          BorderRadius.circular(KedaYaTokens.radiusLg),
                      border: Border.all(color: colors.border),
                    ),
                    child: SwitchListTile(
                      value: _contactAllowed,
                      onChanged: (bool next) =>
                          setState(() => _contactAllowed = next),
                      title: const Text('愿意留联系方式'),
                      subtitle: const Text(
                        '只记录「愿意 / 不愿意」；本机不保存手机号、微信号或 QQ 号。'
                        '愿意时由学校心理中心通过校园账号联系你。',
                      ),
                    ),
                  ),
                  const SizedBox(height: KedaYaTokens.space4),
                  Text(
                    '提交后的状态固定为「已提交（演示）」，不是真实排班确认。'
                    '记录只保存在本机，可在「心理支持」首页清空。',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      height: KedaYaTokens.lineHeightLoose,
                      color: colors.textMuted,
                    ),
                  ),
                  const SizedBox(height: KedaYaTokens.space4),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _submitting ? null : _submit,
                      icon: _submitting
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.send_outlined, size: 18),
                      label: const Text('提交预约（演示）'),
                    ),
                  ),
                  const SizedBox(height: KedaYaTokens.space2),
                  Center(
                    child: TextButton(
                      onPressed: _submitting
                          ? null
                          : () => Navigator.of(context).maybePop(),
                      child: const Text('取消'),
                    ),
                  ),
                  const SizedBox(height: KedaYaTokens.space4),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _label(BuildContext context, String text) => Padding(
        padding: const EdgeInsets.only(bottom: KedaYaTokens.space2),
        child: Text(
          text,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: context.kedayaColors.text,
          ),
        ),
      );

  Widget _fieldError(BuildContext context, String? message) {
    if (message == null) return const SizedBox.shrink();
    return Padding(
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
}
