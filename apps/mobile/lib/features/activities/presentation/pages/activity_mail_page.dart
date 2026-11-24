import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_providers.dart';
import '../../../../domain/models/activity.dart';
import '../../../../domain/models/api_error.dart';
import '../../../../domain/models/mail_activity.dart';
import '../../application/activities_providers.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// 校园邮箱 → 候选活动。
///
/// 三件事分明：
/// 1. **绑定**：只提交邮箱与一次性的 IMAP 密码；服务端先真连一次验证，
///    坏凭证不落库。密码提交后立刻从表单里清掉。
/// 2. **同步**：只读收信，不发信；失败时服务端保留上次结果并标 `stale`，
///    页面必须如实说「上次同步失败」，不能装作成功。
/// 3. **提升**：只有用户勾选的那条才会变成候选活动；候选仍要确认才进日程。
class ActivityMailPage extends ConsumerStatefulWidget {
  const ActivityMailPage({super.key});

  @override
  ConsumerState<ActivityMailPage> createState() => _ActivityMailPageState();
}

class _ActivityMailPageState extends ConsumerState<ActivityMailPage> {
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();

  bool _bound = false;
  bool _checking = true;
  bool _busy = false;
  String? _error;
  String? _notice;
  MailEventsSnapshot? _snapshot;
  final Set<String> _promoting = <String>{};

  @override
  void initState() {
    super.initState();
    unawaited(_loadEvents());
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  /// 没有「查询绑定状态」的端点，就用 `events` 探一次：
  /// 返回 `CAMPUS_BINDING_REQUIRED` 说明没绑定，其余情况都算已绑定。
  Future<void> _loadEvents() async {
    final result = await ref.read(mailRepositoryProvider).events();
    if (!mounted) return;
    setState(() {
      _checking = false;
      if (result.isErr) {
        final ApiError error = result.errorOrNull!;
        if (error.code == ApiErrorCode.campusBindingRequired) {
          _bound = false;
          _snapshot = null;
          return;
        }
        _error = error.userMessage;
        return;
      }
      _bound = true;
      _snapshot = result.valueOrNull;
    });
  }

  Future<void> _link() async {
    if (_busy) return;
    final String email = _email.text;
    final String? problem = validateCampusMailAddress(email);
    if (problem != null) {
      setState(() => _error = problem);
      return;
    }
    if (_password.text.trim().isEmpty) {
      setState(() => _error = '请填写邮箱密码或专用密码');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final result = await ref.read(mailRepositoryProvider).link(
            MailLinkRequest(
              email: email,
              imapHost: MailLinkRequest.campusImapHost,
              password: _password.text,
            ),
          );
      // 密码只在这一刻存在过：无论成败都立刻清掉输入框。
      _password.clear();
      if (!mounted) return;
      if (result.isErr) {
        setState(() => _error = result.errorOrNull!.userMessage);
        return;
      }
      setState(() {
        _bound = true;
        _notice = '已绑定。点「同步最近邮件」拉一次活动。';
      });
      await _performSync();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// 按钮入口：忙的时候不重入。
  Future<void> _sync() async {
    if (_busy) return;
    await _performSync();
  }

  /// 真正干活的部分。绑定成功后直接调用它 ——
  /// 那时候 `_busy` 还是 true，走 [_sync] 会被自己挡掉，等于「绑定成功但没同步」。
  Future<void> _performSync() async {
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final result = await ref.read(mailRepositoryProvider).sync();
      if (!mounted) return;
      if (result.isErr) {
        setState(() => _error = result.errorOrNull!.userMessage);
        return;
      }
      final MailEventsSnapshot snapshot = result.valueOrNull!;
      setState(() {
        _snapshot = snapshot;
        _notice = snapshot.stale
            ? '这次同步没成功，下面是上次的结果。'
            : snapshot.isEmpty
                ? '同步完成，最近邮件里没有识别出活动。'
                : '同步完成，识别到 ${snapshot.items.length} 条活动。';
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _unlink() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final result = await ref.read(mailRepositoryProvider).unlink();
      if (!mounted) return;
      if (result.isErr) {
        setState(() => _error = result.errorOrNull!.userMessage);
        return;
      }
      setState(() {
        _bound = false;
        _snapshot = null;
        _notice = '已解绑，凭证与由该邮箱归一出的活动都已删除。';
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _promote(MailEventItem item) async {
    if (_promoting.contains(item.id)) return;
    setState(() {
      _promoting.add(item.id);
      _error = null;
    });
    try {
      final created = await ref.read(activitiesActionsProvider).promoteMail(item.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Semantics(
            liveRegion: true,
            child: const Text('已提升为候选活动，请在详情页核对时间地点后再确认。'),
          ),
          action: SnackBarAction(
            label: '去看看',
            onPressed: () => context.push('/activities/${created.id}'),
          ),
        ),
      );
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _error =
          error is ApiException ? error.error.userMessage : '$error');
    } finally {
      if (mounted) setState(() => _promoting.remove(item.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;

    return Scaffold(
      appBar: AppBar(
        title: const Text('校园邮箱'),
        actions: <Widget>[
          if (_bound)
            IconButton(
              tooltip: '同步最近邮件',
              onPressed: _busy ? null : () => unawaited(_sync()),
              icon: const Icon(Icons.sync),
            ),
        ],
      ),
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
                '校园邮箱走服务端**只读** IMAP：密码只用于一次验证，随后加密落库；'
                '只保存归一后的活动与 ≤$activityEvidenceMaxChars 字证据片段，'
                '不保存邮件正文与附件，也不会替你发信。',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.text,
                ),
              ),
            ),
            if (_error != null) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space3),
              _Banner(message: _error!, color: colors.danger),
            ],
            if (_notice != null) ...<Widget>[
              const SizedBox(height: KedaYaTokens.space3),
              _Banner(message: _notice!, color: colors.info),
            ],
            const SizedBox(height: KedaYaTokens.space4),
            if (_checking)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: KedaYaTokens.space6),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (!_bound)
              _LinkForm(
                email: _email,
                password: _password,
                busy: _busy,
                onSubmit: () => unawaited(_link()),
              )
            else ...<Widget>[
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      '已绑定校园邮箱',
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeMd,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: colors.text,
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: _busy ? null : () => unawaited(_unlink()),
                    child: const Text('解绑'),
                  ),
                ],
              ),
              const SizedBox(height: KedaYaTokens.space2),
              FilledButton.icon(
                onPressed: _busy ? null : () => unawaited(_sync()),
                icon: const Icon(Icons.sync, size: 18),
                label: const Text('同步最近邮件'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                ),
              ),
              const SizedBox(height: KedaYaTokens.space3),
              ..._buildEvents(colors),
            ],
          ],
        ),
      ),
    );
  }

  List<Widget> _buildEvents(KedaYaColors colors) {
    final MailEventsSnapshot? snapshot = _snapshot;
    if (snapshot == null) {
      return <Widget>[
        Text(
          '还没有同步过。点上面的按钮拉一次最近邮件。',
          style: TextStyle(fontSize: KedaYaTokens.fontSizeSm, color: colors.textMuted),
        ),
      ];
    }
    if (snapshot.isEmpty) {
      return <Widget>[
        Text(
          '最近邮件里没有识别出活动。没有明确时间与关键词的邮件不会被当成活动。',
          style: TextStyle(fontSize: KedaYaTokens.fontSizeSm, color: colors.textMuted),
        ),
      ];
    }

    return <Widget>[
      if (snapshot.stale)
        Padding(
          padding: const EdgeInsets.only(bottom: KedaYaTokens.space2),
          child: Text(
            '上次同步失败，下面是上次的结果。',
            style: TextStyle(fontSize: KedaYaTokens.fontSizeXs, color: colors.warning),
          ),
        ),
      for (final MailEventItem item in snapshot.items)
        Card(
          margin: const EdgeInsets.only(bottom: KedaYaTokens.space2),
          child: Padding(
            padding: const EdgeInsets.all(KedaYaTokens.space3),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  item.title,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    color: colors.text,
                  ),
                ),
                const SizedBox(height: KedaYaTokens.space1),
                Text(
                  <String>[
                    _formatShanghai(item.startsAt),
                    if ((item.location ?? '').trim().isNotEmpty) item.location!.trim(),
                  ].join(' · '),
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    color: colors.textMuted,
                  ),
                ),
                if (item.matchedText.trim().isNotEmpty) ...<Widget>[
                  const SizedBox(height: KedaYaTokens.space1),
                  Text(
                    item.matchedText.trim(),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      height: KedaYaTokens.lineHeightNormal,
                      color: colors.textMuted,
                    ),
                  ),
                ],
                const SizedBox(height: KedaYaTokens.space2),
                Align(
                  alignment: Alignment.centerRight,
                  child: OutlinedButton(
                    onPressed: _promoting.contains(item.id)
                        ? null
                        : () => unawaited(_promote(item)),
                    child: _promoting.contains(item.id)
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('提升为候选活动'),
                  ),
                ),
              ],
            ),
          ),
        ),
    ];
  }

  /// 统一按 Asia/Shanghai 展示：活动时间跨时区最容易读错。
  static String _formatShanghai(DateTime instant) {
    final DateTime local = instant.toUtc().add(const Duration(hours: 8));
    String two(int v) => v.toString().padLeft(2, '0');
    return '${local.year}-${two(local.month)}-${two(local.day)} '
        '${two(local.hour)}:${two(local.minute)}';
  }
}

