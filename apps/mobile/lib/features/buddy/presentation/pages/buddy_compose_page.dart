import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/buddy.dart';
import '../../../../domain/models/buddy_profile.dart';
import '../../../../domain/models/buddy_tags.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/buddy_providers.dart';
import '../components/buddy_tag_picker.dart';

/// 发布活动（规格 §5.4）。
///
/// **板块不单独选**：板块由 `activity` **派生**（规格 §2.3：「不新增 `section` 字段：
/// 板块由 `activity` 派生，避免同一信息两处存储导致不一致」）。因此表单里选的是
/// **活动类型**，页面上只把派生出来的板块显示给用户看。
///
/// **标签是封闭选择器**（[showBuddyTagPicker]），没有自由文本入口（规格 §3.2）。
///
/// **没有 dating 板块可选**（契约 §11.10-G）。
class BuddyComposePage extends ConsumerStatefulWidget {
  const BuddyComposePage({super.key});

  @override
  ConsumerState<BuddyComposePage> createState() => _BuddyComposePageState();
}

class _BuddyComposePageState extends ConsumerState<BuddyComposePage> {
  BuddyPostDraft _draft = const BuddyPostDraft();
  bool _submitting = false;

  static const List<int> _durationChoices = <int>[
    30,
    60,
    90,
    120,
    180,
    240,
    480
  ];

