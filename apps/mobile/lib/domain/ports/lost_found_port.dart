import '../models/lost_found_item.dart';
import '../models/page.dart';
import '../models/result.dart';

/// 失物招领业务端口（契约 §4.1 `lost-found`）。
abstract interface class LostFoundPort {
  /// `GET /api/v1/lost-found/items`（游标分页）。
  Future<Result<Page<LostFoundItem>>> listItems({
    String? cursor,
    int limit,
    LostFoundKind? kind,
  });

  /// `GET /api/v1/lost-found/items/:id`。
  Future<Result<LostFoundItem>> getItem(String id);

  /// `POST /api/v1/lost-found/items`。
  Future<Result<LostFoundItem>> createItem(CreateLostFoundItemCommand command);

  /// `POST /api/v1/lost-found/items/:id/match`：标记为已匹配。
  Future<Result<LostFoundItem>> markMatched(String id);

  /// `POST /api/v1/lost-found/items/:id/close`：关闭条目。
  Future<Result<LostFoundItem>> closeItem(String id);
}
