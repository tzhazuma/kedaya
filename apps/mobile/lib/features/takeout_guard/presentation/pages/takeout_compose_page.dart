import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/takeout_report.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/takeout_guard_providers.dart';

/// 新增一条偷外卖报备。
///
/// 时间默认「现在」，平台默认美团；校验规则集中在
/// [validateTakeoutDraft]，页面只负责展示问题。
class TakeoutComposePage extends ConsumerStatefulWidget {
  const TakeoutComposePage({super.key});

  @override
  ConsumerState<TakeoutComposePage> createState() => _TakeoutComposePageState();
}

class _TakeoutComposePageState extends ConsumerState<TakeoutComposePage> {
  final TextEditingController _location = TextEditingController();
  final TextEditingController _meal = TextEditingController();
  final TextEditingController _note = TextEditingController();

  late DateTime _occurredAt;
  TakeoutPlatform _platform = TakeoutPlatform.meituan;
  bool _contactedBuildingManager = false;

  List<TakeoutDraftProblem> _problems = <TakeoutDraftProblem>[];
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _occurredAt = ref.read(takeoutGuardClockProvider)();
  }

  @override
  void dispose() {
    _location.dispose();
    _meal.dispose();
    _note.dispose();
    super.dispose();
  }

  TakeoutReportDraft _draft() => TakeoutReportDraft(
        occurredAt: _occurredAt,
        location: _location.text,
        platform: _platform,
        meal: _meal.text,
        note: _note.text,
        contactedBuildingManager: _contactedBuildingManager,
      );

  Future<void> _submit() async {
    final TakeoutReportDraft draft = _draft();
    final List<TakeoutDraftProblem> problems = validateTakeoutDraft(
      draft,
      ref.read(takeoutGuardClockProvider)(),
    );
    setState(() => _problems = problems);
    if (problems.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('还有 ${problems.length} 处需要改一下')),
      );
      return;
    }

    setState(() => _submitting = true);
    try {
      ref.read(takeoutReportsProvider.notifier).add(draft);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已保存。只有你自己能看到这条报备。')),
      );
      context.pop();
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$error')),
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _pickDateTime() async {
    final DateTime now = ref.read(takeoutGuardClockProvider)();
    final DateTime today = DateTime(now.year, now.month, now.day);
    final DateTime current = _occurredAt.isAfter(now) ? now : _occurredAt;

    final DateTime? date = await showDatePicker(
      context: context,
      initialDate: DateTime(current.year, current.month, current.day),
      firstDate: DateTime(now.year - 1),
      lastDate: today,
    );
    if (date == null || !mounted) return;

    final TimeOfDay? time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(current),
    );
    if (time == null || !mounted) return;

    setState(() {
      _occurredAt = DateTime(
        date.year,
        date.month,
        date.day,
        time.hour,
        time.minute,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;

    return KedaYaPageScaffold(
      title: '新增报备',
      padding: EdgeInsets.zero,
      child: ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(Icons.lock_outline, size: 16, color: colors.brandStrong),
              const SizedBox(width: KedaYaTokens.space1),
              Expanded(
                child: Text(
                  '只有你自己能看到这些记录',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _label('时间'),
          _DateTimeTile(
            icon: Icons.schedule_outlined,
            title: '外卖被拿错 / 丢失的时间',
            value: _occurredAt,
            onTap: _pickDateTime,
          ),
          const SizedBox(height: KedaYaTokens.space2),
          _label('地点'),
          TextField(
            controller: _location,
            maxLength: takeoutLocationMax,
            decoration: const InputDecoration(
              hintText: '3 号楼外卖架',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          _label('平台'),
          Wrap(
            spacing: KedaYaTokens.space2,
            runSpacing: KedaYaTokens.space2,
            children: <Widget>[
              for (final TakeoutPlatform platform in TakeoutPlatform.values)
                ChoiceChip(
                  label: Text(platform.label),
                  selected: _platform == platform,
                  onSelected: (bool _) => setState(() => _platform = platform),
                ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _label('餐品'),
          TextField(
            controller: _meal,
            maxLength: takeoutMealMax,
            decoration: const InputDecoration(
              hintText: '黄焖鸡米饭',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          _label('备注（选填，最多 $takeoutNoteMax 字）'),
          TextField(
            controller: _note,
            maxLines: 3,
            maxLength: takeoutNoteMax,
            decoration: const InputDecoration(
              hintText: '什么时候放的、有没有编号、楼管怎么说…',
              border: OutlineInputBorder(),
            ),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _contactedBuildingManager,
            title: const Text('是否已联系楼管'),
            subtitle: const Text('只做记录，不会通知楼管'),
            onChanged: (bool value) =>
                setState(() => _contactedBuildingManager = value),
          ),
          if (_problems.isNotEmpty) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space3),
            Container(
              padding: const EdgeInsets.all(KedaYaTokens.space3),
              decoration: BoxDecoration(
                color: colors.danger.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
                border: Border.all(
                  color: colors.danger.withValues(alpha: 0.4),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  for (final TakeoutDraftProblem problem in _problems)
                    Padding(
                      padding:
                          const EdgeInsets.only(bottom: KedaYaTokens.space1),
                      child: Text(
                        '· ${describeTakeoutDraftProblem(problem)}',
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
          const SizedBox(height: KedaYaTokens.space3),
          Text(
            '报备只保存在你自己的列表里，不会公开，也不会通知任何人。'
            '写清地点和餐品，之后跟楼管或平台沟通时更容易说明情况。',
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
                  : const Icon(Icons.save_outlined, size: 18),
              label: const Text('保存报备'),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
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

/// 只读的时间字段：点一下依次选日期 + 时间。
class _DateTimeTile extends StatelessWidget {
  const _DateTimeTile({
    required this.icon,
    required this.title,
    required this.value,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final DateTime value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: KedaYaTokens.space2,
          vertical: KedaYaTokens.space2,
        ),
        decoration: BoxDecoration(
          border: Border.all(color: colors.border),
          borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
        ),
        child: Row(
          children: <Widget>[
            Icon(icon, size: 18, color: colors.textMuted),
            const SizedBox(width: KedaYaTokens.space2),
            Expanded(
              child: Text(
                title,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  color: colors.textMuted,
                ),
              ),
            ),
            Text(
              '${value.month}月${value.day}日 '
              '${value.hour.toString().padLeft(2, '0')}:'
              '${value.minute.toString().padLeft(2, '0')}',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                fontWeight: KedaYaTokens.fontWeightMedium,
                color: colors.text,
              ),
            ),
            const SizedBox(width: KedaYaTokens.space1),
            Icon(Icons.chevron_right, size: 18, color: colors.textMuted),
          ],
        ),
      ),
    );
  }
}
