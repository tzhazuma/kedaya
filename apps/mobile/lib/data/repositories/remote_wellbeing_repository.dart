import '../../domain/models/api_request.dart';
import '../../domain/models/json_read.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/models/wellbeing_appointment.dart';
import '../../domain/ports/kedaya_api_port.dart';
import '../../domain/ports/wellbeing_port.dart';
import '../api/request_ids.dart';
import '../mock/crisis_resources.dart';

/// [WellbeingPort] 的远端实现（`/api/v1/wellbeing/*`，契约 §6.1）。
///
/// 契约 §9：本模块敏感级 **critical**，读写必须落审计日志（服务端负责），
/// 且数据不进入通用画像。危机资源必须**本地可用** —— 因此 [crisisResources]
/// 永远先返回内置资源，再尝试用服务端资源覆盖（失败静默）。
final class RemoteWellbeingRepository implements WellbeingPort {
  RemoteWellbeingRepository(this._api);

  static const String _base = 'wellbeing/items';

  final KedayaApiPort _api;

  /// 服务端下发的危机资源（后台拉取后覆盖内置）。
  List<CrisisResource> _remoteCrisisResources = const <CrisisResource>[];

  @override
  List<CrisisResource> crisisResources() => _remoteCrisisResources.isEmpty
      ? builtInCrisisResources
      : _remoteCrisisResources;

  /// 拉取服务端危机资源；失败保持内置资源（契约 §9：出口不可失效）。
  Future<void> loadCrisisResourcesInBackground() async {
    try {
      final Result<List<CrisisResource>> result =
          await _api.send<List<CrisisResource>>(
        const ApiRequest(
            path: 'wellbeing/crisis-resources', method: ApiMethod.get),
        (Object? data) {
          final Map<String, Object?> json =
              requireJsonMap(data, what: 'crisis resources');
          return readListOrEmpty(json, 'items')
              .map((Object? item) => CrisisResource.fromJson(
                  requireJsonMap(item, what: 'items[]')))
              .toList(growable: false);
        },
      );
      final List<CrisisResource>? resources = result.valueOrNull;
      if (resources != null && resources.isNotEmpty) {
        _remoteCrisisResources = List<CrisisResource>.unmodifiable(resources);
      }
    } on Object {
      // 静默：保留内置资源。
    }
  }

  @override
  Future<Result<Page<WellbeingAppointment>>> listAppointments({
    String? cursor,
    int limit = defaultPageSize,
  }) =>
      _api.send<Page<WellbeingAppointment>>(
        ApiRequest(
          path: _base,
          method: ApiMethod.get,
          query: PageQuery(cursor: cursor, limit: limit).toQuery(),
        ),
        (Object? data) => Page<WellbeingAppointment>.fromJson(
          requireJsonMap(data, what: 'wellbeing list'),
          WellbeingAppointment.fromJson,
        ),
      );

  @override
  Future<Result<WellbeingAppointment>> getAppointment(String id) =>
      _api.send<WellbeingAppointment>(
        ApiRequest(path: '$_base/$id', method: ApiMethod.get),
        _decodeAppointment,
      );

  @override
  Future<Result<WellbeingAppointment>> bookAppointment(
    BookWellbeingAppointmentCommand command,
  ) =>
      _api.send<WellbeingAppointment>(
        ApiRequest(
          path: _base,
          method: ApiMethod.post,
          body: command.toJson(),
          idempotencyKey: newIdempotencyKey(),
        ),
        _decodeAppointment,
      );

  @override
  Future<Result<WellbeingAppointment>> cancelAppointment(String id) =>
      _api.send<WellbeingAppointment>(
        ApiRequest(
          path: '$_base/$id/cancel',
          method: ApiMethod.post,
          idempotencyKey: newIdempotencyKey(),
        ),
        _decodeAppointment,
      );

  WellbeingAppointment _decodeAppointment(Object? data) =>
      WellbeingAppointment.fromJson(
          requireJsonMap(data, what: 'wellbeing appointment'));
}
