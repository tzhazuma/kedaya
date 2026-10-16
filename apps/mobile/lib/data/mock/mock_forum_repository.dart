import '../../domain/models/anonymous_identity.dart';
import '../../domain/models/api_error.dart';
import '../../domain/models/api_request.dart';
import '../../domain/models/forum.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/forum_port.dart';
import 'forum_faq_fixtures.dart';
import 'mock_controls.dart';
import 'mock_fixtures.dart';

/// [ForumPort] 的内存实现 —— 让论坛在**无后端**时可跑（契约 §7 硬规则 4）。
///
/// 实现的是**真实行为**而不是假数据：游标分页、版块筛选、置顶排序、
/// 隐藏内容不可见、锁定禁止回复、匿名身份派生、举报去重与
/// 「3 个不同用户举报 → 自动隐藏」（契约 §2.4 治理规则）。
final class MockForumRepository implements ForumPort {
  MockForumRepository({
    List<ForumBoard>? boards,
    List<ForumPost>? posts,
    Map<String, List<ForumReply>>? replies,
    MockControls? controls,
  }) : _boards = <String, ForumBoard>{
         for (final ForumBoard board in boards ?? mockForumBoards) board.id: board,
       },
       _posts = <String, ForumPost>{
         for (final ForumPost post in posts ?? mockForumPosts) post.id: post,
       },
       _replies = <String, List<ForumReply>>{
         for (final MapEntry<String, List<ForumReply>> entry
             in (replies ?? mockForumReplies).entries)
           entry.key: <ForumReply>[...entry.value],
       },
       currentUserId = mockUser.userId,
       currentUserName = mockUser.displayNameOrId,
       controls = controls ?? MockControls();

  /// 契约 §2.4 治理规则：3 个**不同**用户举报 → 自动隐藏 + 进人工队列。
  static const int autoHideReportThreshold = 3;

  /// 当前登录用户 id。
  ///
  /// 真实实现里它来自 JWT（由服务端决定）；mock 里必须是**可变**的，
  /// 否则「3 个不同用户举报 → 自动隐藏」这条治理规则在测试里根本无法触发。
  String currentUserId;

  String currentUserName;

  final Map<String, ForumBoard> _boards;
  final Map<String, ForumPost> _posts;
  final Map<String, List<ForumReply>> _replies;
  final List<ForumReport> _reports = <ForumReport>[];

  /// 举报去重：targetId -> 已举报过的举报人 key 集合。
  final Map<String, Set<String>> _reportersByTarget = <String, Set<String>>{};

  /// 匿名身份的序号分配表：boardId -> 下一个序号。
  final Map<String, int> _anonymousSequences = <String, int>{};

  /// 该用户在每个版块的匿名身份缓存（保证同一版块内匿名身份稳定）。
  final Map<String, AnonymousIdentity> _anonymousByBoard = <String, AnonymousIdentity>{};

  /// 可在运行时切换延迟与故障（UI 三态演示 / 测试注入）。
  final MockControls controls;

  int _postSequence = 1100;
  int _replySequence = 2100;
  int _reportSequence = 4000;

  /// 供测试断言内部状态。
  List<ForumPost> snapshotPosts() => _sortedPosts(_visible(_posts.values));

  List<ForumReport> snapshotReports() => List<ForumReport>.unmodifiable(_reports);

  int reportCountFor(String targetId) => _reportersByTarget[targetId]?.length ?? 0;