  Future<void> _submit() async {
    final Map<String, String> errors =
        _draft.validationErrorsAt(DateTime.now());
    if (errors.isNotEmpty) {
      setState(() {});
      return;
    }
    setState(() => _submitting = true);
    try {
      await ref.read(buddyActionsProvider).createPost(_draft.toCommand());
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('发布成功')));
      context.pop();
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _submitting = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('$error')));
    }
  }

  Future<void> _pickStartsAt() async {
    final DateTime now = DateTime.now();
    final DateTime base = _draft.startsAt ?? now.add(const Duration(days: 1));
    final DateTime? date = await showDatePicker(
      context: context,
      initialDate: base,
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
      helpText: '选择活动日期',
    );
    if (date == null || !mounted) return;
    final TimeOfDay? time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: base.hour, minute: base.minute),
      helpText: '选择开始时间（本地时间 Asia/Shanghai）',
    );
    if (time == null) return;
    // 用户选的是**上海本地墙上时间**（规格 §2.2：本地时区 Asia/Shanghai）。
    // 因此先按 UTC 组装，再减去固定偏移，得到正确的绝对时刻。
    setState(() {
      _draft = _draft.copyWith(
        startsAt: DateTime.utc(
          date.year,
          date.month,
          date.day,
          time.hour,
          time.minute,
        ).subtract(buddyShanghaiUtcOffset),
      );
    });
  }

  Future<void> _pickTags() async {
    final List<String>? picked = await showBuddyTagPicker(
      context: context,
      title: '活动标签',
      selected: _draft.tags,
      maxCount: buddyPostTagMaxCount,
    );
    if (picked == null) return;
    setState(() => _draft = _draft.copyWith(tags: picked));
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final Map<String, String> errors =
        _draft.validationErrorsAt(DateTime.now());
    final DateTime? startsAt = _draft.startsAt;

    return Scaffold(
      appBar: AppBar(title: const Text('发布搭子活动')),
      body: ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          _FieldLabel(label: '活动类型（板块由它派生）', colors: colors),
          Wrap(
            spacing: KedaYaTokens.space2,
            runSpacing: KedaYaTokens.space2,
            children: <Widget>[
              for (final BuddyActivity activity in BuddyActivity.values)
                ChoiceChip(
                  label: Text(
                      '${activity.label}·${sectionOfActivity(activity).label}'),
                  selected: _draft.activity == activity,
                  showCheckmark: false,
                  onSelected: (bool _) => setState(
                      () => _draft = _draft.copyWith(activity: activity)),
                  backgroundColor: colors.surfaceAlt,
                  selectedColor: colors.brandSoft,
                  side: BorderSide(color: colors.border),
                  labelStyle: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    color: _draft.activity == activity
                        ? colors.brandStrong
                        : colors.textMuted,
                  ),
                ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space5),
          _FieldLabel(label: '标题', colors: colors),
          TextFormField(
            maxLength: buddyTitleMaxLength,
            initialValue: _draft.title,
            onChanged: (String value) =>
                setState(() => _draft = _draft.copyWith(title: value)),
            decoration: InputDecoration(
              hintText: '例如：周六下午羽毛球，缺 2 人',
              errorText: errors['title'],
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _FieldLabel(label: '说明（可选）', colors: colors),
          TextFormField(
            maxLines: 4,
            maxLength: buddyDescriptionMaxLength,
            initialValue: _draft.description,
            onChanged: (String value) =>
                setState(() => _draft = _draft.copyWith(description: value)),
            decoration: InputDecoration(
              hintText: '集合地点、强度、注意事项……**不要写联系方式**',
              errorText: errors['description'],
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _FieldLabel(label: '地点（校园地点白名单）', colors: colors),
          DropdownButtonFormField<String>(
            initialValue: _draft.location.isEmpty ? null : _draft.location,
            isExpanded: true,
            hint: const Text('选择地点'),
            decoration: InputDecoration(
              errorText: errors['location'],
              border: const OutlineInputBorder(),
            ),
            items: <DropdownMenuItem<String>>[
              for (final String location in buddyCampusLocations)
                DropdownMenuItem<String>(
                    value: location, child: Text(location)),
            ],
            onChanged: (String? value) => setState(
              () => _draft = _draft.copyWith(location: value ?? ''),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _FieldLabel(label: '开始时间', colors: colors),
          OutlinedButton.icon(
            onPressed: _pickStartsAt,
            icon: const Icon(Icons.schedule_outlined, size: 18),
            label: Text(
              startsAt == null
                  ? '选择日期与时间'
                  : '${buddyLocalFullLabel(startsAt)}（本地时间）',
            ),
          ),
          if (errors['startsAt'] != null)
            _ErrorText(text: errors['startsAt']!, colors: colors),
          const SizedBox(height: KedaYaTokens.space3),
          _FieldLabel(label: '预计时长', colors: colors),
          Wrap(
            spacing: KedaYaTokens.space2,
            children: <Widget>[
              for (final int minutes in _durationChoices)
                ChoiceChip(
                  label: Text('$minutes 分钟'),
                  selected: _draft.durationMin == minutes,
                  showCheckmark: false,
                  onSelected: (bool _) => setState(
                      () => _draft = _draft.copyWith(durationMin: minutes)),
                  backgroundColor: colors.surfaceAlt,
                  selectedColor: colors.brandSoft,
                  side: BorderSide(color: colors.border),
                  labelStyle: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    color: _draft.durationMin == minutes
                        ? colors.brandStrong
                        : colors.textMuted,
                  ),
                ),
            ],
          ),
          if (errors['durationMin'] != null)
            _ErrorText(text: errors['durationMin']!, colors: colors),
          const SizedBox(height: KedaYaTokens.space3),
          _FieldLabel(
            label: '总人数（含你自己）：${_draft.capacity} 人',
            colors: colors,
          ),
          Slider(
            value: _draft.capacity.toDouble(),
            min: buddyCapacityMin.toDouble(),
            max: buddyCapacityMax.toDouble(),
            divisions: buddyCapacityMax - buddyCapacityMin,
            label: '${_draft.capacity}',
            onChanged: (double value) => setState(
              () => _draft = _draft.copyWith(capacity: value.round()),
            ),
          ),
          if (errors['capacity'] != null)
            _ErrorText(text: errors['capacity']!, colors: colors),
          const SizedBox(height: KedaYaTokens.space3),
          _FieldLabel(label: '性别偏好（发起人的准入约束，不参与打分）', colors: colors),
          SegmentedButton<BuddyGenderPreference>(
            segments: <ButtonSegment<BuddyGenderPreference>>[
              for (final BuddyGenderPreference value
                  in BuddyGenderPreference.values)
                ButtonSegment<BuddyGenderPreference>(
                  value: value,
                  label: Text(value.label),
                ),
            ],
            selected: <BuddyGenderPreference>{_draft.genderPreference},
            onSelectionChanged: (Set<BuddyGenderPreference> selection) =>
                setState(
              () => _draft = _draft.copyWith(genderPreference: selection.first),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space5),
          _FieldLabel(label: '活动标签（封闭标签表，最多 8 个）', colors: colors),
          OutlinedButton.icon(
            onPressed: _pickTags,
            icon: const Icon(Icons.local_offer_outlined, size: 18),
            label: Text(
              _draft.tags.isEmpty
                  ? '选择标签'
                  : _draft.tags.map(buddyTagLabel).join('、'),
            ),
          ),
          if (errors['tags'] != null)
            _ErrorText(text: errors['tags']!, colors: colors),
          if (_draft.section == BuddySection.sport) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space5),
            _FieldLabel(label: '运动水平要求（硬过滤，不是打分）', colors: colors),
            Wrap(
              spacing: KedaYaTokens.space2,
              children: <Widget>[
                ChoiceChip(
                  label: const Text('不限'),
                  selected: _draft.minSkillLevel == null,
                  showCheckmark: false,
                  onSelected: (bool _) => setState(
                    () => _draft = _draft.copyWith(clearMinSkillLevel: true),
                  ),
                  backgroundColor: colors.surfaceAlt,
                  selectedColor: colors.brandSoft,
                  side: BorderSide(color: colors.border),
                  labelStyle: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    color: _draft.minSkillLevel == null
                        ? colors.brandStrong
                        : colors.textMuted,
                  ),
                ),
                for (final BuddySkillLevel level in BuddySkillLevel.values)
                  ChoiceChip(
                    label: Text(level.label),
                    selected: _draft.minSkillLevel == level,
                    showCheckmark: false,
                    onSelected: (bool _) => setState(
                      () => _draft = _draft.copyWith(minSkillLevel: level),
                    ),
                    backgroundColor: colors.surfaceAlt,
                    selectedColor: colors.brandSoft,
                    side: BorderSide(color: colors.border),
                    labelStyle: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: _draft.minSkillLevel == level
                          ? colors.brandStrong
                          : colors.textMuted,
                    ),
                  ),
              ],
            ),
          ],
          const SizedBox(height: KedaYaTokens.space6),
          FilledButton(
            onPressed: _submitting || errors.isNotEmpty
                ? null
                : () => unawaited(_submit()),
            child: Text(_submitting ? '发布中…' : '发布'),
          ),
          if (errors.isNotEmpty) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space3),
            _ErrorText(
              text: '还有 ${errors.length} 项需要修正：${errors.keys.join('、')}',
              colors: colors,
            ),
          ],
          const SizedBox(height: KedaYaTokens.space6),
        ],
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel({required this.label, required this.colors});

  final String label;
  final KedaYaColors colors;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: KedaYaTokens.space2),
        child: Text(
          label,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: colors.text,
          ),
        ),
      );
}

class _ErrorText extends StatelessWidget {
  const _ErrorText({required this.text, required this.colors});

  final String text;
  final KedaYaColors colors;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: KedaYaTokens.space1),
        child: Text(
          text,
          style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs, color: colors.danger),
        ),
      );
}
