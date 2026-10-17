import '../../domain/models/api_error.dart';
import '../../domain/models/api_request.dart';
import '../../domain/models/geo.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/models/wildlife.dart';
import '../../domain/models/wildlife_sighting.dart';
import '../../domain/models/wildlife_track.dart';
import '../../domain/ports/wildlife_port.dart';
import 'mock_controls.dart';
import 'mock_fixtures.dart';
import 'wildlife_fixtures.dart';

/// [WildlifePort] 的内存实现 —— 让 `wildlife` 切片在**无后端**时可跑
/// （冻结契约 §7 硬规则 4）。
///
/// 它扮演的是**服务端**，因此下面这些"服务端才该做的事"都在这里发生：
///
/// | 服务端职责 | 规格 | mock 的做法 |
/// | --- | --- | --- |
/// | 位置模糊化 | §9.3 ② | 网格吸附到 `zone.fuzzRadiusM`（**不含** HMAC 加噪） |
/// | 敏感区不给坐标 | §9.3 ① | `isSensitive` 区域的观测 `geo = null` |
/// | 时间粗化 | §9.5 | 普通区到小时、敏感区到天 |
/// | 只公开已审核 | §10.1 #9 | `listSightings` 只返回 `PUBLISHED` |
/// | 热点聚合延迟 | §8.1 E10 | 只返回 `computedAt` 早于 24h 的热点 |
/// | 精确坐标永不外泄 | §9.6 / T15 | 模型里**根本没有** `reporterId` / 精确坐标 |
/// | 分类可离线降级 | §11.6 T43 | `classifierEnabled = false` 时返回空数组 |
/// | 健康异常不等审核 | §8.4 | `healthConcern` 立即记入 [healthAlerts] |
///
/// ⚠️ **诚实标注**：mock 的"模糊化"只是网格吸附，**没有** HMAC 确定性加噪
/// （规格 §9.3 ③ 需要服务端密钥），也**没有** k-匿名检查（§9.3 ④）与
/// 敏感区多边形（§9.3 ①，用区域圆代替）。真正的隐私防线在服务端，
/// 本 mock 只保证**客户端能观察到的契约**：拿不到精确坐标。
final class MockWildlifeRepository implements WildlifePort {
  MockWildlifeRepository({
    MockControls? controls,
    List<WildlifeSpecies>? species,
    List<WildlifeZone>? zones,
    List<WildlifeSpot>? spots,
    List<WildlifeTrack>? tracks,
    List<WildlifeSighting>? sightings,
    List<WildlifeIndividual>? individuals,
    CampusBasemap? basemap,
    Set<String>? ownSightingIds,
    DateTime? now,
    this.classifierEnabled = false,
    this.classifierForcedConfidence,
    CampusProjection projection = CampusProjection.campus,
  })  : controls = controls ?? MockControls(),
        _projection = projection,
        _now = now ?? DateTime.now(),
        _basemap = basemap ?? mockCampusBasemap,
        _ownSightingIds = <String>{...(ownSightingIds ?? mockOwnSightingIds)},
        _speciesById = <String, WildlifeSpecies>{
          for (final WildlifeSpecies item in species ?? mockWildlifeSpecies)
            item.id: item,
        },
        _zones = <String, WildlifeZone>{
          for (final WildlifeZone zone in zones ?? mockWildlifeZones)
            zone.id: zone,
        },
        _spots = <WildlifeSpot>[...(spots ?? mockWildlifeSpots)],
        _tracks = <WildlifeTrack>[...(tracks ?? mockWildlifeTracks)],
        _sightings = <String, WildlifeSighting>{
          for (final WildlifeSighting item
              in sightings ?? mockWildlifeSightings)
            item.id: item,
        },
        _individuals = <String, WildlifeIndividual>{
          for (final WildlifeIndividual item
              in individuals ?? mockWildlifeIndividuals)
            item.id: item,
        };

