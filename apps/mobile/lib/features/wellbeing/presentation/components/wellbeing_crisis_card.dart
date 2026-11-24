import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../domain/wellbeing_crisis.dart';

/// 首屏热线卡（契约 §9）。
///
/// 它**不读取任何 provider、不发任何请求**：这就是兜底本身。
/// 接口失败、本机记录损坏、同意门尚未通过时，这张卡都照样在页面最上方。
class WellbeingCrisisCard extends StatelessWidget {
  const WellbeingCrisisCard({this.compact = false, super.key});

  /// 预约页使用紧凑版：保留完整文案与号码，去掉大按钮。
  final bool compact;

  Future<void> _copyPhone(BuildContext context) async {
    final String phone = wellbeingCrisisFallback.phone;
    await Clipboard.setData(ClipboardData(text: phone));
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('已复制示例号码；真实号码上线前必须逐个拨通核实'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(
        compact ? KedaYaTokens.space3 : KedaYaTokens.space4,
      ),
      decoration: BoxDecoration(
        color: colors.danger.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(
          color: colors.danger.withValues(alpha: 0.55),
          width: 1.5,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(
                Icons.support_agent,
                size: compact ? 18 : 22,
                color: colors.danger,
              ),
              const SizedBox(width: KedaYaTokens.space2),
              Expanded(
                child: Text(
                  wellbeingCrisisHeadline,
                  style: TextStyle(
                    fontSize: compact
                        ? KedaYaTokens.fontSizeSm
                        : KedaYaTokens.fontSizeMd,
                    fontWeight: KedaYaTokens.fontWeightBold,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.danger,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            wellbeingCrisisPhoneLabel,
            style: TextStyle(
              fontSize:
                  compact ? KedaYaTokens.fontSizeLg : KedaYaTokens.fontSizeXxl,
              fontWeight: KedaYaTokens.fontWeightBold,
              letterSpacing: 0.4,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            wellbeingCrisisFallback.note,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.textMuted,
            ),
          ),
          if (!compact) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space3),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: colors.danger,
                  foregroundColor: colors.textInverse,
                ),
                onPressed: () => _copyPhone(context),
                icon: const Icon(Icons.copy_outlined, size: 18),
                label: const Text('复制号码（示例）'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
