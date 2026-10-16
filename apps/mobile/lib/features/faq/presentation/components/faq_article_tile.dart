import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../domain/models/faq.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/faq_providers.dart';

/// 一条 FAQ：手风琴展开 + 「有用」按钮。
///
/// **幂等**在这里是双层保证：
/// ① 服务端（以及 mock）按 `voterId` 去重，重复调用只计一次；
/// ② UI 记住"我已经投过"（[faqHelpfulOverridesProvider]），按钮变为已标记并禁用，
///    因此正常路径下根本不会发出第二次请求。
class FaqArticleTile extends ConsumerWidget {
  const FaqArticleTile({required this.article, super.key});

  final FaqArticle article;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final Map<String, int> overrides = ref.watch(faqHelpfulOverridesProvider);
    // 局部覆盖：投票后只替换这一条的计数，不整页失效（避免列表闪回 loading）。
    final int helpfulCount = overrides[article.id] ?? article.helpfulCount;
    final bool voted = overrides.containsKey(article.id);
    final FaqHelpfulActions actions = ref.read(faqHelpfulProvider);

    return Card(
      child: ExpansionTile(
        title: Text(
          article.question,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: colors.text,
          ),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: KedaYaTokens.space1),
          child: Text(
            '$helpfulCount 人觉得有用',
            style: TextStyle(fontSize: KedaYaTokens.fontSizeXs, color: colors.textMuted),
          ),
        ),
        childrenPadding: const EdgeInsets.fromLTRB(
          KedaYaTokens.space4,
          0,
          KedaYaTokens.space4,
          KedaYaTokens.space4,
        ),
        expandedCrossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            article.answer,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              height: KedaYaTokens.lineHeightLoose,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          Row(
            children: <Widget>[
              OutlinedButton.icon(
                onPressed: voted ? null : () => _vote(context, actions),
                icon: const Icon(Icons.thumb_up_outlined, size: 16),
                label: Text(voted ? '已标记有用' : '有用'),
              ),
              const SizedBox(width: KedaYaTokens.space2),
              Expanded(
                child: Text(
                  voted ? '已记录，重复点击不会重复计数' : '这条回答对你有帮助吗？',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    color: colors.textMuted,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _vote(BuildContext context, FaqHelpfulActions actions) async {
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    try {
      final FaqHelpfulResult result = await actions.markHelpful(article.id);
      messenger.showSnackBar(
        SnackBar(
          content: Text(result.counted ? '感谢反馈！' : '你已经标记过「有用」了'),
        ),
      );
    } on Object catch (error) {
      messenger.showSnackBar(SnackBar(content: Text('$error')));
    }
  }
}
