import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/dorm_post.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/dorm_harmony_providers.dart';
import '../components/dorm_post_card.dart';
import '../components/dorm_safety_notice.dart';

/// 宿舍矛盾首页：匿名倾诉板。
class DormHarmonyPage extends ConsumerStatefulWidget {
  const DormHarmonyPage({super.key});

  @override
  ConsumerState<DormHarmonyPage> createState() => _DormHarmonyPageState();
}

class _DormHarmonyPageState extends ConsumerState<DormHarmonyPage> {
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
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final List<DormPost> posts = ref.watch(dormVisiblePostsProvider);
    final List<DormPost> all = ref.watch(dormHarmonyPostsProvider);
    final String? selected = ref.watch(dormBuildingFilterProvider);
    final DateTime now = ref.watch(dormHarmonyClockProvider)();

    return KedaYaPageScaffold(
      title: '宿舍矛盾',
      padding: EdgeInsets.zero,
      actions: <Widget>[
        TextButton.icon(
          onPressed: () => context.push('/dorm-harmony/new'),
          icon: const Icon(Icons.edit_outlined, size: 18),
          label: const Text('发帖'),
        ),
      ],
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
          const SizedBox(height: KedaYaTokens.space2),
          DormBuildingFilter(
            selected: selected,
            onSelected: (String? building) =>
                ref.read(dormBuildingFilterProvider.notifier).state = building,
          ),
          Expanded(
            child: posts.isEmpty
                ? ListView(
                    padding: const EdgeInsets.all(KedaYaTokens.space4),
                    children: <Widget>[
                      KedaYaEmptyState(
                        title: all.isEmpty ? '还没有人开口' : '这个楼栋还没有帖子',
                        description: all.isEmpty
                            ? '这里是一个匿名倾诉板：把宿舍生活里具体的困扰写下来，'
                                '让有类似经历的同学回应。不点名、不人身攻击，'
                                '也不做公开举报；涉及安全的情况请直接联系辅导员或保卫处。'
                                '第一帖可以是你。'
                            : '换个楼栋看看，或者成为第一个开口的人。'
                                '这里只聊具体的生活问题，不针对个人。',
                        icon: Icons.forum_outlined,
                      ),
                    ],
                  )
                : ListView.separated(
                    padding: const EdgeInsets.all(KedaYaTokens.space4),
                    itemCount: posts.length,
                    separatorBuilder: (BuildContext context, int index) =>
                        const SizedBox(height: KedaYaTokens.space3),
                    itemBuilder: (BuildContext context, int index) {
                      final DormPost post = posts[index];
                      return DormPostCard(
                        post: post,
                        now: now,
                        onTap: () => context.push('/dorm-harmony/${post.id}'),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
