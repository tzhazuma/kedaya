/// 宿舍矛盾列表的纯规则（楼栋筛选）。
library;

import '../../../domain/models/dorm_post.dart';

/// 选中的楼栋；`null` 或「全部」表示不过滤。
List<DormPost> filterDormPosts(
  Iterable<DormPost> posts,
  String? building,
) {
  if (building == null || building.isEmpty || building == '全部') {
    return List<DormPost>.unmodifiable(posts);
  }
  return List<DormPost>.unmodifiable(
    posts.where((DormPost post) => post.building == building),
  );
}
