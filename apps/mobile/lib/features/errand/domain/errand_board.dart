/// 跑腿列表的展示规则（Tab 归类、排序、倒计时文案）。
///
/// 这些规则不放进 `domain/models/errand_task.dart`：领域模型镜像契约，
/// 而「哪些状态算进行中」「先看哪条」是**本模块的产品口径**。
library;

import '../../../domain/models/errand_task.dart';

/// 列表三个 Tab。
enum ErrandTab {
  open('待接单'),
  inProgress('进行中'),
  completed('已完成');

  const ErrandTab(this.label);

  final String label;
}

/// 状态 → Tab。
///
/// `cancelled` / `unknown` 不进入任何 Tab：演示板不展示无法操作的历史状态，
/// 也不把它们伪装成「已完成」。
ErrandTab? errandTabOf(ErrandStatus status) => switch (status) {
      ErrandStatus.open => ErrandTab.open,
      ErrandStatus.accepted => ErrandTab.inProgress,
      ErrandStatus.delivered => ErrandTab.inProgress,
      ErrandStatus.completed => ErrandTab.completed,
      ErrandStatus.cancelled => null,
      ErrandStatus.unknown => null,
    };

/// 取件点（空值给明确占位，而不是空白行）。
String errandPickupText(ErrandTask task) {
  final String? pickup = task.pickupAddress?.trim();
  return (pickup == null || pickup.isEmpty) ? '取件点待定' : pickup;
}

/// 送达点。
String errandDeliveryText(ErrandTask task) {
  final String? delivery = task.deliveryAddress?.trim();
  return (delivery == null || delivery.isEmpty) ? '送达点待完善' : delivery;
}

/// 列表摘要：压平空白并截断。
String errandNoteExcerpt(String? note, {int maxLength = 36}) {
  if (note == null) return '';
  final String normalized = note.trim().replaceAll(RegExp(r'\s+'), ' ');
  if (normalized.length <= maxLength) return normalized;
  return '${normalized.substring(0, maxLength)}…';
}

/// 发布者代号（**不暴露 requesterId**）。
///
/// 用 requesterId 做稳定哈希，同一个发布者在演示板上始终是同一个代号；
/// 但代号本身不可反推用户 id。
String errandPosterAlias(ErrandTask task) {
  final String source = task.requesterId ?? task.id;
  int hash = 0;
  for (final int codeUnit in source.codeUnits) {
    hash = (hash * 31 + codeUnit) & 0x7fffffff;
  }
  const String letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  final String letter = letters[hash % letters.length];
  final int number = (hash ~/ letters.length) % 90 + 10;
  return '同学 $letter$number';
}

/// 截止时间是否已过。
bool errandDeadlinePassed(DateTime? deadline, DateTime now) =>
    deadline != null && !deadline.isAfter(now);

/// 是否 1 小时内截止（不含已截止）。
bool errandDeadlineUrgent(DateTime? deadline, DateTime now) {
  if (deadline == null || errandDeadlinePassed(deadline, now)) return false;
  return deadline.difference(now) <= const Duration(hours: 1);
}

/// 相对倒计时：`还有 23 分钟截止` / `还有 2 小时 10 分钟截止` / `已截止`。
String errandDeadlineText(DateTime? deadline, DateTime now) {
  if (deadline == null) return '不设截止';
  final Duration remaining = deadline.difference(now);
  if (remaining <= Duration.zero) return '已截止';
  if (remaining.inMinutes < 60) {
    final int minutes = (remaining.inSeconds / 60).ceil();
    return '还有 $minutes 分钟截止';
  }
  if (remaining.inHours < 24) {
    final int rest = remaining.inMinutes % 60;
    return rest == 0
        ? '还有 ${remaining.inHours} 小时截止'
        : '还有 ${remaining.inHours} 小时 $rest 分钟截止';
  }
  return '还有 ${remaining.inDays} 天截止';
}

/// 绝对时间：`11月24日 18:30`（本地时区）。
String formatErrandDateTime(DateTime value) {
  final DateTime local = value.isUtc ? value.toLocal() : value;
  final String hour = local.hour.toString().padLeft(2, '0');
  final String minute = local.minute.toString().padLeft(2, '0');
  return '${local.month}月${local.day}日 $hour:$minute';
}

/// 某个 Tab 的任务，已按该 Tab 的阅读顺序排好。
///
/// - 待接单：先截止的排前面（无截止时间的排最后），同截止时间新的在前；
/// - 进行中 / 已完成：最近创建/完成的排前面。
List<ErrandTask> errandsForTab(
  Iterable<ErrandTask> tasks,
  ErrandTab tab,
) {
  final List<ErrandTask> filtered = tasks
      .where((ErrandTask task) => errandTabOf(task.status) == tab)
      .toList(growable: false);
  final List<ErrandTask> sorted = List<ErrandTask>.of(filtered);
  sorted.sort((ErrandTask a, ErrandTask b) => _compare(a, b, tab));
  return List<ErrandTask>.unmodifiable(sorted);
}

int _compare(ErrandTask a, ErrandTask b, ErrandTab tab) {
  if (tab != ErrandTab.open) {
    final int byCreated = b.createdAt.compareTo(a.createdAt);
    if (byCreated != 0) return byCreated;
    return a.id.compareTo(b.id);
  }
  final DateTime? aDeadline = a.deadline;
  final DateTime? bDeadline = b.deadline;
  if (aDeadline == null && bDeadline == null) {
    return b.createdAt.compareTo(a.createdAt);
  }
  if (aDeadline == null) return 1;
  if (bDeadline == null) return -1;
  final int byDeadline = aDeadline.compareTo(bDeadline);
  if (byDeadline != 0) return byDeadline;
  return b.createdAt.compareTo(a.createdAt);
}
