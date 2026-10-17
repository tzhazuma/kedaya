import 'package:flutter/material.dart';

import '../../../../domain/models/wildlife.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 伦理提示 + 一次性确认（规格 §8.1 / §8.2）。
///
/// ## 这是**表单校验**，不是同意门
///
/// 规格 §8.2 把两者的区别写得很清楚，实现时**极容易被误做成同意门**：
///
/// | | 同意门（`wellbeing` 等） | **本组件的勾选** |
/// | --- | --- | --- |
/// | 性质 | 独立的授权状态，可撤回 | 单次表单的操作确认 |
/// | 缺它 | **整个模块不可用**（`CONSENT_REQUIRED`） | **只有该次提交被拒**（`VALIDATION_FAILED`） |
/// | 影响浏览 | 是 | **否**：浏览地图、看区域、看别人的上报完全不受影响 |
///
/// 因此本组件**不写任何同意记录**、不产生授权状态、也不经过 `ConsentPort`
/// （契约 §9 的同意门只适用于 `wellbeing` / `dorm-harmony` / `ai-portrait`）。
///
/// 内容取 [wildlifeEthicsRules]（≤5 条、每条 ≤20 字，由单测锁住）。
class WildlifeEthicsNotice extends StatelessWidget {
  const WildlifeEthicsNotice({
    required this.acknowledged,
    required this.onChanged,
    this.forbiddenZoneName,
    super.key,
  });

  final bool acknowledged;
  final ValueChanged<bool> onChanged;

  /// 选中的区域是 `forbidden` 时传区域名 → 顶部出**红色警告条**（规格 §8.3）。
  final String? forbiddenZoneName;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(
          color: acknowledged
              ? colors.border
              : colors.warning.withValues(alpha: 0.6),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (forbiddenZoneName != null) ...<Widget>[
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(KedaYaTokens.space3),
              decoration: BoxDecoration(
                color: colors.danger.withValues(alpha: 0.14),
                borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Icon(Icons.report_gmailerrorred,
                      size: 18, color: colors.danger),
                  const SizedBox(width: KedaYaTokens.space2),
                  Expanded(
                    child: Text(
                      '「$forbiddenZoneName」禁止投喂，请勿投喂动物',
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeSm,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: colors.danger,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: KedaYaTokens.space3),
          ],
          Row(
            children: <Widget>[
              Icon(Icons.volunteer_activism_outlined,
                  size: 18, color: colors.brandStrong),
              const SizedBox(width: KedaYaTokens.space2),
              Text(
                '观察动物的基本约定',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  fontWeight: KedaYaTokens.fontWeightSemibold,
                  color: colors.text,
                ),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space2),
          for (final String rule in wildlifeEthicsRules)
            Padding(
              padding: const EdgeInsets.only(bottom: KedaYaTokens.space1),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('· ', style: TextStyle(color: colors.textMuted)),
                  Expanded(
                    child: Text(
                      rule,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeXs,
                        height: KedaYaTokens.lineHeightNormal,
                        color: colors.text,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: KedaYaTokens.space2),
          CheckboxListTile(
            value: acknowledged,
            onChanged: (bool? value) => onChanged(value ?? false),
            contentPadding: EdgeInsets.zero,
            dense: true,
            controlAffinity: ListTileControlAffinity.leading,
            title: const Text(wildlifeEthicsAckLabel),
            subtitle: Text(
              '这只是本次提交的操作确认，不是授权：不勾选只会拒绝这次提交，'
              '浏览地图与查看他人的上报完全不受影响。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                height: KedaYaTokens.lineHeightNormal,
                color: colors.textMuted,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
