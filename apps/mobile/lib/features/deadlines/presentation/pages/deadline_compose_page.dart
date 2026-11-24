import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/deadline_item.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/deadlines_providers.dart';

/// 新增 DDL（标题 / 类型 / 截止时间 / 来源 / 备注）。
///
/// 校验规则来自 domain 的 [validateDeadlineDraft]，页面里不复制一份。
/// 截止时间默认「今天 23:59」（如果今天已过 23:59 则明天 23:59），
/// 大多数情况下只需要改标题就能提交。
///
/// 表单只写本机 DDL 列表：**不写入课程表**。
class DeadlineComposePage extends ConsumerStatefulWidget {
  const DeadlineComposePage({this.initial, super.key});

  /// 传入即进入「编辑」模式（id / completed 保留，其余字段用草稿覆盖）。
  final DeadlineItem? initial;

  @override
  ConsumerState<DeadlineComposePage> createState() =>
      _DeadlineComposePageState();
}

class _DeadlineComposePageState extends ConsumerState<DeadlineComposePage> {
  final TextEditingController _title = TextEditingController();
  final TextEditingController _source = TextEditingController();
  final TextEditingController _note = TextEditingController();

  DeadlineKind _kind = DeadlineKind.homework;
  late DateTime _dueAt;

  List<DeadlineDraftProblem> _problems = <DeadlineDraftProblem>[];
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    final DeadlineItem? initial = widget.initial;
    if (initial != null) {
      _title.text = initial.title;
      _source.text = initial.source ?? '';
      _note.text = initial.note ?? '';
      _kind = initial.kind;
      _dueAt = initial.dueAt;
    } else {
      _dueAt = _defaultDueAt(ref.read(deadlinesClockProvider)());
    }
  }

  @override
  void dispose() {
    _title.dispose();
    _source.dispose();
    _note.dispose();
    super.dispose();
  }

  DeadlineDraft _draft() => DeadlineDraft(
        title: _title.text,
        kind: _kind,
        dueAt: _dueAt,
        source: _source.text,
        note: _note.text,
      );

  Future<void> _submit() async {
    final DeadlineDraft draft = _draft();
    final List<DeadlineDraftProblem> problems = validateDeadlineDraft(draft);
    setState(() => _problems = problems);
    if (problems.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('还有 ${problems.length} 处需要改一下')),
      );
      return;
    }

    setState(() => _submitting = true);
    try {
      final DeadlinesController controller =
          ref.read(deadlinesControllerProvider.notifier);
      final DeadlineItem? initial = widget.initial;
      if (initial == null) {
        await controller.add(draft);
      } else {
        await controller.updateItem(initial.id, draft);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            initial == null
                ? '已添加：${draft.normalizedTitle}'
                : '已保存：${draft.normalizedTitle}',
          ),
        ),
      );
      Navigator.of(context).maybePop(true);
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$error')),
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _pickDue() async {
    final DateTime now = ref.read(deadlinesClockProvider)();
    final DateTime? date = await showDatePicker(
      context: context,
      initialDate: _dueAt,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 3),
    );
    if (date == null || !mounted) return;
    final TimeOfDay? time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_dueAt),
    );
    if (time == null || !mounted) return;
    setState(() {
      _dueAt =
          DateTime(date.year, date.month, date.day, time.hour, time.minute);
    });
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final DateTime now = ref.watch(deadlinesClockProvider)();

    return KedaYaPageScaffold(
      title: '新增 DDL',
      child: ListView(
        children: <Widget>[
          _label('标题'),
          TextField(
            key: const Key('deadline-title-field'),
            controller: _title,
            maxLength: deadlineTitleMax,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(
              hintText: '例如：程序分析作业 4：CHA',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space1),
          _label('类型'),
          Wrap(
            spacing: KedaYaTokens.space2,
            runSpacing: KedaYaTokens.space2,
            children: <Widget>[
              for (final DeadlineKind kind in DeadlineKind.values)
                ChoiceChip(
                  label: Text(kind.label),
                  selected: _kind == kind,
                  onSelected: (bool _) => setState(() => _kind = kind),
                ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _label('截止时间（日期 + 时间）'),
          InkWell(
            key: const Key('deadline-due-tile'),
            onTap: _pickDue,
            borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
            child: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: KedaYaTokens.space3,
                vertical: KedaYaTokens.space3,
              ),
              decoration: BoxDecoration(
                color: colors.surfaceAlt,
                borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
                border: Border.all(color: colors.border),
              ),
              child: Row(
                children: <Widget>[
                  Icon(
                    Icons.event_outlined,
                    size: 18,
                    color: colors.textMuted,
                  ),
                  const SizedBox(width: KedaYaTokens.space2),
                  Expanded(
                    child: Text(
                      formatDeadlineDue(_dueAt, now),
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeSm,
                        fontWeight: KedaYaTokens.fontWeightMedium,
                        color: colors.text,
                      ),
                    ),
                  ),
                  Icon(
                    Icons.chevron_right,
                    size: 18,
                    color: colors.textMuted,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _label('来源（可选）'),
          TextField(
            key: const Key('deadline-source-field'),
            controller: _source,
            maxLength: deadlineSourceMax,
            decoration: const InputDecoration(
              hintText: '课程名或通知来源，例如「程序分析 · 张涛」',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space1),
          _label('备注（可选）'),
          TextField(
            key: const Key('deadline-note-field'),
            controller: _note,
            maxLength: deadlineNoteMax,
            maxLines: 3,
            decoration: const InputDecoration(
              hintText: '提交方式、迟交规则、考试地点……',
              border: OutlineInputBorder(),
            ),
          ),
          if (_problems.isNotEmpty) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
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
                  for (final DeadlineDraftProblem problem in _problems)
                    Padding(
                      padding:
                          const EdgeInsets.only(bottom: KedaYaTokens.space1),
                      child: Text(
                        '· ${describeDeadlineProblem(problem)}',
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
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            'DDL 只进本列表，不写入课程表；已经逾期的条目也可以补记，'
            '列表会用「已逾期 N 天」和红色标出来。',
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
                  : const Icon(Icons.check, size: 18),
              label: const Text('保存'),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          Center(
            child: TextButton(
              onPressed: _submitting ? null : () => context.pop(),
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

/// 默认截止：今天 23:59；如果今天已经过了 23:59，则明天 23:59。
DateTime _defaultDueAt(DateTime now) {
  final DateTime local = now.toLocal();
  final DateTime todayEnd =
      DateTime(local.year, local.month, local.day, 23, 59);
  return todayEnd.isAfter(local)
      ? todayEnd
      : DateTime(local.year, local.month, local.day + 1, 23, 59);
}
