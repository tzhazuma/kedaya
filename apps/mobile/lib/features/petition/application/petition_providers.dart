import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/app_providers.dart';
import '../../../domain/models/petition_ticket.dart';
import '../../../domain/ports/local_cache_port.dart';
import 'petition_store.dart';

/// 「现在」的注入点。
///
/// 提交时间、记录 id 都依赖它；测试里 override 成固定时刻就能做确定性断言。
final petitionClockProvider =
    Provider<DateTime Function()>((ref) => DateTime.now);

/// 本机存储（`LocalCachePort` → `LocalPetitionStore`）。
///
/// 测试直接 override 这个 provider，就不必装配整个 [AppRuntime]。
final petitionStoreProvider = Provider<PetitionStore>((ref) {
  final LocalCachePort cache = ref.watch(localCacheProvider);
  return LocalPetitionStore(cache);
});

/// 「我的提交」—— 同步读本机、按时间倒序。
final petitionTicketsProvider =
    NotifierProvider<PetitionTicketsController, List<PetitionTicket>>(
  PetitionTicketsController.new,
);

/// 按 id 取一条记录；不存在返回 null（详情页据此给如实的空态）。
final petitionTicketProvider =
    Provider.family<PetitionTicket?, String>((ref, String id) {
  for (final PetitionTicket ticket in ref.watch(petitionTicketsProvider)) {
    if (ticket.id == id) return ticket;
  }
  return null;
});

final class PetitionTicketsController extends Notifier<List<PetitionTicket>> {
  int _sequence = 0;

  @override
  List<PetitionTicket> build() {
    final PetitionStore store = ref.watch(petitionStoreProvider);
    return sortPetitionTickets(store.read());
  }

  /// 校验 → 落盘 → 更新状态。
  ///
  /// 顺序刻意是「先写盘再改内存」：写盘失败时页面会拿到异常，
  /// 列表也不会出现一条其实没保存成功的记录。
  Future<PetitionTicket> submit(PetitionDraft draft) async {
    final List<PetitionDraftProblem> problems = validatePetitionDraft(draft);
    if (problems.isNotEmpty) {
      throw PetitionDraftException(problems);
    }

    final PetitionCategory? category = draft.category;
    if (category == null) {
      // validatePetitionDraft 已经拦住；这里只是让类型收窄。
      throw const PetitionDraftException(
        <PetitionDraftProblem>[PetitionDraftProblem.categoryMissing],
      );
    }

    final DateTime now = ref.read(petitionClockProvider)();
    final PetitionTicket ticket = PetitionTicket(
      id: 'petition-${now.microsecondsSinceEpoch}-${_sequence++}',
      category: category,
      title: draft.title,
      body: draft.body,
      anonymous: draft.anonymous,
      contact: draft.contact,
      submittedAt: now,
    );

    final List<PetitionTicket> next = sortPetitionTickets(
      <PetitionTicket>[ticket, ...state],
    );
    await ref.read(petitionStoreProvider).write(next);
    state = next;
    return ticket;
  }

  /// 撤回：**只有「已提交」可以**。
  ///
  /// 撤回后从本机删除；进入处理或已有回复的记录抛 [StateError]，
  /// 页面据此不显示按钮，controller 再兜一层。
  Future<void> withdraw(String id) async {
    PetitionTicket? target;
    for (final PetitionTicket ticket in state) {
      if (ticket.id == id) {
        target = ticket;
        break;
      }
    }
    if (target == null) {
      throw StateError('本机没有这条提交记录（$id）');
    }
    if (!target.canWithdraw) {
      throw StateError(
        '「${target.status.label}」的记录不能撤回；只有「已提交」可以',
      );
    }

    final List<PetitionTicket> next = state
        .where((PetitionTicket ticket) => ticket.id != id)
        .toList(growable: false);
    await ref.read(petitionStoreProvider).write(next);
    state = next;
  }
}
