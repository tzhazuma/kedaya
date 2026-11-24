import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/petition_ticket.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/petition_providers.dart';
import '../components/petition_widgets.dart';
import '../petition_paths.dart';

/// 写一条建议（本机保存）。
///
/// 校验规则**只来自** `validatePetitionDraft`，页面不复制一份；
/// 因此「什么算合法」不会在页面和 controller 之间漂移。
class PetitionComposePage extends ConsumerStatefulWidget {
  const PetitionComposePage({super.key});

  @override
  ConsumerState<PetitionComposePage> createState() =>
      _PetitionComposePageState();
}

class _PetitionComposePageState extends ConsumerState<PetitionComposePage> {
  final TextEditingController _title = TextEditingController();
  final TextEditingController _body = TextEditingController();
  final TextEditingController _contact = TextEditingController();

  PetitionCategory? _category;
  bool _anonymous = false;
  bool _submitting = false;
  List<PetitionDraftProblem> _problems = const <PetitionDraftProblem>[];

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    _contact.dispose();
    super.dispose();
  }

  PetitionDraft _draft() => PetitionDraft(
        category: _category,
        title: _title.text,
        body: _body.text,
        anonymous: _anonymous,
        contact: _contact.text,
      );

  Future<void> _submit() async {
    final PetitionDraft draft = _draft();
    final List<PetitionDraftProblem> problems = validatePetitionDraft(draft);
    setState(() => _problems = problems);
    if (problems.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('还有 ${problems.length} 处需要改一下')),
      );
      return;
    }

    setState(() => _submitting = true);
    try {
      await ref.read(petitionTicketsProvider.notifier).submit(draft);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('已保存到本机。没有发送给学校，也不会有人收到通知。'),
        ),
      );
      if (context.canPop()) {
        context.pop(true);
      } else {
        context.go(PetitionRoutes.list);
      }
    } on PetitionDraftException catch (error) {
      if (!mounted) return;
      setState(() => _problems = error.problems);
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('保存失败：$error')),
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  void _toggleAnonymous(bool next) {
    setState(() {
      _anonymous = next;
      if (next) {
        // 匿名记录不该在本机留下联系方式：UI 与模型各拦一次。
        _contact.clear();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;

    return KedaYaPageScaffold(
      title: '写一条建议',
      child: ListView(
        children: <Widget>[
          const PetitionDemoNotice(),
          const SizedBox(height: KedaYaTokens.space4),
          _label('类别（必选）'),
          Wrap(
            spacing: KedaYaTokens.space2,
            runSpacing: KedaYaTokens.space2,
            children: <Widget>[
              for (final PetitionCategory category in PetitionCategory.values)
                ChoiceChip(
                  key: Key('petition-category-${category.wire}'),
                  label: Text(category.label),
                  selected: _category == category,
                  onSelected: (bool selected) => setState(
                    () => _category = selected ? category : null,
                  ),
                ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space4),
          _label('标题'),
          TextField(
            key: const Key('petition-title'),
            controller: _title,
            maxLength: petitionTitleMax,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(
              hintText: '一句话说清问题，例如「教学楼 3 楼饮水机经常没水」',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          _label('正文（最多 $petitionBodyMax 字）'),
          TextField(
            key: const Key('petition-body'),
            controller: _body,
            maxLength: petitionBodyMax,
            minLines: 6,
            maxLines: 12,
            keyboardType: TextInputType.multiline,
            decoration: const InputDecoration(
              hintText: '发生了什么、影响到谁、希望怎么改。'
                  '写得越具体，自己回看时越有用。',
              border: OutlineInputBorder(),
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          SwitchListTile(
            key: const Key('petition-anonymous'),
            contentPadding: EdgeInsets.zero,
            value: _anonymous,
            onChanged: _toggleAnonymous,
            title: const Text('匿名提交'),
            subtitle: const Text('不保存联系方式；本机记录里也不显示身份'),
          ),
          if (_anonymous)
            Padding(
              padding: const EdgeInsets.only(
                left: KedaYaTokens.space1,
                bottom: KedaYaTokens.space2,
              ),
              child: Text(
                '匿名记录不会写入联系方式。演示版本来就不发送，'
                '匿名只是让本机记录也少留一点信息。',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.textMuted,
                ),
              ),
            )
          else ...<Widget>[
            const SizedBox(height: KedaYaTokens.space2),
            _label('联系方式（可选）'),
            TextField(
              key: const Key('petition-contact'),
              controller: _contact,
              maxLength: petitionContactMax,
              decoration: const InputDecoration(
                hintText: '邮箱 / 手机号 / 微信号',
                border: OutlineInputBorder(),
              ),
            ),
            Text(
              '只保存在本机，方便你自己对照；不会发送给学校。',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.textMuted,
              ),
            ),
          ],
          if (_problems.isNotEmpty) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space3),
            Container(
              padding: const EdgeInsets.all(KedaYaTokens.space3),
              decoration: BoxDecoration(
                color: colors.danger.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
                border: Border.all(
                  color: colors.danger.withValues(alpha: 0.4),
                ),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  for (final PetitionDraftProblem problem in _problems)
                    Padding(
                      padding: const EdgeInsets.only(
                        bottom: KedaYaTokens.space1,
                      ),
                      child: Text(
                        '· ${describePetitionProblem(problem)}',
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
          const SizedBox(height: KedaYaTokens.space4),
          Text(
            '保存后可以在「建议与诉求」里看到这条记录。'
            '演示版没有对接任何部门：不上传、不发送，'
            '卸载应用或清除本机数据后记录会丢失。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightLoose,
              color: colors.textMuted,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space4),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              key: const Key('petition-submit-button'),
              onPressed: _submitting ? null : _submit,
              icon: _submitting
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.save_outlined, size: 18),
              label: const Text('保存到本机'),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Center(
            child: TextButton(
              onPressed: _submitting ? null : () => context.pop(),
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
