import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/buddy.dart';
import '../../../../domain/models/buddy_profile.dart';
import '../../../../domain/models/buddy_tags.dart';
import '../../../../presentation/components/async_state_view.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/buddy_providers.dart';
import '../components/buddy_availability_editor.dart';
import '../components/buddy_tag_picker.dart';

/// 我的匹配资料（规格 §2.2 / §6.3）。
///
/// 与 `profile` 模块**分离**（规格 §2.2）：`profile` 存「我是谁」，
/// `BuddyProfile` 只存「匹配要用的特征」—— 撤回匹配只需删这一份，不动账号资料。
///
/// `matchEnabled` **默认关闭**：匹配需要把「兴趣 / 可用时段」交给算法，
/// 属于对个人信息的**新用途**，必须由用户显式打开（规格 §6.3）。
class BuddyProfilePage extends ConsumerWidget {
  const BuddyProfilePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<BuddyProfile> value = ref.watch(buddyProfileProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('我的匹配资料'),
        actions: <Widget>[
          IconButton(
            tooltip: '隐私说明',
            onPressed: () => context.push('/buddy/privacy'),
            icon: const Icon(Icons.privacy_tip_outlined),
          ),
        ],
      ),
      body: AsyncStateView<BuddyProfile>(
        value: value,
        onRetry: () => ref.invalidate(buddyProfileProvider),
        loadingMessage: '正在加载匹配资料…',
        builder: (BuildContext context, BuddyProfile profile) =>
            _BuddyProfileForm(initial: profile),
      ),
    );
  }
}

class _BuddyProfileForm extends ConsumerStatefulWidget {
  const _BuddyProfileForm({required this.initial});

  final BuddyProfile initial;

  @override
  ConsumerState<_BuddyProfileForm> createState() => _BuddyProfileFormState();
}

class _BuddyProfileFormState extends ConsumerState<_BuddyProfileForm> {
  late BuddyProfile _draft = widget.initial;
  bool _busy = false;

  Future<void> _pickTags({required bool interest}) async {
    final List<String>? picked = await showBuddyTagPicker(
      context: context,
      title: interest ? '兴趣标签' : '活动标签',
      selected: interest ? _draft.interestTags : _draft.activityTags,
      maxCount: interest ? buddyInterestTagMaxCount : buddyActivityTagMaxCount,
    );
    if (picked == null) return;
    setState(() {
      _draft = interest
          ? _draft.copyWith(interestTags: picked)
          : _draft.copyWith(activityTags: picked);
    });
  }

