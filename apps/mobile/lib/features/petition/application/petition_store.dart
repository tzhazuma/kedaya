import '../../../domain/models/petition_ticket.dart';
import '../../../domain/ports/local_cache_port.dart';

/// 本机存储键（带版本号；将来改结构时换 key 而不是就地改旧数据）。
const String petitionStorageKey = 'petition.tickets.v1';

/// 「我的提交」的本机读写接口。
///
/// 抽成接口是为了让 controller 的测试不必碰 `SharedPreferences`：
/// 测试里换一个内存实现即可。读**同步**（与 [LocalCachePort] 一致），
/// 因此首屏不会出现加载骨架。
abstract interface class PetitionStore {
  List<PetitionTicket> read();

  Future<void> write(List<PetitionTicket> tickets);
}

/// `LocalCachePort`（SharedPreferences）实现。
///
/// 只写本机：这个类**没有任何网络依赖**，也没法「顺手」发出去 ——
/// 演示版的隐私承诺在依赖图上就成立。
final class LocalPetitionStore implements PetitionStore {
  const LocalPetitionStore(this._cache);

  final LocalCachePort _cache;

  @override
  List<PetitionTicket> read() {
    final Object? raw = _cache.readJson(petitionStorageKey);
    if (raw is! Map) return const <PetitionTicket>[];
    final Object? items = raw['tickets'];
    if (items is! List) return const <PetitionTicket>[];

    final List<PetitionTicket> tickets = <PetitionTicket>[];
    for (final Object? item in items) {
      if (item is! Map) continue;
      try {
        tickets.add(
          PetitionTicket.fromJson(Map<String, Object?>.from(item)),
        );
      } on Object {
        // 单条损坏（例如旧版本字段）只丢这一条，不把整个列表清空。
        continue;
      }
    }
    return tickets;
  }

  @override
  Future<void> write(List<PetitionTicket> tickets) {
    final List<PetitionTicket> kept = sortPetitionTickets(tickets)
        .take(petitionStoredLimit)
        .toList(growable: false);
    return _cache.writeJson(petitionStorageKey, <String, Object?>{
      'version': 1,
      'tickets': kept
          .map((PetitionTicket ticket) => ticket.toJson())
          .toList(growable: false),
    });
  }
}
