import '../../domain/models/api_error.dart';
import '../../domain/models/api_request.dart';
import '../../domain/models/groupbuy_order.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/groupbuy_port.dart';
import 'mock_controls.dart';
import 'mock_fixtures.dart';

/// [GroupbuyPort] 的内存实现 —— 让拼单垂直切片在**无后端**时可跑（契约 §7 硬规则 4）。
///
/// 真实行为而不是假数据：游标分页、参团累加、成团判定、状态冲突、故障注入。
final class MockGroupbuyRepository implements GroupbuyPort {
  MockGroupbuyRepository({List<GroupbuyOrder>? seed, MockControls? controls})
      : _orders = <String, GroupbuyOrder>{
          for (final GroupbuyOrder order in seed ?? mockGroupbuyOrders)
            order.id: order,
        },
        controls = controls ?? MockControls();

  final Map<String, GroupbuyOrder> _orders;

  /// 可在运行时切换延迟与故障（UI 三态演示 / 测试注入）。
  final MockControls controls;

  int _sequence = 1006;

  /// 供测试断言内部状态。
  List<GroupbuyOrder> snapshot() => _sorted();

  @override
  Future<Result<Page<GroupbuyOrder>>> listOrders(GroupbuyQuery query) async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<Page<GroupbuyOrder>>();
    }
    if (controls.emptyResults) {
      return Ok<Page<GroupbuyOrder>>(
        const Page<GroupbuyOrder>(items: <GroupbuyOrder>[], total: 0),
      );
    }

    final List<GroupbuyOrder> all = _sorted();
    final int start = _parseCursor(query.cursor);
    final int limit = query.limit < 1
        ? 1
        : (query.limit > maxPageSize ? maxPageSize : query.limit);
    final List<GroupbuyOrder> window =
        all.skip(start).take(limit).toList(growable: false);
    final int consumed = start + window.length;
    return Ok<Page<GroupbuyOrder>>(
      Page<GroupbuyOrder>(
        items: window,
        nextCursor: consumed < all.length ? '$consumed' : null,
        total: all.length,
      ),
    );
  }

  @override
  Future<Result<GroupbuyOrder>> getOrder(String id) async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<GroupbuyOrder>();
    }
    final GroupbuyOrder? order = _orders[id];
    if (order == null) {
      return Err<GroupbuyOrder>(
        const ApiError(code: ApiErrorCode.notFound, message: '该拼单不存在或已下架'),
        traceId: MockControls.traceId,
      );
    }
    return Ok<GroupbuyOrder>(order);
  }

  @override
  Future<Result<GroupbuyOrder>> createOrder(
      CreateGroupbuyOrderCommand command) async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<GroupbuyOrder>();
    }
    if (command.title.trim().isEmpty) {
      return Err<GroupbuyOrder>(
        const ApiError(
            code: ApiErrorCode.validationFailed, message: '拼单标题不能为空'),
        traceId: MockControls.traceId,
      );
    }
    if (command.unitPriceFen <= 0 || command.targetQuantity <= 0) {
      return Err<GroupbuyOrder>(
        const ApiError(
            code: ApiErrorCode.validationFailed, message: '单价与目标份数必须大于 0'),
        traceId: MockControls.traceId,
      );
    }
    final GroupbuyOrder created = GroupbuyOrder(
      id: 'gb-${_sequence++}',
      title: command.title.trim(),
      description: command.description,
      unitPriceFen: command.unitPriceFen,
      targetQuantity: command.targetQuantity,
      joinedQuantity: 1,
      status: GroupbuyStatus.recruiting,
      initiatorId: mockUser.userId,
      initiatorName: mockUser.displayNameOrId,
      pickupLocation: command.pickupLocation,
      deadline: command.deadline,
      createdAt: mockNow,
      updatedAt: mockNow,
    );
    _orders[created.id] = created;
    return Ok<GroupbuyOrder>(created);
  }

  @override
  Future<Result<GroupbuyOrder>> joinOrder(String id,
      {required int quantity}) async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<GroupbuyOrder>();
    }
    final GroupbuyOrder? order = _orders[id];
    if (order == null) {
      return Err<GroupbuyOrder>(
        const ApiError(code: ApiErrorCode.notFound, message: '该拼单不存在或已下架'),
        traceId: MockControls.traceId,
      );
    }
    if (quantity < 1) {
      return Err<GroupbuyOrder>(
        const ApiError(
            code: ApiErrorCode.validationFailed, message: '参团份数必须大于 0'),
        traceId: MockControls.traceId,
      );
    }
    if (order.status != GroupbuyStatus.recruiting) {
      return Err<GroupbuyOrder>(
        ApiError(
          code: ApiErrorCode.conflict,
          message: '该拼单当前状态为「${order.status.label}」，无法参团',
        ),
        traceId: MockControls.traceId,
      );
    }
    final int joined = order.joinedQuantity + quantity;
    final GroupbuyOrder updated = order.copyWith(
      joinedQuantity: joined,
      status: joined >= order.targetQuantity
          ? GroupbuyStatus.locked
          : GroupbuyStatus.recruiting,
      updatedAt: mockNow,
    );
    _orders[id] = updated;
    return Ok<GroupbuyOrder>(updated);
  }

  @override
  Future<Result<GroupbuyOrder>> cancelOrder(String id) async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<GroupbuyOrder>();
    }
    final GroupbuyOrder? order = _orders[id];
    if (order == null) {
      return Err<GroupbuyOrder>(
        const ApiError(code: ApiErrorCode.notFound, message: '该拼单不存在或已下架'),
        traceId: MockControls.traceId,
      );
    }
    if (order.status == GroupbuyStatus.completed) {
      return Err<GroupbuyOrder>(
        const ApiError(code: ApiErrorCode.conflict, message: '已成团的拼单不能取消'),
        traceId: MockControls.traceId,
      );
    }
    final GroupbuyOrder cancelled = order.copyWith(
      status: GroupbuyStatus.cancelled,
      updatedAt: mockNow,
    );
    _orders[id] = cancelled;
    return Ok<GroupbuyOrder>(cancelled);
  }

  /// 最新的排在最前（与后端默认排序一致）。
  List<GroupbuyOrder> _sorted() {
    final List<GroupbuyOrder> all = _orders.values.toList(growable: false);
    all.sort((GroupbuyOrder a, GroupbuyOrder b) =>
        b.createdAt.compareTo(a.createdAt));
    return all;
  }

  int _parseCursor(String? cursor) {
    if (cursor == null || cursor.isEmpty) return 0;
    final int? parsed = int.tryParse(cursor);
    if (parsed == null || parsed < 0) return 0;
    return parsed;
  }
}
