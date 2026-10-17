import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../domain/models/forum.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/forum_providers.dart';

/// 发帖页：版块 + 标题 + 正文 + 标签 + **匿名开关**。
///
/// 匿名开关旁边的说明文案来自 domain 常量 [anonymousPostNotice]
/// （"匿名后你的实名身份不会与帖子关联"），不是页面里的字面量 ——
/// 这样它可被单元测试机械校验（契约 §9）。
class ForumComposePage extends ConsumerStatefulWidget {
  const ForumComposePage({super.key});

  @override
  ConsumerState<ForumComposePage> createState() => _ForumComposePageState();
}

class _ForumComposePageState extends ConsumerState<ForumComposePage> {
  final TextEditingController _title = TextEditingController();
  final TextEditingController _body = TextEditingController();
  final TextEditingController _tags = TextEditingController();

  String? _boardId;
  bool _anonymous = false;
  bool _busy = false;
  bool _submitted = false;
  String? _error;

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    _tags.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final AsyncValue<List<ForumBoard>> boards = ref.watch(forumBoardsProvider);
    final List<ForumBoard> boardList =
        boards.valueOrNull ?? const <ForumBoard>[];
    // 默认选中：先看列表页当前的版块筛选，否则第一个版块。
    final String? selectedBoardId = _boardId ??
        ref.watch(forumBoardFilterProvider) ??
        (boardList.isEmpty ? null : boardList.first.id);

