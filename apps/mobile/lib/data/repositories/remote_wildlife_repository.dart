import '../../domain/models/api_request.dart';
import '../../domain/models/json_read.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/models/wildlife.dart';
import '../../domain/models/wildlife_sighting.dart';
import '../../domain/models/wildlife_track.dart';
import '../../domain/ports/kedaya_api_port.dart';
import '../../domain/ports/wildlife_port.dart';
import '../api/request_ids.dart';

/// [WildlifePort] 的远端实现（`/api/v1/wildlife/*`，规格 §10.1）。
///
/// 与 `services/api` 的形状约定：
///   - 列表统一走契约 §6.1 的游标分页 `Page<T>`；
///   - 写操作带 `Idempotency-Key`（契约 §11.3）；
///   - `PATCH` 用 JSON Merge Patch（契约 §11.1），只发要改的字段；
///   - 图片走 **multipart 服务端代理上传**（规格 §4.1），幂等键复用
///     `clientPhotoId`，因此"重试同一张图"不会产生第二份存储。
///
/// 本实现**不做任何模糊化**：坐标模糊化、k-匿名、敏感区判定全部在服务端
/// （规格 §9.1 A6：客户端从未见过精确坐标，除了用户自己输入的那一次）。
final class RemoteWildlifeRepository implements WildlifePort {
  const RemoteWildlifeRepository(this._api);

  static const String _base = 'wildlife';
  static const String _items = '$_base/items';

  final KedayaApiPort _api;

  @override
  Future<Result<CampusBasemap>> getBasemap() => _api.send<CampusBasemap>(
        const ApiRequest(path: '$_base/basemap', method: ApiMethod.get),
        (Object? data) => CampusBasemap.fromJson(
            requireJsonMap(data, what: 'wildlife basemap')),
      );

  @override
  Future<Result<List<WildlifeSpecies>>> listSpecies() =>
      _api.send<List<WildlifeSpecies>>(
        const ApiRequest(path: '$_base/species', method: ApiMethod.get),
        (Object? data) =>
            _decodeList(data, 'wildlife species', WildlifeSpecies.fromJson),
      );

  @override
  Future<Result<List<WildlifeZone>>> listZones() =>
      _api.send<List<WildlifeZone>>(
        const ApiRequest(path: '$_base/zones', method: ApiMethod.get),
        (Object? data) =>
            _decodeList(data, 'wildlife zones', WildlifeZone.fromJson),
      );

  @override
  Future<Result<WildlifeZone>> getZone(String id) => _api.send<WildlifeZone>(
        ApiRequest(path: '$_base/zones/$id', method: ApiMethod.get),
        (Object? data) =>
            WildlifeZone.fromJson(requireJsonMap(data, what: 'wildlife zone')),
      );

  @override
  Future<Result<Page<WildlifeSpot>>> listSpots(WildlifeSpotQuery query) =>
      _api.send<Page<WildlifeSpot>>(
        ApiRequest(
          path: '$_base/spots',
          method: ApiMethod.get,
          query: query.toQuery(),
        ),
        (Object? data) => Page<WildlifeSpot>.fromJson(
          requireJsonMap(data, what: 'wildlife spots'),
          WildlifeSpot.fromJson,
        ),
      );

  @override
  Future<Result<Page<WildlifeTrack>>> listTracks(WildlifeTrackQuery query) =>
      _api.send<Page<WildlifeTrack>>(
        ApiRequest(
          path: '$_base/tracks',
          method: ApiMethod.get,
          query: query.toQuery(),
        ),
        (Object? data) => Page<WildlifeTrack>.fromJson(
          requireJsonMap(data, what: 'wildlife tracks'),
          WildlifeTrack.fromJson,
        ),
      );

  @override
  Future<Result<WildlifeTrack>> getTrack(String id) => _api.send<WildlifeTrack>(
        ApiRequest(path: '$_base/tracks/$id', method: ApiMethod.get),
        (Object? data) => WildlifeTrack.fromJson(
            requireJsonMap(data, what: 'wildlife track')),
      );

  @override
  Future<Result<List<WildlifeIndividual>>> listIndividuals(
          {String? speciesId}) =>
      _api.send<List<WildlifeIndividual>>(
        ApiRequest(
          path: '$_base/individuals',
          method: ApiMethod.get,
          query: <String, Object?>{
            if (speciesId != null && speciesId.isNotEmpty) 'species': speciesId,
          },
        ),
        (Object? data) => _decodeList(
            data, 'wildlife individuals', WildlifeIndividual.fromJson),
      );

