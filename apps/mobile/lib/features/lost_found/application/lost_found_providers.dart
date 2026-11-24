import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../domain/models/lost_found_item.dart';

/// 「现在」的注入点：相对时间、演示数据与新增默认时间都依赖它。
final lostFoundClockProvider =
    Provider<DateTime Function()>((ref) => DateTime.now);

/// 本 feature 的内存仓库（不经过 `AppRuntime`，也不发任何网络请求）。
///
/// 名字特意避开 `app_providers.dart` 里已有的 `lostFoundRepositoryProvider`
/// （那是 `LostFoundPort` 的装配入口）；本模块的页面只认这个 store。
final lostFoundStoreProvider = Provider<InMemoryLostFoundRepository>((ref) {
  final DateTime Function() clock = ref.watch(lostFoundClockProvider);
  return InMemoryLostFoundRepository(
    seed: demoLostFoundItems(clock()),
    clock: clock,
  );
});

/// 全部条目（仓库快照，已按发布时间倒序）。
final lostFoundFeedProvider =
    NotifierProvider<LostFoundFeedController, List<LostFoundItem>>(
  LostFoundFeedController.new,
);

final class LostFoundFeedController extends Notifier<List<LostFoundItem>> {
  @override
  List<LostFoundItem> build() {
    final InMemoryLostFoundRepository repository =
        ref.watch(lostFoundStoreProvider);
    return repository.list();
  }

  LostFoundItem add(LostFoundDraft draft) {
    final InMemoryLostFoundRepository repository =
        ref.read(lostFoundStoreProvider);
    final LostFoundItem created = repository.add(draft);
    state = repository.list();
    return created;
  }

  LostFoundItem? resolve(String id) {
    final InMemoryLostFoundRepository repository =
        ref.read(lostFoundStoreProvider);
    final LostFoundItem? updated = repository.resolve(id);
    state = repository.list();
    return updated;
  }
}

/// 列表筛选条件（类型 + 状态 + 关键词）。
final lostFoundFilterProvider =
    NotifierProvider<LostFoundFilterController, LostFoundFilter>(
  LostFoundFilterController.new,
);

final class LostFoundFilterController extends Notifier<LostFoundFilter> {
  @override
  LostFoundFilter build() => const LostFoundFilter();

  void selectKind(LostFoundKindFilter kind) =>
      state = state.copyWith(kind: kind);

  void selectStatus(LostFoundStatusFilter status) =>
      state = state.copyWith(status: status);

  void setQuery(String query) => state = state.copyWith(query: query);

  void reset() => state = const LostFoundFilter();
}

/// 页面实际渲染的列表（排序 + 类型 / 状态 / 关键词筛选）。
final visibleLostFoundProvider = Provider<List<LostFoundItem>>((ref) {
  return filterLostFoundItems(
    ref.watch(lostFoundFeedProvider),
    ref.watch(lostFoundFilterProvider),
  );
});

/// 详情页按 id 取条目；状态变化后会自动拿到新对象。
final lostFoundItemProvider =
    Provider.family<LostFoundItem?, String>((ref, String id) {
  for (final LostFoundItem item in ref.watch(lostFoundFeedProvider)) {
    if (item.id == id) return item;
  }
  return null;
});

/// 「全部 / 寻物 / 招领」三个 tab。
enum LostFoundKindFilter {
  all('全部'),
  lost('寻物'),
  found('招领');

  const LostFoundKindFilter(this.label);

  final String label;

  bool accepts(LostFoundKind kind) => switch (this) {
        LostFoundKindFilter.all => true,
        LostFoundKindFilter.lost => kind == LostFoundKind.lost,
        LostFoundKindFilter.found => kind == LostFoundKind.found,
      };
}

/// 状态筛选。`resolved` 同时覆盖 `resolved` 与 `closed`。
enum LostFoundStatusFilter {
  all('全部'),
  open('进行中'),
  resolved('已解决');

  const LostFoundStatusFilter(this.label);

  final String label;

  bool accepts(LostFoundStatus status) => switch (this) {
        LostFoundStatusFilter.all => true,
        LostFoundStatusFilter.open => status == LostFoundStatus.open,
        LostFoundStatusFilter.resolved => status == LostFoundStatus.resolved ||
            status == LostFoundStatus.closed,
      };
}

/// 筛选条件本身（不可变，便于 provider 比较与测试构造）。
final class LostFoundFilter {
  const LostFoundFilter({
    this.kind = LostFoundKindFilter.all,
    this.status = LostFoundStatusFilter.all,
    this.query = '',
  });

  final LostFoundKindFilter kind;
  final LostFoundStatusFilter status;
  final String query;

  bool get isActive =>
      kind != LostFoundKindFilter.all ||
      status != LostFoundStatusFilter.all ||
      query.trim().isNotEmpty;

  LostFoundFilter copyWith({
    LostFoundKindFilter? kind,
    LostFoundStatusFilter? status,
    String? query,
  }) =>
      LostFoundFilter(
        kind: kind ?? this.kind,
        status: status ?? this.status,
        query: query ?? this.query,
      );
}

