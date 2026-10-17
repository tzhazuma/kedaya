import '../models/errand_task.dart';
import '../models/page.dart';
import '../models/result.dart';

/// 跑腿业务端口（契约 §4.1 `errand`）。
abstract interface class ErrandPort {
  /// `GET /api/v1/errand/items`（游标分页）。
  Future<Result<Page<ErrandTask>>> listTasks({String? cursor, int limit});

  /// `GET /api/v1/errand/items/:id`。
  Future<Result<ErrandTask>> getTask(String id);

  /// `POST /api/v1/errand/items`。
  Future<Result<ErrandTask>> createTask(CreateErrandCommand command);

  /// `POST /api/v1/errand/items/:id/accept`。
  Future<Result<ErrandTask>> acceptTask(String id);

  /// `POST /api/v1/errand/items/:id/complete`。
  Future<Result<ErrandTask>> completeTask(String id);
}
