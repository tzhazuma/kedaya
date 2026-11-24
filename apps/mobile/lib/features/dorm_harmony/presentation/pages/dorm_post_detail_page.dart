import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../domain/models/dorm_post.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/dorm_harmony_providers.dart';
import '../../data/dorm_harmony_repository.dart';
import '../components/dorm_post_card.dart';
import '../components/dorm_safety_notice.dart';

/// 帖子详情：正文 + 匿名回复列表 + 回复输入。
class DormPostDetailPage extends ConsumerStatefulWidget {
  const DormPostDetailPage({required this.postId, super.key});

  final String postId;

  @override
  ConsumerState<DormPostDetailPage> createState() => _DormPostDetailPageState();
}

class _DormPostDetailPageState extends ConsumerState<DormPostDetailPage> {
  final TextEditingController _reply = TextEditingController();
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 60), (Timer timer) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _reply.dispose();
    super.dispose();
  }

  void _sendReply(DormPost post) {
    final String text = _reply.text.trim();
    if (text.isEmpty) return;
    try {
      ref.read(dormHarmonyPostsProvider.notifier).reply(post.id, text);
      _reply.clear();
      FocusScope.of(context).unfocus();
    } on DormHarmonyException catch (error) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.message)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final DormPost? post = ref.watch(dormPostProvider(widget.postId));
    final DateTime now = ref.watch(dormHarmonyClockProvider)();

    if (post == null) {
      return const KedaYaPageScaffold(
        title: '帖子详情',
        child: KedaYaEmptyState(
          title: '这个帖子不存在',
          description: '它可能已经被删除。回到列表看看别的帖子，或者自己开一个话题。',
          icon: Icons.search_off_outlined,
        ),
      );
    }

    final KedaYaColors colors = context.kedayaColors;

    return KedaYaPageScaffold(
      title: '帖子详情',
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
                Row(
                  children: <Widget>[
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: KedaYaTokens.space2,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: colors.surfaceAlt,
                        borderRadius:
                            BorderRadius.circular(KedaYaTokens.radiusPill),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          Icon(
                            Icons.apartment_outlined,
                            size: 12,
                            color: colors.textMuted,
                          ),
                          const SizedBox(width: 2),
                          Text(
                            post.building,
                            style: TextStyle(
                              fontSize: KedaYaTokens.fontSizeXs,
                              color: colors.textMuted,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: KedaYaTokens.space2),
                    Expanded(
                      child: Text(
                        post.alias,
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeXs,
                          fontWeight: KedaYaTokens.fontWeightMedium,
                          color: colors.brandStrong,
                        ),
                      ),
                    ),
                    Text(
                      formatDormTime(post.createdAt, now),
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeXs,
                        color: colors.textMuted,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: KedaYaTokens.space3),
                Text(
                  post.title,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXl,
                    fontWeight: KedaYaTokens.fontWeightSemibold,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.text,
                  ),
                ),
                const SizedBox(height: KedaYaTokens.space3),
                Text(
                  post.body,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    height: KedaYaTokens.lineHeightLoose,
                    color: colors.text,
                  ),
                ),
                const SizedBox(height: KedaYaTokens.space5),
                Row(
                  children: <Widget>[
                    Text(
                      '回复 ${post.replyCount}',
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeSm,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: colors.text,
                      ),
                    ),
                    const SizedBox(width: KedaYaTokens.space2),
                    Expanded(
                      child: Text(
                        '同样匿名',
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeXs,
                          color: colors.textMuted,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: KedaYaTokens.space2),
                if (post.replies.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      vertical: KedaYaTokens.space4,
                    ),
                    child: Text(
                      '还没有回复。第一条回复也会显示匿名代号；'
                      '就事论事、不针对个人，更容易得到有用的回应。',
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeSm,
                        height: KedaYaTokens.lineHeightNormal,
                        color: colors.textMuted,
                      ),
                    ),
                  )
                else
                  for (int index = 0; index < post.replies.length; index++)
                    _ReplyTile(
                      reply: post.replies[index],
                      now: now,
                      showDivider: index < post.replies.length - 1,
                    ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.fromLTRB(
              KedaYaTokens.space4,
              KedaYaTokens.space2,
              KedaYaTokens.space4,
              KedaYaTokens.space2,
            ),
            decoration: BoxDecoration(
              color: colors.surface,
              border: Border(top: BorderSide(color: colors.border)),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: <Widget>[
                Expanded(
                  child: TextField(
                    controller: _reply,
                    minLines: 1,
                    maxLines: 3,
                    decoration: const InputDecoration(
                      hintText: '写下你的回应（同样匿名）',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: KedaYaTokens.space2),
                ValueListenableBuilder<TextEditingValue>(
                  valueListenable: _reply,
                  builder: (
                    BuildContext context,
                    TextEditingValue value,
                    Widget? child,
                  ) {
                    final bool canSend = value.text.trim().isNotEmpty;
                    return IconButton.filled(
                      tooltip: '发送回复',
                      onPressed: canSend ? () => _sendReply(post) : null,
                      icon: const Icon(Icons.send_outlined, size: 20),
                    );
                  },
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ReplyTile extends StatelessWidget {
  const _ReplyTile({
    required this.reply,
    required this.now,
    required this.showDivider,
  });

  final DormReply reply;
  final DateTime now;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.symmetric(
            vertical: KedaYaTokens.space3,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      reply.alias,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeXs,
                        fontWeight: KedaYaTokens.fontWeightMedium,
                        color: colors.brandStrong,
                      ),
                    ),
                  ),
                  Text(
                    formatDormTime(reply.createdAt, now),
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
        ),
        if (showDivider) Divider(height: 1, color: colors.border),
      ],
    );
  }
}
