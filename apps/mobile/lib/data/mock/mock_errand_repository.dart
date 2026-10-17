import '../../domain/models/api_error.dart';
import '../../domain/models/api_request.dart';
import '../../domain/models/errand_task.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/errand_port.dart';
import 'mock_controls.dart';
import 'mock_fixtures.dart';

/// [ErrandPort] 的内存实现。
final class MockErrandRepository implements ErrandPort {
  MockErrandRepository({List<ErrandTask>? seed, MockControls? controls})
      : _tasks = <String, ErrandTask>{
          for (final ErrandTask task in seed ?? mockErrandTasks) task.id: task,
        },
        controls = controls ?? MockControls();

  final Map<String, ErrandTask> _tasks;
  final MockControls controls;
  int _sequence = 2004;

  List<ErrandTask> snapshot() => _sorted();

  @override
  Future<Result<Page<ErrandTask>>> listTasks(
      {String? cursor, int limit = defaultPageSize}) async {
    await controls.simulate();
    if (controls.failure != null)
      return controls.failureResult<Page<ErrandTask>>();
    final List<ErrandTask> all = _sorted();
    final int start = _parseCursor(cursor);
    final int size =
        limit < 1 ? 1 : (limit > maxPageSize ? maxPageSize : limit);
    final List<ErrandTask> window =
        all.skip(start).take(size).toList(growable: false);
    final int consumed = start + window.length;
    return Ok<Page<ErrandTask>>(
      Page<ErrandTask>(
        items: window,
        nextCursor: consumed < all.length ? '$consumed' : null,
        total: all.length,
      ),
    );
  }

  @override
  Future<Result<ErrandTask>> getTask(String id) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<ErrandTask>();
    return _require(id);
  }

  @override
  Future<Result<ErrandTask>> createTask(CreateErrandCommand command) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<ErrandTask>();
    if (command.title.trim().isEmpty || command.rewardFen <= 0) {
      return Err<ErrandTask>(
        const ApiError(
            code: ApiErrorCode.validationFailed, message: '标题不能为空，悬赏必须大于 0'),
        traceId: MockControls.traceId,
      );
    }
    final ErrandTask created = ErrandTask(
      id: 'er-${_sequence++}',
      title: command.title.trim(),
      rewardFen: command.rewardFen,
      status: ErrandStatus.open,
      createdAt: mockNow,
      note: command.note,
      pickupAddress: command.pickupAddress,
      deliveryAddress: command.deliveryAddress,
      requesterId: mockUser.userId,
      deadline: command.deadline,
    );
    _tasks[created.id] = created;
    return Ok<ErrandTask>(created);
  }

  @override
  Future<Result<ErrandTask>> acceptTask(String id) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<ErrandTask>();
    final Result<ErrandTask> found = _require(id);
    final ErrandTask? task = found.valueOrNull;
    if (task == null) return found;
    if (task.status != ErrandStatus.open) {
      return Err<ErrandTask>(
        const ApiError(code: ApiErrorCode.conflict, message: '该任务已被接单'),
        traceId: MockControls.traceId,
      );
    }
    final ErrandTask accepted = task.copyWith(
      status: ErrandStatus.accepted,
      runnerId: mockUser.userId,
    );
    _tasks[id] = accepted;
    return Ok<ErrandTask>(accepted);
  }

  @override
  Future<Result<ErrandTask>> completeTask(String id) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<ErrandTask>();
    final Result<ErrandTask> found = _require(id);
    final ErrandTask? task = found.valueOrNull;
    if (task == null) return found;
    if (task.status != ErrandStatus.accepted &&
        task.status != ErrandStatus.delivered) {
      return Err<ErrandTask>(
        const ApiError(code: ApiErrorCode.conflict, message: '只有已接单的任务可以完成'),
        traceId: MockControls.traceId,
      );
    }
    final ErrandTask completed = task.copyWith(status: ErrandStatus.completed);
    _tasks[id] = completed;
    return Ok<ErrandTask>(completed);
  }

  Result<ErrandTask> _require(String id) {
    final ErrandTask? task = _tasks[id];
    if (task == null) {
      return Err<ErrandTask>(
        const ApiError(code: ApiErrorCode.notFound, message: '该跑腿任务不存在'),
        traceId: MockControls.traceId,
      );
    }
    return Ok<ErrandTask>(task);
  }

  List<ErrandTask> _sorted() {
    final List<ErrandTask> all = _tasks.values.toList(growable: false);
    all.sort(
        (ErrandTask a, ErrandTask b) => b.createdAt.compareTo(a.createdAt));
    return all;
  }

  int _parseCursor(String? cursor) {
    if (cursor == null || cursor.isEmpty) return 0;
    final int? parsed = int.tryParse(cursor);
    return (parsed == null || parsed < 0) ? 0 : parsed;
  }
}
