import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/lost_found_item.dart';
import '../../../../domain/models/validate.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/lost_found_providers.dart';

/// 发布寻物 / 招领信息。
///
/// 联系方式是自由文本，**不做手机号格式校验**：产品只要求提示发布者
/// 自行脱敏；检测到疑似 PII 时给一条更醒目的提示，但不阻断发布。
class LostFoundComposePage extends ConsumerStatefulWidget {
  const LostFoundComposePage({super.key});

  @override
  ConsumerState<LostFoundComposePage> createState() =>
      _LostFoundComposePageState();
}

class _LostFoundComposePageState extends ConsumerState<LostFoundComposePage> {
  final TextEditingController _title = TextEditingController();
  final TextEditingController _location = TextEditingController();
  final TextEditingController _description = TextEditingController();
  final TextEditingController _contact = TextEditingController();

  LostFoundKind _kind = LostFoundKind.lost;
  late DateTime _occurredAt;
  List<LostFoundDraftProblem> _problems = <LostFoundDraftProblem>[];

  @override
  void initState() {
    super.initState();
    _occurredAt = ref.read(lostFoundClockProvider)();
  }

  @override
  void dispose() {
    _title.dispose();
    _location.dispose();
    _description.dispose();
    _contact.dispose();
    super.dispose();
  }

  LostFoundDraft _draft() => LostFoundDraft(
        kind: _kind,
        title: _title.text,
        location: _location.text,
        occurredAt: _occurredAt,
        description: _description.text,
        contact: _contact.text,
      );

  void _submit() {
    final LostFoundDraft draft = _draft();
    final List<LostFoundDraftProblem> problems = validateLostFoundDraft(draft);
    setState(() => _problems = problems);
    if (problems.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('还有 ${problems.length} 处需要改一下')),
      );
      return;
    }

    try {
      ref.read(lostFoundFeedProvider.notifier).add(draft);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已发布，列表里现在能看到这条信息。')),
      );
      context.pop();
    } on Object catch (error) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$error')),
      );
    }
  }

  Future<void> _pickDateTime() async {
    final DateTime now = ref.read(lostFoundClockProvider)();
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
    final bool contactLooksSensitive = containsLikelyPii(_contact.text);

    return KedaYaPageScaffold(
      title: '发布失物招领',
      padding: EdgeInsets.zero,
      child: ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          _label('类型'),
          SizedBox(
            width: double.infinity,
            child: SegmentedButton<LostFoundKind>(
              showSelectedIcon: false,
              segments: const <ButtonSegment<LostFoundKind>>[
                ButtonSegment<LostFoundKind>(
                  value: LostFoundKind.lost,
                  label: Text('寻物'),
                ),
                ButtonSegment<LostFoundKind>(
                  value: LostFoundKind.found,
                  label: Text('招领'),
                ),
              ],
              selected: <LostFoundKind>{_kind},
              onSelectionChanged: (Set<LostFoundKind> selection) {
                if (selection.isEmpty) return;
                setState(() => _kind = selection.first);
              },
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _label('标题'),
          TextField(
            controller: _title,
            maxLength: lostFoundTitleMax,
            decoration: const InputDecoration(
              hintText: '丢了一个蓝色保温杯 / 捡到一把黑色雨伞',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          _label('地点'),
          TextField(
            controller: _location,
            maxLength: lostFoundLocationMax,
            decoration: const InputDecoration(
              hintText: '图书馆三楼自习区',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          _label('时间'),
          _DateTimeTile(
            icon: Icons.schedule_outlined,
            title: '丢失 / 捡到的时间',
            value: _occurredAt,
            onTap: _pickDateTime,
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _label('描述'),
          TextField(
            controller: _description,
            maxLines: 4,
            maxLength: lostFoundDescriptionMax,
            decoration: const InputDecoration(
              hintText: '颜色、品牌、有没有贴纸、里面有什么…',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          _label('联系方式（会公开展示）'),
          TextField(
            controller: _contact,
            maxLines: 2,
            maxLength: lostFoundContactMax,
            onChanged: (String _) => setState(() {}),
            decoration: const InputDecoration(
              hintText: '站内留言，或「放在图书馆三楼服务台」',
              border: OutlineInputBorder(),
            ),
          ),
          Text(
            '公开前请自行脱敏，不要填手机号。'
            '可以写「站内留言」或一个公共地点。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              color: contactLooksSensitive ? colors.danger : colors.warning,
            ),
          ),
          if (contactLooksSensitive)
            Padding(
              padding: const EdgeInsets.only(top: KedaYaTokens.space1),
              child: Text(
                '这段联系方式看起来包含手机号 / 学号 / 邮箱，'
                '建议改掉再发布。',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  height: KedaYaTokens.lineHeightNormal,
                  fontWeight: KedaYaTokens.fontWeightSemibold,
                  color: colors.danger,
                ),
              ),
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
                  for (final LostFoundDraftProblem problem in _problems)
                    Padding(
                      padding:
                          const EdgeInsets.only(bottom: KedaYaTokens.space1),
                      child: Text(
                        '· ${describeLostFoundDraftProblem(problem)}',
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
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _submit,
              icon: const Icon(Icons.send_outlined, size: 18),
              label: const Text('发布'),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Center(
            child: TextButton(
              onPressed: () => context.pop(),
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
