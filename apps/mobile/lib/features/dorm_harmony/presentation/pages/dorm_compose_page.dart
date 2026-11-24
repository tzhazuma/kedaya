import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../domain/models/dorm_post.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/dorm_harmony_providers.dart';
import '../../data/dorm_harmony_repository.dart';
import '../components/dorm_safety_notice.dart';

/// 匿名发帖：楼栋 / 标题 / 正文（≤500 字）。
class DormComposePage extends ConsumerStatefulWidget {
  const DormComposePage({super.key});

  @override
  ConsumerState<DormComposePage> createState() => _DormComposePageState();
}

class _DormComposePageState extends ConsumerState<DormComposePage> {
  final TextEditingController _title = TextEditingController();
  final TextEditingController _body = TextEditingController();

  String _building = dormBuildings.first;
  List<DormPostProblem> _problems = const <DormPostProblem>[];

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  void _submit() {
    final DormPostDraft draft = DormPostDraft(
      building: _building,
      title: _title.text,
      body: _body.text,
    );
    final List<DormPostProblem> problems = validateDormPostDraft(draft);
    setState(() => _problems = problems);

    if (problems.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('还有 ${problems.length} 处需要改一下')),
      );
      return;
    }

    try {
      ref.read(dormHarmonyPostsProvider.notifier).create(draft);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已匿名发布。帖子只保存在本机。')),
      );
      Navigator.of(context).maybePop(true);
    } on DormHarmonyException catch (error) {
      setState(() => _problems = const <DormPostProblem>[]);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.message)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;

    return KedaYaPageScaffold(
      title: '匿名发帖',
      padding: EdgeInsets.zero,
      child: Column(
        children: <Widget>[
          const Padding(
            padding: EdgeInsets.fromLTRB(
              KedaYaTokens.space4,
              KedaYaTokens.space3,
              KedaYaTokens.space4,
              0,
            ),
            child: DormSafetyNotice(),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(KedaYaTokens.space4),
              children: <Widget>[
                _label('楼栋'),
                Wrap(
                  spacing: KedaYaTokens.space2,
                  runSpacing: KedaYaTokens.space2,
                  children: <Widget>[
                    for (final String building in dormBuildings)
                      ChoiceChip(
                        label: Text(building),
                        selected: _building == building,
                        onSelected: (bool selected) {
                          if (!selected) return;
                          setState(() => _building = building);
                        },
                      ),
                  ],
                ),
                const SizedBox(height: KedaYaTokens.space3),
                _label('标题'),
                TextField(
                  controller: _title,
                  decoration: const InputDecoration(
                    hintText: '用一句话说清具体的事',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: KedaYaTokens.space3),
                _label('正文（≤$dormPostBodyMax 字）'),
                TextField(
                  controller: _body,
                  maxLines: 8,
                  maxLength: dormPostBodyMax,
                  decoration: const InputDecoration(
                    hintText: '发生了什么、你希望怎么解决、'
                        '你已经试过什么……只描述具体行为，不点名。',
                    border: OutlineInputBorder(),
                    alignLabelWithHint: true,
                  ),
                ),
                Text(
                  '提交后生成「1 号楼 · 同学 A」这样的匿名代号；'
                  '不保存你的账号，也不会公开举报任何人。',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.textMuted,
                  ),
                ),
                if (_problems.isNotEmpty) ...<Widget>[
                  const SizedBox(height: KedaYaTokens.space3),
                  Container(
                    padding: const EdgeInsets.all(KedaYaTokens.space3),
                    decoration: BoxDecoration(
                      color: colors.danger.withValues(alpha: 0.08),
                      borderRadius:
                          BorderRadius.circular(KedaYaTokens.radiusMd),
                      border: Border.all(
                        color: colors.danger.withValues(alpha: 0.4),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        for (final DormPostProblem problem in _problems)
                          Padding(
                            padding: const EdgeInsets.only(
                              bottom: KedaYaTokens.space1,
                            ),
                            child: Text(
                              '· ${describeDormPostProblem(problem)}',
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
                    label: const Text('匿名发布'),
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
