/// `wildlife` 业务端口（契约 §4.1 `wildlife`，敏感级**低**、**无同意门**）。
///
/// 规格 §10.1 的端点总表与本端口的对应关系：
///
/// | 方法 | HTTP | 登录 |
/// | --- | --- | --- |
/// | [getBasemap] | `GET wildlife/basemap` | 否 |
/// | [listSpecies] | `GET wildlife/species` | 否 |
/// | [listZones] / [getZone] | `GET wildlife/zones[/:id]` | 否 |
/// | [listSpots] | `GET wildlife/spots` | 否（**只读，延迟 ≥24h**） |
/// | [listTracks] / [getTrack] | `GET wildlife/tracks[/:id]` | 否 |
/// | [listIndividuals] | `GET wildlife/individuals` | 否 |
/// | [listSightings] / [getSighting] | `GET wildlife/items[/:id]` | 否（仅 PUBLISHED） |
/// | [uploadMedia] | `POST wildlife/media` | 是（multipart） |
/// | [createSighting] | `POST wildlife/items` | 是 |
/// | [correctSpecies] | `PATCH wildlife/items/:id` | 是（RFC 7396 merge patch） |
/// | [deleteSighting] | `DELETE wildlife/items/:id` | 是（软删） |
/// | [classify] | `POST wildlife/classify` | 是（无能力时返回空数组） |
/// | [createIndividual] | `POST wildlife/individuals` | 是 |
///
/// **本端口没有 `moderate`**：审核是管理员能力，学生端不提供入口。
/// 该 action 名已在契约 §11.2 登记（`wildlife.moderate`），管理端可直接使用。
library;

import '../models/page.dart';
import '../models/result.dart';
import '../models/wildlife.dart';
import '../models/wildlife_sighting.dart';
import '../models/wildlife_track.dart';

abstract interface class WildlifePort {
  /// `GET /api/v1/wildlife/basemap` —— 底图配置（含仿射标定与署名）。
  Future<Result<CampusBasemap>> getBasemap();

  /// `GET /api/v1/wildlife/species` —— 物种列表（分类树）。
  Future<Result<List<WildlifeSpecies>>> listSpecies();

  /// `GET /api/v1/wildlife/zones` —— 区域列表（含投喂政策与告示位）。
  Future<Result<List<WildlifeZone>>> listZones();

  /// `GET /api/v1/wildlife/zones/:id`。
  Future<Result<WildlifeZone>> getZone(String id);

  /// `GET /api/v1/wildlife/spots` —— 聚合热点（**只读**，`computedAt` 至少晚 24h）。
  Future<Result<Page<WildlifeSpot>>> listSpots(WildlifeSpotQuery query);

  /// `GET /api/v1/wildlife/tracks` —— 推断轨迹列表。
  Future<Result<Page<WildlifeTrack>>> listTracks(WildlifeTrackQuery query);

  /// `GET /api/v1/wildlife/tracks/:id`。
  Future<Result<WildlifeTrack>> getTrack(String id);

  /// `GET /api/v1/wildlife/individuals?species=` —— 已审核的命名个体。
  Future<Result<List<WildlifeIndividual>>> listIndividuals({String? speciesId});

  /// `POST /api/v1/wildlife/individuals` —— 给个体起名（走 PENDING 审核队列）。
  Future<Result<WildlifeIndividual>> createIndividual(
    CreateWildlifeIndividualCommand command,
  );

  /// `GET /api/v1/wildlife/items` —— 观测记录（游标分页，**仅 PUBLISHED**）。
  Future<Result<Page<WildlifeSighting>>> listSightings(
      WildlifeSightingQuery query);

  /// `GET /api/v1/wildlife/items/:id`。
  ///
  /// 未公开（PENDING / REJECTED）的记录对**非上报人**按 `NOT_FOUND` 处理
  /// （规格 §9.1 A3：`NOT_FOUND` 不区分，避免成为枚举旁路）。
  Future<Result<WildlifeSighting>> getSighting(String id);

  /// `POST /api/v1/wildlife/media` —— **服务端代理上传**（multipart）。
  ///
  /// 为什么不是对象存储直传：EXIF 剥离（含 GPS）是隐私硬要求，
  /// **不能是"客户端承诺"**（规格 §4.1）。重试必须复用 [clientPhotoId]。
  Future<Result<WildlifeMedia>> uploadMedia(UploadWildlifeMediaCommand command);

  /// `POST /api/v1/wildlife/items` —— 上报观测（带 `Idempotency-Key`）。
  Future<Result<WildlifeSighting>> createSighting(WildlifeSightingDraft draft);

  /// `POST /api/v1/wildlife/classify` —— 自动分类建议。
  ///
  /// 无能力时返回**空数组**（不是 5xx，规格 §11.6 T43），
  /// 客户端据此静默降级到手动选择（§5.2）。
  Future<Result<WildlifeClassifyResult>> classify(
      WildlifeClassifyRequest request);

  /// `PATCH /api/v1/wildlife/items/:id` —— 纠正物种（JSON Merge Patch）。
  ///
  /// 服务端记录 `correctedFromSpeciesId` 形成标注样本（规格 §5.5 的闭环）。
  Future<Result<WildlifeSighting>> correctSpecies(String id,
      {required String speciesId});

  /// `DELETE /api/v1/wildlife/items/:id` —— 撤回自己的上报（软删）。
  Future<Result<Unit>> deleteSighting(String id);
}