  @override
  Future<Result<List<ForumBoard>>> listBoards() async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<List<ForumBoard>>();
    final List<ForumBoard> all = _boards.values.toList(growable: false);
    all.sort((ForumBoard a, ForumBoard b) => a.id.compareTo(b.id));
    return Ok<List<ForumBoard>>(all);
  }

  @override
  Future<Result<Page<ForumPost>>> listPosts(ForumPostQuery query) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<Page<ForumPost>>();
    if (controls.emptyResults) {
      return Ok<Page<ForumPost>>(const Page<ForumPost>(items: <ForumPost>[], total: 0));
    }

    Iterable<ForumPost> candidates = _visible(_posts.values);
    final String? boardId = query.boardId;
    if (boardId != null && boardId.isNotEmpty) {
      candidates = candidates.where((ForumPost post) => post.boardId == boardId);
    }
    final String keyword = (query.keyword ?? '').trim().toLowerCase();
    if (keyword.isNotEmpty) {
      candidates = candidates.where(
        (ForumPost post) =>
            post.title.toLowerCase().contains(keyword) ||
            post.body.toLowerCase().contains(keyword),
      );
    }

    final List<ForumPost> all = _sortedPosts(candidates);
    final int start = _parseCursor(query.cursor);
    final int limit = _clampLimit(query.limit);
    final List<ForumPost> window = all.skip(start).take(limit).toList(growable: false);
    final int consumed = start + window.length;
    return Ok<Page<ForumPost>>(
      Page<ForumPost>(
        items: window,
        nextCursor: consumed < all.length ? '$consumed' : null,
        total: all.length,
      ),
    );
  }

  @override
  Future<Result<ForumPost>> getPost(String id) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<ForumPost>();
    final ForumPost? post = _posts[id];
    // 隐藏/已删除/草稿对普通用户等同"不存在"（不泄露"这条内容存在但被隐藏了"）。
    if (post == null || !post.isVisible) return _notFoundPost();
    return Ok<ForumPost>(post);
  }

  @override
  Future<Result<Page<ForumReply>>> listReplies(ForumReplyQuery query) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<Page<ForumReply>>();
    final ForumPost? post = _posts[query.postId];
    if (post == null || !post.isVisible) {
      return Err<Page<ForumReply>>(
        const ApiError(code: ApiErrorCode.notFound, message: '该主题不存在或已被隐藏'),
        traceId: MockControls.traceId,
      );
    }
    if (controls.emptyResults) {
      return Ok<Page<ForumReply>>(const Page<ForumReply>(items: <ForumReply>[], total: 0));
    }

    final List<ForumReply> all = <ForumReply>[
      ...(_replies[query.postId] ?? const <ForumReply>[]),
    ]..removeWhere((ForumReply reply) => reply.status == ForumReplyStatus.deleted);
    all.sort((ForumReply a, ForumReply b) => a.createdAt.compareTo(b.createdAt));

    final int start = _parseCursor(query.cursor);
    final int limit = _clampLimit(query.limit);
    final List<ForumReply> window = all.skip(start).take(limit).toList(growable: false);
    final int consumed = start + window.length;
    return Ok<Page<ForumReply>>(
      Page<ForumReply>(
        items: window,
        nextCursor: consumed < all.length ? '$consumed' : null,
        total: all.length,
      ),
    );
  }

  @override
  Future<Result<ForumPost>> createPost(CreateForumPostCommand command) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<ForumPost>();

    final String title = command.title.trim();
    final String body = command.body.trim();
    if (title.isEmpty) {
      return _validation<ForumPost>('标题不能为空');
    }
    if (title.runes.length > ForumPostDraft.titleMaxLength) {
      return _validation<ForumPost>('标题请控制在 ${ForumPostDraft.titleMaxLength} 字以内');
    }
    if (body.isEmpty) {
      return _validation<ForumPost>('正文不能为空');
    }
    if (body.runes.length > ForumPostDraft.bodyMaxLength) {
      return _validation<ForumPost>('正文请控制在 ${ForumPostDraft.bodyMaxLength} 字以内');
    }
    final ForumBoard? board = _boards[command.boardId];
    if (board == null) {
      return Err<ForumPost>(
        const ApiError(code: ApiErrorCode.notFound, message: '该版块不存在'),
        traceId: MockControls.traceId,
      );
    }

    // 契约 §9：匿名与否在**模型层面**就分叉 —— 匿名时作者是 AnonymousAuthor，
    // 实名时是 RealAuthor。二者不可能互相赋值，因此不可能"匿名却带着 userId"。
    final ForumAuthor author = command.anonymous
        ? AnonymousAuthor(_anonymousFor(board.id))
        : RealAuthor(userId: currentUserId, name: currentUserName);

    final ForumPost created = ForumPost(
      id: 'fp-${_postSequence++}',
      boardId: board.id,
      boardName: board.name,
      title: title,
      body: body,
      author: author,
      status: ForumPostStatus.published,
      tags: command.tags.take(ForumPostDraft.tagMaxCount).toList(growable: false),
      replyCount: 0,
      likeCount: 0,
      createdAt: mockNow,
      updatedAt: mockNow,
    );
    _posts[created.id] = created;
    return Ok<ForumPost>(created);
  }

  @override
  Future<Result<ForumReply>> createReply(CreateForumReplyCommand command) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<ForumReply>();

    final ForumPost? post = _posts[command.postId];
    if (post == null || !post.isVisible) {
      return Err<ForumReply>(
        const ApiError(code: ApiErrorCode.notFound, message: '该主题不存在或已被隐藏'),
        traceId: MockControls.traceId,
      );
    }
    final String body = command.body.trim();
    if (body.isEmpty) {
      return _validation<ForumReply>('回复内容不能为空');
    }
    if (body.runes.length > ForumReplyDraft.bodyMaxLength) {
      return _validation<ForumReply>('回复请控制在 ${ForumReplyDraft.bodyMaxLength} 字以内');
    }
    // 契约 §2.4 状态机：LOCKED 禁止新回复。
    if (!post.canReply) {
      return Err<ForumReply>(
        ApiError(
          code: ApiErrorCode.conflict,
          message: '该主题当前状态为「${post.status.label}」，暂不能回复',
        ),
        traceId: MockControls.traceId,
      );
    }

    final ForumAuthor author = command.anonymous
        ? AnonymousAuthor(_anonymousFor(post.boardId))
        : RealAuthor(userId: currentUserId, name: currentUserName);

    final ForumReply created = ForumReply(
      id: 'fr-${_replySequence++}',
      postId: post.id,
      body: body,
      author: author,
      status: ForumReplyStatus.published,
      parentReplyId: command.parentReplyId,
      createdAt: mockNow,
    );
    _replies.putIfAbsent(post.id, () => <ForumReply>[]).add(created);
    _posts[post.id] = post.copyWith(
      replyCount: post.replyCount + 1,
      updatedAt: mockNow,
    );
    return Ok<ForumReply>(created);
  }

  @override
  Future<Result<ForumReport>> report(CreateForumReportCommand command) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<ForumReport>();

    final bool targetExists = switch (command.targetType) {
      ForumReportTargetType.post => _posts.containsKey(command.targetId),
      ForumReportTargetType.reply => _replies.values.any(
        (List<ForumReply> list) =>
            list.any((ForumReply reply) => reply.id == command.targetId),
      ),
    };
    if (!targetExists) {
      return Err<ForumReport>(
        const ApiError(code: ApiErrorCode.notFound, message: '被举报的内容不存在'),
        traceId: MockControls.traceId,
      );
    }

    final ForumPost? targetPost = command.targetType == ForumReportTargetType.post
        ? _posts[command.targetId]
        : null;
    final String boardId = targetPost?.boardId ?? _boardIdOfReply(command.targetId) ?? '';

    final ForumAuthor reporter = command.anonymous
        ? AnonymousAuthor(_anonymousFor(boardId))
        : RealAuthor(userId: currentUserId, name: currentUserName);

    final Set<String> reporters = _reportersByTarget.putIfAbsent(
      command.targetId,
      () => <String>{},
    );
    if (reporters.contains(reporter.authorId)) {
      return Err<ForumReport>(
        const ApiError(code: ApiErrorCode.conflict, message: '你已经举报过这条内容了'),
        traceId: MockControls.traceId,
      );
    }
    reporters.add(reporter.authorId);

    final ForumReport created = ForumReport(
      id: 'frp-${_reportSequence++}',
      targetType: command.targetType,
      targetId: command.targetId,
      reason: command.reason,
      reporter: reporter,
      status: ForumReportStatus.pending,
      detail: command.detail,
      createdAt: mockNow,
    );
    _reports.add(created);

    // 契约 §2.4：3 个不同用户举报 → 自动隐藏。
    if (targetPost != null && reporters.length >= autoHideReportThreshold) {
      _posts[targetPost.id] = targetPost.copyWith(status: ForumPostStatus.hidden);
    }
    return Ok<ForumReport>(created);
  }

  /// 该用户在该版块的匿名身份（稳定：同一版块重复调用得到同一个身份）。
  AnonymousIdentity _anonymousFor(String boardId) {
    // 缓存键含 userId：换了用户就得到另一个匿名身份（不同人不能被认成同一个匿名鸭）。
    final String cacheKey = '$currentUserId::$boardId';
    final AnonymousIdentity? cached = _anonymousByBoard[cacheKey];
    if (cached != null) return cached;
    final int sequence = _anonymousSequences[boardId] ?? 1;
    _anonymousSequences[boardId] = sequence + 1;
    final AnonymousIdentity identity = AnonymousIdentity.derive(
      boardId: boardId,
      sequence: sequence,
    );
    _anonymousByBoard[cacheKey] = identity;
    return identity;
  }

  String? _boardIdOfReply(String replyId) {
    for (final MapEntry<String, List<ForumReply>> entry in _replies.entries) {
      for (final ForumReply reply in entry.value) {
        if (reply.id == replyId) return _posts[entry.key]?.boardId;
      }
    }
    return null;
  }

  Iterable<ForumPost> _visible(Iterable<ForumPost> posts) =>
      posts.where((ForumPost post) => post.isVisible);

  /// 置顶优先，其余按创建时间倒序（与后端默认排序一致）。
  List<ForumPost> _sortedPosts(Iterable<ForumPost> posts) {
    final List<ForumPost> all = posts.toList(growable: false);
    all.sort((ForumPost a, ForumPost b) {
      if (a.isPinned != b.isPinned) return a.isPinned ? -1 : 1;
      return b.createdAt.compareTo(a.createdAt);
    });
    return all;
  }

  int _clampLimit(int limit) {
    if (limit < 1) return 1;
    return limit > maxPageSize ? maxPageSize : limit;
  }

  int _parseCursor(String? cursor) {
    if (cursor == null || cursor.isEmpty) return 0;
    final int? parsed = int.tryParse(cursor);
    if (parsed == null || parsed < 0) return 0;
    return parsed;
  }

  Err<T> _validation<T>(String message) => Err<T>(
    ApiError(code: ApiErrorCode.validationFailed, message: message),
    traceId: MockControls.traceId,
  );

  Err<T> _notFoundPost<T>() => Err<T>(
    const ApiError(code: ApiErrorCode.notFound, message: '该主题不存在或已被隐藏'),
    traceId: MockControls.traceId,
  );
}
