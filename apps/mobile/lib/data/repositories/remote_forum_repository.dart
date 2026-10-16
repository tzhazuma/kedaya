import '../../domain/models/api_request.dart';
import '../../domain/models/forum.dart';
import '../../domain/models/json_read.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/forum_port.dart';
import '../../domain/ports/kedaya_api_port.dart';
import '../api/request_ids.dart';

/// [ForumPort] 的远端实现（`/api/v1/forum/*`，契约 §6.1）。
///
/// 所有写操作都带 `Idempotency-Key`（契约 §11.3：POST 必需）。
final class RemoteForumRepository implements ForumPort {
  const RemoteForumRepository(this._api);

  static const String _base = 'forum/items';

  final KedayaApiPort _api;

  @override
  Future<Result<List<ForumBoard>>> listBoards() => _api.send<List<ForumBoard>>(
    const ApiRequest(path: 'forum/boards', method: ApiMethod.get),
    _decodeBoards,
  );

  @override
  Future<Result<Page<ForumPost>>> listPosts(ForumPostQuery query) =>
      _api.send<Page<ForumPost>>(
        ApiRequest(path: _base, method: ApiMethod.get, query: query.toQuery()),
        (Object? data) => Page<ForumPost>.fromJson(
          requireJsonMap(data, what: 'forum list'),
          ForumPost.fromJson,
        ),
      );

  @override
  Future<Result<ForumPost>> getPost(String id) => _api.send<ForumPost>(
    ApiRequest(path: '$_base/$id', method: ApiMethod.get),
    _decodePost,
  );

  @override
  Future<Result<Page<ForumReply>>> listReplies(ForumReplyQuery query) =>
      _api.send<Page<ForumReply>>(
        ApiRequest(
          path: '$_base/${query.postId}/replies',
          method: ApiMethod.get,
          query: PageQuery(cursor: query.cursor, limit: query.limit).toQuery(),
        ),
        (Object? data) => Page<ForumReply>.fromJson(
          requireJsonMap(data, what: 'forum replies'),
          ForumReply.fromJson,
        ),
      );

  @override
  Future<Result<ForumPost>> createPost(CreateForumPostCommand command) =>
      _api.send<ForumPost>(
        ApiRequest(
          path: _base,
          method: ApiMethod.post,
          body: command.toJson(),
          idempotencyKey: newIdempotencyKey(),
        ),
        _decodePost,
      );

  @override
  Future<Result<ForumReply>> createReply(CreateForumReplyCommand command) =>
      _api.send<ForumReply>(
        ApiRequest(
          // `services/api` 的路径是 `items/:id/replies`（复数、子资源）。
          path: '$_base/${command.postId}/replies',
          method: ApiMethod.post,
          body: command.toJson(),
          idempotencyKey: newIdempotencyKey(),
        ),
        (Object? data) => ForumReply.fromJson(requireJsonMap(data, what: 'forum reply')),
      );

  @override
  Future<Result<ForumReport>> report(CreateForumReportCommand command) =>
      _api.send<ForumReport>(
        ApiRequest(
          path: '$_base/${command.targetId}/report',
          method: ApiMethod.post,
          body: command.toJson(),
          idempotencyKey: newIdempotencyKey(),
        ),
        (Object? data) => ForumReport.fromJson(requireJsonMap(data, what: 'forum report')),
      );

  ForumPost _decodePost(Object? data) =>
      ForumPost.fromJson(requireJsonMap(data, what: 'forum post'));

  List<ForumBoard> _decodeBoards(Object? data) => readListOrEmpty(
    requireJsonMap(data, what: 'forum boards'),
    'items',
  )
      .map((Object? item) => ForumBoard.fromJson(requireJsonMap(item, what: 'forum board')))
      .toList(growable: false);
}