  Future<void> _pickAreas() async {
    final List<String>? picked = await showModalBottomSheet<List<String>>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext sheetContext) =>
          _LocationPickerSheet(selected: _draft.preferredAreas),
    );
    if (picked == null) return;
    setState(() => _draft = _draft.copyWith(preferredAreas: picked));
  }

  Future<void> _save() async {
    final Map<String, String> errors = _draft.validationErrors();
    if (errors.isNotEmpty) {
      setState(() {});
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(buddyActionsProvider).saveProfile(_draft);
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('匹配资料已保存')));
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('$error')));
    }
  }

  Future<void> _delete() async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('删除匹配资料？'),
        content: const Text(
          '会硬删这一份资料（含服务端向量），立即从推荐池移除。账号资料不受影响，'
          '之后可以重新填写。',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('删除'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(buddyActionsProvider).deleteProfile();
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('匹配资料已删除')));
      context.pop();
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('$error')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final Map<String, String> errors = _draft.validationErrors();

    return ListView(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      children: <Widget>[
        // -------------------------------------------------- 匹配开关
        Container(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          decoration: BoxDecoration(
            color: colors.surfaceAlt,
            borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
            border: Border.all(color: colors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _draft.matchEnabled,
                title: const Text('开启匹配（默认关闭）'),
                subtitle: const Text(
                  '开启后你的兴趣与可用时段会参与推荐计算。不开启就不进推荐池。',
                ),
                onChanged: _busy
                    ? null
                    : (bool next) => setState(
                        () => _draft = _draft.copyWith(matchEnabled: next)),
              ),
              Text(
                _draft.isRecommendable
                    ? '当前：会被推荐（已选 ${_draft.matchableSections.length} 个板块）'
                    : '当前：不会被推荐（需要开启开关 + 至少选 1 个板块）',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  color:
                      _draft.isRecommendable ? colors.success : colors.warning,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: KedaYaTokens.space5),

        // -------------------------------------------------- 板块
        _Label(text: '参与板块（至少 1 个才可被推荐）', colors: colors),
        Wrap(
          spacing: KedaYaTokens.space2,
          children: <Widget>[
            for (final BuddySection section in buddyMatchableSections)
              FilterChip(
                label: Text(section.label),
                selected: _draft.matchableSections.contains(section),
                showCheckmark: false,
                onSelected: (bool _) => setState(() {
                  final List<BuddySection> next = <BuddySection>[
                    ..._draft.matchableSections,
                  ];
                  if (next.contains(section)) {
                    next.remove(section);
                  } else {
                    next.add(section);
                  }
                  _draft = _draft.copyWith(sections: next);
                }),
                backgroundColor: colors.surfaceAlt,
                selectedColor: colors.brandSoft,
                side: BorderSide(color: colors.border),
                labelStyle: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  color: _draft.matchableSections.contains(section)
                      ? colors.brandStrong
                      : colors.textMuted,
                ),
              ),
          ],
        ),
        const SizedBox(height: KedaYaTokens.space5),

        // -------------------------------------------------- 标签
        _Label(text: '兴趣标签（封闭标签表，最多 20 个）', colors: colors),
        _PickerRow(
          summary: _draft.interestTags.isEmpty
              ? '还没选'
              : _draft.interestTags.map(buddyTagLabel).join('、'),
          onTap: _busy ? null : () => unawaited(_pickTags(interest: true)),
          colors: colors,
        ),
        if (errors['interestTags'] != null)
          _Error(text: errors['interestTags']!, colors: colors),
        const SizedBox(height: KedaYaTokens.space4),
        _Label(text: '活动标签（最多 10 个）', colors: colors),
        _PickerRow(
          summary: _draft.activityTags.isEmpty
              ? '还没选'
              : _draft.activityTags.map(buddyTagLabel).join('、'),
          onTap: _busy ? null : () => unawaited(_pickTags(interest: false)),
          colors: colors,
        ),
        if (errors['activityTags'] != null)
          _Error(text: errors['activityTags']!, colors: colors),
        const SizedBox(height: KedaYaTokens.space5),

        // -------------------------------------------------- 可用时段
        BuddyAvailabilityEditor(
          value: _draft.availability,
          onChanged: (List<AvailabilitySlot> next) =>
              setState(() => _draft = _draft.copyWith(availability: next)),
        ),
        if (errors['availability'] != null)
          _Error(text: errors['availability']!, colors: colors),
        const SizedBox(height: KedaYaTokens.space5),

        // -------------------------------------------------- 偏好区域
        _Label(text: '常去区域（校园地点白名单，最多 5 个；不是精确坐标）', colors: colors),
        _PickerRow(
          summary: _draft.preferredAreas.isEmpty
              ? '还没选'
              : _draft.preferredAreas.join('、'),
          onTap: _busy ? null : () => unawaited(_pickAreas()),
          colors: colors,
        ),
        if (errors['preferredAreas'] != null)
          _Error(text: errors['preferredAreas']!, colors: colors),
        const SizedBox(height: KedaYaTokens.space5),

        // -------------------------------------------------- 技能水平
        _Label(text: '运动水平（仅「运动组队」板块使用）', colors: colors),
        Wrap(
          spacing: KedaYaTokens.space2,
          children: <Widget>[
            for (final BuddySkillLevel level in BuddySkillLevel.values)
              ChoiceChip(
                label: Text(level.label),
                selected: _draft.skillLevel == level,
                showCheckmark: false,
                onSelected: (bool _) =>
                    setState(() => _draft = _draft.copyWith(skillLevel: level)),
                backgroundColor: colors.surfaceAlt,
                selectedColor: colors.brandSoft,
                side: BorderSide(color: colors.border),
                labelStyle: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  color: _draft.skillLevel == level
                      ? colors.brandStrong
                      : colors.textMuted,
                ),
              ),
          ],
        ),
        const SizedBox(height: KedaYaTokens.space5),

        // -------------------------------------------------- 院系与自述
        _Label(text: '院系（用于「学术自习」板块）', colors: colors),
        TextFormField(
          initialValue: _draft.department ?? '',
          maxLength: buddyDepartmentMaxLength,
          onChanged: (String value) => setState(
            () => _draft = value.trim().isEmpty
                ? _draft.copyWith(clearDepartment: true)
                : _draft.copyWith(department: value),
          ),
          decoration: InputDecoration(
            hintText: '例如：信息科学与技术学院',
            errorText: errors['department'],
            border: const OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: KedaYaTokens.space3),
        _Label(text: '一句话自述（可选）', colors: colors),
        TextFormField(
          initialValue: _draft.bio ?? '',
          maxLines: 2,
          maxLength: buddyBioMaxLength,
          onChanged: (String value) => setState(
            () => _draft = value.trim().isEmpty
                ? _draft.copyWith(clearBio: true)
                : _draft.copyWith(bio: value),
          ),
          decoration: InputDecoration(
            hintText: '例如：常泡图书馆，羽毛球随便打打',
            errorText: errors['bio'],
            border: const OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: KedaYaTokens.space5),

        // -------------------------------------------------- 保存 / 删除
        FilledButton(
          onPressed:
              _busy || errors.isNotEmpty ? null : () => unawaited(_save()),
          child: Text(_busy ? '处理中…' : '保存匹配资料'),
        ),
        const SizedBox(height: KedaYaTokens.space2),
        OutlinedButton(
          onPressed: _busy ? null : () => unawaited(_delete()),
          child: const Text('删除匹配资料（可随时撤回）'),
        ),
        if (errors.isNotEmpty) ...<Widget>[
          const SizedBox(height: KedaYaTokens.space3),
          _Error(
            text: '还有 ${errors.length} 项需要修正：${errors.keys.join('、')}',
            colors: colors,
          ),
        ],
        const SizedBox(height: KedaYaTokens.space6),
      ],
    );
  }
}

