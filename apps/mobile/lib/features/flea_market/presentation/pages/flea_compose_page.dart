import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../domain/models/flea_listing.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/flea_market_providers.dart';

/// 发布闲置（`/flea-market/new`）。
///
/// 字段集合与 [FleaDraft] 一一对应；校验只调用 [validateFleaDraft]，
/// 页面里不复制"什么算合法价格"。
///
/// 刻意没有手机号 / 微信号 / 聊天入口：联系文案由标题、价格、地点拼成，
/// 用户复制后自己发给对方。
class FleaComposePage extends ConsumerStatefulWidget {
  const FleaComposePage({super.key});

  @override
  ConsumerState<FleaComposePage> createState() => _FleaComposePageState();
}

class _FleaComposePageState extends ConsumerState<FleaComposePage> {
  final TextEditingController _title = TextEditingController();
  final TextEditingController _price = TextEditingController();
  final TextEditingController _location = TextEditingController();
  final TextEditingController _description = TextEditingController();

  FleaCondition _condition = FleaCondition.likeNew;
  FleaCategory _category = FleaCategory.other;
  List<FleaDraftProblem> _problems = const <FleaDraftProblem>[];

  @override
  void dispose() {
    _title.dispose();
    _price.dispose();
    _location.dispose();
    _description.dispose();
    super.dispose();
  }

  FleaDraft _draft() => FleaDraft(
        title: _title.text,
        priceYuan: _price.text,
        condition: _condition,
        category: _category,
        location: _location.text,
        description: _description.text,
      );

  void _submit() {
    final FleaDraft draft = _draft();
    final List<FleaDraftProblem> problems = validateFleaDraft(draft);
    setState(() => _problems = problems);
    if (problems.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('还有 ${problems.length} 处需要改一下')),
      );
      return;
    }

    try {
      final FleaListing listing =
          ref.read(fleaMarketListingsProvider.notifier).publish(draft);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('已发布「${listing.title}」')),
      );
      Navigator.of(context).maybePop(true);
    } on FleaDraftException catch (error) {
      if (!mounted) return;
      setState(() => _problems = error.problems);
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$error')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;

    return KedaYaPageScaffold(
      title: '发布闲置',
      child: ListView(
        children: <Widget>[
          _label('标题'),
          TextField(
            controller: _title,
            maxLength: fleaTitleMax,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(
              hintText: '例如：高等数学教材（第七版）上册',
              border: OutlineInputBorder(),
            ),
          ),
          _label('价格'),
          TextField(
            controller: _price,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              hintText: '25',
              suffixText: '元',
              helperText: '只能填整数或一位小数，例如 25 / 12.5',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _label('成色'),
          Wrap(
            spacing: KedaYaTokens.space2,
            runSpacing: KedaYaTokens.space2,
            children: <Widget>[
              for (final FleaCondition condition in FleaCondition.values)
                ChoiceChip(
                  label: Text(condition.label),
                  selected: _condition == condition,
                  showCheckmark: false,
                  onSelected: (bool _) =>
                      setState(() => _condition = condition),
                ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _label('分类'),
          Wrap(
            spacing: KedaYaTokens.space2,
            runSpacing: KedaYaTokens.space2,
            children: <Widget>[
              for (final FleaCategory category in FleaCategory.values)
                ChoiceChip(
                  label: Text(category.label),
                  selected: _category == category,
                  showCheckmark: false,
                  onSelected: (bool _) => setState(() => _category = category),
                ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space3),
          _label('描述（选填，最多 $fleaDescriptionMax 字）'),
          TextField(
            controller: _description,
            maxLength: fleaDescriptionMax,
            minLines: 3,
            maxLines: 4,
            decoration: const InputDecoration(
              hintText: '使用时长、有没有配件、哪里有小瑕疵…',
              border: OutlineInputBorder(),
              alignLabelWithHint: true,
            ),
          ),
          _label('交易地点'),
          TextField(
            controller: _location,
            maxLength: fleaLocationMax,
            decoration: const InputDecoration(
              hintText: '例如：三号宿舍楼下 / 图书馆一楼大厅',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Container(
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
                      Icons.privacy_tip_outlined,
                      size: 18,
                      color: colors.brandStrong,
                    ),
                    const SizedBox(width: KedaYaTokens.space1),
                    Text(
                      '不需要留手机号',
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeSm,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: colors.text,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: KedaYaTokens.space1),
                Text(
                  '联系文案由标题、价格和地点自动生成，复制后自己发给对方。'
                  '发布内容只保存在本机，属于演示数据。',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.text,
                  ),
                ),
              ],
            ),
          ),
          if (_problems.isNotEmpty) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space3),
            Container(
              padding: const EdgeInsets.all(KedaYaTokens.space3),
              decoration: BoxDecoration(
                color: colors.danger.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
                border: Border.all(color: colors.danger.withValues(alpha: 0.4)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  for (final FleaDraftProblem problem in _problems)
                    Padding(
                      padding:
                          const EdgeInsets.only(bottom: KedaYaTokens.space1),
                      child: Text(
                        '· ${describeFleaDraftProblem(problem)}',
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeXs,
                          height: KedaYaTokens.lineHeightNormal,
                          color: colors.danger,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
          const SizedBox(height: KedaYaTokens.space5),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _submit,
              icon: const Icon(Icons.send_outlined, size: 18),
              label: const Text('发布'),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          Center(
            child: TextButton(
              onPressed: () => Navigator.of(context).maybePop(),
              child: const Text('取消'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: KedaYaTokens.space2),
        child: Text(
          text,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: context.kedayaColors.text,
          ),
        ),
      );
}
