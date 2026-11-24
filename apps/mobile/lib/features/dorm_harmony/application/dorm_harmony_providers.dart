import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../domain/models/dorm_post.dart';
import '../data/dorm_harmony_repository.dart';
import '../domain/dorm_board.dart';

/// 「现在」的注入点（相对时间 / 演示数据）。
final dormHarmonyClockProvider =
    Provider<DateTime Function()>((ref) => DateTime.now);

/// 本机内存仓库（**直接 new**，不经过 AppRuntime）。
final dormHarmonyRepositoryProvider = Provider<DormHarmonyRepository>((ref) {
  final DateTime Function() clock = ref.watch(dormHarmonyClockProvider);
  return DormHarmonyRepository(clock: clock);
});

final dormHarmonyPostsProvider =
    NotifierProvider<DormHarmonyController, List<DormPost>>(
  DormHarmonyController.new,
);

final class DormHarmonyController extends Notifier<List<DormPost>> {
  @override
  List<DormPost> build() {
    final DormHarmonyRepository repository =
        ref.watch(dormHarmonyRepositoryProvider);
    return repository.snapshot();
  }

  DormPost create(DormPostDraft draft) {
    final DormHarmonyRepository repository =
        ref.read(dormHarmonyRepositoryProvider);
    final DormPost created = repository.create(draft);
    state = repository.snapshot();
    return created;
  }

  DormReply reply(String postId, String body) {
    final DormHarmonyRepository repository =
        ref.read(dormHarmonyRepositoryProvider);
    final DormReply reply = repository.addReply(postId, body);
    state = repository.snapshot();
    return reply;
  }
}

/// 楼栋筛选：`null` = 全部。
final dormBuildingFilterProvider = StateProvider<String?>((ref) => null);

/// 当前筛选下的帖子（仓库已按时间倒序）。
final dormVisiblePostsProvider = Provider<List<DormPost>>((ref) {
  return filterDormPosts(
    ref.watch(dormHarmonyPostsProvider),
    ref.watch(dormBuildingFilterProvider),
  );
});

/// 单条帖子；不存在时返回 `null`。
final dormPostProvider = Provider.family<DormPost?, String>((ref, String id) {
  final List<DormPost> posts = ref.watch(dormHarmonyPostsProvider);
  for (final DormPost post in posts) {
    if (post.id == id) return post;
  }
  return null;
});
