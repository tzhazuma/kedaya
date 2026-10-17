import '../../domain/models/api_request.dart';
import '../../domain/models/groupbuy_order.dart';
import '../../domain/models/json_read.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/groupbuy_port.dart';
import '../../domain/ports/kedaya_api_port.dart';
import '../api/request_ids.dart';

/// [GroupbuyPort] 的远端实现（`/api/v1/groupbuy/*`，契约 §6.1）。
final class RemoteGroupbuyRepository implements GroupbuyPort {
  const RemoteGroupbuyRepository(this._api);

  static const String _base = 'groupbuy/items';

  final KedayaApiPort _api;

  @override
  Future<Result<Page<GroupbuyOrder>>> listOrders(GroupbuyQuery query) =>
      _api.send<Page<GroupbuyOrder>>(
        ApiRequest(path: _base, method: ApiMethod.get, query: query.toQuery()),
        (Object? data) => Page<GroupbuyOrder>.fromJson(
          requireJsonMap(data, what: 'groupbuy list'),
          GroupbuyOrder.fromJson,
        ),
      );

  @override
  Future<Result<GroupbuyOrder>> getOrder(String id) => _api.send<GroupbuyOrder>(
        ApiRequest(path: '$_base/$id', method: ApiMethod.get),
        _decodeOrder,
      );

  @override
  Future<Result<GroupbuyOrder>> createOrder(
          CreateGroupbuyOrderCommand command) =>
      _api.send<GroupbuyOrder>(
        ApiRequest(
          path: _base,
          method: ApiMethod.post,
          body: command.toJson(),
          idempotencyKey: newIdempotencyKey(),
        ),
        _decodeOrder,
      );

  @override
  Future<Result<GroupbuyOrder>> joinOrder(String id, {required int quantity}) =>
      _api.send<GroupbuyOrder>(
        ApiRequest(
          path: '$_base/$id/join',
          method: ApiMethod.post,
          body: <String, Object?>{'quantity': quantity},
          idempotencyKey: newIdempotencyKey(),
        ),
        _decodeOrder,
      );

  @override
  Future<Result<GroupbuyOrder>> cancelOrder(String id) =>
      _api.send<GroupbuyOrder>(
        ApiRequest(
          path: '$_base/$id/cancel',
          method: ApiMethod.post,
          idempotencyKey: newIdempotencyKey(),
        ),
        _decodeOrder,
      );

  GroupbuyOrder _decodeOrder(Object? data) =>
      GroupbuyOrder.fromJson(requireJsonMap(data, what: 'groupbuy order'));
}
