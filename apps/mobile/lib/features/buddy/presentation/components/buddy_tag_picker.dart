import 'package:flutter/material.dart';

import '../../../../domain/models/buddy_tags.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// **封闭标签选择器**（规格 §3.2）。
///
/// 为什么不是自由文本输入框：规格 §3.2 的核心结论是
/// 「`interestTags` / `activityTags` / `BuddyPost.tags` **一律取自服务端维护的
/// 封闭标签表**，不允许自由文本进入匹配特征」——
/// 自由文本会让 `"羽毛球"` / `"打羽毛球"` / `"badminton"` 互不匹配
/// （STUMatch 的 `matching.py:277-282` 就是靠字符串精确相等，很脆弱）。
///
/// 因此本组件**只能从 [buddyActiveTags] 里选**：
///   - 没有"自定义标签"入口（有入口就等于自由文本）；
///   - 已下架标签（`isActive: false`）不出现在候选里，但已选中的会照常显示
///     （历史数据不能被吞掉，规格 §3.2「下架标签不删除」）。
///
/// 返回 `null` 表示用户取消（不修改原值）。
Future<List<String>?> showBuddyTagPicker({
  required BuildContext context,
  required String title,
  required List<String> selected,
  required int maxCount,
  BuddyTagGroup? group,
}) =>
    showModalBottomSheet<List<String>>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext sheetContext) => _BuddyTagPickerSheet(
        title: title,
        selected: selected,
        maxCount: maxCount,
        group: group,
      ),
    );

class _BuddyTagPickerSheet extends StatefulWidget {
  const _BuddyTagPickerSheet({
    required this.title,
    required this.selected,
    required this.maxCount,
    this.group,
  });

  final String title;
  final List<String> selected;
  final int maxCount;
  final BuddyTagGroup? group;

  @override
  State<_BuddyTagPickerSheet> createState() => _BuddyTagPickerSheetState();
}

class _BuddyTagPickerSheetState extends State<_BuddyTagPickerSheet> {
  late List<String> _selected = <String>[...widget.selected];
  String _keyword = '';

  void _toggle(String key) {
    setState(() {
      if (_selected.contains(key)) {
        _selected = _selected
            .where((String item) => item != key)
            .toList(growable: false);
        return;
      }
      if (_selected.length >= widget.maxCount) return;
      _selected = <String>[..._selected, key];
    });
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final List<BuddyTag> candidates =
        searchBuddyTags(_keyword, group: widget.group);
    final bool full = _selected.length >= widget.maxCount;

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: KedaYaTokens.space4,
          right: KedaYaTokens.space4,
          top: KedaYaTokens.space4,
          bottom: MediaQuery.viewInsetsOf(context).bottom + KedaYaTokens.space4,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    widget.title,
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeMd,
                      fontWeight: KedaYaTokens.fontWeightSemibold,
                      color: colors.text,
                    ),
                  ),
                ),
                Text(
                  '${_selected.length}/${widget.maxCount}',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    color: full ? colors.danger : colors.textMuted,
                  ),
                ),
              ],
            ),
            const SizedBox(height: KedaYaTokens.space1),
            Text(
              '只能从封闭标签表里选 —— 自由文本无法参与匹配（规格 §3.2）',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.textMuted,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space3),
            TextField(
              onChanged: (String value) => setState(() => _keyword = value),
              decoration: const InputDecoration(
                isDense: true,
                prefixIcon: Icon(Icons.search, size: 18),
                hintText: '搜索标签（支持别名）',
              ),
            ),
            const SizedBox(height: KedaYaTokens.space3),
            Flexible(
              child: candidates.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.all(KedaYaTokens.space6),
                      child: Text(
                        '没有匹配的标签',
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeSm,
                          color: colors.textMuted,
                        ),
                      ),
                    )
                  : SingleChildScrollView(
                      child: Wrap(
                        spacing: KedaYaTokens.space2,
                        runSpacing: KedaYaTokens.space2,
                        children: <Widget>[
                          for (final BuddyTag tag in candidates)
                            FilterChip(
                              label: Text(tag.label),
                              selected: _selected.contains(tag.key),
                              showCheckmark: false,
                              onSelected: (bool _) => _toggle(tag.key),
                              backgroundColor: colors.surfaceAlt,
                              selectedColor: colors.brandSoft,
                              side: BorderSide(color: colors.border),
                              labelStyle: TextStyle(
                                fontSize: KedaYaTokens.fontSizeSm,
                                color: _selected.contains(tag.key)
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
