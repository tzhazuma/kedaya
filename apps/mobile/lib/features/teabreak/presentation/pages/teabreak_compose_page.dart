import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/api_error.dart';
import '../../../../domain/models/teabreak.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/teabreak_providers.dart';

/// 新建茶歇（「报一个茶歇」）。
///
/// 表单的字段集合 = 契约 `TeabreakDraft`；提交前用 [validateTeabreakDraft]
/// 跑一遍规则层已经写好的校验 —— **页面里不复制任何校验规则**，
/// 因此 Web / 小程序 / Flutter 三端的"什么算合法"不可能不一致。
///
/// 时间字段给了**相对现在的合理默认值**（下一个半点开始的两小时会议、
/// 中间 30 分钟茶歇）：大多数用户只需要改名字和地点，不用一路点日期选择器。
class TeabreakComposePage extends ConsumerStatefulWidget {
  const TeabreakComposePage({super.key});

  @override
  ConsumerState<TeabreakComposePage> createState() =>
      _TeabreakComposePageState();
}

class _TeabreakComposePageState extends ConsumerState<TeabreakComposePage> {
  final TextEditingController _conferenceName = TextEditingController();
  final TextEditingController _venue = TextEditingController();
  final TextEditingController _note = TextEditingController();

  late DateTime _conferenceStartsAt;
  late DateTime _conferenceEndsAt;
  late DateTime _teaStartsAt;
  late DateTime _teaEndsAt;

  TeabreakAccess _access = TeabreakAccess.unknown;

