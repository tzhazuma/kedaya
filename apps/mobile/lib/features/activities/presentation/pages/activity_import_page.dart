import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/activity.dart';
import '../../../../domain/models/api_error.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/activities_providers.dart';

/// 用户主动提交**单篇**公众号文章（链接与正文至少一个）。
///
/// 明确不做：自动发现、批量抓取历史文章、反检测、绕过微信验证。
/// 正文只保留 ≤200 字作为证据摘录，不上传全文。
class ActivityImportPage extends ConsumerStatefulWidget {
  const ActivityImportPage({super.key});

  @override
  ConsumerState<ActivityImportPage> createState() => _ActivityImportPageState();
}

class _ActivityImportPageState extends ConsumerState<ActivityImportPage> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _url = TextEditingController();
  final TextEditingController _text = TextEditingController();

  String? _formError;
  bool _saving = false;

  @override
  void dispose() {
    _url.dispose();
    _text.dispose();
    super.dispose();
  }

  String? _validateUrl(String? value) {
    final String text = (value ?? '').trim();
    if (text.isEmpty) return null;
    if (!isHttpUrl(text)) return '文章链接必须是 http(s) 地址';
    return null;
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    setState(() => _formError = null);

    final FormState? form = _formKey.currentState;
    if (form == null || !form.validate()) {
      setState(() => _formError = '请检查表单中标红的字段');
      return;
    }

    final WechatImportDraft draft = WechatImportDraft(
      url: _url.text,
      text: _text.text,
    );
    if (draft.isEmpty) {
      setState(() => _formError = '请粘贴公众号文章链接或正文');
      return;
    }
    if (draft.normalizedUrl != null && draft.normalizedText != null) {
      setState(() => _formError = '链接与正文只能填一个');
      return;
    }

    setState(() => _saving = true);
    try {
      final ActivityItem created =
          await ref.read(activitiesActionsProvider).importWechat(draft);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Semantics(
            liveRegion: true,
            child: const Text('已导入。活动先进入待确认，请核对时间和地点。'),
          ),
        ),
      );
      context.pushReplacement('/activities/${created.id}');
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _formError =
          error is ApiException ? error.error.userMessage : '$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;

    return Scaffold(
      appBar: AppBar(title: const Text('导入公众号文章')),
      body: SafeArea(
        child: Form(
          key: _formKey,
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
                  '只导入你主动提交的这一篇：不会自动发现，不会批量抓取历史文章，'
                  '也不会绕过微信验证。粘贴的正文仅用于本次抽取、不落库；'
                  '只保存链接与 ≤$activityEvidenceMaxChars 字证据摘录。',
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.text,
                  ),
                ),
              ),
              if (_formError != null) ...<Widget>[
                const SizedBox(height: KedaYaTokens.space3),
                Semantics(
                  liveRegion: true,
                  child: Container(
                    padding: const EdgeInsets.all(KedaYaTokens.space3),
                    decoration: BoxDecoration(
                      color: colors.danger.withValues(alpha: 0.1),
                      borderRadius:
                          BorderRadius.circular(KedaYaTokens.radiusMd),
                      border: Border.all(
                        color: colors.danger.withValues(alpha: 0.35),
                      ),
                    ),
                    child: Text(
                      _formError!,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeSm,
                        color: colors.danger,
                      ),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: KedaYaTokens.space4),
              TextFormField(
                key: const Key('wechat-url'),
                controller: _url,
                keyboardType: TextInputType.url,
                textInputAction: TextInputAction.next,
                autocorrect: false,
                enableSuggestions: false,
                spellCheckConfiguration:
                    const SpellCheckConfiguration.disabled(),
                autofillHints: const <String>[AutofillHints.url],
                decoration: const InputDecoration(
                  labelText: '文章链接（可选）',
                  helperText: '单篇 http(s) 链接，与正文二选一；不抓取历史文章',
                ),
                validator: _validateUrl,
              ),
              const SizedBox(height: KedaYaTokens.space3),
              TextFormField(
                key: const Key('wechat-text'),
                controller: _text,
                maxLines: 6,
                maxLength: 200000,
                decoration: const InputDecoration(
                  labelText: '正文（可选，与链接二选一）',
                  helperText: '原文仅用于本次抽取，不落库；落库证据最多 200 字',
                  counterText: '',
                  alignLabelWithHint: true,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space4),
              FilledButton.icon(
                onPressed: _saving ? null : () => unawaited(_submit()),
                icon: _saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.link_outlined, size: 18),
                label: const Text('导入这篇'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                ),
              ),
              const SizedBox(height: KedaYaTokens.space2),
              OutlinedButton(
                onPressed: _saving ? null : () => context.pop(),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                ),
                child: const Text('取消'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
