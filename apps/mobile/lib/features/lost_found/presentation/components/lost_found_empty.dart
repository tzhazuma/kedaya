import 'package:flutter/material.dart';

import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 空态：区分「一条都没有」与「筛选后没有」。
class LostFoundEmpty extends StatelessWidget {
  const LostFoundEmpty({
    required this.hasFilter,
    this.onReset,
    super.key,
  });

  final bool hasFilter;
  final VoidCallback? onReset;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(KedaYaTokens.space6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(
              hasFilter ? Icons.search_off : Icons.inventory_2_outlined,
              size: 40,
              color: colors.textMuted,
            ),
            const SizedBox(height: KedaYaTokens.space3),
            Text(
              hasFilter ? '没有符合条件的条目' : '还没有失物招领信息',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeMd,
                fontWeight: KedaYaTokens.fontWeightSemibold,
                color: colors.text,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space2),
            Text(
              hasFilter
                  ? '换个关键词或筛选条件试试。'
                  : '这里可以发布你丢了什么，也可以发布你捡到了什么：'
                      '写清地点和时间，留下能公开的联系方式，'
                      '失主或拾获者就能找到你。',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightLoose,
                color: colors.textMuted,
              ),
            ),
            if (hasFilter && onReset != null) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space3),
              TextButton(
                onPressed: onReset,
                child: const Text('清除筛选'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