/// 常去区域多选（校园地点白名单，≤5）。
class _LocationPickerSheet extends StatefulWidget {
  const _LocationPickerSheet({required this.selected});

  final List<String> selected;

  @override
  State<_LocationPickerSheet> createState() => _LocationPickerSheetState();
}

class _LocationPickerSheetState extends State<_LocationPickerSheet> {
  late List<String> _selected = <String>[...widget.selected];

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              '常去区域（最多 $buddyPreferredAreaMaxCount 个）',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeMd,
                fontWeight: KedaYaTokens.fontWeightSemibold,
                color: colors.text,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space1),
            Text(
              '只到「区域」粒度，**不是**精确坐标（规格 §6.3：不采集精确位置）。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.textMuted,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space3),
            Flexible(
              child: SingleChildScrollView(
                child: Wrap(
                  spacing: KedaYaTokens.space2,
                  runSpacing: KedaYaTokens.space2,
                  children: <Widget>[
                    for (final String location in buddyCampusLocations)
                      FilterChip(
                        label: Text(location),
                        selected: _selected.contains(location),
                        showCheckmark: false,
                        onSelected: (bool _) => setState(() {
                          if (_selected.contains(location)) {
                            _selected = _selected
                                .where((String item) => item != location)
                                .toList(growable: false);
                          } else if (_selected.length <
                              buddyPreferredAreaMaxCount) {
                            _selected = <String>[..._selected, location];
                          }
                        }),
                        backgroundColor: colors.surfaceAlt,
                        selectedColor: colors.brandSoft,
                        side: BorderSide(color: colors.border),
                        labelStyle: TextStyle(
                          fontSize: KedaYaTokens.fontSizeSm,
                          color: _selected.contains(location)
                              ? colors.brandStrong
                              : colors.textMuted,
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: KedaYaTokens.space4),
            Row(
              children: <Widget>[
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('取消'),
                  ),
                ),
                const SizedBox(width: KedaYaTokens.space3),
                Expanded(
                  child: FilledButton(
                    onPressed: () => Navigator.of(context).pop(_selected),
                    child: const Text('确定'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ 小组件

class _Label extends StatelessWidget {
  const _Label({required this.text, required this.colors});

  final String text;
  final KedaYaColors colors;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: KedaYaTokens.space2),
        child: Text(
          text,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: colors.text,
          ),
        ),
      );
}

class _PickerRow extends StatelessWidget {
  const _PickerRow({
    required this.summary,
    required this.onTap,
    required this.colors,
  });

  final String summary;
  final VoidCallback? onTap;
  final KedaYaColors colors;

  @override
  Widget build(BuildContext context) => OutlinedButton(
        onPressed: onTap,
        child: SizedBox(
          width: double.infinity,
          child: Text(summary, textAlign: TextAlign.left),
        ),
      );
}

class _Error extends StatelessWidget {
  const _Error({required this.text, required this.colors});

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
