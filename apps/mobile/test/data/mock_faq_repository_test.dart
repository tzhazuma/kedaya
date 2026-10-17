import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/data/mock/mock_faq_repository.dart';
import 'package:kedaya/data/mock/mock_fixtures.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/faq.dart';
import 'package:kedaya/domain/models/page.dart';
import 'package:kedaya/domain/models/result.dart';

/// `MockFaqRepository` 的行为测试：分类、检索、**「有用」幂等**、工单。
void main() {
  MockFaqRepository repo({MockControls? controls}) => MockFaqRepository(
      controls: controls ?? MockControls(latency: Duration.zero));

  group('listCategories', () {
    test('返回 4 个分类，按 id 稳定排序', () async {
      final List<FaqCategory> categories =
          (await repo().listCategories()).unwrap;

      expect(
        categories.map((FaqCategory category) => category.id),
        <String>['fc-account', 'fc-module', 'fc-other', 'fc-privacy'],
      );
    });
  });

  group('listArticles：可见性 + 分类 + 搜索 + 分页', () {
    test('DRAFT 文章对普通用户不可见', () async {
      final Page<FaqArticle> page = (await repo().listArticles(
        const FaqQuery(limit: 50),
      ))
          .unwrap;

      expect(page.total, 7, reason: '8 篇 fixture 中有 1 篇是 DRAFT');
      expect(
        page.items.any((FaqArticle article) => article.id == 'fa-1008'),
        isFalse,
      );
    });

    test('按分类筛选', () async {
      final Page<FaqArticle> page = (await repo().listArticles(
        const FaqQuery(category: 'fc-account', limit: 50),
      ))
          .unwrap;

      expect(page.total, 3);
      expect(
        page.items
            .every((FaqArticle article) => article.category == 'fc-account'),
        isTrue,
      );
    });

    test('关键词检索命中问题 / 答案 / 标签', () async {
      final Page<FaqArticle> anon = (await repo().listArticles(
        const FaqQuery(keyword: '匿名', limit: 50),
      ))
          .unwrap;
      expect(anon.items.map((FaqArticle article) => article.id),
          <String>['fa-1004']);

      // 命中答案里的词。
      final Page<FaqArticle> binding = (await repo().listArticles(
        const FaqQuery(keyword: 'CAMPUS_BINDING_REQUIRED', limit: 50),
      ))
          .unwrap;
      expect(binding.items.map((FaqArticle article) => article.id),
          <String>['fa-1003']);

      // 命中标签。
      final Page<FaqArticle> ticketTag = (await repo().listArticles(
        const FaqQuery(keyword: '工单', limit: 50),
      ))
          .unwrap;
      expect(ticketTag.items.map((FaqArticle article) => article.id),
          <String>['fa-1006']);
    });

    test('搜索无结果 => 空页（不是错误）', () async {
      final Page<FaqArticle> page = (await repo().listArticles(
        const FaqQuery(keyword: 'zzz-不存在-zzz'),
      ))
          .unwrap;

      expect(page.items, isEmpty);
      expect(page.total, 0);
    });

    test('游标分页：limit=3 分三页', () async {
      final MockFaqRepository repository = repo();

      final Page<FaqArticle> first = (await repository.listArticles(
        const FaqQuery(limit: 3),
      ))
          .unwrap;
      expect(first.items, hasLength(3));
      expect(first.nextCursor, '3');

      final Page<FaqArticle> second = (await repository.listArticles(
        FaqQuery(cursor: first.nextCursor, limit: 3),
      ))
          .unwrap;
      expect(second.items, hasLength(3));
      expect(second.nextCursor, '6');

      final Page<FaqArticle> third = (await repository.listArticles(
        FaqQuery(cursor: second.nextCursor, limit: 3),
      ))
          .unwrap;
      expect(third.items, hasLength(1));
      expect(third.nextCursor, isNull);
    });
  });

  group('markHelpful：**幂等**（同一用户重复点只算一次）', () {
    test('第一次计入，第二次同一 voter 只返回 counted=false 且计数不变', () async {
      final MockFaqRepository repository = repo();
      final int before = repository
          .snapshotArticles()
          .firstWhere((FaqArticle article) => article.id == 'fa-1001')
          .helpfulCount;

      final FaqHelpfulResult first = (await repository.markHelpful(
        'fa-1001',
        voterId: 'u:u-1001',
      ))
          .unwrap;
      expect(first.counted, isTrue);
      expect(first.helpfulCount, before + 1);
      expect(first.alreadyVoted, isFalse);

      final FaqHelpfulResult second = (await repository.markHelpful(
        'fa-1001',
        voterId: 'u:u-1001',
      ))
          .unwrap;
      expect(second.counted, isFalse, reason: '重复点击是幂等命中，不是失败');
      expect(second.alreadyVoted, isTrue);
      expect(second.helpfulCount, before + 1, reason: '计数不得再涨');
      expect(repository.helpfulVoterCountFor('fa-1001'), 1);
    });

    test('不同 voter 各计一次', () async {
      final MockFaqRepository repository = repo();

      await repository.markHelpful('fa-1005', voterId: 'u:u-1001');
      await repository.markHelpful('fa-1005', voterId: 'u:u-1002');
      await repository.markHelpful('fa-1005', voterId: 'd:dev-abc');
      await repository.markHelpful('fa-1005', voterId: 'd:dev-abc');

      expect(repository.helpfulVoterCountFor('fa-1005'), 3);
      final FaqArticle article = repository
          .snapshotArticles()
          .firstWhere((FaqArticle item) => item.id == 'fa-1005');
      expect(article.helpfulCount, 11 + 3, reason: 'fixture 里是 11');
    });

    test('未登录的设备票与实名票分开计', () async {
      final MockFaqRepository repository = repo();

      final FaqHelpfulResult device = (await repository.markHelpful(
        'fa-1002',
        voterId: FaqVoter.resolve(userId: null, deviceId: 'dev-abc').key,
      ))
          .unwrap;
      final FaqHelpfulResult user = (await repository.markHelpful(
        'fa-1002',
        voterId: FaqVoter.resolve(userId: 'u-1001', deviceId: 'dev-abc').key,
      ))
          .unwrap;

      expect(device.counted, isTrue);
      expect(user.counted, isTrue);
      expect(repository.helpfulVoterCountFor('fa-1002'), 2);
    });

    test('不存在的文章 => NOT_FOUND；空 voterId => VALIDATION_FAILED', () async {
      final MockFaqRepository repository = repo();

      expect(
        (await repository.markHelpful('fa-nope', voterId: 'u:u-1'))
            .errorOrNull!
            .code,
        ApiErrorCode.notFound,
      );
      expect(
        (await repository.markHelpful('fa-1001', voterId: '   '))
            .errorOrNull!
            .code,
        ApiErrorCode.validationFailed,
      );
    });
  });

  group('listMyTickets', () {
    test('只返回当前用户的工单，按时间倒序', () async {
      final Page<FaqTicket> page = (await repo().listMyTickets()).unwrap;

      expect(
        page.items.map((FaqTicket ticket) => ticket.id),
        <String>['ft-3002', 'ft-3001', 'ft-3003'],
      );
      expect(
        page.items
            .every((FaqTicket ticket) => ticket.userId == mockUser.userId),
        isTrue,
      );
    });

    test('别人的工单（含未登录工单）不出现在"我的工单"里', () async {
      final MockFaqRepository repository = MockFaqRepository(
        tickets: <FaqTicket>[
          FaqTicket(
            id: 'ft-mine',
            userId: mockUser.userId,
            contact: 'a@b.c',
            question: '我的',
            createdAt: DateTime.utc(2026, 10, 16, 12),
          ),
          FaqTicket(
            id: 'ft-other',
            userId: 'u-2002',
            contact: 'x@y.z',
            question: '别人的',
            createdAt: DateTime.utc(2026, 10, 16, 13),
          ),
          FaqTicket(
            id: 'ft-anon',
            contact: 'wechat: nobody',
            question: '未登录提交的',
            createdAt: DateTime.utc(2026, 10, 16, 14),
          ),
        ],
        controls: MockControls(latency: Duration.zero),
      );

      final Page<FaqTicket> page = (await repository.listMyTickets()).unwrap;

      expect(
          page.items.map((FaqTicket ticket) => ticket.id), <String>['ft-mine']);
    });

    test('游标分页', () async {
      final Page<FaqTicket> first =
          (await repo().listMyTickets(limit: 2)).unwrap;

      expect(first.items, hasLength(2));
      expect(first.nextCursor, '2');
      expect(first.total, 3);

      final Page<FaqTicket> second = (await repo().listMyTickets(
        cursor: first.nextCursor,
        limit: 2,
      ))
          .unwrap;
      expect(second.items, hasLength(1));
      expect(second.nextCursor, isNull);
    });
  });

  group('submitTicket', () {
    test('手机号被拒绝（契约 §2.8：不存明文手机号）', () async {
      final Result<FaqTicket> result = await repo().submitTicket(
        const SubmitFaqTicketCommand(contact: '13800138000', question: '问题'),
      );

      expect(result.errorOrNull!.code, ApiErrorCode.validationFailed);
      expect(result.errorOrNull!.userMessage, contains('手机号'));
    });

    test('空问题被拒绝', () async {
      final Result<FaqTicket> result = await repo().submitTicket(
        const SubmitFaqTicketCommand(contact: 'a@b.c', question: '   '),
      );

      expect(result.errorOrNull!.code, ApiErrorCode.validationFailed);
    });

    test('合法提交：状态 OPEN、归属当前用户，并出现在"我的工单"里', () async {
      final MockFaqRepository repository = repo();

      final FaqTicket created = (await repository.submitTicket(
        const SubmitFaqTicketCommand(
          contact: '  test@shanghaitech.edu.cn ',
          question: '  一个新问题  ',
        ),
      ))
          .unwrap;

      expect(created.status, FaqTicketStatus.open);
      expect(created.userId, mockUser.userId);
      expect(created.contact, 'test@shanghaitech.edu.cn', reason: '提交时去空白');
      expect(created.question, '一个新问题');

      final Page<FaqTicket> page =
          (await repository.listMyTickets(limit: 50)).unwrap;
      expect(page.total, 4);
      expect(page.items.first.id, created.id, reason: '最新的排最前');
    });
  });

  group('故障与空结果注入', () {
    test('上游故障 => UPSTREAM_UNAVAILABLE', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..failureMode = MockFailureMode.upstreamUnavailable;
      final MockFaqRepository repository = repo(controls: controls);

      expect(
        (await repository.listArticles(const FaqQuery())).errorOrNull!.code,
        ApiErrorCode.upstreamUnavailable,
      );
      expect(
        (await repository.markHelpful('fa-1001', voterId: 'u:u-1'))
            .errorOrNull!
            .code,
        ApiErrorCode.upstreamUnavailable,
      );
      expect(
        (await repository.listMyTickets()).errorOrNull!.code,
        ApiErrorCode.upstreamUnavailable,
      );
    });

    test('空结果开关 => 空列表（不是错误）', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..emptyResults = true;
      final MockFaqRepository repository = repo(controls: controls);

      expect((await repository.listArticles(const FaqQuery())).unwrap.items,
          isEmpty);
      expect((await repository.listMyTickets()).unwrap.items, isEmpty);
    });
  });
}