  List<TeabreakDraftProblem> _problems = <TeabreakDraftProblem>[];
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    final DateTime now = ref.read(teabreakClockProvider)();
    // 默认值：下一个半点开始，两小时会议，中间 30 分钟茶歇（窗口合法、在会议内）。
    final DateTime start = _nextHalfHour(now);
    _conferenceStartsAt = start;
    _conferenceEndsAt = start.add(const Duration(hours: 2));
    _teaStartsAt = start.add(const Duration(minutes: 45));
    _teaEndsAt = start.add(const Duration(minutes: 75));
  }

  @override
  void dispose() {
    _conferenceName.dispose();
    _venue.dispose();
    _note.dispose();
    super.dispose();
  }

  TeabreakDraft _draft() => TeabreakDraft(
        conferenceName: _conferenceName.text,
        venue: _venue.text,
        conferenceStartsAt: _conferenceStartsAt,
        conferenceEndsAt: _conferenceEndsAt,
        teaStartsAt: _teaStartsAt,
        teaEndsAt: _teaEndsAt,
        access: _access,
        note: _note.text,
      );

  Future<void> _submit() async {
    final TeabreakDraft draft = _draft();
    final List<TeabreakDraftProblem> problems =
        validateTeabreakDraft(draft, ref.read(teabreakClockProvider)());
    setState(() => _problems = problems);
    if (problems.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('还有 ${problems.length} 处需要改一下')),
      );
      return;
    }

    setState(() => _submitting = true);
    try {
      await ref.read(teabreakActionsProvider).create(draft);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已发出。接下来 20 分钟里，别人看到的是「刚确认还有」')),
      );
      Navigator.of(context).maybePop(true);
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            error is ApiException ? error.error.userMessage : '$error',
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _pick(DateTime current, ValueChanged<DateTime> apply) async {
    final DateTime? date = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: DateTime(current.year - 1),
      lastDate: DateTime(current.year + 2),
    );
    if (date == null || !mounted) return;
    final TimeOfDay? time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(current),
    );
    if (time == null || !mounted) return;
    apply(
      DateTime(date.year, date.month, date.day, time.hour, time.minute),
    );
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;

    return Scaffold(
      appBar: AppBar(title: const Text('报一个茶歇')),
      body: ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          _label('会议名称'),
          TextField(
            controller: _conferenceName,
            maxLength: teabreakConferenceMax,
            decoration: const InputDecoration(
              hintText: '第七届信息科学前沿论坛',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          _label('地点（楼 + 房间号）'),
          TextField(
            controller: _venue,
            maxLength: teabreakVenueMax,
            decoration: const InputDecoration(
              hintText: '信息学院 1-101',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          _label('会议时间'),
          _DateTimeTile(
            icon: Icons.event_outlined,
            title: '会议开始',
            value: _conferenceStartsAt,
            onTap: () => _pick(
              _conferenceStartsAt,
              (DateTime next) => setState(() => _conferenceStartsAt = next),
            ),
          ),
          _DateTimeTile(
            icon: Icons.event_available_outlined,
            title: '会议结束',
            value: _conferenceEndsAt,
            onTap: () => _pick(
              _conferenceEndsAt,
              (DateTime next) => setState(() => _conferenceEndsAt = next),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          _label('茶歇时间（10 分钟 – 3 小时，必须在会议时间内）'),
          _DateTimeTile(
            icon: Icons.local_cafe_outlined,
            title: '茶歇开始',
            value: _teaStartsAt,
            onTap: () => _pick(
              _teaStartsAt,
              (DateTime next) => setState(() => _teaStartsAt = next),
            ),
          ),
          _DateTimeTile(
            icon: Icons.timer_outlined,
            title: '茶歇结束',
            value: _teaEndsAt,
            onTap: () => _pick(
              _teaEndsAt,
              (DateTime next) => setState(() => _teaEndsAt = next),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _label('开放程度（决定别人敢不敢来）'),
          Wrap(
            spacing: KedaYaTokens.space2,
            runSpacing: KedaYaTokens.space2,
            children: <Widget>[
              for (final TeabreakAccess access in TeabreakAccess.values)
                ChoiceChip(
                  label: Text(access.label),
                  selected: _access == access,
                  onSelected: (bool _) => setState(() => _access = access),
                ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            _access.hint,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.textMuted,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _label('备注（有什么吃的 / 具体位置）'),
          TextField(
            controller: _note,
            maxLines: 3,
            decoration: const InputDecoration(
              hintText: '有咖啡和可颂，在二楼走廊尽头',
              border: OutlineInputBorder(),
            ),
          ),
          if (_problems.isNotEmpty) ...<Widget>[
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
                  for (final TeabreakDraftProblem problem in _problems)
                    Padding(
                      padding: const EdgeInsets.only(bottom: KedaYaTokens.space1),
                      child: Text(
                        '· ${describeTeabreakProblem(problem)}',
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
            '说明：茶歇时间可以比会议时间短，但必须在会议时间内；'
            '已经结束的会议不接收新条目 —— 发出来也没人去。'
            '开放程度请如实填写，被工作人员请出去的场面比少吃一块蛋糕难受得多。',
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
              onPressed: _submitting ? null : _submit,
              icon: _submitting
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.send_outlined, size: 18),
              label: const Text('发布'),
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
    return Padding(
      padding: const EdgeInsets.only(bottom: KedaYaTokens.space1),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: KedaYaTokens.space2,
            vertical: KedaYaTokens.space2,
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
                formatDateTimeText(value),
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
      ),
    );
  }
}

/// `10月22日 14:30`（本地时区）。
String formatDateTimeText(DateTime value) {
  final DateTime local = value.isUtc ? value.toLocal() : value;
  final String hour = local.hour.toString().padLeft(2, '0');
  final String minute = local.minute.toString().padLeft(2, '0');
  return '${local.month}月${local.day}日 $hour:$minute';
}

/// 下一个半点（**严格晚于** `now`，避免默认值一提交就"在过去"）。
DateTime _nextHalfHour(DateTime now) {
  final DateTime base = DateTime(
    now.year,
    now.month,
    now.day,
    now.hour,
    now.minute,
  );
  final int minutesToAdd = 30 - (base.minute % 30);
  return base.add(Duration(minutes: minutesToAdd));
}
