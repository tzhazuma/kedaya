import '../../domain/models/api_error.dart';
import '../../domain/models/api_request.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/models/wellbeing_appointment.dart';
import '../../domain/ports/wellbeing_port.dart';
import 'crisis_resources.dart';
import 'mock_controls.dart';
import 'mock_fixtures.dart';

/// [WellbeingPort] 的内存实现（敏感级 critical 的示例数据）。
///
/// 契约 §9：危机资源**永远本地可用** —— 本实现直接返回内置清单，
/// 不依赖任何网络。
final class MockWellbeingRepository implements WellbeingPort {
  MockWellbeingRepository({
    List<WellbeingAppointment>? seed,
    List<CrisisResource>? crisisResources,
    MockControls? controls,
  }) : _appointments = <String, WellbeingAppointment>{
         for (final WellbeingAppointment item in seed ?? mockWellbeingAppointments)
           item.id: item,
       },
       _crisisResources = crisisResources ?? builtInCrisisResources,
       controls = controls ?? MockControls();

  final Map<String, WellbeingAppointment> _appointments;
  final List<CrisisResource> _crisisResources;
  final MockControls controls;
  int _sequence = 4003;

  @override
  List<CrisisResource> crisisResources() => _crisisResources;

  @override
  Future<Result<Page<WellbeingAppointment>>> listAppointments({
    String? cursor,
    int limit = defaultPageSize,
  }) async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<Page<WellbeingAppointment>>();
    }
    final List<WellbeingAppointment> all = _sorted();
    final int start = _parseCursor(cursor);
    final int size = limit < 1 ? 1 : (limit > maxPageSize ? maxPageSize : limit);
    final List<WellbeingAppointment> window = all.skip(start).take(size).toList(growable: false);
    final int consumed = start + window.length;
    return Ok<Page<WellbeingAppointment>>(
      Page<WellbeingAppointment>(
        items: window,
        nextCursor: consumed < all.length ? '$consumed' : null,
        total: all.length,
      ),
    );
  }

  @override
  Future<Result<WellbeingAppointment>> getAppointment(String id) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<WellbeingAppointment>();
    return _require(id);
  }

  @override
  Future<Result<WellbeingAppointment>> bookAppointment(
    BookWellbeingAppointmentCommand command,
  ) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<WellbeingAppointment>();
    if (!command.endsAt.isAfter(command.startsAt)) {
      return Err<WellbeingAppointment>(
        const ApiError(code: ApiErrorCode.validationFailed, message: '结束时间必须晚于开始时间'),
        traceId: MockControls.traceId,
      );
    }
    final WellbeingAppointment created = WellbeingAppointment(
      id: 'wb-${_sequence++}',
      counselorName: '待分配咨询师',
      startsAt: command.startsAt,
      endsAt: command.endsAt,
      status: WellbeingStatus.requested,
      createdAt: mockNow,
      mode: command.mode,
      note: command.note,
    );
    _appointments[created.id] = created;
    return Ok<WellbeingAppointment>(created);
  }

  @override
  Future<Result<WellbeingAppointment>> cancelAppointment(String id) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<WellbeingAppointment>();
    final Result<WellbeingAppointment> found = _require(id);
    final WellbeingAppointment? item = found.valueOrNull;
    if (item == null) return found;
    if (!item.isActive) {
      return Err<WellbeingAppointment>(
        const ApiError(code: ApiErrorCode.conflict, message: '该预约已结束或已取消'),
        traceId: MockControls.traceId,
      );
    }
    final WellbeingAppointment cancelled = item.copyWith(status: WellbeingStatus.cancelled);
    _appointments[id] = cancelled;
    return Ok<WellbeingAppointment>(cancelled);
  }

  Result<WellbeingAppointment> _require(String id) {
    final WellbeingAppointment? item = _appointments[id];
    if (item == null) {
      return Err<WellbeingAppointment>(
        const ApiError(code: ApiErrorCode.notFound, message: '该预约不存在'),
        traceId: MockControls.traceId,
      );
    }
    return Ok<WellbeingAppointment>(item);
  }

  List<WellbeingAppointment> _sorted() {
    final List<WellbeingAppointment> all = _appointments.values.toList(growable: false);
    all.sort((WellbeingAppointment a, WellbeingAppointment b) => a.startsAt.compareTo(b.startsAt));
    return all;
  }

  int _parseCursor(String? cursor) {
    if (cursor == null || cursor.isEmpty) return 0;
    final int? parsed = int.tryParse(cursor);
    return (parsed == null || parsed < 0) ? 0 : parsed;
  }
}
