import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/app_providers.dart';
import '../../../../domain/models/api_error.dart';
import '../../../../domain/models/forum.dart';
import '../../../../domain/models/time_text.dart';
import '../../../../domain/ports/platform_ports.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/forum_providers.dart';
import '../components/forum_badges.dart';
import '../components/forum_report_sheet.dart';

/// 分享用的 Web 落地页基址（**占位域名**，与 `AppEnvironment.prodBaseUrl` 同一类问题：
/// 上线前必须由 Lead 提供真实域名后替换）。
const String forumShareBaseUrl = 'https://kedaya.local/forum';

/// 主题详情页：主题正文 + 回复列表 + 回复输入。
///
/// 三态：loading（骨架）/ error（可重试）/ empty（`NOT_FOUND` → "不存在或已隐藏"）。
class ForumPostDetailPage extends ConsumerWidget {
  const ForumPostDetailPage({required this.postId, super.key});

  final String postId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<ForumPost> value = ref.watch(forumPostProvider(postId));
    final ForumPost? post = value.valueOrNull;

    return Scaffold(
      appBar: AppBar(
        title: const Text('主题'),
        actions: <Widget>[
          IconButton(
            tooltip: '分享',
            onPressed: post == null ? null : () => _share(context, ref, post),
            icon: const Icon(Icons.share_outlined),
          ),
          IconButton(
            tooltip: '举报',
            onPressed: post == null
                ? null
                : () => showForumReportSheet(
                      context,
                      targetType: ForumReportTargetType.post,
                      targetId: post.id,
                    ),
            icon: const Icon(Icons.flag_outlined),
          ),
        ],
      ),
      body: value.when(
        data: (ForumPost data) => _DetailBody(post: data),
        loading: () => const KedaYaLoadingState(message: '正在加载主题…'),
        error: (Object error, StackTrace stackTrace) =>
            _buildError(context, ref, error),
      ),
    );
  }

  /// 分享走 `SharePort`（契约 §7：presentation 不直接碰平台 API）。
  ///
  /// 当前装配的是 `ClipboardSharePort` —— 链接会进系统剪贴板，**真实可用**；
  /// 换成 `share_plus` 只需替换 platform 层的实现，这里不用改。
  Future<void> _share(
      BuildContext context, WidgetRef ref, ForumPost post) async {
    final SharePort share = ref.read(shareProvider);
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    await share.shareText(
      '【可达鸭论坛】${post.title}\n$forumShareBaseUrl/${post.id}\n（第三方非官方平台）',
      subject: post.title,
    );
    messenger.showSnackBar(const SnackBar(content: Text('链接已复制到剪贴板')));
  }

  Widget _buildError(BuildContext context, WidgetRef ref, Object error) {
    // "不存在/已隐藏"是空态，不是错误态。
    if (error is ApiException && error.code == ApiErrorCode.notFound) {
      return const KedaYaEmptyState(
        title: '该主题不存在或已被隐藏',
        description: '它可能已被作者删除，或因多人举报被自动隐藏。',
        icon: Icons.forum_outlined,
      );
    }
    return KedaYaErrorState(
      error: error,
      onRetry: () => ref.invalidate(forumPostProvider(postId)),
    );
  }
}

class _DetailBody extends ConsumerWidget {
  const _DetailBody({required this.post});

  final ForumPost post;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final AsyncValue<ForumReplyListState> replies =
        ref.watch(forumRepliesProvider(post.id));

    return Column(
      children: <Widget>[
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(KedaYaTokens.space4),
            children: <Widget>[
              _PostHeader(post: post),
              const SizedBox(height: KedaYaTokens.space6),
              Row(
                children: <Widget>[
                  Text(
                    '回复',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeMd,
                      fontWeight: KedaYaTokens.fontWeightSemibold,
                      color: colors.text,
                    ),
                  ),
                  const SizedBox(width: KedaYaTokens.space2),
                  Text(
                    '${post.replyCount}',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeSm,
                      color: colors.textMuted,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: KedaYaTokens.space2),
              replies.when(
                data: (ForumReplyListState state) => state.isEmpty
                    ? const KedaYaEmptyState(
                        title: '还没有人回复',
                        description: '在下面的输入框里说两句，成为第一个回复的人。',
                        icon: Icons.chat_bubble_outline,
                      )
                    : _ReplyList(state: state, postId: post.id),
                loading: () => const KedaYaLoadingState(message: '正在加载回复…'),
                error: (Object error, StackTrace stackTrace) =>
                    KedaYaErrorState(
                  error: error,
                  onRetry: () => ref.invalidate(forumRepliesProvider(post.id)),
                ),
              ),
            ],
          ),
        ),
        _ReplyComposer(post: post),
      ],
    );
  }
}

class _PostHeader extends StatelessWidget {
  const _PostHeader({required this.post});

