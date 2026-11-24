import '../../../domain/models/flea_listing.dart';

/// 跳蚤市场的**本机内存仓库**（演示用）。
///
/// 不接 `AppRuntime`、不落盘、不发网络请求：进程退出数据就没了。
/// 这正是页面底部必须写「演示数据 · 仅本机保存」的原因。
///
/// 仓库自己再做一次校验（不只依赖表单）：即使将来有别的调用方，
/// 也写不进「价格为 0」或「标题为空」的条目。
final class FleaMarketRepository {
  FleaMarketRepository({
    List<FleaListing> seed = const <FleaListing>[],
    DateTime Function()? clock,
  })  : _listings = <FleaListing>[...seed],
        _clock = clock ?? DateTime.now,
        _sequence = seed.length;

  final List<FleaListing> _listings;
  final DateTime Function() _clock;

  /// 本机发布的自增序号（种子数据不进这个序列）。
  int _sequence;

  /// 全部条目（含已下架）。只读快照，调用方无法绕过仓库改状态。
  List<FleaListing> get listings => List<FleaListing>.unmodifiable(_listings);

  FleaListing? findById(String id) {
    for (final FleaListing listing in _listings) {
      if (listing.id == id) return listing;
    }
    return null;
  }

  /// 发布一条闲置；校验不通过时抛 [FleaDraftException]。
  FleaListing publish(FleaDraft draft) {
    final List<FleaDraftProblem> problems = validateFleaDraft(draft);
    if (problems.isNotEmpty) throw FleaDraftException(problems);

    final FleaListing listing = FleaListing(
      id: 'flea-local-${++_sequence}',
      title: draft.title.trim(),
      // `validateFleaDraft` 已保证能解析，这里的 `!` 不会在合法输入上触发。
      priceFen: draft.priceFen!,
      condition: draft.condition,
      category: draft.category,
      location: draft.location.trim(),
      description: draft.description.trim(),
      createdAt: _clock(),
      isMine: true,
      active: true,
    );
    _listings.insert(0, listing);
    return listing;
  }

  /// 下架 / 重新上架。只有自己的发布能改，别人的抛 [StateError]。
  FleaListing setActive(String id, bool active) {
    final int index = _listings.indexWhere((FleaListing it) => it.id == id);
    if (index == -1) {
      throw StateError('FleaMarket: 找不到 "$id"');
    }
    final FleaListing listing = _listings[index];
    if (!listing.isMine) {
      throw StateError('FleaMarket: 只有自己的发布才能下架或重新上架');
    }
    final FleaListing updated = listing.copyWith(active: active);
    _listings[index] = updated;
    return updated;
  }
}

/// 演示种子数据。
///
/// 时间**相对 `now` 生成**，否则过几天再看，所有条目都会变成「几个月前」，
/// 相对时间与「最新」排序就演示不出效果了。
/// 其中两条 `isMine: true`（一条在架、一条已下架），用来演示「我的」里的两种状态。
List<FleaListing> buildSeedFleaListings(DateTime now) => <FleaListing>[
      FleaListing(
        id: 'flea-demo-1',
        title: '高等数学教材（第七版）上下册',
        priceFen: 2500,
        condition: FleaCondition.good,
        category: FleaCategory.textbook,
        location: '二食堂门口',
        createdAt: now.subtract(const Duration(minutes: 8)),
        description: '上册有少量笔记，下册基本全新。期末周急出，两本一起拿走。',
      ),
      FleaListing(
        id: 'flea-demo-2',
        title: '索尼 WH-1000XM4 降噪耳机',
        priceFen: 89900,
        condition: FleaCondition.likeNew,
        category: FleaCategory.electronics,
        location: '图书馆一楼大厅',
        createdAt: now.subtract(const Duration(hours: 3)),
        description: '去年双十一买的，耳罩无脱皮，降噪正常。附原装收纳盒和充电线。',
      ),
      FleaListing(
        id: 'flea-demo-3',
        title: '宿舍可调光小台灯',
        priceFen: 3550,
        condition: FleaCondition.brandNew,
        category: FleaCategory.daily,
        location: '五号宿舍楼下',
        createdAt: now.subtract(const Duration(hours: 26)),
        description: '买重了，全新未拆封。三档色温，USB 供电。',
      ),
      FleaListing(
        id: 'flea-demo-4',
        title: '87 键机械键盘（青轴）',
        priceFen: 12000,
        condition: FleaCondition.good,
        category: FleaCategory.electronics,
        location: '信息学院 B 区',
        createdAt: now.subtract(const Duration(days: 2)),
        description: '键帽有使用痕迹，功能全部正常。宿舍用青轴太吵，故出。',
      ),
      FleaListing(
        id: 'flea-demo-5',
        title: '考研英语真题（近十年）',
        priceFen: 1500,
        condition: FleaCondition.usable,
        category: FleaCategory.textbook,
        location: '三号宿舍楼下',
        createdAt: now.subtract(const Duration(hours: 5)),
        description: '做过一遍，答案用铅笔写的，可以擦掉重做。',
        isMine: true,
      ),
      FleaListing(
        id: 'flea-demo-6',
        title: '折叠衣架 + 收纳箱',
        priceFen: 2000,
        condition: FleaCondition.good,
        category: FleaCategory.daily,
        location: '一食堂门口',
        createdAt: now.subtract(const Duration(days: 6)),
        description: '搬家剩下的，衣架十个，收纳箱 40L，一起出。',
        isMine: true,
        // 已下架示例：只出现在「我的」，不在「全部」。
        active: false,
      ),
    ];
