import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/app_providers.dart';
import '../../../domain/models/api_error.dart';
import '../../../domain/models/page.dart';
import '../../../domain/models/result.dart';
import '../../../domain/models/wildlife.dart';
import '../../../domain/models/wildlife_sighting.dart';
import '../../../domain/models/wildlife_track.dart';
import '../../../domain/ports/wildlife_port.dart';

/// 把 `Result` 的失败分支转成可抛的 [ApiException]（presentation 只认这个）。
T _require<T>(Result<T> result) => switch (result) {
      Ok<T>(:final T value) => value,
      Err<T>(:final ApiError error, :final String? traceId) =>
        throw ApiException(error, traceId: traceId),
    };

/// 物种筛选（地图页与观测列表**共用同一个筛选状态**）。
final wildlifeSpeciesFilterProvider =
    NotifierProvider<WildlifeSpeciesFilter, String?>(
  WildlifeSpeciesFilter.new,
);

final class WildlifeSpeciesFilter extends Notifier<String?> {
  @override
  String? build() => null;

  /// null = 全部物种。
  void select(String? speciesId) => state = speciesId;
}

/// 物种字典（筛选 chip 与上报表单共用）。
final wildlifeSpeciesProvider =
    FutureProvider<List<WildlifeSpecies>>((ref) async {
  final WildlifePort port = ref.watch(wildlifeRepositoryProvider);
  return _require<List<WildlifeSpecies>>(await port.listSpecies());
});

/// 区域列表（区域页；与地图的筛选无关 —— 区域是管理端定义的全集）。
final wildlifeZonesProvider = FutureProvider<List<WildlifeZone>>((ref) async {
  final WildlifePort port = ref.watch(wildlifeRepositoryProvider);
  return _require<List<WildlifeZone>>(await port.listZones());
});

/// 底图配置（详情页要画小地图时用；地图页自己从 [WildlifeMapController] 里拿）。
final wildlifeBasemapProvider = FutureProvider<CampusBasemap>((ref) async {
  final WildlifePort port = ref.watch(wildlifeRepositoryProvider);
  final CampusBasemap basemap =
      _require<CampusBasemap>(await port.getBasemap());
  // 与地图页同一条守门规则：标定不合法就不画图（规格 §1.4）。
  if (!basemap.isRenderable) {
    throw ApiException(
      ApiError(
        code: ApiErrorCode.internal,
        message: '底图配置不可用（${basemap.validate().join('、')}）',
      ),
    );
  }
  return basemap;
});

/// 区域详情。
final wildlifeZoneDetailProvider = FutureProvider.family<WildlifeZone, String>((
  ref,
  String zoneId,
) async {
  final WildlifePort port = ref.watch(wildlifeRepositoryProvider);
  return _require<WildlifeZone>(await port.getZone(zoneId));
});

/// 地图页的聚合状态。
///
/// 为什么把 5 个读接口合成一个 state 而不是 5 个 provider：
/// 地图是一张**必须一起画出来**的图 —— 底图有了但热点没到，画出来的图是错的
/// （用户会以为"这里没有动物"）。因此它们共用一个三态。
final class WildlifeMapState {
  const WildlifeMapState({
    required this.basemap,
    required this.species,
    required this.zones,
    required this.spots,
    required this.tracks,
    this.selectedSpeciesId,
  });

  final CampusBasemap basemap;
  final List<WildlifeSpecies> species;
  final List<WildlifeZone> zones;
  final List<WildlifeSpot> spots;
  final List<WildlifeTrack> tracks;
  final String? selectedSpeciesId;

  /// 三个叠加层都空 → 空态（不是错误）。
  bool get isEmpty => zones.isEmpty && spots.isEmpty && tracks.isEmpty;

  WildlifeSpecies? get selectedSpecies {
    for (final WildlifeSpecies item in species) {
      if (item.id == selectedSpeciesId) return item;
    }
    return null;
  }

  /// 敏感区（只展示"这里有一个不公开坐标的区域"）。
  List<WildlifeZone> get sensitiveZones => zones
      .where((WildlifeZone zone) => zone.isSensitive)
      .toList(growable: false);

  List<WildlifeZone> get publicZones => zones
      .where((WildlifeZone zone) => !zone.isSensitive)
      .toList(growable: false);

  /// 底图署名（规格 §1.4：`odbl` 时必须有署名）。
  String get basemapAttribution => basemap.attribution.trim().isEmpty
      ? '示意性自绘底图（P1，非测绘精度）'
      : basemap.attribution;

  /// 规格 §8.1 E10：地图**不得**显示实时点位。
  String get aggregationNotice =>
      '热点为历史聚合（延迟 ≥$defaultAggregationDelayHours 小时），不显示实时位置';

  @override
  String toString() =>
      'WildlifeMapState(zones=${zones.length}, spots=${spots.length}, '
      'tracks=${tracks.length}, species=$selectedSpeciesId)';
}