  /// 可在运行时切换延迟与故障（UI 三态演示 / 测试注入）。
  final MockControls controls;

  /// 是否具备自动分类能力（规格 §5.4 的 `WILDLIFE_CLASSIFIER`）。
  ///
  /// 默认 `false` = `manual` 模式：**上报全流程依然可用**，只是没有建议
  /// （规格 §11.6 T41/T43 的核心）。
  bool classifierEnabled;

  /// 强制分类置信度（测试低置信度分支：< 0.60 **不得**预选，T44）。
  double? classifierForcedConfidence;

  final CampusProjection _projection;

  /// 固定的"服务端时钟"。
  ///
  /// **不直接用 `DateTime.now()`**：发现时间越界（§11.10 A）这类校验必须是
  /// 可复现的，否则测试会随真实时间漂移。
  final DateTime _now;

  final CampusBasemap _basemap;
  final Set<String> _ownSightingIds;
  final Map<String, WildlifeSpecies> _speciesById;
  final Map<String, WildlifeZone> _zones;
  final List<WildlifeSpot> _spots;
  final List<WildlifeTrack> _tracks;
  final Map<String, WildlifeSighting> _sightings;
  final Map<String, WildlifeIndividual> _individuals;

  /// 客户端幂等键 → 已上传媒体（规格 §11.5 T37：重试返回**相同** mediaId）。
  final Map<String, WildlifeMedia> _mediaByClientId = <String, WildlifeMedia>{};

  /// 已被某条观测关联的媒体（规格 §10.3：`MEDIA_ALREADY_LINKED`）。
  final Set<String> _linkedMediaIds = <String>{};

  /// 疑似受伤的观测 id：**审核前**就已通知社团（规格 §8.4）。
  final List<String> _healthAlerts = <String>[];

  int _sequence = 2000;

  /// 疑似受伤告警（测试断言"不等审核就通知"）。
  List<String> get healthAlerts => List<String>.unmodifiable(_healthAlerts);

  /// 已上传媒体数量（断言幂等不重复存储）。
  int get mediaCount => _mediaByClientId.length;

  /// 全部观测（含待审核 / 未通过），按发现时间倒序。
  List<WildlifeSighting> sightingsSnapshot() => _sortedSightings();

  /// 全部个体（含待审核）。
  List<WildlifeIndividual> individualsSnapshot() =>
      _individuals.values.toList(growable: false);

  // --------------------------------------------------------------- 读端点

  @override
  Future<Result<CampusBasemap>> getBasemap() async {
    await controls.simulate();
    if (controls.failure != null)
      return controls.failureResult<CampusBasemap>();
    return Ok<CampusBasemap>(_basemap);
  }

  @override
  Future<Result<List<WildlifeSpecies>>> listSpecies() async {
    await controls.simulate();
    if (controls.failure != null)
      return controls.failureResult<List<WildlifeSpecies>>();
    if (controls.emptyResults)
      return Ok<List<WildlifeSpecies>>(const <WildlifeSpecies>[]);
    return Ok<List<WildlifeSpecies>>(
      _speciesById.values.toList(growable: false),
    );
  }

  @override
  Future<Result<List<WildlifeZone>>> listZones() async {
    await controls.simulate();
    if (controls.failure != null)
      return controls.failureResult<List<WildlifeZone>>();
    if (controls.emptyResults)
      return Ok<List<WildlifeZone>>(const <WildlifeZone>[]);
    final List<WildlifeZone> zones = _zones.values.toList(growable: false);
    zones.sort((WildlifeZone a, WildlifeZone b) {
      final int byOrder = a.sortOrder.compareTo(b.sortOrder);
      return byOrder != 0 ? byOrder : a.name.compareTo(b.name);
    });
    return Ok<List<WildlifeZone>>(zones);
  }

