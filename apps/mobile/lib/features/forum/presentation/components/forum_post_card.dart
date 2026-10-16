import 'package:flutter/material.dart';

import '../../../../domain/models/forum.dart';
import '../../../../domain/models/time_text.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import 'forum_badges.dart';

/// 主题卡片（列表用）。
class ForumPostCard extends StatelessWidget {
  const ForumPostCard({
    required this.post,
    required this.onTap,
    this.now,
    super.key,
  });

  final ForumPost post;
  final VoidCallback onTap;

  /// 相对时间的参照点；测试可注入固定值。
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        child: Padding(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  if (post.isPinned) ...<Widget>[
                    const ForumPill(
                      text: '置顶',
                      tone: ForumPillTone.brand,
                      icon: Icons.push_pin_outlined,
                    ),
                    const SizedBox(width: KedaYaTokens.space1),
                  ],
                  if (post.boardName != null) ...<Widget>[
                    ForumPill(text: post.boardName!),
                    const SizedBox(width: KedaYaTokens.space1),
                  ],
                  if (post.anonymous) ...<Widget>[
                    ForumAnonymousBadge(notice: anonymousPostNotice),
                    const SizedBox(width: KedaYaTokens.space1),
                  ],
                  if (post.isLocked) ...<Widget>[
                    const ForumPill(
                      text: '已锁定',
                      tone: ForumPillTone.danger,
                      icon: Icons.lock_outline,
                    ),
                    const SizedBox(width: KedaYaTokens.space1),
                  ],
                  const Spacer(),
                  Text(
                    formatRelativeTime(post.createdAt, now: now),
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: colors.textMuted,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: KedaYaTokens.space2),
              Text(
                post.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeMd,
                  fontWeight: KedaYaTokens.fontWeightSemibold,
                  color: colors.text,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space1),
              Text(
                post.body,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.textMuted,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space3),
              Row(
                children: <Widget>[
                  Text(
                    post.author.displayName,
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: colors.textMuted,
                    ),
                  ),
                  const Spacer(),
                  for (final String tag in post.tags.take(3)) ...<Widget>[
                    ForumPill(text: '#$tag'),
                    const SizedBox(width: KedaYaTokens.space1),
                  ],
                  Icon(Icons.mode_comment_outlined, size: 14, color: colors.textMuted),
                  const SizedBox(width: KedaYaTokens.space1),
                  Text(
                    '${post.replyCount}',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: colors.textMuted,
                    ),
                  ),
                  const SizedBox(width: KedaYaTokens.space2),
                  Icon(Icons.thumb_up_outlined, size: 14, color: colors.textMuted),
                  const SizedBox(width: KedaYaTokens.space1),
                  Text(
                    '${post.likeCount}',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: colors.textMuted,
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
}