final wildlifeMapControllerProvider =
    AsyncNotifierProvider<WildlifeMapController, WildlifeMapState>(
  WildlifeMapController.new,
);

final class WildlifeMapController extends AsyncNotifier<WildlifeMapState> {
  /// 叠加层一次取完（热点与轨迹都是数百级，规格 §10.7）。
  static const int spotLimit = 100;
  static const int trackLimit = 50;

  @override
  Future<WildlifeMapState> build() {
    // 物种切换即重新加载：筛选是 build 的入参，三态会自然回到 loading。
    final String? speciesId = ref.watch(wildlifeSpeciesFilterProvider);
    return _fetch(speciesId);
  }

  Future<void> refresh() async {
    final String? speciesId = ref.read(wildlifeSpeciesFilterProvider);
    state = const AsyncLoading<WildlifeMapState>();
    state = await AsyncValue.guard<WildlifeMapState>(() => _fetch(speciesId));
  }

  Future<WildlifeMapState> _fetch(String? speciesId) async {
    final WildlifePort port = ref.read(wildlifeRepositoryProvider);

    final CampusBasemap basemap =
        _require<CampusBasemap>(await port.getBasemap());
    // 规格 §1.4 的 CI 约束在客户端也校验一次：标定错了会让**所有**点位整体偏移，
    // 而这种错误看起来像"数据错了"。宁可整页报错，也不要画一张错图。
    if (!basemap.isRenderable) {
      throw ApiException(
        ApiError(
          code: ApiErrorCode.internal,
          message: '底图配置不可用（${basemap.validate().join('、')}），请联系管理员',
        ),
      );
    }

    final List<WildlifeSpecies> species = _require<List<WildlifeSpecies>>(
      await port.listSpecies(),
    );
    final List<WildlifeZone> zones =
        _require<List<WildlifeZone>>(await port.listZones());
    final Page<WildlifeSpot> spots = _require<Page<WildlifeSpot>>(
      await port.listSpots(
        WildlifeSpotQuery(speciesId: speciesId, limit: spotLimit),
      ),
    );
    final Page<WildlifeTrack> tracks = _require<Page<WildlifeTrack>>(
      await port.listTracks(
        WildlifeTrackQuery(speciesId: speciesId, limit: trackLimit),
      ),
    );

    return WildlifeMapState(
      basemap: basemap,
      species: species,
      zones: zones,
      spots: spots.items,
      tracks: tracks.items,
      selectedSpeciesId: speciesId,
    );
  }
}

/// 观测列表状态（与 `forum` / `groupbuy` 同构：翻页失败不打死整页）。
final class WildlifeSightingListState {
  const WildlifeSightingListState({
    required this.sightings,
    this.speciesId,
    this.nextCursor,
    this.total,
    this.isLoadingMore = false,
    this.loadMoreError,
  });

  final List<WildlifeSighting> sightings;
  final String? speciesId;
  final String? nextCursor;
  final int? total;
  final bool isLoadingMore;

  /// 翻页失败的原因；列表本身仍然可用。
  final Object? loadMoreError;

  bool get hasMore => nextCursor != null && nextCursor!.isNotEmpty;

  bool get isEmpty => sightings.isEmpty;

  WildlifeSightingListState copyWith({
    List<WildlifeSighting>? sightings,
    String? speciesId,
    String? nextCursor,
    int? total,
    bool? isLoadingMore,
    Object? loadMoreError,
    bool clearLoadMoreError = false,
  }) =>
      WildlifeSightingListState(
        sightings: sightings ?? this.sightings,
        speciesId: speciesId ?? this.speciesId,
        nextCursor: nextCursor ?? this.nextCursor,
        total: total ?? this.total,
        isLoadingMore: isLoadingMore ?? this.isLoadingMore,
        loadMoreError:
            clearLoadMoreError ? null : (loadMoreError ?? this.loadMoreError),
      );

  WildlifeSightingListState append(WildlifeSightingListState next) =>
      WildlifeSightingListState(
        sightings: <WildlifeSighting>[...sightings, ...next.sightings],
        speciesId: next.speciesId ?? speciesId,
        nextCursor: next.nextCursor,
        total: next.total ?? total,
      );
}

final wildlifeSightingListControllerProvider = AsyncNotifierProvider<
    WildlifeSightingListController, WildlifeSightingListState>(
  WildlifeSightingListController.new,
);

