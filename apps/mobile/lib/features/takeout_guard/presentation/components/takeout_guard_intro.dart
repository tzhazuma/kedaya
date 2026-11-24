import 'package:flutter/material.dart';

import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 报备页的固定说明卡。
///
/// 产品要求这句提示**固定出现**：这是本人可见的记录，不是公开举报墙。
class TakeoutGuardIntro extends StatelessWidget {
  const TakeoutGuardIntro({super.key});

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space3),
      decoration: BoxDecoration(
        color: colors.brandSoft,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                Icons.lock_outline,
                size: 18,
                color: colors.brandStrong,
              ),
              const SizedBox(width: KedaYaTokens.space2),
              Expanded(
                child: Text(
                  '只有你自己能看到这些记录',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            '外卖被误拿或丢失时，把时间、地点和餐品记在这里，'
            '方便你跟楼管、平台沟通。记录不会公开，也不会通知任何人。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.text,
            ),
          ),
        ],
      ),
    );
  }
}

/// 空态：解释这个功能是干什么的，而不是只说「暂无数据」。
class TakeoutGuardEmpty extends StatelessWidget {
  const TakeoutGuardEmpty({
    required this.hasFilter,
    this.onReset,
    super.key,
  });

  /// 是否因为筛选条件才为空（此时文案与「一条都没有」不同）。
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
              hasFilter
                  ? Icons.filter_alt_off_outlined
                  : Icons.receipt_long_outlined,
              size: 40,
              color: colors.textMuted,
            ),
            const SizedBox(height: KedaYaTokens.space3),
            Text(
              hasFilter ? '没有符合条件的记录' : '还没有报备记录',
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
                  ? '换个筛选条件看看，或者新增一条报备。'
                  : '这个功能用来记录你自己遇到的外卖被拿错、丢失的情况：'
                      '写下时间、地点和餐品，方便之后跟楼管或平台沟通。'
                      '记录只存在你的列表里，不会公开。',
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
                child: const Text('查看全部记录'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