  @override
  Future<Result<WildlifeZone>> getZone(String id) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<WildlifeZone>();
    final WildlifeZone? zone = _zones[id];
    if (zone == null) return _notFound<WildlifeZone>('该区域不存在或已下架');
    return Ok<WildlifeZone>(zone);
  }

  @override
  Future<Result<Page<WildlifeSpot>>> listSpots(WildlifeSpotQuery query) async {
    await controls.simulate();
    if (controls.failure != null)
      return controls.failureResult<Page<WildlifeSpot>>();
    if (controls.emptyResults) {
      return Ok<Page<WildlifeSpot>>(
          const Page<WildlifeSpot>(items: <WildlifeSpot>[], total: 0));
    }

    final List<WildlifeSpot> all = <WildlifeSpot>[
      for (final WildlifeSpot spot in _spots)
        if (_isSpotPublic(spot) &&
            (query.speciesId == null ||
                query.speciesId!.isEmpty ||
                spot.speciesId == query.speciesId) &&
            (query.zoneId == null ||
                query.zoneId!.isEmpty ||
                spot.zoneId == query.zoneId) &&
            spot.confidence >= query.minConfidence)
          spot,
    ];
    all.sort((WildlifeSpot a, WildlifeSpot b) =>
        b.lastSeenAt.compareTo(a.lastSeenAt));
    return Ok<Page<WildlifeSpot>>(
        _page<WildlifeSpot>(all, query.cursor, query.limit));
  }

  @override
  Future<Result<Page<WildlifeTrack>>> listTracks(
      WildlifeTrackQuery query) async {
    await controls.simulate();
    if (controls.failure != null)
      return controls.failureResult<Page<WildlifeTrack>>();
    if (controls.emptyResults) {
      return Ok<Page<WildlifeTrack>>(
        const Page<WildlifeTrack>(items: <WildlifeTrack>[], total: 0),
      );
    }

    final List<WildlifeTrack> all = <WildlifeTrack>[
      for (final WildlifeTrack track in _tracks)
        if ((query.speciesId == null ||
                query.speciesId!.isEmpty ||
                track.speciesId == query.speciesId) &&
            (query.individualId == null ||
                query.individualId!.isEmpty ||
                track.individualId == query.individualId))
          track,
    ];
    all.sort((WildlifeTrack a, WildlifeTrack b) =>
        b.spanEndAt.compareTo(a.spanEndAt));
    return Ok<Page<WildlifeTrack>>(
        _page<WildlifeTrack>(all, query.cursor, query.limit));
  }

  @override
  Future<Result<WildlifeTrack>> getTrack(String id) async {
    await controls.simulate();
    if (controls.failure != null)
      return controls.failureResult<WildlifeTrack>();
    for (final WildlifeTrack track in _tracks) {
      if (track.id == id) return Ok<WildlifeTrack>(track);
    }
    return _notFound<WildlifeTrack>('该轨迹不存在或已被重算覆盖');
  }

  @override
  Future<Result<List<WildlifeIndividual>>> listIndividuals(
      {String? speciesId}) async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<List<WildlifeIndividual>>();
    }
    if (controls.emptyResults) {
      return Ok<List<WildlifeIndividual>>(const <WildlifeIndividual>[]);
    }
    // 只有审核通过且启用的个体才公开（规格 §2.8：防止恶搞命名）。
    final List<WildlifeIndividual> all = <WildlifeIndividual>[
      for (final WildlifeIndividual item in _individuals.values)
        if (item.isPublic &&
            (speciesId == null ||
                speciesId.isEmpty ||
                item.speciesId == speciesId))
          item,
    ];
    all.sort((WildlifeIndividual a, WildlifeIndividual b) =>
        a.name.compareTo(b.name));
    return Ok<List<WildlifeIndividual>>(all);
  }

  @override
  Future<Result<Page<WildlifeSighting>>> listSightings(
    WildlifeSightingQuery query,
  ) async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<Page<WildlifeSighting>>();
    }
    if (controls.emptyResults) {
      return Ok<Page<WildlifeSighting>>(
        const Page<WildlifeSighting>(items: <WildlifeSighting>[], total: 0),
      );
    }

    final List<WildlifeSighting> all = <WildlifeSighting>[
      for (final WildlifeSighting sighting in _sortedSightings())
        // 规格 §10.1 #9：列表**只返回 PUBLISHED**。
        if (sighting.isPublished &&
            (query.speciesId == null ||
                query.speciesId!.isEmpty ||
                sighting.speciesId == query.speciesId) &&
            (query.zoneId == null ||
                query.zoneId!.isEmpty ||
                sighting.zoneId == query.zoneId) &&
            (!query.healthConcernOnly || sighting.healthConcern))
          sighting,
    ];
    return Ok<Page<WildlifeSighting>>(
      _page<WildlifeSighting>(all, query.cursor, query.limit),
    );
  }

  @override
  Future<Result<WildlifeSighting>> getSighting(String id) async {
    await controls.simulate();
    if (controls.failure != null)
      return controls.failureResult<WildlifeSighting>();
    final WildlifeSighting? sighting = _sightings[id];
    if (sighting == null) return _notFound<WildlifeSighting>('该观测不存在或已下架');
    // 未公开的记录对**非上报人**按 NOT_FOUND 处理（规格 §9.1 A3：不区分，
    // 避免成为"这条记录存在吗"的枚举旁路）；上报人自己可以看到待审核状态。
    if (!sighting.isPublished && !_ownSightingIds.contains(id)) {
      return _notFound<WildlifeSighting>('该观测不存在或已下架');
    }
    return Ok<WildlifeSighting>(sighting);
  }

  // --------------------------------------------------------------- 写端点

  @override
  Future<Result<WildlifeMedia>> uploadMedia(
      UploadWildlifeMediaCommand command) async {
    await controls.simulate();
    if (controls.failure != null)
      return controls.failureResult<WildlifeMedia>();

    final WildlifeValidationResult validation = command.validate();
    if (validation.isInvalid) {
      return Err<WildlifeMedia>(
        ApiError(
          code: ApiErrorCode.validationFailed,
          message: validation.firstMessage ?? '图片不合法',
          details: <String, Object?>{'reason': validation.firstReason},
        ),
        traceId: MockControls.traceId,
      );
    }

    // 规格 §11.5 T37：同一 clientPhotoId 重试 → 返回**相同** mediaId，不重复存储。
    final WildlifeMedia? existing = _mediaByClientId[command.clientPhotoId];
    if (existing != null) return Ok<WildlifeMedia>(existing);

    final String mediaId = 'wm-${_sequence++}';
    final String fingerprint = _fingerprint(command.bytes);
    final WildlifeMedia media = WildlifeMedia(
      mediaId: mediaId,
      thumbUrl: 'https://cdn.kedaya.local/wildlife/mock/$mediaId/thumb.webp',
      url: 'https://cdn.kedaya.local/wildlife/mock/$mediaId/original.jpg',
      widthPx: command.widthPx ?? 1600,
      heightPx: command.heightPx ?? 1200,
      byteSize: command.byteSize,
      mimeType: command.sniffedMimeType ?? command.mimeType ?? 'image/jpeg',
      // ⚠️ 不是真 sha256：mock 用 FNV-1a 32 位指纹（无 crypto 依赖），
      // 只用于演示"同一张图去重"的语义，**不得**当作内容哈希使用。
      sha256: 'mock-fnv1a-$fingerprint',
      clientPhotoId: command.clientPhotoId,
    );
    _mediaByClientId[command.clientPhotoId] = media;
    return Ok<WildlifeMedia>(media);
  }

  @override
  Future<Result<WildlifeSighting>> createSighting(
      WildlifeSightingDraft draft) async {
    await controls.simulate();
    if (controls.failure != null)
      return controls.failureResult<WildlifeSighting>();

    final WildlifeValidationResult validation = draft.validate(
      now: _now,
      knownSpeciesIds: _speciesById.keys.toSet(),
    );
    if (validation.isInvalid) {
      return Err<WildlifeSighting>(
        ApiError(
          code: ApiErrorCode.validationFailed,
          message: validation.firstMessage ?? '请求参数不合法',
          details: <String, Object?>{'reason': validation.firstReason},
        ),
        traceId: MockControls.traceId,
      );
    }
    for (final String mediaId in draft.mediaIds) {
      if (_linkedMediaIds.contains(mediaId)) {
        return Err<WildlifeSighting>(
          const ApiError(
            code: ApiErrorCode.validationFailed,
            message: '这些照片已经关联到另一条上报了',
            details: <String, Object?>{'reason': reasonMediaAlreadyLinked},
          ),
          traceId: MockControls.traceId,
        );
      }
    }

    final WildlifeZone? zone = _zoneFor(draft.zoneId, draft.geo);
    final bool sensitive = zone?.isSensitive ?? false;
    final int gridM = zone?.fuzzRadiusM ?? defaultFuzzRadiusM;
    final WildlifeSpecies? species = _speciesById[draft.speciesId];

    final WildlifeSighting created = WildlifeSighting(
      id: 'wl-${_sequence++}',
      speciesId: draft.speciesId,
      speciesNameZh: species?.displayName,
      // 新上报一律 PENDING（规格 §2.10 状态机）。
      status: WildlifeModerationStatus.pending,
      // 敏感区：**不输出任何坐标**（规格 §9.3 ① / T10）；否则输出网格吸附后的点。
      geo: sensitive ? null : _snapToGrid(draft.geo, gridM),
      observedAt: draft.observedAt,
      observedAtFuzzed: _fuzzTime(draft.observedAt, toDay: sensitive),
      createdAt: _now,
      zoneId: zone?.id,
      zoneName: zone?.name,
      photoUrls: <String>[
        for (final String mediaId in draft.mediaIds) _thumbUrlFor(mediaId),
      ],
      healthConcern: draft.healthConcern,
      isAnonymous: draft.isAnonymous,
      individualId: draft.individualId,
      individualName: draft.individualId == null
          ? null
          : _individuals[draft.individualId]?.name,
      autoSpeciesId: draft.autoSpeciesId,
      autoConfidence: draft.autoConfidence,
      classifiedBy: draft.classifiedBy,
      note: draft.note,
      reporterDisplayName: draft.isAnonymous ? null : mockUser.displayNameOrId,
    );

    _sightings[created.id] = created;
    _ownSightingIds.add(created.id);
    _linkedMediaIds.addAll(draft.mediaIds);
    if (draft.healthConcern) {
      // 规格 §8.4：健康异常**不等待审核**就通知社团。
      _healthAlerts.add(created.id);
    }
    return Ok<WildlifeSighting>(created);
  }

  @override
  Future<Result<WildlifeClassifyResult>> classify(
      WildlifeClassifyRequest request) async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<WildlifeClassifyResult>();
    }
    // 规格 §11.6 T43：无能力时返回**空数组**（不是 5xx）。
    if (!classifierEnabled) {
      return Ok<WildlifeClassifyResult>(WildlifeClassifyResult.unavailable);
    }
    final List<WildlifeSpecies> candidates =
        _speciesById.values.toList(growable: false);
    if (candidates.isEmpty) {
      return Ok<WildlifeClassifyResult>(WildlifeClassifyResult.unavailable);
    }
    // 确定性（同一 mediaId 永远给同一结果），便于断言与复现。
    final int seed = _hashSeed(request.mediaId);
    final WildlifeSpecies top = candidates[seed % candidates.length];
    final WildlifeSpecies runnerUp = candidates[(seed + 3) % candidates.length];
    final double topConfidence =
        classifierForcedConfidence ?? (0.55 + (seed % 40) / 100);
    final double runnerUpConfidence = topConfidence * 0.6;
    return Ok<WildlifeClassifyResult>(
      WildlifeClassifyResult(
        available: true,
        items: <WildlifeClassifySuggestion>[
          WildlifeClassifySuggestion(
            speciesId: top.id,
            speciesNameZh: top.displayName,
            confidence: topConfidence,
          ),
          if (runnerUp.id != top.id)
            WildlifeClassifySuggestion(
              speciesId: runnerUp.id,
              speciesNameZh: runnerUp.displayName,
              confidence: runnerUpConfidence,
            ),
        ],
      ),
    );
  }

  @override
  Future<Result<WildlifeSighting>> correctSpecies(
    String id, {
    required String speciesId,
  }) async {
    await controls.simulate();
    if (controls.failure != null)
      return controls.failureResult<WildlifeSighting>();

    final WildlifeSighting? current = _sightings[id];
    if (current == null || !_ownSightingIds.contains(id)) {
      return _notFound<WildlifeSighting>('只能纠正自己的上报');
    }
    final WildlifeSpecies? species = _speciesById[speciesId];
    if (species == null) {
      return Err<WildlifeSighting>(
        const ApiError(
          code: ApiErrorCode.validationFailed,
          message: '请选择一个有效的物种',
          details: <String, Object?>{'reason': reasonUnknownSpecies},
        ),
        traceId: MockControls.traceId,
      );
    }
    if (current.speciesId == speciesId) return Ok<WildlifeSighting>(current);

    final WildlifeSighting updated = current.copyWith(
      speciesId: speciesId,
      speciesNameZh: species.displayName,
      // 规格 §5.5 的纠正闭环：记录被纠正的来源 → 成为标注样本。
      correctedFromSpeciesId: current.autoSpeciesId ?? current.speciesId,
    );
    _sightings[id] = updated;
    return Ok<WildlifeSighting>(updated);
  }

  @override
  Future<Result<Unit>> deleteSighting(String id) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<Unit>();
    if (!_sightings.containsKey(id) || !_ownSightingIds.contains(id)) {
      return _notFound<Unit>('只能撤回自己的上报');
    }
    // 软删（规格 §10.1 #14）：mock 直接从可见集合里移除。
    _sightings.remove(id);
    _ownSightingIds.remove(id);
    return Ok<Unit>(Unit.instance);
  }

  @override
  Future<Result<WildlifeIndividual>> createIndividual(
    CreateWildlifeIndividualCommand command,
  ) async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<WildlifeIndividual>();
    }
    final WildlifeValidationResult validation = command.validate();
    if (validation.isInvalid) {
      return Err<WildlifeIndividual>(
        ApiError(
          code: ApiErrorCode.validationFailed,
          message: validation.firstMessage ?? '名字不合法',
          details: <String, Object?>{'reason': validation.firstReason},
        ),
        traceId: MockControls.traceId,
      );
    }
    final String name = command.name.trim();
    // 规格 §2.8：`@@unique([speciesId, name])` —— 同物种内名字唯一。
    for (final WildlifeIndividual item in _individuals.values) {
      if (item.speciesId == command.speciesId && item.name == name) {
        return Err<WildlifeIndividual>(
          ApiError(
            code: ApiErrorCode.conflict,
            message: '这个物种下已经有叫「$name」的个体了，请直接选择它',
          ),
          traceId: MockControls.traceId,
        );
      }
    }
    final WildlifeIndividual created = WildlifeIndividual(
      id: 'wi-${_sequence++}',
      name: name,
      speciesId: command.speciesId,
      speciesNameZh: _speciesById[command.speciesId]?.displayName,
      description: command.description,
      coverPhotoUrl: command.coverPhotoUrl,
      // 命名需要审核（规格 §2.8：防止恶搞命名）。
      status: WildlifeModerationStatus.pending,
    );
    _individuals[created.id] = created;
    return Ok<WildlifeIndividual>(created);
  }

  // ------------------------------------------------------------------ 内部

  List<WildlifeSighting> _sortedSightings() {
    final List<WildlifeSighting> all =
        _sightings.values.toList(growable: false);
    all.sort(
      (WildlifeSighting a, WildlifeSighting b) =>
          b.observedAt.compareTo(a.observedAt),
    );
    return all;
  }

  /// 热点是否可公开：落在敏感区内的热点**不公开**（规格 §9.3 ① 的同一条推理 ——
  /// 宿舍区的"热点质心"同样等于一个位置）。
  bool _isSpotPublic(WildlifeSpot spot) {
    final WildlifeZone? zone = spot.zoneId == null ? null : _zones[spot.zoneId];
    return !(zone?.isSensitive ?? false);
  }

  WildlifeZone? _zoneFor(String? zoneId, Wgs84Point point) {
    if (zoneId != null && zoneId.isNotEmpty) {
      final WildlifeZone? explicit = _zones[zoneId];
      if (explicit != null) return explicit;
    }
    return zoneContaining(
      point,
      _zones.values.toList(growable: false),
      projection: _projection,
    );
  }

  /// 网格吸附（规格 §9.3 ②）。**确定性**：同一个点永远吸附到同一格。
  Wgs84Point _snapToGrid(Wgs84Point point, int gridM) {
    final LocalMeters meters = _projection.toLocalMeters(point);
    final double snappedX = (meters.x / gridM).roundToDouble() * gridM;
    final double snappedY = (meters.y / gridM).roundToDouble() * gridM;
    return _projection.fromLocalMeters(LocalMeters(x: snappedX, y: snappedY));
  }

  /// 时间粗化（规格 §9.5）。
  DateTime _fuzzTime(DateTime at, {required bool toDay}) {
    final DateTime utc = at.toUtc();
    return toDay
        ? DateTime.utc(utc.year, utc.month, utc.day)
        : DateTime.utc(utc.year, utc.month, utc.day, utc.hour);
  }

  String _thumbUrlFor(String mediaId) {
    for (final WildlifeMedia media in _mediaByClientId.values) {
      if (media.mediaId == mediaId) {
        return media.thumbUrl ??
            'https://cdn.kedaya.local/wildlife/mock/$mediaId/thumb.webp';
      }
    }
    return 'https://cdn.kedaya.local/wildlife/mock/$mediaId/thumb.webp';
  }

  Page<T> _page<T>(List<T> all, String? cursor, int limit) {
    final int start = _parseCursor(cursor);
    final int size =
        limit < 1 ? 1 : (limit > maxPageSize ? maxPageSize : limit);
    final List<T> window = all.skip(start).take(size).toList(growable: false);
    final int consumed = start + window.length;
    return Page<T>(
      items: window,
      nextCursor: consumed < all.length ? '$consumed' : null,
      total: all.length,
    );
  }

  int _parseCursor(String? cursor) {
    if (cursor == null || cursor.isEmpty) return 0;
    final int? parsed = int.tryParse(cursor);
    if (parsed == null || parsed < 0) return 0;
    return parsed;
  }

  Err<T> _notFound<T>(String message) => Err<T>(
        ApiError(code: ApiErrorCode.notFound, message: message),
        traceId: MockControls.traceId,
      );

  /// FNV-1a 32 位指纹（**不是** sha256，见 [uploadMedia] 的注释）。
  String _fingerprint(List<int> bytes) {
    int hash = 0x811C9DC5;
    for (final int byte in bytes) {
      hash ^= byte & 0xFF;
      hash = (hash * 0x01000193) & 0xFFFFFFFF;
    }
    return hash.toRadixString(16).padLeft(8, '0');
  }

  int _hashSeed(String value) {
    int hash = 0x811C9DC5;
    for (final int unit in value.codeUnits) {
      hash ^= unit & 0xFF;
      hash = (hash * 0x01000193) & 0xFFFFFFFF;
    }
    return hash;
  }
}