  final ForumPost post;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Wrap(
          spacing: KedaYaTokens.space1,
          runSpacing: KedaYaTokens.space1,
          children: <Widget>[
            if (post.boardName != null) ForumPill(text: post.boardName!),
            if (post.isPinned)
              const ForumPill(
                text: '置顶',
                tone: ForumPillTone.brand,
                icon: Icons.push_pin_outlined,
              ),
            if (post.anonymous)
              ForumAnonymousBadge(notice: anonymousPostNotice),
            if (post.isLocked)
              const ForumPill(
                text: '已锁定',
                tone: ForumPillTone.danger,
                icon: Icons.lock_outline,
              ),
          ],
        ),
        const SizedBox(height: KedaYaTokens.space3),
        Text(
          post.title,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXl,
            fontWeight: KedaYaTokens.fontWeightBold,
            color: colors.text,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space2),
        Row(
          children: <Widget>[
            Text(
              post.author.displayName,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                color: colors.textMuted,
              ),
            ),
            const SizedBox(width: KedaYaTokens.space2),
            Text(
              formatRelativeTime(post.createdAt),
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.textMuted,
              ),
            ),
          ],
        ),
        const SizedBox(height: KedaYaTokens.space4),
        Text(
          post.body,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeSm,
            height: KedaYaTokens.lineHeightLoose,
            color: colors.text,
          ),
        ),
        if (post.tags.isNotEmpty) ...<Widget>[
          const SizedBox(height: KedaYaTokens.space3),
          Wrap(
            spacing: KedaYaTokens.space1,
            runSpacing: KedaYaTokens.space1,
            children: <Widget>[
              for (final String tag in post.tags) ForumPill(text: '#$tag'),
            ],
          ),
        ],
        const SizedBox(height: KedaYaTokens.space4),
        const Divider(height: 1),
      ],
    );
  }
}

class _ReplyList extends ConsumerWidget {
  const _ReplyList({required this.state, required this.postId});

  final ForumReplyListState state;
  final String postId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final ForumReplyListController controller = ref.read(
      forumRepliesProvider(postId).notifier,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        for (int index = 0; index < state.replies.length; index++)
          _ReplyTile(reply: state.replies[index], floor: index + 1),
        if (state.loadMoreError != null) ...<Widget>[
          Text(
            '加载更多回复失败：${state.loadMoreError}',
            style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm, color: colors.danger),
          ),
          const SizedBox(height: KedaYaTokens.space2),
        ],
        if (state.isLoadingMore) const KedaYaLoadingState(),
        if (state.hasMore && !state.isLoadingMore)
          Center(
            child: OutlinedButton(
              onPressed: () => controller.loadMore(),
              child: const Text('加载更多回复'),
            ),
          ),
      ],
    );
  }
}

class _ReplyTile extends StatelessWidget {
  const _ReplyTile({required this.reply, required this.floor});

  final ForumReply reply;
  final int floor;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: KedaYaTokens.space2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Text(
                reply.author.displayName,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  fontWeight: KedaYaTokens.fontWeightMedium,
                  color: colors.text,
                ),
              ),
              const SizedBox(width: KedaYaTokens.space1),
              if (reply.anonymous)
                ForumAnonymousBadge(notice: anonymousReplyNotice),
              if (reply.parentReplyId != null) ...<Widget>[
                const SizedBox(width: KedaYaTokens.space1),
                const ForumPill(text: '二级回复'),
              ],
              const Spacer(),
              Text(
                '#$floor · ${formatRelativeTime(reply.createdAt)}',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  color: colors.textMuted,
                ),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            reply.body,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.text,
            ),
          ),
        ],
      ),
    );
  }
}

/// 回复输入框（底部固定）。
///
/// 锁定主题不显示输入框 —— 契约 §2.4 状态机：`LOCKED` 禁止新回复。
class _ReplyComposer extends ConsumerStatefulWidget {
  const _ReplyComposer({required this.post});

  final ForumPost post;

  @override
  ConsumerState<_ReplyComposer> createState() => _ReplyComposerState();
}

class _ReplyComposerState extends ConsumerState<_ReplyComposer> {
  final TextEditingController _body = TextEditingController();
  bool _anonymous = false;
  bool _busy = false;

  @override
  void dispose() {
    _body.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    if (!widget.post.canReply) {
      return Container(
        width: double.infinity,
        color: colors.surfaceAlt,
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        child: Text(
          '该主题当前状态为「${widget.post.status.label}」，暂不能回复。',
          textAlign: TextAlign.center,
          style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm, color: colors.textMuted),
        ),
      );
    }
    return Container(
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border(top: BorderSide(color: colors.border)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.all(KedaYaTokens.space3),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: <Widget>[
                  Expanded(
                    child: TextField(
                      controller: _body,
                      maxLines: 4,
                      minLines: 1,
                      maxLength: ForumReplyDraft.bodyMaxLength,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeSm,
                        color: colors.text,
                      ),
                      decoration: InputDecoration(
                        hintText: '写下你的回复…',
                        hintStyle: TextStyle(color: colors.textMuted),
                        counterText: '',
                        isDense: true,
                        enabledBorder: OutlineInputBorder(
                          borderSide: BorderSide(color: colors.border),
                          borderRadius:
                              BorderRadius.circular(KedaYaTokens.radiusMd),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderSide: BorderSide(color: colors.brandStrong),
                          borderRadius:
                              BorderRadius.circular(KedaYaTokens.radiusMd),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: KedaYaTokens.space2),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    child: _busy
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('发送'),
                  ),
                ],
              ),
              const SizedBox(height: KedaYaTokens.space1),
              Row(
                children: <Widget>[
                  Switch(
                    value: _anonymous,
                    onChanged: (bool next) => setState(() => _anonymous = next),
                  ),
                  const SizedBox(width: KedaYaTokens.space1),
                  Expanded(
                    child: Text(
                      // 契约 §9：匿名说明必须写在开关旁边，不能只藏在帮助页里。
                      anonymousReplyNotice,
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
        ),
      ),
    );
  }

  Future<void> _submit() async {
    final String body = _body.text.trim();
    if (body.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请先写点什么再发送')),
      );
      return;
    }
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await ref.read(forumActionsProvider).reply(
            CreateForumReplyCommand(
              postId: widget.post.id,
              body: body,
              anonymous: _anonymous,
            ),
          );
      _body.clear();
      messenger.showSnackBar(
        SnackBar(content: Text(_anonymous ? '已匿名回复' : '回复成功')),
      );
    } on Object catch (error) {
      messenger.showSnackBar(SnackBar(content: Text('$error')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}
