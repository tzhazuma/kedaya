import '../../domain/models/api_request.dart';
import '../../domain/models/errand_task.dart';
import '../../domain/models/json_read.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/errand_port.dart';
import '../../domain/ports/kedaya_api_port.dart';
import '../api/request_ids.dart';

/// [ErrandPort] 的远端实现（`/api/v1/errand/*`，契约 §6.1）。
final class RemoteErrandRepository implements ErrandPort {
  const RemoteErrandRepository(this._api);

  static const String _base = 'errand/items';

  final KedayaApiPort _api;

  @override
  Future<Result<Page<ErrandTask>>> listTasks(
          {String? cursor, int limit = defaultPageSize}) =>
      _api.send<Page<ErrandTask>>(
        ApiRequest(
          path: _base,
          method: ApiMethod.get,
          query: PageQuery(cursor: cursor, limit: limit).toQuery(),
        ),
        (Object? data) => Page<ErrandTask>.fromJson(
          requireJsonMap(data, what: 'errand list'),
          ErrandTask.fromJson,
        ),
      );

  @override
  Future<Result<ErrandTask>> getTask(String id) => _api.send<ErrandTask>(
        ApiRequest(path: '$_base/$id', method: ApiMethod.get),
        _decodeTask,
      );

  @override
  Future<Result<ErrandTask>> createTask(CreateErrandCommand command) =>
      _api.send<ErrandTask>(
        ApiRequest(
          path: _base,
          method: ApiMethod.post,
          body: command.toJson(),
          idempotencyKey: newIdempotencyKey(),
        ),
        _decodeTask,
      );

  @override
  Future<Result<ErrandTask>> acceptTask(String id) => _api.send<ErrandTask>(
        ApiRequest(
          path: '$_base/$id/accept',
          method: ApiMethod.post,
          idempotencyKey: newIdempotencyKey(),
        ),
        _decodeTask,
      );

  @override
  Future<Result<ErrandTask>> completeTask(String id) => _api.send<ErrandTask>(
        ApiRequest(
          path: '$_base/$id/complete',
          method: ApiMethod.post,
          idempotencyKey: newIdempotencyKey(),
        ),
        _decodeTask,
      );

  ErrandTask _decodeTask(Object? data) =>
      ErrandTask.fromJson(requireJsonMap(data, what: 'errand task'));
}