final class WildlifeSightingListController
    extends AsyncNotifier<WildlifeSightingListState> {
  static const int pageSize = 10;

  @override
  Future<WildlifeSightingListState> build() {
    final String? speciesId = ref.watch(wildlifeSpeciesFilterProvider);
    return _fetch(WildlifeSightingQuery(speciesId: speciesId, limit: pageSize));
  }

  Future<void> refresh() async {
    final String? speciesId = ref.read(wildlifeSpeciesFilterProvider);
    state = const AsyncLoading<WildlifeSightingListState>();
    state = await AsyncValue.guard<WildlifeSightingListState>(
      () =>
          _fetch(WildlifeSightingQuery(speciesId: speciesId, limit: pageSize)),
    );
  }

  Future<void> loadMore() async {
    final WildlifeSightingListState? current = state.valueOrNull;
    if (current == null || !current.hasMore || current.isLoadingMore) return;
    state = AsyncData<WildlifeSightingListState>(
      current.copyWith(isLoadingMore: true, clearLoadMoreError: true),
    );
    try {
      final WildlifeSightingListState next = await _fetch(
        WildlifeSightingQuery(
          speciesId: current.speciesId,
          cursor: current.nextCursor,
          limit: pageSize,
        ),
      );
      state = AsyncData<WildlifeSightingListState>(current.append(next));
    } on Object catch (error) {
      // 保留已有列表，只挂上翻页错误。
      state = AsyncData<WildlifeSightingListState>(
        current.copyWith(isLoadingMore: false, loadMoreError: error),
      );
    }
  }

  Future<WildlifeSightingListState> _fetch(WildlifeSightingQuery query) async {
    final WildlifePort port = ref.read(wildlifeRepositoryProvider);
    final Page<WildlifeSighting> page = _require<Page<WildlifeSighting>>(
      await port.listSightings(query),
    );
    return WildlifeSightingListState(
      sightings: page.items,
      speciesId: query.speciesId,
      nextCursor: page.nextCursor,
      total: page.total,
    );
  }
}

/// 观测详情（按 id 取；未公开的记录对非上报人返回 404 → 空态）。
final wildlifeSightingDetailProvider =
    FutureProvider.family<WildlifeSighting, String>((
  ref,
  String sightingId,
) async {
  final WildlifePort port = ref.watch(wildlifeRepositoryProvider);
  return _require<WildlifeSighting>(await port.getSighting(sightingId));
});

/// 推断轨迹列表（数量有限，一次取完）。
final wildlifeTracksProvider = FutureProvider<List<WildlifeTrack>>((ref) async {
  final String? speciesId = ref.watch(wildlifeSpeciesFilterProvider);
  final WildlifePort port = ref.watch(wildlifeRepositoryProvider);
  final Page<WildlifeTrack> page = _require<Page<WildlifeTrack>>(
    await port.listTracks(WildlifeTrackQuery(speciesId: speciesId, limit: 50)),
  );
  return page.items;
});

/// 轨迹详情。
final wildlifeTrackDetailProvider =
    FutureProvider.family<WildlifeTrack, String>((
  ref,
  String trackId,
) async {
  final WildlifePort port = ref.watch(wildlifeRepositoryProvider);
  return _require<WildlifeTrack>(await port.getTrack(trackId));
});

/// 某物种下已审核的命名个体（R6「也可以手动给个名字」）。
final wildlifeIndividualsProvider =
    FutureProvider.family<List<WildlifeIndividual>, String?>((
  ref,
  String? speciesId,
) async {
  final WildlifePort port = ref.watch(wildlifeRepositoryProvider);
  return _require<List<WildlifeIndividual>>(
    await port.listIndividuals(speciesId: speciesId),
  );
});

/// 写操作集合（上报 / 纠正 / 撤回）。
///
/// 刻意**不持有 `Ref`**：只拿端口 + 一个失效回调，因此 application 层的对象
/// 不依赖 Riverpod 的内部类型，也能在测试里直接构造。
final wildlifeActionsProvider = Provider<WildlifeActions>((ref) {
  final WildlifePort port = ref.watch(wildlifeRepositoryProvider);
  return WildlifeActions(
    port: port,
    onMutated: () {
      // 写成功后失效读 provider —— 让列表与地图重新拉取，避免本地拼接状态。
      ref.invalidate(wildlifeSightingListControllerProvider);
      ref.invalidate(wildlifeMapControllerProvider);
      ref.invalidate(wildlifeTracksProvider);
      // 详情是 family provider：写操作后必须一并失效，否则撤回后详情仍读到缓存值
      //（实测 `withdraw` 后详情仍返回已删除的记录）。
      ref.invalidate(wildlifeSightingDetailProvider);
      ref.invalidate(wildlifeTrackDetailProvider);
      ref.invalidate(wildlifeZoneDetailProvider);
    },
  );
});

final class WildlifeActions {
  const WildlifeActions({required this.port, required this.onMutated});

  final WildlifePort port;

  /// 写成功后的通知（用于失效读 provider）。
  final void Function() onMutated;

  /// 纠正物种（规格 §5.5 的纠正闭环：服务端会记录 `correctedFromSpeciesId`）。
  Future<WildlifeSighting> correctSpecies(String id,
      {required String speciesId}) async {
    final WildlifeSighting updated = _require<WildlifeSighting>(
      await port.correctSpecies(id, speciesId: speciesId),
    );
    onMutated();
    return updated;
  }

  /// 撤回自己的上报（软删）。
  Future<void> withdraw(String id) async {
    _require<Unit>(await port.deleteSighting(id));
    onMutated();
  }
}
