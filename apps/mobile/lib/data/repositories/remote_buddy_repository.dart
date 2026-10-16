import '../../domain/models/buddy.dart';
import '../../domain/models/buddy_application.dart';
import '../../domain/models/buddy_matching.dart';
import '../../domain/models/buddy_profile.dart';
import '../../domain/models/json_read.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/buddy_port.dart';
import '../../domain/ports/kedaya_api_port.dart';
import '../api/request_ids.dart';

/// [BuddyPort] 的远端实现（`/api/v1/buddy/*`，契约 §6.1）。
///
/// 所有 `POST` 都带 `Idempotency-Key`（契约 §11.3：POST **必需**）。
/// 五个领域动作名（`join` / `leave` / `close` / `decide` / `feedback`）
/// 已登记在契约 §11.2，本端不自创路由。
final class RemoteBuddyRepository implements BuddyPort {
  const RemoteBuddyRepository(this._api);

  static const String _items = 'buddy/items';
  static const String _profile = 'buddy/profile';

  final KedayaApiPort _api;

  // ------------------------------------------------------------ 匹配资料

  @override
  Future<Result<BuddyProfile>> getMyProfile() => _api.send<BuddyProfile>(
    const ApiRequest(path: _profile, method: ApiMethod.get),
    _decodeProfile,
  );

  @override
  Future<Result<BuddyProfile>> saveMyProfile(BuddyProfile profile) =>
      _api.send<BuddyProfile>(
        ApiRequest(
          path: _profile,
          method: ApiMethod.put,
          body: profile.toJson(),
        ),
        _decodeProfile,
      );

  @override
  Future<Result<Unit>> deleteMyProfile() => _api.sendVoid(
    const ApiRequest(path: _profile, method: ApiMethod.delete),
  );

  // ------------------------------------------------------------ 活动列表

  @override
  Future<Result<Page<BuddyPost>>> listPosts(BuddyPostQuery query) =>
      _api.send<Page<BuddyPost>>(
        ApiRequest(path: _items, method: ApiMethod.get, query: query.toQuery()),
        (Object? data) => Page<BuddyPost>.fromJson(
          requireJsonMap(data, what: 'buddy list'),
          BuddyPost.fromJson,
        ),
      );

  @override
  Future<Result<BuddyPost>> getPost(String id) => _api.send<BuddyPost>(
    ApiRequest(path: '$_items/$id', method: ApiMethod.get),
    _decodePost,
  );

  @override
  Future<Result<BuddyPost>> createPost(CreateBuddyPostCommand command) =>
      _api.send<BuddyPost>(
        ApiRequest(
          path: _items,
          method: ApiMethod.post,
          body: command.toJson(),
          idempotencyKey: newIdempotencyKey(),
        ),
        _decodePost,
      );

  @override
  Future<Result<BuddyPost>> closePost(String postId) => _api.send<BuddyPost>(
    ApiRequest(
      path: '$_items/$postId/close',
      method: ApiMethod.post,
      idempotencyKey: newIdempotencyKey(),
    ),
    _decodePost,
  );

  // ------------------------------------------------------------ 申请与审批

  @override
  Future<Result<BuddyApplication>> join(BuddyJoinCommand command) =>
      _api.send<BuddyApplication>(
        ApiRequest(
          path: '$_items/${command.postId}/join',
          method: ApiMethod.post,
          body: command.toJson(),
          idempotencyKey: newIdempotencyKey(),
        ),
        _decodeApplication,
      );

  @override
  Future<Result<BuddyApplication>> leave(String postId) =>
      _api.send<BuddyApplication>(
        ApiRequest(
          path: '$_items/$postId/leave',
          method: ApiMethod.post,
          idempotencyKey: newIdempotencyKey(),
        ),
        _decodeApplication,
      );

  @override
  Future<Result<BuddyApplication>> decide(BuddyDecideCommand command) =>
      _api.send<BuddyApplication>(
        ApiRequest(
          path: '$_items/${command.postId}/decide',
          method: ApiMethod.post,
          body: command.toJson(),
          idempotencyKey: newIdempotencyKey(),
        ),
        _decodeApplication,
      );

  @override
  Future<Result<List<BuddyApplication>>> listApplications({String? postId}) =>
      _api.send<List<BuddyApplication>>(
        ApiRequest(
          path: 'buddy/applications',
          method: ApiMethod.get,
          query: <String, Object?>{
            if (postId != null && postId.isNotEmpty) 'postId': postId,
          },
        ),
        _decodeApplications,
      );

  // ------------------------------------------------------------ 推荐与反馈

  @override
  Future<Result<BuddyRecommendationPage>> recommend(BuddyRecommendQuery query) =>
      _api.send<BuddyRecommendationPage>(
        ApiRequest(
          path: 'buddy/recommendations',
          method: ApiMethod.get,
          query: query.toQuery(),
        ),
        (Object? data) => BuddyRecommendationPage.fromJson(
          requireJsonMap(data, what: 'buddy recommendations'),
        ),
      );

  @override
  Future<Result<BuddyMatchFeedback>> submitFeedback(BuddyMatchFeedback feedback) =>
      _api.send<BuddyMatchFeedback>(
        ApiRequest(
          path: '$_items/${feedback.targetPostId}/feedback',
          method: ApiMethod.post,
          // 规格 §5.8 的请求体只有 `{ section, action }`：
          // 反馈者由后端从 JWT 取，帖子 id 在**路径**里。
          body: <String, Object?>{
            'section': feedback.section.wire,
            'action': feedback.action.wire,
          },
          idempotencyKey: newIdempotencyKey(),
        ),
        (Object? data) {
          final Map<String, Object?> json = requireJsonMap(data, what: 'buddy feedback');
          // 后端只回 `{ action }`（规格 §5.8）：缺 `targetPostId` / `createdAt` 时
          // 用请求里的值补齐，避免整条解析失败。
          return BuddyMatchFeedback(
            userId: feedback.userId,
            targetPostId: json['targetPostId'] == null
                ? feedback.targetPostId
                : readStringOr(json, 'targetPostId', feedback.targetPostId),
            section: feedback.section,
            action: BuddyMatchFeedbackAction.tryFromWire(
                  readStringOr(json, 'action', feedback.action.wire),
                ) ??
                feedback.action,
            createdAt: readDateTimeOrNull(json, 'createdAt') ?? feedback.createdAt,
          );
        },
      );

  // ------------------------------------------------------------ 解码

  BuddyProfile _decodeProfile(Object? data) =>
      BuddyProfile.fromJson(requireJsonMap(data, what: 'buddy profile'));

  BuddyPost _decodePost(Object? data) =>
      BuddyPost.fromJson(requireJsonMap(data, what: 'buddy post'));

  BuddyApplication _decodeApplication(Object? data) =>
      BuddyApplication.fromJson(requireJsonMap(data, what: 'buddy application'));

  List<BuddyApplication> _decodeApplications(Object? data) {
    final Map<String, Object?> json = requireJsonMap(data, what: 'buddy applications');
    // 兼容裸数组与 `{ items: [...] }` 两种形状（`forum` 的经验：后端两种都用过）。
    final List<Object?> raw = json.containsKey('items')
        ? readListOrEmpty(json, 'items')
        : (json['applications'] is List<Object?>
              ? readListOrEmpty(json, 'applications')
              : <Object?>[json]);
    return raw
        .map(
          (Object? item) =>
              BuddyApplication.fromJson(requireJsonMap(item, what: 'buddy application')),
        )
        .toList(growable: false);
  }
}