    return Scaffold(
      appBar: AppBar(title: const Text('发帖')),
      body: boards.when(
        data: (List<ForumBoard> data) => data.isEmpty
            ? const KedaYaEmptyState(
                title: '没有可发帖的版块',
                description: '版块列表为空，请稍后下拉重试。',
                icon: Icons.dashboard_customize_outlined,
              )
            : _buildForm(context, colors, boardList, selectedBoardId),
        loading: () => const KedaYaLoadingState(message: '正在加载版块…'),
        error: (Object error, StackTrace stackTrace) => KedaYaErrorState(
          error: error,
          onRetry: () => ref.invalidate(forumBoardsProvider),
        ),
      ),
    );
  }

  Widget _buildForm(
    BuildContext context,
    KedaYaColors colors,
    List<ForumBoard> boardList,
    String? selectedBoardId,
  ) {
    final ForumPostDraft draft = ForumPostDraft(
      title: _title.text,
      body: _body.text,
      tags: parseForumTags(_tags.text),
      anonymous: _anonymous,
    );
    final bool showTitleError = _submitted || _title.text.isNotEmpty;
    final bool showBodyError = _submitted || _body.text.isNotEmpty;

    return ListView(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      children: <Widget>[
        _FieldLabel('版块'),
        Wrap(
          spacing: KedaYaTokens.space2,
          runSpacing: KedaYaTokens.space2,
          children: <Widget>[
            for (final ForumBoard board in boardList)
              ChoiceChip(
                label: Text(board.name),
                selected: selectedBoardId == board.id,
                showCheckmark: false,
                backgroundColor: colors.surfaceAlt,
                selectedColor: colors.brandSoft,
                side: BorderSide(color: colors.border),
                labelStyle: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  color: selectedBoardId == board.id
                      ? colors.brandStrong
                      : colors.textMuted,
                ),
                onSelected: (bool _) => setState(() => _boardId = board.id),
              ),
          ],
        ),
        const SizedBox(height: KedaYaTokens.space4),
        _FieldLabel('标题'),
        TextField(
          controller: _title,
          maxLength: ForumPostDraft.titleMaxLength,
          style:
              TextStyle(fontSize: KedaYaTokens.fontSizeSm, color: colors.text),
          decoration: _decoration(colors, '一句话说清你要讨论什么'),
          onChanged: (String _) => setState(() {}),
        ),
        if (showTitleError && draft.titleError != null)
          _FieldError(message: draft.titleError!),
        const SizedBox(height: KedaYaTokens.space3),
        _FieldLabel('正文'),
        TextField(
          controller: _body,
          maxLines: 8,
          minLines: 5,
          maxLength: ForumPostDraft.bodyMaxLength,
          style:
              TextStyle(fontSize: KedaYaTokens.fontSizeSm, color: colors.text),
          decoration: _decoration(colors, '支持 Markdown 子集（标题、列表、链接）'),
          onChanged: (String _) => setState(() {}),
        ),
        if (showBodyError && draft.bodyError != null)
          _FieldError(message: draft.bodyError!),
        const SizedBox(height: KedaYaTokens.space3),
        _FieldLabel('标签（可选，最多 5 个，用逗号分隔）'),
        TextField(
          controller: _tags,
          style:
              TextStyle(fontSize: KedaYaTokens.fontSizeSm, color: colors.text),
          decoration: _decoration(colors, '例如：食堂, 测评'),
          onChanged: (String _) => setState(() {}),
        ),
        if (draft.tags.isNotEmpty) ...<Widget>[
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            '将提交：${draft.tags.map((String tag) => '#$tag').join(' ')}',
            style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs, color: colors.textMuted),
          ),
        ],
        if (draft.tagsError != null) _FieldError(message: draft.tagsError!),
        const SizedBox(height: KedaYaTokens.space4),
        Card(
          child: SwitchListTile(
            contentPadding:
                const EdgeInsets.symmetric(horizontal: KedaYaTokens.space4),
            value: _anonymous,
            onChanged: (bool next) => setState(() => _anonymous = next),
            title: const Text('匿名发帖'),
            // 契约 §9 的说明文案，来自 domain 常量。
            subtitle: const Text(anonymousPostNotice),
          ),
        ),
        const SizedBox(height: KedaYaTokens.space2),
        Text(
          '匿名帖子只会带上一个版块内稳定的匿名身份；普通用户看不到任何实名信息。'
          '该匿名身份在版块内可被版主追溯（用于治理），映射由服务端持有。',
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            height: KedaYaTokens.lineHeightNormal,
            color: colors.textMuted,
          ),
        ),
        if (_error != null) ...<Widget>[
          const SizedBox(height: KedaYaTokens.space3),
          _FieldError(message: _error!),
        ],
        const SizedBox(height: KedaYaTokens.space4),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: _busy ? null : () => _submit(draft, selectedBoardId),
            child: _busy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(_anonymous ? '匿名发布' : '发布'),
          ),
        ),
        const SizedBox(height: KedaYaTokens.space6),
      ],
    );
  }

  InputDecoration _decoration(KedaYaColors colors, String hint) =>
      InputDecoration(
        hintText: hint,
        hintStyle: TextStyle(
            color: colors.textMuted, fontSize: KedaYaTokens.fontSizeSm),
        counterText: '',
        enabledBorder: OutlineInputBorder(
          borderSide: BorderSide(color: colors.border),
          borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
        ),
        focusedBorder: OutlineInputBorder(
          borderSide: BorderSide(color: colors.brandStrong),
          borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
        ),
      );

  Future<void> _submit(ForumPostDraft draft, String? boardId) async {
    setState(() {
      _submitted = true;
      _error = null;
    });
    if (boardId == null) {
      setState(() => _error = '请选择版块');
      return;
    }
    if (!draft.isValid) return;

    final NavigatorState navigator = Navigator.of(context);
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await ref
          .read(forumActionsProvider)
          .createPost(draft.toCommand(boardId: boardId));
      navigator.pop();
      messenger.showSnackBar(
        SnackBar(content: Text(draft.anonymous ? '已匿名发布' : '发布成功')),
      );
    } on Object catch (error) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = '$error';
        });
      }
    }
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: KedaYaTokens.space1),
        child: Text(
          text,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            fontWeight: KedaYaTokens.fontWeightSemibold,
            color: context.kedayaColors.textMuted,
          ),
        ),
      );
}

class _FieldError extends StatelessWidget {
  const _FieldError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: KedaYaTokens.space1),
        child: Text(
          message,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            color: context.kedayaColors.danger,
          ),
        ),
      );
}
