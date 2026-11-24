import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/flea_listing.dart';
import 'package:kedaya/features/flea_market/application/flea_market_providers.dart';
import 'package:kedaya/features/flea_market/application/flea_market_repository.dart';

/// `flea-market` 的规则层测试。
///
/// 覆盖五件产品承诺：分类筛选、搜索、价格排序、发布校验、下架后从「全部」消失。
/// 页面怎么画不在这里测 —— 规则错了，页面再好看也没用。
void main() {
  final DateTime now = DateTime(2026, 11, 24, 12);

  FleaListing make({
    required String id,
    String title = '闲置',
    int priceFen = 1000,
    FleaCondition condition = FleaCondition.good,
    FleaCategory category = FleaCategory.other,
    String location = '一食堂门口',
    String description = '',
    DateTime? createdAt,
    bool isMine = false,
    bool active = true,
  }) =>
      FleaListing(
        id: id,
        title: title,
        priceFen: priceFen,
        condition: condition,
        category: category,
        location: location,
        description: description,
        createdAt: createdAt ?? now,
        isMine: isMine,
        active: active,
      );

  group('分类筛选', () {
    final List<FleaListing> all = <FleaListing>[
      make(id: 'textbook-1', category: FleaCategory.textbook),
      make(id: 'electronics-1', category: FleaCategory.electronics),
      make(id: 'daily-1', category: FleaCategory.daily),
      make(
          id: 'textbook-off',
          category: FleaCategory.textbook,
          active: false,
          isMine: true),
    ];

    test('传分类只返回该分类、且在架的条目', () {
      final List<FleaListing> result =
          visibleFleaListings(all, category: FleaCategory.textbook);
      expect(result.map((FleaListing it) => it.id), <String>['textbook-1']);
    });

    test('不传分类 = 全部（已下架的仍然不出现）', () {
      final List<FleaListing> result = visibleFleaListings(all);
      expect(
        result.map((FleaListing it) => it.id).toSet(),
        <String>{'textbook-1', 'electronics-1', 'daily-1'},
      );
    });

    test('「我的」范围包含自己已下架的发布', () {
      final List<FleaListing> result = visibleFleaListings(
        all,
        scope: FleaScope.mine,
        category: FleaCategory.textbook,
      );
      final List<String> ids = result.map((FleaListing it) => it.id).toList();
      expect(ids, contains('textbook-off'));
      // 别人的条目不会混进「我的」。
      expect(ids, isNot(contains('electronics-1')));
    });
  });

  group('搜索', () {
    final List<FleaListing> all = <FleaListing>[
      make(
        id: 'earphone',
        title: '索尼 WH-1000XM4 降噪耳机',
        description: '耳罩无脱皮，附收纳盒',
        location: '图书馆一楼大厅',
      ),
      make(id: 'book', title: '高等数学教材', location: '二食堂门口'),
    ];

    List<String> idsOf(String query) => visibleFleaListings(all, query: query)
        .map((FleaListing it) => it.id)
        .toList();

    test('标题命中', () {
      expect(idsOf('耳机'), <String>['earphone']);
    });

    test('描述与地点也能命中', () {
      expect(idsOf('收纳盒'), <String>['earphone']);
      expect(idsOf('二食堂'), <String>['book']);
    });

    test('大小写不敏感，前后空白忽略', () {
      expect(idsOf('  wh-1000xm4  '), <String>['earphone']);
    });

    test('空关键词返回全部', () {
      expect(idsOf('   ').length, 2);
    });

    test('没有命中时返回空列表', () {
      expect(idsOf('不存在的关键词'), isEmpty);
    });
  });

  group('排序', () {
    final List<FleaListing> all = <FleaListing>[
      make(
        id: 'new-expensive',
        priceFen: 90000,
        createdAt: now.subtract(const Duration(minutes: 1)),
      ),
      make(
        id: 'old-cheap',
        priceFen: 500,
        createdAt: now.subtract(const Duration(days: 3)),
      ),
      make(
        id: 'mid',
        priceFen: 2000,
        createdAt: now.subtract(const Duration(hours: 2)),
      ),
    ];

    test('最新：按发布时间倒序', () {
      expect(
        visibleFleaListings(all).map((FleaListing it) => it.id),
        <String>['new-expensive', 'mid', 'old-cheap'],
      );
    });

    test('价格从低到高：按分比较，不受浮点影响', () {
      expect(
        visibleFleaListings(all, sort: FleaSort.priceAsc)
            .map((FleaListing it) => it.id),
        <String>['old-cheap', 'mid', 'new-expensive'],
      );
    });

    test('价格展示：整数不带小数，一位小数保留一位', () {
      expect(formatFleaPrice(2500), '¥25');
      expect(formatFleaPrice(3550), '¥35.5');
      expect(formatFleaPrice(3555), '¥35.55');
    });
  });

  group('发布校验', () {
    FleaDraft draft({
      String title = '台灯',
      String priceYuan = '25',
      String location = '三号宿舍楼下',
      String description = '',
    }) =>
        FleaDraft(
          title: title,
          priceYuan: priceYuan,
          condition: FleaCondition.likeNew,
          category: FleaCategory.daily,
          location: location,
          description: description,
        );

    test('合法草稿没有问题', () {
      expect(validateFleaDraft(draft()), isEmpty);
      expect(validateFleaDraft(draft(priceYuan: '12.5')), isEmpty);
      expect(validateFleaDraft(draft(priceYuan: ' 0.5 ')), isEmpty);
    });

    test('标题为空 / 只有空白都不行', () {
      expect(validateFleaDraft(draft(title: '')), <FleaDraftProblem>[
        FleaDraftProblem.titleEmpty,
      ]);
      expect(validateFleaDraft(draft(title: '   ')), <FleaDraftProblem>[
        FleaDraftProblem.titleEmpty,
      ]);
    });

    test('价格必须大于 0，且不能是负数 / 非法格式', () {
      expect(validateFleaDraft(draft(priceYuan: '0')), <FleaDraftProblem>[
        FleaDraftProblem.priceNotPositive,
      ]);
      expect(validateFleaDraft(draft(priceYuan: '-1')), <FleaDraftProblem>[
        FleaDraftProblem.priceNotNumber,
      ]);
      expect(validateFleaDraft(draft(priceYuan: 'abc')), <FleaDraftProblem>[
        FleaDraftProblem.priceNotNumber,
      ]);
      // 只允许一位小数：两位小数是非法输入，不会被四舍五入。
      expect(validateFleaDraft(draft(priceYuan: '12.34')), <FleaDraftProblem>[
        FleaDraftProblem.priceNotNumber,
      ]);
    });

    test('价格解析：元 → 分', () {
      expect(parseFleaPriceFen('12'), 1200);
      expect(parseFleaPriceFen('12.5'), 1250);
      expect(parseFleaPriceFen('12.0'), 1200);
      expect(parseFleaPriceFen(''), isNull);
      expect(parseFleaPriceFen('12.'), isNull);
    });

    test('描述最多 300 字', () {
      expect(
        validateFleaDraft(draft(description: '字' * fleaDescriptionMax)),
        isEmpty,
      );
      expect(
        validateFleaDraft(draft(description: '字' * (fleaDescriptionMax + 1))),
        <FleaDraftProblem>[FleaDraftProblem.descriptionTooLong],
      );
    });

    test('仓库写入前会再校验一次（不能绕过表单写非法价格）', () {
      final FleaMarketRepository repository =
          FleaMarketRepository(clock: () => now);
      expect(
        () => repository.publish(draft(priceYuan: '0')),
        throwsA(isA<FleaDraftException>()),
      );
      expect(repository.listings, isEmpty);
    });
  });

  group('下架与重新上架', () {
    late FleaMarketRepository repository;

    setUp(() {
      repository = FleaMarketRepository(
        seed: buildSeedFleaListings(now),
        clock: () => now,
      );
    });

    test('下架后不出现在「全部」，但仍在「我的」里', () {
      const String mineId = 'flea-demo-5';
      expect(
        visibleFleaListings(repository.listings).map((FleaListing it) => it.id),
        contains(mineId),
      );

      repository.setActive(mineId, false);

      expect(
        visibleFleaListings(repository.listings).map((FleaListing it) => it.id),
        isNot(contains(mineId)),
      );
      expect(
        visibleFleaListings(repository.listings, scope: FleaScope.mine)
            .map((FleaListing it) => it.id),
        contains(mineId),
      );

      repository.setActive(mineId, true);
      expect(
        visibleFleaListings(repository.listings).map((FleaListing it) => it.id),
        contains(mineId),
      );
    });

    test('种子里预置的已下架条目只出现在「我的」', () {
      const String inactiveId = 'flea-demo-6';
      expect(
        visibleFleaListings(repository.listings).map((FleaListing it) => it.id),
        isNot(contains(inactiveId)),
      );
      expect(
        visibleFleaListings(repository.listings, scope: FleaScope.mine)
            .map((FleaListing it) => it.id),
        contains(inactiveId),
      );
    });

    test('不能下架别人的发布', () {
      expect(
        () => repository.setActive('flea-demo-1', false),
        throwsStateError,
      );
      expect(repository.findById('flea-demo-1')!.active, isTrue);
    });

    test('找不到 id 时抛 StateError', () {
      expect(
        () => repository.setActive('nope', false),
        throwsStateError,
      );
    });
  });

  group('发布落库与联系文案', () {
    test('发布后成为「我的」且在「全部」顶部（最新）', () {
      final FleaMarketRepository repository = FleaMarketRepository(
        seed: buildSeedFleaListings(now),
        clock: () => now,
      );
      final FleaListing created = repository.publish(
        const FleaDraft(
          title: '宿舍小台灯',
          priceYuan: '12.5',
          condition: FleaCondition.brandNew,
          category: FleaCategory.daily,
          location: '五号宿舍楼下',
          description: '全新未拆封',
        ),
      );

      expect(created.priceFen, 1250);
      expect(created.isMine, isTrue);
      expect(created.active, isTrue);
      expect(
        visibleFleaListings(repository.listings).first.id,
        created.id,
      );
      expect(
        visibleFleaListings(repository.listings, scope: FleaScope.mine)
            .map((FleaListing it) => it.id),
        contains(created.id),
      );
    });

    test('联系文案包含标题、价格、地点，且没有手机号字段', () {
      final String text = buildFleaContactText(
        make(
          id: 'x',
          title: '漫步者蓝牙耳机',
          priceFen: 1250,
          condition: FleaCondition.likeNew,
          location: '三号宿舍楼下',
          description: '功能正常',
        ),
      );
      expect(text, contains('漫步者蓝牙耳机'));
      expect(text, contains('¥12.5'));
      expect(text, contains('九成新'));
      expect(text, contains('三号宿舍楼下'));
      expect(text, isNot(contains('手机号')));
      expect(text, isNot(contains('电话')));
    });

    test('相对时间使用注入的 now', () {
      final FleaListing listing = make(
        id: 'x',
        createdAt: now.subtract(const Duration(hours: 3)),
      );
      expect(describeFleaPostedAt(listing, now), '3 小时前');
    });
  });

  group('状态层（Riverpod）', () {
    test('下架后列表 provider 的「全部」结果立即变化', () {
      final ProviderContainer container = ProviderContainer(
        overrides: <Override>[
          fleaMarketClockProvider.overrideWithValue(() => now),
        ],
      );
      addTearDown(container.dispose);

      const String mineId = 'flea-demo-5';
      expect(
        visibleFleaListings(container.read(fleaMarketListingsProvider))
            .map((FleaListing it) => it.id),
        contains(mineId),
      );

      container
          .read(fleaMarketListingsProvider.notifier)
          .setActive(mineId, false);

      expect(
        visibleFleaListings(container.read(fleaMarketListingsProvider))
            .map((FleaListing it) => it.id),
        isNot(contains(mineId)),
      );
    });
  });
}
