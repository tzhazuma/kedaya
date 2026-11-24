import 'package:flutter_test/flutter_test.dart';

import 'package:kedaya/domain/models/lost_found_item.dart';
import 'package:kedaya/domain/models/time_text.dart';
import 'package:kedaya/features/lost_found/application/lost_found_providers.dart';

void main() {
  // 固定时刻：相对时间断言与演示数据都以它为基准。
  final DateTime now = DateTime(2026, 11, 24, 12, 0);

  LostFoundItem item(
    String id, {
    LostFoundKind kind = LostFoundKind.lost,
    LostFoundStatus status = LostFoundStatus.open,
    String title = '丢了一个蓝色保温杯',
    String? location = '图书馆三楼自习区',
    required DateTime createdAt,
  }) =>
      LostFoundItem(
        id: id,
        kind: kind,
        title: title,
        status: status,
        createdAt: createdAt,
        description: '杯身有一张白色贴纸',
        location: location,
        occurredAt: createdAt.subtract(const Duration(minutes: 30)),
        contact: '站内留言',
      );

  LostFoundDraft draft({
    LostFoundKind kind = LostFoundKind.lost,
    String title = '丢了一个蓝色保温杯',
    String location = '图书馆三楼自习区',
    String description = '',
    String contact = '',
  }) =>
      LostFoundDraft(
        kind: kind,
        title: title,
        location: location,
        occurredAt: now.subtract(const Duration(hours: 1)),
        description: description,
        contact: contact,
      );

  group('仓库排序', () {
    test('按发布时间倒序，与插入顺序无关', () {
      final InMemoryLostFoundRepository repository =
          InMemoryLostFoundRepository(
        seed: <LostFoundItem>[
          item('old', createdAt: now.subtract(const Duration(days: 2))),
          item('new', createdAt: now.subtract(const Duration(minutes: 20))),
          item('mid', createdAt: now.subtract(const Duration(hours: 3))),
        ],
        clock: () => now,
      );

      expect(
        repository.list().map((LostFoundItem item) => item.id).toList(),
        <String>['new', 'mid', 'old'],
      );
    });
  });

  group('列表筛选', () {
    final List<LostFoundItem> items = <LostFoundItem>[
      item(
        'lost-cup',
        title: '丢了一个蓝色保温杯',
        location: '图书馆三楼自习区',
        createdAt: now.subtract(const Duration(hours: 3)),
      ),
      item(
        'found-umbrella',
        kind: LostFoundKind.found,
        title: '捡到一把黑色雨伞',
        location: '信息学院 1-201',
        createdAt: now.subtract(const Duration(hours: 2)),
      ),
      item(
        'resolved-card',
        title: '校园卡丢失（已找回）',
        location: '一食堂二楼',
        status: LostFoundStatus.resolved,
        createdAt: now.subtract(const Duration(days: 1)),
      ),
    ];

    test('全部 / 寻物 / 招领三个 tab 各自只留对应类型', () {
      expect(
        filterLostFoundItems(items, const LostFoundFilter())
            .map((LostFoundItem item) => item.kind)
            .toSet(),
        <LostFoundKind>{LostFoundKind.lost, LostFoundKind.found},
      );
      expect(
        filterLostFoundItems(
          items,
          const LostFoundFilter(kind: LostFoundKindFilter.lost),
        ).map((LostFoundItem item) => item.id).toList(),
        <String>['lost-cup', 'resolved-card'],
      );
      expect(
        filterLostFoundItems(
          items,
          const LostFoundFilter(kind: LostFoundKindFilter.found),
        ).map((LostFoundItem item) => item.id).toList(),
        <String>['found-umbrella'],
      );
    });

    test('搜索同时匹配标题与地点', () {
      expect(
        filterLostFoundItems(items, const LostFoundFilter(query: '保温杯'))
            .map((LostFoundItem item) => item.id)
            .toList(),
        <String>['lost-cup'],
      );
      expect(
        filterLostFoundItems(items, const LostFoundFilter(query: '信息学院'))
            .map((LostFoundItem item) => item.id)
            .toList(),
        <String>['found-umbrella'],
      );
      expect(
        filterLostFoundItems(items, const LostFoundFilter(query: '不存在')),
        isEmpty,
      );
    });

    test('「进行中」不含已解决，「已解决」覆盖 resolved / closed', () {
      final List<LostFoundItem> withClosed = <LostFoundItem>[
        ...items,
        item(
          'closed',
          status: LostFoundStatus.closed,
          createdAt: now.subtract(const Duration(days: 2)),
        ),
      ];

      expect(
        filterLostFoundItems(
          withClosed,
          const LostFoundFilter(status: LostFoundStatusFilter.open),
        ).map((LostFoundItem item) => item.id).toList(),
        <String>['lost-cup', 'found-umbrella'],
      );
      expect(
        filterLostFoundItems(
          withClosed,
          const LostFoundFilter(status: LostFoundStatusFilter.resolved),
        ).map((LostFoundItem item) => item.id).toList(),
        <String>['resolved-card', 'closed'],
      );
    });

    test('筛选条件可以被重置', () {
      const LostFoundFilter filter = LostFoundFilter(
        kind: LostFoundKindFilter.found,
        status: LostFoundStatusFilter.resolved,
        query: '雨伞',
      );

      expect(filter.isActive, isTrue);
      expect(const LostFoundFilter().isActive, isFalse);
    });
  });

  group('状态流转', () {
    test('标记已解决后不再出现在「进行中」', () {
      final InMemoryLostFoundRepository repository =
          InMemoryLostFoundRepository(
        seed: <LostFoundItem>[
          item('open', createdAt: now.subtract(const Duration(hours: 1))),
        ],
        clock: () => now,
      );

      expect(
        filterLostFoundItems(
          repository.list(),
          const LostFoundFilter(status: LostFoundStatusFilter.open),
        ),
        hasLength(1),
      );

      final LostFoundItem? updated = repository.resolve('open');
      expect(updated?.status, LostFoundStatus.resolved);

      expect(
        filterLostFoundItems(
          repository.list(),
          const LostFoundFilter(status: LostFoundStatusFilter.open),
        ),
        isEmpty,
      );
      expect(
        filterLostFoundItems(
          repository.list(),
          const LostFoundFilter(status: LostFoundStatusFilter.resolved),
        ).single.id,
        'open',
      );
    });
  });

  group('新增', () {
    test('新条目默认进行中，空描述 / 空联系方式存成 null', () {
      final InMemoryLostFoundRepository repository =
          InMemoryLostFoundRepository(clock: () => now);

      final LostFoundItem created = repository.add(
        draft(
          kind: LostFoundKind.found,
          title: '捡到一张校园卡',
          description: '',
          contact: '',
        ),
      );

      expect(created.status, LostFoundStatus.open);
      expect(created.kind, LostFoundKind.found);
      expect(created.description, isNull);
      expect(created.contact, isNull);
      expect(repository.length, 1);
    });

    test('空标题被拒', () {
      final List<LostFoundDraftProblem> problems =
          validateLostFoundDraft(draft(title: '   '));

      expect(problems, contains(LostFoundDraftProblem.emptyTitle));

      final InMemoryLostFoundRepository repository =
          InMemoryLostFoundRepository(clock: () => now);
      expect(
        () => repository.add(draft(title: '')),
        throwsArgumentError,
      );
      expect(repository.length, 0);
    });

    test('描述超过 300 字被拒', () {
      final String tooLong =
          List<String>.filled(lostFoundDescriptionMax + 1, '字').join();
      final List<LostFoundDraftProblem> problems =
          validateLostFoundDraft(draft(description: tooLong));

      expect(problems, contains(LostFoundDraftProblem.descriptionTooLong));

      final InMemoryLostFoundRepository repository =
          InMemoryLostFoundRepository(clock: () => now);
      expect(
        () => repository.add(draft(description: tooLong)),
        throwsArgumentError,
      );
    });

    test('空地点与超长联系方式被拒', () {
      final List<LostFoundDraftProblem> problems = validateLostFoundDraft(
        draft(
          location: '',
          contact: List<String>.filled(lostFoundContactMax + 1, '字').join(),
        ),
      );

      expect(
        problems,
        containsAll(<LostFoundDraftProblem>[
          LostFoundDraftProblem.emptyLocation,
          LostFoundDraftProblem.contactTooLong,
        ]),
      );
    });
  });

  test('列表相对时间按小时 / 分钟展示', () {
    expect(
      formatRelativeTime(
        now.subtract(const Duration(hours: 3)),
        now: now,
      ),
      '3 小时前',
    );
    expect(
      formatRelativeTime(
        now.subtract(const Duration(minutes: 30)),
        now: now,
      ),
      '30 分钟前',
    );
  });
}
