import '../models/forum.dart';
import '../models/page.dart';
import '../models/result.dart';

/// 论坛业务端口（契约 §4.1 `forum`）。
///
/// 路径形状遵循契约 §6.1 的统一 CRUD：`forum/items[/:id[/action]]`。
/// 领域动作名必须登记在契约 §11.2；本端口用到的 action 只有 `report`。
abstract interface class ForumPort {
  /// `GET /api/v1/forum/boards`。
  ///
  /// ⚠️ 契约 §6.1 只冻结了 `<mod>/items` 这一套 CRUD 形状，没有为"版块"
  /// 单独冻结子资源路径。这里按同一风格取 `forum/boards`（只读、无分页），
  /// 已在交付说明中提出「请 Lead 把 `forum/boards` 登记进 OpenAPI」。
  Future<Result<List<ForumBoard>>> listBoards();

  /// `GET /api/v1/forum/items`（游标分页 + 版块筛选）。
  Future<Result<Page<ForumPost>>> listPosts(ForumPostQuery query);

  /// `GET /api/v1/forum/items/:id`。
  Future<Result<ForumPost>> getPost(String id);

  /// `GET /api/v1/forum/items/:postId/replies`（游标分页）。
  Future<Result<Page<ForumReply>>> listReplies(ForumReplyQuery query);

  /// `POST /api/v1/forum/items`（契约 §11.3：POST 必须带 `Idempotency-Key`）。
  Future<Result<ForumPost>> createPost(CreateForumPostCommand command);

  /// `POST /api/v1/forum/items/:id/reply`（见 `CreateForumReplyCommand` 的说明：
  /// `reply` 尚未登记进契约 §11.2，本端不自创路由，仅按统一形状调用）。
  Future<Result<ForumReply>> createReply(CreateForumReplyCommand command);

  /// `POST /api/v1/forum/items/:id/report`（action 名 `report`，契约 §11.2）。
  Future<Result<ForumReport>> report(CreateForumReportCommand command);
}
