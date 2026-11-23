import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/activity.dart';
import '../../../../domain/models/activity_time.dart';
import '../../../../domain/models/api_error.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/activities_providers.dart';
import '../components/activity_date_time_picker.dart';

/// 手动创建活动。
///
/// 只收活动字段与 ≤200 字证据摘录；不提供正文/附件入口。
/// 校验只在**提交时**阻断，错误用文字 + `Semantics(liveRegion: true)` 呈现。
class ActivityComposePage extends ConsumerStatefulWidget {
  const ActivityComposePage({super.key});

  @override
  ConsumerState<ActivityComposePage> createState() =>
      _ActivityComposePageState();
}

class _ActivityComposePageState extends ConsumerState<ActivityComposePage> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();

  late final TextEditingController _title;
  String _kind = defaultActivityKind;
  late final TextEditingController _location;
  late final TextEditingController _organizer;
  late final TextEditingController _registrationUrl;
  late final TextEditingController _deadlineRaw;
  late final TextEditingController _evidence;

  late DateTime _startsAt;
  DateTime? _endsAt;
  DateTime? _deadlineAt;
  String? _formError;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _title = TextEditingController();
    _location = TextEditingController();
    _organizer = TextEditingController();
    _registrationUrl = TextEditingController();
    _deadlineRaw = TextEditingController();
    _evidence = TextEditingController();
    _startsAt = defaultActivityStart(ref.read(activitiesClockProvider)());
  }

  @override
  void dispose() {
    _title.dispose();
    _location.dispose();
    _organizer.dispose();
    _registrationUrl.dispose();
    _deadlineRaw.dispose();
    _evidence.dispose();
    super.dispose();
  }

  String? _validateTitle(String? value) {
    final String text = (value ?? '').trim();
    if (text.length < activityTitleMinChars) {
      return describeActivityDraftProblem(ActivityDraftProblem.titleTooShort);
    }
    if (text.length > activityTitleMaxChars) {
      return describeActivityDraftProblem(ActivityDraftProblem.titleTooLong);
    }
    return null;
  }

  String? _validateUrl(String? value) {
    final String text = (value ?? '').trim();
    if (text.isEmpty) return null;
    if (!isHttpUrl(text)) {
      return describeActivityDraftProblem(ActivityDraftProblem.invalidUrl);
    }
    return null;
  }

  String? _validateEvidence(String? value) {
    final String text = (value ?? '').trim();
    if (text.runes.length > activityEvidenceMaxChars) {
      return describeActivityDraftProblem(ActivityDraftProblem.evidenceTooLong);
    }
    return null;
  }

  Future<void> _pickStart() async {
    final DateTime? picked = await pickActivityDateTime(
      context,
      initialUtc: _startsAt,
      now: ref.read(activitiesClockProvider)(),
    );
    if (picked == null || !mounted) return;
    setState(() {
      _startsAt = picked;
      if (_endsAt != null && !_endsAt!.isAfter(picked)) {
        _endsAt = picked.add(const Duration(hours: 2));
      }
    });
  }

  Future<void> _pickEnd() async {
    final DateTime? picked = await pickActivityDateTime(
      context,
      initialUtc: _endsAt ?? _startsAt.add(const Duration(hours: 2)),
      now: ref.read(activitiesClockProvider)(),
      firstUtc: _startsAt,
    );
    if (picked == null || !mounted) return;
    setState(() => _endsAt = picked);
  }

  Future<void> _pickDeadline() async {
    final DateTime? picked = await pickActivityDateTime(
      context,
      initialUtc: _deadlineAt ?? _startsAt.subtract(const Duration(days: 1)),
      now: ref.read(activitiesClockProvider)(),
    );
    if (picked == null || !mounted) return;
    setState(() => _deadlineAt = picked);
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    setState(() => _formError = null);

    final FormState? form = _formKey.currentState;
    if (form == null || !form.validate()) {
      setState(() => _formError = '请检查表单中标红的字段');
      return;
    }

    final ActivityDraft draft = ActivityDraft(
      title: _title.text,
      kind: _kind,
      startsAt: _startsAt,
      endsAt: _endsAt,
      location: _location.text,
      organizer: _organizer.text,
      registrationDeadlineAt: _deadlineAt,
      registrationDeadlineRaw: _deadlineRaw.text,
      registrationUrl: _registrationUrl.text,
      evidenceText: _evidence.text,
    );
    final List<ActivityDraftProblem> problems = validateActivityDraft(draft);
    if (problems.isNotEmpty) {
      setState(() =>
          _formError = problems.map(describeActivityDraftProblem).join('；'));
      return;
    }

    setState(() => _saving = true);
    try {
      final ActivityItem created =
          await ref.read(activitiesActionsProvider).createManual(draft);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Semantics(
            liveRegion: true,
            child: const Text('已创建。活动先进入待确认，确认后才会提醒。'),
          ),
        ),
      );
      context.pushReplacement('/activities/${created.id}');
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _formError =
          error is ApiException ? error.error.userMessage : '$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;

    return Scaffold(
      appBar: AppBar(title: const Text('手动添加活动')),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: EdgeInsets.fromLTRB(
              KedaYaTokens.space4,
              KedaYaTokens.space4,
              KedaYaTokens.space4,
              KedaYaTokens.space6 + MediaQuery.viewPaddingOf(context).bottom,
            ),
            children: <Widget>[
              Text(
                '只保存活动字段与 ≤$activityEvidenceMaxChars 字证据摘录。'
                '手动创建的活动先进入「待确认」，确认后才会创建提醒。',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.textMuted,
                ),
              ),
              if (_formError != null) ...<Widget>[
                const SizedBox(height: KedaYaTokens.space3),
                Semantics(
                  liveRegion: true,
                  child: Container(
                    padding: const EdgeInsets.all(KedaYaTokens.space3),
                    decoration: BoxDecoration(
                      color: colors.danger.withValues(alpha: 0.1),
                      borderRadius:
                          BorderRadius.circular(KedaYaTokens.radiusMd),
                      border: Border.all(
                        color: colors.danger.withValues(alpha: 0.35),
                      ),
                    ),
                    child: Text(
                      _formError!,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeSm,
                        color: colors.danger,
                      ),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: KedaYaTokens.space4),
              TextFormField(
                key: const Key('activity-title'),
                controller: _title,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(
                  labelText: '活动名称',
                  helperText: '要能认出来是哪场活动',
                ),
                validator: _validateTitle,
              ),
              const SizedBox(height: KedaYaTokens.space3),
              DropdownButtonFormField<String>(
                key: const Key('activity-kind'),
                initialValue: _kind,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: '活动类型',
                  helperText: '类型来自契约枚举；不确定就选「其他」',
                ),
                items: <DropdownMenuItem<String>>[
                  for (final String kind in activityKinds)
                    DropdownMenuItem<String>(
                      value: kind,
                      child: Text(activityKindLabels[kind] ?? kind),
                    ),
                ],
                onChanged: (String? value) {
                  if (value != null) setState(() => _kind = value);
                },
              ),
              const SizedBox(height: KedaYaTokens.space4),
              _DateTimeField(
                buttonKey: const Key('activity-start-at'),
                label: '开始时间',
                value: formatShanghaiInstantWithZone(_startsAt),
                onPressed: () => unawaited(_pickStart()),
              ),
              const SizedBox(height: KedaYaTokens.space3),
              _DateTimeField(
                buttonKey: const Key('activity-end-at'),
                label: '结束时间（可选）',
                value: _endsAt == null
                    ? '未设置'
                    : formatShanghaiInstantWithZone(_endsAt!),
                onPressed: () => unawaited(_pickEnd()),
                trailing: _endsAt == null
                    ? null
                    : TextButton(
                        onPressed: () => setState(() => _endsAt = null),
                        style: TextButton.styleFrom(
                          minimumSize: const Size(48, 48),
                        ),
                        child: const Text('清除'),
                      ),
              ),
              const SizedBox(height: KedaYaTokens.space3),
              TextFormField(
                key: const Key('activity-location'),
                controller: _location,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(
                  labelText: '地点',
                  helperText: '写清楼和房间号，例如「信息学院 1-101」',
                ),
              ),
              const SizedBox(height: KedaYaTokens.space3),
              TextFormField(
                key: const Key('activity-organizer'),
                controller: _organizer,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(
                  labelText: '主办方',
                  helperText: '可选',
                ),
              ),
              const SizedBox(height: KedaYaTokens.space3),
              TextFormField(
                key: const Key('activity-registration-url'),
                controller: _registrationUrl,
                keyboardType: TextInputType.url,
                textInputAction: TextInputAction.next,
                autocorrect: false,
                enableSuggestions: false,
                spellCheckConfiguration:
                    const SpellCheckConfiguration.disabled(),
                autofillHints: const <String>[AutofillHints.url],
                decoration: const InputDecoration(
                  labelText: '报名链接（可选）',
                  helperText: '只接受 http(s) 地址；应用内不会自动打开',
                ),
                validator: _validateUrl,
              ),
              const SizedBox(height: KedaYaTokens.space4),
              _DateTimeField(
                buttonKey: const Key('activity-deadline-at'),
                label: '报名截止时间（可选）',
                value: _deadlineAt == null
                    ? '未设置'
                    : formatShanghaiInstantWithZone(_deadlineAt!),
                onPressed: () => unawaited(_pickDeadline()),
                trailing: _deadlineAt == null
                    ? null
                    : TextButton(
                        onPressed: () => setState(() => _deadlineAt = null),
                        style: TextButton.styleFrom(
                          minimumSize: const Size(48, 48),
                        ),
                        child: const Text('清除'),
                      ),
              ),
              const SizedBox(height: KedaYaTokens.space3),
              TextFormField(
                key: const Key('activity-deadline-raw'),
                controller: _deadlineRaw,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(
                  labelText: '报名截止原文（可选）',
                  helperText: '不知道具体时刻就照原文填，不会自动补 23:59',
                ),
                maxLength: activityDeadlineRawMaxChars,
              ),
              const SizedBox(height: KedaYaTokens.space3),
              TextFormField(
                key: const Key('activity-evidence'),
                controller: _evidence,
                maxLines: 4,
                maxLength: activityEvidenceMaxChars,
                decoration: const InputDecoration(
                  labelText: '证据摘录（可选）',
                  helperText: '最多 200 字；不要粘贴邮件正文或公众号全文',
                  alignLabelWithHint: true,
                ),
                validator: _validateEvidence,
              ),
              const SizedBox(height: KedaYaTokens.space4),
              FilledButton.icon(
                onPressed: _saving ? null : () => unawaited(_submit()),
                icon: _saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.save_outlined, size: 18),
                label: const Text('保存活动'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                ),
              ),
              const SizedBox(height: KedaYaTokens.space2),
              OutlinedButton(
                onPressed: _saving ? null : () => context.pop(),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                ),
                child: const Text('取消'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DateTimeField extends StatelessWidget {
  const _DateTimeField({
    required this.buttonKey,
    required this.label,
    required this.value,
    required this.onPressed,
    this.trailing,
  });

  final Key buttonKey;
  final String label;
  final String value;
  final VoidCallback onPressed;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          label,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: colors.text,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space1),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton(
            key: buttonKey,
            onPressed: onPressed,
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
              alignment: Alignment.centerLeft,
            ),
            child: Row(
              children: <Widget>[
                const Icon(Icons.calendar_month_outlined, size: 18),
                const SizedBox(width: KedaYaTokens.space2),
                Expanded(
                  child: Text(
                    value,
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeSm,
                      color: colors.text,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        if (trailing != null)
          Align(alignment: Alignment.centerRight, child: trailing),
      ],
    );
  }
}
