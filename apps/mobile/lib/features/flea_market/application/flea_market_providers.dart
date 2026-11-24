import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../domain/models/flea_listing.dart';
import 'flea_market_repository.dart';

/// 「现在」的注入点（相对时间、发布时间、排序都依赖它）。
///
/// 演示数据与测试都通过 override 固定时刻，页面本身不读 `DateTime.now()`。
final fleaMarketClockProvider =
    Provider<DateTime Function()>((ref) => DateTime.now);

/// 本机内存仓库：**provider 里直接 new**，不经过 `AppRuntime`。
///
/// 种子时间用注入的时钟生成，这样「8 分钟前」在今天和明天看都是真的 8 分钟。
final fleaMarketRepositoryProvider = Provider<FleaMarketRepository>((ref) {
  final DateTime Function() clock = ref.watch(fleaMarketClockProvider);
  return FleaMarketRepository(
    seed: buildSeedFleaListings(clock()),
    clock: clock,
  );
});

/// 全部条目（含已下架）。页面拿它再做筛选与排序 —— 规则在 [visibleFleaListings]。
final fleaMarketListingsProvider =
    NotifierProvider<FleaMarketListingsController, List<FleaListing>>(
  FleaMarketListingsController.new,
);

/// 写操作的唯一入口：发布、下架 / 重新上架。
///
/// 每次写完都把仓库的最新快照推回 `state`，避免页面自己拼接状态。
final class FleaMarketListingsController extends Notifier<List<FleaListing>> {
  @override
  List<FleaListing> build() => ref.watch(fleaMarketRepositoryProvider).listings;

  /// 发布；校验失败时抛 [FleaDraftException]（表单会先校验，这里是第二道）。
  FleaListing publish(FleaDraft draft) {
    final FleaMarketRepository repository =
        ref.read(fleaMarketRepositoryProvider);
    final FleaListing listing = repository.publish(draft);
    state = repository.listings;
    return listing;
  }

  /// 下架（`active: false`）或重新上架（`active: true`）。
  FleaListing setActive(String id, bool active) {
    final FleaMarketRepository repository =
        ref.read(fleaMarketRepositoryProvider);
    final FleaListing listing = repository.setActive(id, active);
    state = repository.listings;
    return listing;
  }
}
