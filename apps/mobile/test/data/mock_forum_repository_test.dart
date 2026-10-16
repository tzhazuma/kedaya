import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/data/mock/mock_forum_repository.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/forum.dart';
import 'package:kedaya/domain/models/page.dart';
import 'package:kedaya/domain/models/result.dart';

/// `MockForumRepository` 的行为测试：分页、筛选、可见性、匿名、举报治理。
void main() {
  MockForumRepository repo({MockControls? controls}) =>
      MockForumRepository(controls: controls ?? MockControls(latency: Duration.zero));

  group('listBoards', () {
    test('返回 4 个版块，按 id 稳定排序，含 campus_only 可见性', () async {
      final Result<List<ForumBoard>> result = await repo().listBoards();
      final List<ForumBoard> boards = result.unwrap;

      expect(boards, hasLength(4));
      expect(
        boards.map((ForumBoard board) => board.id),
        <String>['fb-campus', 'fb-club', 'fb-study', 'fb-voice'],
      );
      expect(boards.last.requiresSignIn, isTrue, reason: 'fb-voice 是 campus_only');
      expect(boards.first.requiresSignIn, isFalse);
    });
  });

  group('listPosts：游标分页 + 可见性 + 排序', () {
    test('隐藏（HIDDEN）主题不出现在列表里', () async {
      final Result<Page<ForumPost>> result = await repo().listPosts(
        const ForumPostQuery(limit: 50),
      );
      final Page<ForumPost> page = result.unwrap;

      expect(page.total, 6, reason: '7 条 fixture 中有 1 条是 HIDDEN');
      expect(
        page.items.any((ForumPost post) => post.id == 'fp-1007'),
        isFalse,
      );
    });

    test('置顶优先，其余按创建时间倒序', () async {
      final Page<ForumPost> page = await repo()
          .listPosts(const ForumPostQuery(limit: 50))
          .then((Result<Page<ForumPost>> r) => r.unwrap);

      expect(
        page.items.map((ForumPost post) => post.id),
        <String>['fp-1001', 'fp-1004', 'fp-1003', 'fp-1002', 'fp-1005', 'fp-1006'],
      );
      expect(page.items.first.isPinned, isTrue);
    });

    test('游标分页：limit=4 分两页，第二页到末尾', () async {
      final MockForumRepository repository = repo();

      final Page<ForumPost> first = (await repository.listPosts(
        const ForumPostQuery(limit: 4),
      )).unwrap;
      expect(first.items, hasLength(4));
      expect(first.nextCursor, '4');
      expect(first.total, 6);

      final Page<ForumPost> second = (await repository.listPosts(
        ForumPostQuery(cursor: first.nextCursor, limit: 4),
      )).unwrap;
      expect(second.items, hasLength(2));
      expect(second.nextCursor, isNull);
    });

    test('按版块筛选', () async {
      final Page<ForumPost> page = (await repo().listPosts(
        const ForumPostQuery(boardId: 'fb-study', limit: 50),
      )).unwrap;

      expect(
        page.items.map((ForumPost post) => post.id),
        <String>['fp-1002', 'fp-1005'],
      );
    });

    test('关键词同时匹配标题与正文', () async {
      final Page<ForumPost> byTitle = (await repo().listPosts(
        const ForumPostQuery(keyword: '空调', limit: 50),
      )).unwrap;
      expect(byTitle.items.map((ForumPost post) => post.id), <String>['fp-1003']);

      final Page<ForumPost> byBody = (await repo().listPosts(
        const ForumPostQuery(keyword: '保温杯', limit: 50),
      )).unwrap;
      expect(byBody.items.map((ForumPost post) => post.id), <String>['fp-1004']);
    });
  });

  group('getPost / listReplies', () {
    test('隐藏的主题按"不存在"处理（不泄露"它存在但被隐藏了"）', () async {
      final Result<ForumPost> result = await repo().getPost('fp-1007');

      expect(result.isErr, isTrue);
      expect(result.errorOrNull!.code, ApiErrorCode.notFound);
    });

    test('回复按时间正序返回，二级回复带 parentReplyId', () async {
      final Page<ForumReply> page = (await repo().listReplies(
        const ForumReplyQuery(postId: 'fp-1002', limit: 50),
      )).unwrap;

      expect(page.items.map((ForumReply reply) => reply.id), <String>['fr-2003', 'fr-2004']);
      expect(page.items.last.parentReplyId, 'fr-2003');
    });

    test('不存在的主题取回复 => NOT_FOUND', () async {
      final Result<Page<ForumReply>> result = await repo().listReplies(
        const ForumReplyQuery(postId: 'fp-nope'),
      );

      expect(result.errorOrNull!.code, ApiErrorCode.notFound);
    });
  });

  group('createPost：校验 + 匿名身份派生', () {
    test('空标题 / 空正文 => VALIDATION_FAILED', () async {
      final MockForumRepository repository = repo();

      final Result<ForumPost> emptyTitle = await repository.createPost(
        const CreateForumPostCommand(boardId: 'fb-campus', title: '   ', body: '正文'),
      );
      expect(emptyTitle.errorOrNull!.code, ApiErrorCode.validationFailed);

      final Result<ForumPost> emptyBody = await repository.createPost(
        const CreateForumPostCommand(boardId: 'fb-campus', title: '标题', body: '  '),
      );
      expect(emptyBody.errorOrNull!.code, ApiErrorCode.validationFailed);
    });

    test('不存在的版块 => NOT_FOUND', () async {
      final Result<ForumPost> result = await repo().createPost(
        const CreateForumPostCommand(boardId: 'fb-nope', title: '标题', body: '正文'),
      );

      expect(result.errorOrNull!.code, ApiErrorCode.notFound);
    });

    test('实名发帖：author 是 RealAuthor，authorId 是当前用户', () async {
      final ForumPost post = (await repo().createPost(
        const CreateForumPostCommand(boardId: 'fb-campus', title: '标题', body: '正文'),
      )).unwrap;

      expect(post.anonymous, isFalse);
      expect(post.author, isA<RealAuthor>());
      expect(post.authorId, 'u-1001');
      expect(post.status, ForumPostStatus.published);
      expect(post.replyCount, 0);
    });

    test('匿名发帖：author 是 AnonymousAuthor，且**没有**实名出口', () async {
      final ForumPost post = (await repo().createPost(
        const CreateForumPostCommand(
          boardId: 'fb-campus',
          title: '匿名标题',
          body: '正文',
          anonymous: true,
        ),
      )).unwrap;

      expect(post.anonymous, isTrue);
      expect(post.author, isA<AnonymousAuthor>());
      expect(post.author.realUserIdOrNull, isNull);
      expect(post.authorId, startsWith('anon-fb-campus-'));
      expect(post.toJson().containsKey('authorId'), isFalse);
      expect(post.toJson().values.contains('u-1001'), isFalse);
    });

    test('同一用户在同一版块的匿名身份稳定（可被版主追溯）', () async {
      final MockForumRepository repository = repo();
      final ForumPost first = (await repository.createPost(
        const CreateForumPostCommand(
          boardId: 'fb-campus',
          title: 'a',
          body: 'b',
          anonymous: true,
        ),
      )).unwrap;
      final ForumPost second = (await repository.createPost(
        const CreateForumPostCommand(
          boardId: 'fb-campus',
          title: 'c',
          body: 'd',
          anonymous: true,
        ),
      )).unwrap;

      expect(second.authorId, first.authorId);

      // 换一个用户 + 换一个版块 => 匿名身份不同（跨人、跨版块都不可关联）。
      repository.currentUserId = 'u-9999';
      final ForumPost otherUser = (await repository.createPost(
        const CreateForumPostCommand(
          boardId: 'fb-campus',
          title: 'e',
          body: 'f',
          anonymous: true,
        ),
      )).unwrap;
      expect(otherUser.authorId, isNot(first.authorId));
    });
  });

  group('createReply', () {
    test('LOCKED 主题拒绝新回复 => CONFLICT（契约 §2.4 状态机）', () async {
      final Result<ForumReply> result = await repo().createReply(
        const CreateForumReplyCommand(postId: 'fp-1005', body: '想回复'),
      );

      expect(result.isErr, isTrue);
      expect(result.errorOrNull!.code, ApiErrorCode.conflict);
      expect(result.errorOrNull!.userMessage, contains('锁定'));
    });

    test('正常回复：追加到列表末尾并把 replyCount +1', () async {
      final MockForumRepository repository = repo();

      final ForumReply created = (await repository.createReply(
        const CreateForumReplyCommand(postId: 'fp-1001', body: '新回复'),
      )).unwrap;
      expect(created.postId, 'fp-1001');
      expect(created.anonymous, isFalse);

      final Page<ForumReply> page = (await repository.listReplies(
        const ForumReplyQuery(postId: 'fp-1001', limit: 50),
      )).unwrap;
      expect(page.items, hasLength(3));
      expect(page.items.last.body, '新回复');

      final ForumPost post = (await repository.getPost('fp-1001')).unwrap;
      expect(post.replyCount, 3);
    });

    test('匿名回复不带实名出口', () async {
      final ForumReply reply = (await repo().createReply(
        const CreateForumReplyCommand(postId: 'fp-1001', body: '匿名回复', anonymous: true),
      )).unwrap;

      expect(reply.anonymous, isTrue);
      expect(reply.author.realUserIdOrNull, isNull);
      expect(reply.toJson().containsKey('authorId'), isFalse);
    });

    test('空回复 => VALIDATION_FAILED', () async {
      final Result<ForumReply> result = await repo().createReply(
        const CreateForumReplyCommand(postId: 'fp-1001', body: '   '),
      );

      expect(result.errorOrNull!.code, ApiErrorCode.validationFailed);
    });
  });

  group('report：去重 + 阈值自动隐藏（契约 §2.4 治理规则）', () {
    test('同一用户重复举报同一条 => CONFLICT', () async {
      final MockForumRepository repository = repo();

      final Result<ForumReport> first = await repository.report(
        const CreateForumReportCommand(
          targetType: ForumReportTargetType.post,
          targetId: 'fp-1002',
          reason: ForumReportReason.spam,
        ),
      );
      expect(first.isOk, isTrue);

      final Result<ForumReport> second = await repository.report(
        const CreateForumReportCommand(
          targetType: ForumReportTargetType.post,
          targetId: 'fp-1002',
          reason: ForumReportReason.abuse,
        ),
      );
      expect(second.errorOrNull!.code, ApiErrorCode.conflict);
      expect(repository.reportCountFor('fp-1002'), 1);
    });

    test('3 个**不同**用户举报 => 自动隐藏，且之后列表/详情都取不到', () async {
      final MockForumRepository repository = repo();

      for (final String userId in <String>['u-a', 'u-b']) {
        repository.currentUserId = userId;
        final Result<ForumReport> result = await repository.report(
          const CreateForumReportCommand(
            targetType: ForumReportTargetType.post,
            targetId: 'fp-1002',
            reason: ForumReportReason.abuse,
          ),
        );
        expect(result.isOk, isTrue);
        // 阈值未达成前仍然可见。
        expect((await repository.getPost('fp-1002')).isOk, isTrue);
      }

      repository.currentUserId = 'u-c';
      await repository.report(
        const CreateForumReportCommand(
          targetType: ForumReportTargetType.post,
          targetId: 'fp-1002',
          reason: ForumReportReason.illegal,
        ),
      );

      expect(repository.reportCountFor('fp-1002'), 3);
      final Result<ForumPost> hidden = await repository.getPost('fp-1002');
      expect(hidden.errorOrNull!.code, ApiErrorCode.notFound);
      expect(repository.snapshotReports(), hasLength(3));

      final Page<ForumPost> page = (await repository.listPosts(
        const ForumPostQuery(limit: 50),
      )).unwrap;
      expect(page.items.any((ForumPost post) => post.id == 'fp-1002'), isFalse);
      expect(page.total, 5);
    });

    test('举报不存在的对象 => NOT_FOUND', () async {
      final Result<ForumReport> result = await repo().report(
        const CreateForumReportCommand(
          targetType: ForumReportTargetType.reply,
          targetId: 'fr-nope',
          reason: ForumReportReason.other,
        ),
      );

      expect(result.errorOrNull!.code, ApiErrorCode.notFound);
    });

    test('举报可以匿名，记录里不带实名信息', () async {
      final ForumReport report = (await repo().report(
        const CreateForumReportCommand(
          targetType: ForumReportTargetType.post,
          targetId: 'fp-1003',
          reason: ForumReportReason.privacy,
          anonymous: true,
        ),
      )).unwrap;

      expect(report.anonymous, isTrue);
      expect(report.reporter.realUserIdOrNull, isNull);
      expect(report.toJson().containsKey('authorId'), isFalse);
    });
  });

  group('故障与空结果注入（UI 三态演示的开关）', () {
    test('上游故障 => UPSTREAM_UNAVAILABLE', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..failureMode = MockFailureMode.upstreamUnavailable;
      final MockForumRepository repository = repo(controls: controls);

      expect(
        (await repository.listPosts(const ForumPostQuery())).errorOrNull!.code,
        ApiErrorCode.upstreamUnavailable,
      );
      expect(
        (await repository.listBoards()).errorOrNull!.code,
        ApiErrorCode.upstreamUnavailable,
      );
      expect(
        (await repository.getPost('fp-1001')).errorOrNull!.code,
        ApiErrorCode.upstreamUnavailable,
      );
    });

    test('空结果开关 => 空列表（不是错误）', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..emptyResults = true;
      final MockForumRepository repository = repo(controls: controls);

      final Page<ForumPost> page = (await repository.listPosts(
        const ForumPostQuery(),
      )).unwrap;
      expect(page.items, isEmpty);
      expect(page.total, 0);

      final Page<ForumReply> replies = (await repository.listReplies(
        const ForumReplyQuery(postId: 'fp-1001'),
      )).unwrap;
      expect(replies.items, isEmpty);
    });
  });
}