  @override
  Future<Result<WildlifeIndividual>> createIndividual(
    CreateWildlifeIndividualCommand command,
  ) =>
      _api.send<WildlifeIndividual>(
        ApiRequest(
          path: '$_base/individuals',
          method: ApiMethod.post,
          body: command.toJson(),
          idempotencyKey: newIdempotencyKey(),
        ),
        (Object? data) => WildlifeIndividual.fromJson(
            requireJsonMap(data, what: 'wildlife individual')),
      );

  @override
  Future<Result<Page<WildlifeSighting>>> listSightings(
          WildlifeSightingQuery query) =>
      _api.send<Page<WildlifeSighting>>(
        ApiRequest(
          path: _items,
          method: ApiMethod.get,
          query: query.toQuery(),
        ),
        (Object? data) => Page<WildlifeSighting>.fromJson(
          requireJsonMap(data, what: 'wildlife sightings'),
          WildlifeSighting.fromJson,
        ),
      );

  @override
  Future<Result<WildlifeSighting>> getSighting(String id) =>
      _api.send<WildlifeSighting>(
        ApiRequest(path: '$_items/$id', method: ApiMethod.get),
        (Object? data) => WildlifeSighting.fromJson(
            requireJsonMap(data, what: 'wildlife sighting')),
      );

  @override
  Future<Result<WildlifeMedia>> uploadMedia(
          UploadWildlifeMediaCommand command) =>
      _api.sendMultipart<WildlifeMedia>(
        ApiRequest(
          path: '$_base/media',
          method: ApiMethod.post,
          body: <String, Object?>{'clientPhotoId': command.clientPhotoId},
          // 规格 §4.5：重试**复用** clientPhotoId 作为幂等键。
          idempotencyKey: command.clientPhotoId,
        ),
        <ApiUploadFile>[
          ApiUploadFile(
            field: 'file',
            bytes: command.bytes,
            fileName: command.fileName ?? '${command.clientPhotoId}.jpg',
            mimeType: command.mimeType,
          ),
        ],
        (Object? data) => WildlifeMedia.fromJson(
            requireJsonMap(data, what: 'wildlife media')),
      );

  @override
  Future<Result<WildlifeSighting>> createSighting(
          WildlifeSightingDraft draft) =>
      _api.send<WildlifeSighting>(
        ApiRequest(
          path: _items,
          method: ApiMethod.post,
          body: draft.toJson(),
          idempotencyKey: newIdempotencyKey(),
        ),
        (Object? data) => WildlifeSighting.fromJson(
            requireJsonMap(data, what: 'wildlife sighting')),
      );

  @override
  Future<Result<WildlifeClassifyResult>> classify(
          WildlifeClassifyRequest request) =>
      _api.send<WildlifeClassifyResult>(
        ApiRequest(
          path: '$_base/classify',
          method: ApiMethod.post,
          body: request.toJson(),
          idempotencyKey: newIdempotencyKey(),
        ),
        (Object? data) => WildlifeClassifyResult.fromJson(
            requireJsonMap(data, what: 'wildlife classify')),
      );

  @override
  Future<Result<WildlifeSighting>> correctSpecies(
    String id, {
    required String speciesId,
  }) =>
      _api.send<WildlifeSighting>(
        ApiRequest(
          path: '$_items/$id',
          method: ApiMethod.patch,
          // 契约 §11.1：只发要改的字段（RFC 7396）。
          body: <String, Object?>{'species': speciesId},
          contentType: mergePatchContentType,
        ),
        (Object? data) => WildlifeSighting.fromJson(
            requireJsonMap(data, what: 'wildlife sighting')),
      );

  @override
  Future<Result<Unit>> deleteSighting(String id) => _api.sendVoid(
        ApiRequest(path: '$_items/$id', method: ApiMethod.delete),
      );

  /// 列表响应既可能是裸数组，也可能是 `{ items: [...] }` —— 两种都接受。
  ///
  /// 契约 §6.1 的分页集合是 `{ items, nextCursor }`，而 `species` / `zones` /
  /// `individuals` 这类**有界字典**在实现里更常直接返回数组。
  /// 客户端不该因为这种形状差异整页失败。
  List<T> _decodeList<T>(
    Object? data,
    String what,
    T Function(Map<String, Object?> item) decode,
  ) {
    if (data is List<Object?>) {
      return data
          .whereType<Map<String, Object?>>()
          .map(decode)
          .toList(growable: false);
    }
    final Map<String, Object?> map = requireJsonMap(data, what: what);
    return readListOrEmpty(map, 'items')
        .whereType<Map<String, Object?>>()
        .map(decode)
        .toList(growable: false);
  }
}
