import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/activity.dart';
import '../../../../domain/models/api_error.dart';
import '../../../../domain/models/wechat_history.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/activities_providers.dart';

/// 从**用户自己保存**的公众号「历史消息」页批量挑文章。
///
/// 为什么是「保存的页面」而不是「公众号链接」：
/// 微信没有公开的历史列表 API，自动取那一页必须持微信客户端内部的会话
/// Cookie（`wap_sid2`）—— 那等于逆向客户端，本应用不做。
/// 但用户本来就能在微信里看到这页，所以让他把页面保存/复制过来，我们只负责解析。
///
/// 三步：粘贴页面 → 解析出文章列表 → 勾选后逐篇导入。
/// 导入的每一篇仍然进「待确认」，不会绕过用户核对时间地点。
class ActivityHistoryImportPage extends ConsumerStatefulWidget {
  const ActivityHistoryImportPage({super.key});

  @override
  ConsumerState<ActivityHistoryImportPage> createState() =>
      _ActivityHistoryImportPageState();
}

class _ActivityHistoryImportPageState
    extends ConsumerState<ActivityHistoryImportPage> {
  final TextEditingController _html = TextEditingController();

  WechatHistoryPage? _page;
  final Set<String> _selected = <String>{};
  String? _error;
  bool _parsing = false;
  bool _importing = false;
  int _imported = 0;

  @override
  void dispose() {
    _html.dispose();
    super.dispose();
  }

  Future<void> _parse() async {
    FocusScope.of(context).unfocus();
    if (_parsing || _importing) return;
    setState(() {
      _parsing = true;
      _error = null;
      _page = null;
      _selected.clear();
      _imported = 0;
    });
    try {
      final WechatHistoryPage page = await ref
          .read(activitiesActionsProvider)
          .parseWechatHistory(_html.text);
      if (!mounted) return;
      setState(() {
        _page = page;
        // 默认只勾主条：副条多是「附：报名表」这类，一起勾会让待确认列表变噪音。
        for (final WechatHistoryArticle article in page.articles) {
          if (article.isHeadline) _selected.add(article.url);
        }
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _error =
          error is ApiException ? error.error.userMessage : '$error');
    } finally {
      if (mounted) setState(() => _parsing = false);
    }
  }

  Future<void> _importSelected() async {
    final WechatHistoryPage? page = _page;
    if (page == null || _selected.isEmpty || _importing) return;

    setState(() {
      _importing = true;
      _error = null;
    });

    int imported = 0;
    final List<String> failures = <String>[];
    for (final WechatHistoryArticle article in page.articles) {
      if (!_selected.contains(article.url)) continue;
      try {
        // 只传链接：服务端契约要求 url 与 text **二选一**，
        // 同时给两个会被判成入参错误（`WECHAT_IMPORT_SOURCE_REQUIRED` 的另一半）。
        // 摘要只是列表里的提示，不当作正文提交 —— 正文由服务端取回原文后抽取。
        await ref.read(activitiesActionsProvider).importWechat(
              WechatImportDraft(url: article.url),
            );
        imported++;
        if (mounted) setState(() => _imported = imported);
      } on Object catch (error) {
        // 一篇失败不拖垮整批：其余继续，最后统一报哪些没进去。
        failures.add(
          '${article.title}：'
          '${error is ApiException ? error.error.userMessage : '$error'}',
        );
      }
    }

    if (!mounted) return;
    setState(() {
      _importing = false;
      if (failures.isNotEmpty) {
        _error = '${failures.length} 篇没导入成功\n${failures.join('\n')}';
      }
    });

    if (imported > 0 && failures.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Semantics(
            liveRegion: true,
            child: Text('已导入 $imported 篇，都在「待确认」里，请逐条核对时间与地点。'),
          ),
        ),
      );
      context.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final WechatHistoryPage? page = _page;
    final int selectedCount = _selected.length;

    return Scaffold(
      appBar: AppBar(title: const Text('从历史消息导入')),
      body: SafeArea(
        child: ListView(
          padding: EdgeInsets.fromLTRB(
            KedaYaTokens.space4,
            KedaYaTokens.space4,
            KedaYaTokens.space4,
            KedaYaTokens.space6 + MediaQuery.viewPaddingOf(context).bottom,
          ),
          children: <Widget>[
            Container(
              padding: const EdgeInsets.all(KedaYaTokens.space3),
              decoration: BoxDecoration(
                color: colors.brandSoft,
                borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
              ),
              child: Text(
                '在微信里打开公众号 →「查看历史消息」→ 保存或复制这一页的内容，'
                '粘贴到下面。\n'
                '我们只解析你贴进来的页面：不抓取、不带 Cookie、不绕过任何验证。'
                '导入的每一篇都会先进「待确认」，需要你核对时间地点。',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.text,
                ),
              ),
            ),
            if (_error != null) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space3),
              Semantics(
                liveRegion: true,
                child: Container(
                  padding: const EdgeInsets.all(KedaYaTokens.space3),
                  decoration: BoxDecoration(
                    color: colors.danger.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
                    border: Border.all(
                      color: colors.danger.withValues(alpha: 0.35),
                    ),
                  ),
                  child: Text(
                    _error!,
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeSm,
                      color: colors.danger,
                    ),
                  ),
                ),
              ),
            ],
            const SizedBox(height: KedaYaTokens.space4),
            TextField(
              key: const Key('history-html'),
              controller: _html,
              maxLines: 6,
              maxLength: 12000000,
              decoration: const InputDecoration(
                labelText: '历史消息页内容',
                helperText: '整页源码或复制出来的内容都可以；只在本机与服务端之间传输一次',
                counterText: '',
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: KedaYaTokens.space3),
            FilledButton.icon(
              onPressed: _parsing || _importing ? null : () => unawaited(_parse()),
              icon: _parsing
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.manage_search, size: 18),
              label: const Text('解析出文章列表'),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
              ),
            ),
            if (page != null) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space4),
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      page.accountName ?? '识别到 ${page.articles.length} 篇',
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeMd,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: colors.text,
                      ),
                    ),
                  ),
                  Text(
                    '已选 $selectedCount / ${page.articles.length}',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: colors.textMuted,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: KedaYaTokens.space2),
              for (final WechatHistoryArticle article in page.articles)
                _HistoryArticleTile(
                  article: article,
                  checked: _selected.contains(article.url),
                  enabled: !_importing,
                  onChanged: (bool value) => setState(() {
                    if (value) {
                      _selected.add(article.url);
                    } else {
                      _selected.remove(article.url);
                    }
                  }),
                ),
              const SizedBox(height: KedaYaTokens.space3),
              FilledButton.icon(
                onPressed: selectedCount == 0 || _importing
                    ? null
                    : () => unawaited(_importSelected()),
                icon: _importing
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.download_done, size: 18),
                label: Text(
                  _importing
                      ? '正在导入 $_imported / $selectedCount'
                      : '导入选中的 $selectedCount 篇',
                ),
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                ),
              ),
              const SizedBox(height: KedaYaTokens.space2),
              Text(
                selectedCount == 0
                    ? '至少勾一篇再导入。'
                    : '导入后仍需要在详情页确认，未确认的活动不会生成提醒。',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  color: colors.textMuted,
                ),
              ),
            ],
            const SizedBox(height: KedaYaTokens.space3),
            OutlinedButton(
              onPressed: _importing ? null : () => context.pop(),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
              ),
              child: const Text('返回'),
            ),
          ],
        ),
      ),
    );
  }
}