/// 纯筛选函数：只认标题与地点（产品要求），保持输入顺序。
List<LostFoundItem> filterLostFoundItems(
  Iterable<LostFoundItem> items,
  LostFoundFilter filter,
) {
  final String query = filter.query.trim().toLowerCase();
  final List<LostFoundItem> matched = <LostFoundItem>[];

  for (final LostFoundItem item in items) {
    if (!filter.kind.accepts(item.kind)) continue;
    if (!filter.status.accepts(item.status)) continue;
    if (query.isNotEmpty) {
      final String haystack =
          '${item.title} ${item.location ?? ''}'.toLowerCase();
      if (!haystack.contains(query)) continue;
    }
    matched.add(item);
  }

  return List<LostFoundItem>.unmodifiable(matched);
}

/// 按发布时间倒序；同一时刻用 id 稳定排序。
List<LostFoundItem> sortLostFoundItems(Iterable<LostFoundItem> items) {
  final List<LostFoundItem> sorted = List<LostFoundItem>.of(items);
  sorted.sort((LostFoundItem a, LostFoundItem b) {
    final int byCreated = b.createdAt.compareTo(a.createdAt);
    if (byCreated != 0) return byCreated;
    return a.id.compareTo(b.id);
  });
  return List<LostFoundItem>.unmodifiable(sorted);
}

/// 内存仓库：排序 / 筛选状态流转的唯一真相。
///
/// `add` 会再跑一次 [validateLostFoundDraft]，即使绕过页面直接调用，
/// 空标题 / 超长描述也进不来。
final class InMemoryLostFoundRepository {
  InMemoryLostFoundRepository({
    List<LostFoundItem>? seed,
    DateTime Function()? clock,
  })  : _clock = clock ?? DateTime.now,
        _items = <String, LostFoundItem>{
          for (final LostFoundItem item in seed ?? const <LostFoundItem>[])
            item.id: item,
        };

  final DateTime Function() _clock;
  final Map<String, LostFoundItem> _items;
  int _nextId = 1;

  List<LostFoundItem> list() => sortLostFoundItems(_items.values);

  LostFoundItem? findById(String id) => _items[id];

  int get length => _items.length;

  LostFoundItem add(LostFoundDraft draft) {
    final List<LostFoundDraftProblem> problems = validateLostFoundDraft(draft);
    if (problems.isNotEmpty) {
      throw ArgumentError(
        '失物招领内容不合法：'
        '${problems.map(describeLostFoundDraftProblem).join('；')}',
      );
    }

    final String description = draft.description.trim();
    final String contact = draft.contact.trim();
    final LostFoundItem item = LostFoundItem(
      id: 'lf-local-${_nextId++}',
      kind: draft.kind,
      title: draft.title.trim(),
      status: LostFoundStatus.open,
      createdAt: _clock(),
      description: description.isEmpty ? null : description,
      location: draft.location.trim(),
      occurredAt: draft.occurredAt,
      contact: contact.isEmpty ? null : contact,
    );
    _items[item.id] = item;
    return item;
  }

  LostFoundItem? resolve(String id) {
    final LostFoundItem? item = _items[id];
    if (item == null) return null;
    if (!item.isOpen) return item;

    final LostFoundItem updated =
        item.copyWith(status: LostFoundStatus.resolved);
    _items[id] = updated;
    return updated;
  }
}

/// 演示数据：相对 `now` 生成，保证「30 分钟前 / 3 小时前」永远成立。
List<LostFoundItem> demoLostFoundItems(DateTime now) => <LostFoundItem>[
      LostFoundItem(
        id: 'lf-demo-1',
        kind: LostFoundKind.found,
        title: '在教学楼 1-201 捡到一把黑色雨伞',
        status: LostFoundStatus.open,
        createdAt: now.subtract(const Duration(minutes: 30)),
        description: '长柄黑伞，伞柄上有一圈磨掉的漆。先放在讲台旁边了。',
        location: '信息学院 1-201',
        occurredAt: now.subtract(const Duration(hours: 1)),
        contact: '到 1-201 讲台旁自取即可',
      ),
      LostFoundItem(
        id: 'lf-demo-2',
        kind: LostFoundKind.lost,
        title: '丢了一个蓝色保温杯',
        status: LostFoundStatus.open,
        createdAt: now.subtract(const Duration(hours: 3)),
        description: '杯身有一张白色贴纸，里面还有半杯水。',
        location: '图书馆三楼自习区',
        occurredAt: now.subtract(const Duration(hours: 4)),
        contact: '请放在图书馆三楼服务台，或站内留言',
      ),
      LostFoundItem(
        id: 'lf-demo-3',
        kind: LostFoundKind.lost,
        title: '校园卡丢失（已找回）',
        status: LostFoundStatus.resolved,
        createdAt: now.subtract(const Duration(days: 2)),
        description: '已经在一食堂服务台找回，谢谢帮忙转发的同学。',
        location: '一食堂二楼',
        occurredAt: now.subtract(const Duration(days: 3)),
        contact: '已解决',
      ),
    ];
