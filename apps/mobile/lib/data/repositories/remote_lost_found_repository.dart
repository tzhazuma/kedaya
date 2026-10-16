import '../../domain/models/api_request.dart';
import '../../domain/models/json_read.dart';
import '../../domain/models/lost_found_item.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/kedaya_api_port.dart';
import '../../domain/ports/lost_found_port.dart';
import '../api/request_ids.dart';

/// [LostFoundPort] 的远端实现（`/api/v1/lost-found/*`，契约 §6.1）。
final class RemoteLostFoundRepository implements LostFoundPort {
  const RemoteLostFoundRepository(this._api);

  static const String _base = 'lost-found/items';

  final KedayaApiPort _api;

  @override
  Future<Result<Page<LostFoundItem>>> listItems({
    String? cursor,
    int limit = defaultPageSize,
    LostFoundKind? kind,
  }) => _api.send<Page<LostFoundItem>>(
    ApiRequest(
      path: _base,
      method: ApiMethod.get,
      query: <String, Object?>{
        ...PageQuery(cursor: cursor, limit: limit).toQuery(),
        if (kind != null) 'kind': kind.wire,
      },
    ),
    (Object? data) => Page<LostFoundItem>.fromJson(
      requireJsonMap(data, what: 'lost-found list'),
      LostFoundItem.fromJson,
    ),
  );

  @override
  Future<Result<LostFoundItem>> getItem(String id) => _api.send<LostFoundItem>(
    ApiRequest(path: '$_base/$id', method: ApiMethod.get),
    _decodeItem,
  );

  @override
  Future<Result<LostFoundItem>> createItem(CreateLostFoundItemCommand command) =>
      _api.send<LostFoundItem>(
        ApiRequest(
          path: _base,
          method: ApiMethod.post,
          body: command.toJson(),
          idempotencyKey: newIdempotencyKey(),
        ),
        _decodeItem,
      );

  @override
  Future<Result<LostFoundItem>> markMatched(String id) => _api.send<LostFoundItem>(
    ApiRequest(
      path: '$_base/$id/match',
      method: ApiMethod.post,
      idempotencyKey: newIdempotencyKey(),
    ),
    _decodeItem,
  );

  @override
  Future<Result<LostFoundItem>> closeItem(String id) => _api.send<LostFoundItem>(
    ApiRequest(
      path: '$_base/$id/close',
      method: ApiMethod.post,
      idempotencyKey: newIdempotencyKey(),
    ),
    _decodeItem,
  );

  LostFoundItem _decodeItem(Object? data) =>
      LostFoundItem.fromJson(requireJsonMap(data, what: 'lost-found item'));
}
