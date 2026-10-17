import 'package:flutter/material.dart';

import '../../../../domain/models/buddy_profile.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// **可用时段编辑器（含跨零点）**（规格 §2.2 / §3.3）。
///
/// 三个要点：
///
/// 1. **粒度是分钟**，本地时区 Asia/Shanghai（规格 §2.2）；
/// 2. **跨零点**：用户选「23:00 → 01:00」时，[splitCrossMidnight] 会把它
///    拆成「周一 23:00–24:00」+「周二 00:00–01:00」两段。这是规格 §3.3
///    明确点名的边界情况（「`end > 1440` 时同时检查 `dow + 1` 的时段。
///    **这是边界情况，必须有单测**」）。对话框里会**预览**拆分结果，
///    不让用户在不知情的情况下被拆；
/// 3. 拆分后的时段用 [normalizeAvailability] 去重排序，保证同样的输入
///    得到同样的资料（匹配结果可复现）。
class BuddyAvailabilityEditor extends StatelessWidget {
  const BuddyAvailabilityEditor({
    required this.value,
    required this.onChanged,
    super.key,
  });

  final List<AvailabilitySlot> value;
  final ValueChanged<List<AvailabilitySlot>> onChanged;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: Text(
                '每周可用时段',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  fontWeight: KedaYaTokens.fontWeightSemibold,
                  color: colors.text,
                ),
              ),
            ),
            TextButton.icon(
              onPressed: () => _addSlot(context),
              icon: const Icon(Icons.add, size: 18),
              label: const Text('添加时段'),
            ),
          ],
        ),
        Text(
          '组队最关键的是「时间能不能碰上」—— 所以这里填的时段会参与匹配（规格 §3.3）。',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            color: colors.textMuted,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space2),
        if (value.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(KedaYaTokens.space4),
            decoration: BoxDecoration(
              color: colors.surfaceAlt,
              borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
            ),
            child: Text(
              '还没填时段。不填也能用，但推荐会退化成「按标签与时间排序」。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                color: colors.textMuted,
              ),
            ),
          )
        else
          Wrap(
            spacing: KedaYaTokens.space2,
            runSpacing: KedaYaTokens.space2,
            children: <Widget>[
              for (final AvailabilitySlot slot in value)
                InputChip(
                  label: Text(slot.label),
                  onDeleted: () => onChanged(
                    normalizeAvailability(
                      value
                          .where((AvailabilitySlot item) => item != slot)
                          .toList(growable: false),
                    ),
                  ),
                  backgroundColor: colors.surfaceAlt,
                  side: BorderSide(color: colors.border),
                  labelStyle: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    color: colors.text,
                  ),
                ),
            ],
          ),
        if (hasOverlappingAvailability(value)) ...<Widget>[
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            '有重叠的时段（不影响保存，只是提醒）。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.warning,
            ),
          ),
        ],
      ],
    );
  }

  Future<void> _addSlot(BuildContext context) async {
    final List<AvailabilitySlot>? added =
        await showDialog<List<AvailabilitySlot>>(
      context: context,
      builder: (BuildContext dialogContext) => const _AddSlotDialog(),
    );
    if (added == null || added.isEmpty) return;
    onChanged(normalizeAvailability(<AvailabilitySlot>[...value, ...added]));
  }
}

/// 星期选择顺序：周一…周六、周日（展示习惯），但内部 `dow` 仍是
/// 0 = 周日（与 JS `getDay()` 一致，规格 §3.3）。
const List<int> _dowDisplayOrder = <int>[1, 2, 3, 4, 5, 6, 0];

class _AddSlotDialog extends StatefulWidget {
  const _AddSlotDialog();

  @override
  State<_AddSlotDialog> createState() => _AddSlotDialogState();
}

class _AddSlotDialogState extends State<_AddSlotDialog> {
  int _dow = 1;
  int _startMin = 19 * 60;
  int _endMin = 22 * 60;

  List<AvailabilitySlot> get _parts =>
      splitCrossMidnight(dow: _dow, startMin: _startMin, endMin: _endMin);

  bool get _crossesMidnight => _parts.length > 1;

  Future<void> _pick({required bool isStart}) async {
    final int current = isStart ? _startMin : _endMin;
    final TimeOfDay? picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: (current ~/ 60) % 24, minute: current % 60),
      helpText: isStart ? '选择开始时间' : '选择结束时间（早于开始时间即为跨零点）',
    );
    if (picked == null) return;
    setState(() {
      final int minutes = picked.hour * 60 + picked.minute;
      if (isStart) {
        _startMin = minutes;
      } else {
        _endMin = minutes;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final List<AvailabilitySlot> parts = _parts;
    return AlertDialog(
      title: const Text('添加可用时段'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              '星期',
              style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs, color: colors.textMuted),
            ),
            const SizedBox(height: KedaYaTokens.space1),
            Wrap(
              spacing: KedaYaTokens.space1,
              children: <Widget>[
                for (final int dow in _dowDisplayOrder)
                  ChoiceChip(
                    label: Text(buddyDowLabel(dow)),
                    selected: _dow == dow,
                    showCheckmark: false,
                    onSelected: (bool _) => setState(() => _dow = dow),
                    backgroundColor: colors.surfaceAlt,
                    selectedColor: colors.brandSoft,
                    side: BorderSide(color: colors.border),
                    labelStyle: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color:
                          _dow == dow ? colors.brandStrong : colors.textMuted,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: KedaYaTokens.space3),
            Row(
              children: <Widget>[
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _pick(isStart: true),
                    child: Text('开始 ${buddyMinutesLabel(_startMin)}'),
                  ),
                ),
                const SizedBox(width: KedaYaTokens.space2),
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _pick(isStart: false),
                    child: Text('结束 ${buddyMinutesLabel(_endMin)}'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: KedaYaTokens.space3),
            Text(
              parts.isEmpty
                  ? '这个时段不合法'
                  : '实际保存为：${parts.map((AvailabilitySlot slot) => slot.label).join('、')}',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                color: parts.isEmpty ? colors.danger : colors.text,
              ),
            ),
            if (_crossesMidnight) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space1),
              Text(
                '跨零点：结束时间早于开始时间，会自动拆成当天与次日两段（规格 §3.3）。',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  color: colors.warning,
                ),
              ),
            ],
          ],
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed:
              parts.isEmpty ? null : () => Navigator.of(context).pop(parts),
          child: const Text('添加'),
        ),
      ],
    );
  }
}