class _HistoryArticleTile extends StatelessWidget {
  const _HistoryArticleTile({
    required this.article,
    required this.checked,
    required this.enabled,
    required this.onChanged,
  });

  final WechatHistoryArticle article;
  final bool checked;
  final bool enabled;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Card(
      margin: const EdgeInsets.only(bottom: KedaYaTokens.space2),
      child: CheckboxListTile(
        value: checked,
        onChanged: enabled
            ? (bool? value) => onChanged(value ?? false)
            : null,
        title: Text(
          article.title,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            fontWeight: article.isHeadline
                ? KedaYaTokens.fontWeightSemibold
                : KedaYaTokens.fontWeightRegular,
            color: colors.text,
          ),
        ),
        subtitle: Text(
          <String>[
            _formatDate(article.publishedAt),
            if (article.hasDigest) article.digest!.trim(),
          ].join(' · '),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXs,
            color: colors.textMuted,
          ),
        ),
        controlAffinity: ListTileControlAffinity.leading,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: KedaYaTokens.space2,
          vertical: KedaYaTokens.space1,
        ),
      ),
    );
  }

  String _formatDate(DateTime value) {
    final DateTime local = value.toLocal();
    final String month = local.month.toString().padLeft(2, '0');
    final String day = local.day.toString().padLeft(2, '0');
    return '${local.year}-$month-$day';
  }
}
