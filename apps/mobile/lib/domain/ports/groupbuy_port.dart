import '../models/groupbuy_order.dart';
import '../models/page.dart';
import '../models/result.dart';

/// 拼单业务端口（契约 §4.1 `groupbuy`）。
///
/// 路径形状遵循契约 §6.1 的统一 CRUD：`groupbuy/items[/:id[/action]]`。
abstract interface class GroupbuyPort {
  /// `GET /api/v1/groupbuy/items`（游标分页）。
  Future<Result<Page<GroupbuyOrder>>> listOrders(GroupbuyQuery query);

  /// `GET /api/v1/groupbuy/items/:id`。
  Future<Result<GroupbuyOrder>> getOrder(String id);

  /// `POST /api/v1/groupbuy/items`。
  Future<Result<GroupbuyOrder>> createOrder(CreateGroupbuyOrderCommand command);

  /// `POST /api/v1/groupbuy/items/:id/join`。
  Future<Result<GroupbuyOrder>> joinOrder(String id, {required int quantity});

  /// `POST /api/v1/groupbuy/items/:id/cancel`。
  Future<Result<GroupbuyOrder>> cancelOrder(String id);
}