class _LinkForm extends StatelessWidget {
  const _LinkForm({
    required this.email,
    required this.password,
    required this.busy,
    required this.onSubmit,
  });

  final TextEditingController email;
  final TextEditingController password;
  final bool busy;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        TextField(
          key: const Key('mail-email'),
          controller: email,
          enabled: !busy,
          keyboardType: TextInputType.emailAddress,
          autocorrect: false,
          decoration: const InputDecoration(
            labelText: '学校邮箱',
            hintText: 'you@shanghaitech.edu.cn',
            helperText: '只支持 @shanghaitech.edu.cn 与 @stu.shanghaitech.edu.cn',
          ),
        ),
        const SizedBox(height: KedaYaTokens.space3),
        TextField(
          key: const Key('mail-password'),
          controller: password,
          enabled: !busy,
          obscureText: true,
          autocorrect: false,
          enableSuggestions: false,
          decoration: const InputDecoration(
            labelText: '邮箱密码 / 专用密码',
            helperText: '只用于一次 IMAP 验证；提交后立即从表单清除',
          ),
        ),
        const SizedBox(height: KedaYaTokens.space4),
        FilledButton.icon(
          onPressed: busy ? null : onSubmit,
          icon: busy
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.mark_email_read_outlined, size: 18),
          label: const Text('绑定并同步'),
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
        ),
        const SizedBox(height: KedaYaTokens.space2),
        Text(
          '绑定失败不会保存任何凭证。学校邮箱若开了两步验证，请使用应用专用密码。',
          style: TextStyle(fontSize: KedaYaTokens.fontSizeXs, color: colors.textMuted),
        ),
      ],
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.message, required this.color});

  final String message;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(KedaYaTokens.space3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
          border: Border.all(color: color.withValues(alpha: 0.35)),
        ),
        child: Text(
          message,
          style: TextStyle(fontSize: KedaYaTokens.fontSizeSm, color: color),
        ),
      ),
    );
  }
}
