import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../domain/models/money.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/errand_providers.dart';
import '../../data/errand_repository.dart';
import '../../domain/errand_board.dart';
import '../components/errand_demo_notice.dart';

/// 发布跑腿：取件点 / 送达点 / 报酬 / 截止时间 / 备注。
class ErrandComposePage extends ConsumerStatefulWidget {
  const ErrandComposePage({super.key});

  @override
  ConsumerState<ErrandComposePage> createState() => _ErrandComposePageState();
}

enum _DeadlineChoice {
  today('今天内'),
  tomorrow('明天'),
  custom('自定义');

  const _DeadlineChoice(this.label);

  final String label;
}

class _ErrandComposePageState extends ConsumerState<ErrandComposePage> {
  final TextEditingController _pickup = TextEditingController();
  final TextEditingController _delivery = TextEditingController();
  final TextEditingController _reward = TextEditingController();
  final TextEditingController _note = TextEditingController();

  _DeadlineChoice _choice = _DeadlineChoice.today;
  late DateTime _customDeadline;
  List<String> _errors = const <String>[];

  @override
  void initState() {
    super.initState();
    final DateTime now = ref.read(errandClockProvider)();
    _customDeadline = DateTime(
      now.year,
      now.month,
      now.day,
      now.hour,
    ).add(const Duration(hours: 2));
  }

  @override
  void dispose() {
    _pickup.dispose();
    _delivery.dispose();
    _reward.dispose();
    _note.dispose();
    super.dispose();
  }

  DateTime _deadlineFor(_DeadlineChoice choice, DateTime now) =>
      switch (choice) {
        _DeadlineChoice.today => DateTime(
            now.year,
            now.month,
            now.day,
            23,
            59,
          ),
        _DeadlineChoice.tomorrow => DateTime(
            now.year,
            now.month,
            now.day + 1,
            23,
            59,
          ),
        _DeadlineChoice.custom => _customDeadline,
      };

  Future<void> _pickCustomDeadline() async {
    final DateTime now = ref.read(errandClockProvider)();
    final DateTime initial =
        _customDeadline.isAfter(now) ? _customDeadline : now;
    final DateTime? date = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: now.add(const Duration(days: 60)),
    );
    if (date == null || !mounted) return;
    final TimeOfDay? time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial),
    );
    if (time == null || !mounted) return;
    setState(() {
      _choice = _DeadlineChoice.custom;
      _customDeadline = DateTime(
        date.year,
        date.month,
        date.day,
        time.hour,
        time.minute,
      );
    });
  }

  void _submit() {
    final DateTime now = ref.read(errandClockProvider)();
    final String rewardText = _reward.text.trim();
    int rewardFen = 0;
    final List<String> errors = <String>[];

    if (rewardText.isNotEmpty) {
      try {
        rewardFen = Money.yuanToFen(rewardText);
      } on FormatException {
        errors.add('报酬请填写数字，最多两位小数（例如 5.00）。');
      }
    }

    final ErrandDraft draft = ErrandDraft(
      pickupAddress: _pickup.text,
      deliveryAddress: _delivery.text,
      rewardFen: rewardFen,
      note: _note.text,
      deadline: _deadlineFor(_choice, now),
    );
    errors.addAll(
      validateErrandDraft(draft).map(describeErrandDraftProblem),
    );

    if (errors.isNotEmpty) {
      setState(() => _errors = errors);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('还有 ${errors.length} 处需要改一下')),
      );
      return;
    }

    try {
      ref.read(errandTasksProvider.notifier).create(draft);
      setState(() => _errors = const <String>[]);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已发布。演示：不会真的通知对方。')),
      );
      Navigator.of(context).maybePop(true);
    } on ErrandException catch (error) {
      setState(() => _errors = <String>[error.message]);
    }
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final DateTime now = ref.watch(errandClockProvider)();
    final DateTime deadline = _deadlineFor(_choice, now);

    return KedaYaPageScaffold(
      title: '发布跑腿',
      padding: EdgeInsets.zero,
      child: ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          const ErrandDemoNotice(),
          const SizedBox(height: KedaYaTokens.space3),
          _label('取件点'),
          TextField(
            controller: _pickup,
            decoration: const InputDecoration(
              hintText: '3 号快递柜 / 二食堂一楼',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _label('送达点（必填）'),
          TextField(
            controller: _delivery,
            decoration: const InputDecoration(
              hintText: '6 号宿舍楼 302 / 图书馆 4 楼研讨间',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _label('报酬（元，可以是 0）'),
          TextField(
            controller: _reward,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              hintText: '5.00',
              prefixText: '¥ ',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _label('截止时间'),
          Wrap(
            spacing: KedaYaTokens.space2,
            runSpacing: KedaYaTokens.space2,
            children: <Widget>[
              for (final _DeadlineChoice choice in _DeadlineChoice.values)
                ChoiceChip(
                  label: Text(choice.label),
                  selected: _choice == choice,
                  onSelected: (bool selected) {
                    if (!selected) return;
                    if (choice == _DeadlineChoice.custom) {
                      _pickCustomDeadline();
                    } else {
                      setState(() => _choice = choice);
                    }
                  },
                ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            '截止：${formatErrandDateTime(deadline)}'
            '（${errandDeadlineText(deadline, now)}）',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.textMuted,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _label('备注'),
          TextField(
            controller: _note,
            maxLines: 4,
            decoration: const InputDecoration(
              hintText: '包裹有几个、有没有忌口、送到哪一层……',
              border: OutlineInputBorder(),
            ),
          ),
          if (_errors.isNotEmpty) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space3),
            Container(
              padding: const EdgeInsets.all(KedaYaTokens.space3),
              decoration: BoxDecoration(
                color: colors.danger.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
                border: Border.all(color: colors.danger.withValues(alpha: 0.4)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  for (final String error in _errors)
                    Padding(
                      padding: const EdgeInsets.only(
                        bottom: KedaYaTokens.space1,
                      ),
                      child: Text(
                        '· $error',
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeXs,
                          height: KedaYaTokens.lineHeightNormal,
                          color: colors.danger,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
          const SizedBox(height: KedaYaTokens.space4),
          Text(
            '说明：报酬按元填写，内部按整数分保存；'
            '送达点必须写清楚，否则接单的人不知道该送到哪。'
            '这是本机演示，发布后不会真的通知任何人。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightLoose,
              color: colors.textMuted,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space5),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _submit,
              icon: const Icon(Icons.send_outlined, size: 18),
              label: const Text('发布'),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          Center(
            child: TextButton(
              onPressed: () => Navigator.of(context).maybePop(),
              child: const Text('取消'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _label(String text) => Padding(
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
}
