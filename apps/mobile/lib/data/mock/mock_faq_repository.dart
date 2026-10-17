import '../../domain/models/api_error.dart';
import '../../domain/models/api_request.dart';
import '../../domain/models/faq.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/faq_port.dart';
import 'forum_faq_fixtures.dart';
import 'mock_controls.dart';
import 'mock_fixtures.dart';

/// [FaqPort] 的内存实现 —— 让常见问题在**无后端**时可跑（契约 §7 硬规则 4）。
///
/// 重点实现两件契约要求的行为，而不是返回假数据：
/// ① 分类 + 关键词检索（且**草稿文章不可见**）；
/// ② 「有用」按钮的**幂等**：同一个 [FaqPort.markHelpful] 的 `voterId`
///    重复调用只计一次，第二次返回 `counted == false`。
final class MockFaqRepository implements FaqPort {
  MockFaqRepository({
    List<FaqCategory>? categories,
    List<FaqArticle>? articles,
    List<FaqTicket>? tickets,
    MockControls? controls,
  })  : _categories = <String, FaqCategory>{
          for (final FaqCategory category in categories ?? mockFaqCategories)
            category.id: category,
        },
        _articles = <String, FaqArticle>{
          for (final FaqArticle article in articles ?? mockFaqArticles)
            article.id: article,
        },
        _tickets = <FaqTicket>[...(tickets ?? mockFaqTickets)],
        controls = controls ?? MockControls();

  final Map<String, FaqCategory> _categories;
  final Map<String, FaqArticle> _articles;
  final List<FaqTicket> _tickets;

  /// articleId -> 已投过「有用」的 voterId 集合（幂等的真相来源）。
  final Map<String, Set<String>> _helpfulVoters = <String, Set<String>>{};

  /// 可在运行时切换延迟与故障（UI 三态演示 / 测试注入）。
  final MockControls controls;

  int _ticketSequence = 3100;

  /// 供测试断言内部状态。
  List<FaqArticle> snapshotArticles() =>
      List<FaqArticle>.unmodifiable(_articles.values);

  List<FaqTicket> snapshotTickets() => List<FaqTicket>.unmodifiable(_tickets);

  /// 某篇文章「有用」的**去重后**投票人数（用于断言幂等）。
  int helpfulVoterCountFor(String articleId) =>
      _helpfulVoters[articleId]?.length ?? 0;

  @override
  Future<Result<List<FaqCategory>>> listCategories() async {
    await controls.simulate();
    if (controls.failure != null)
      return controls.failureResult<List<FaqCategory>>();
    final List<FaqCategory> all = _categories.values.toList(growable: false);
    all.sort((FaqCategory a, FaqCategory b) => a.id.compareTo(b.id));
    return Ok<List<FaqCategory>>(all);
  }

  @override
  Future<Result<Page<FaqArticle>>> listArticles(FaqQuery query) async {
    await controls.simulate();
    if (controls.failure != null)
      return controls.failureResult<Page<FaqArticle>>();
    if (controls.emptyResults) {
      return Ok<Page<FaqArticle>>(
          const Page<FaqArticle>(items: <FaqArticle>[], total: 0));
    }

    Iterable<FaqArticle> candidates = _articles.values.where(
      (FaqArticle article) => article.isPublished,
    );
    final String? category = query.category;
    if (category != null && category.isNotEmpty) {
      candidates = candidates
          .where((FaqArticle article) => article.category == category);
    }
    final String keyword = (query.keyword ?? '').trim();
    if (keyword.isNotEmpty) {
      candidates =
          candidates.where((FaqArticle article) => article.matches(keyword));
    }

    final List<FaqArticle> all = candidates.toList(growable: false);
    all.sort((FaqArticle a, FaqArticle b) => a.id.compareTo(b.id));

    final int start = _parseCursor(query.cursor);
    final int limit = _clampLimit(query.limit);
    final List<FaqArticle> window =
        all.skip(start).take(limit).toList(growable: false);
    final int consumed = start + window.length;
    return Ok<Page<FaqArticle>>(
      Page<FaqArticle>(
        items: window,
        nextCursor: consumed < all.length ? '$consumed' : null,
        total: all.length,
      ),
    );
  }

  @override
  Future<Result<FaqHelpfulResult>> markHelpful(
    String articleId, {
    required String voterId,
  }) async {
    await controls.simulate();
    if (controls.failure != null)
      return controls.failureResult<FaqHelpfulResult>();

    final FaqArticle? article = _articles[articleId];
    if (article == null) {
      return Err<FaqHelpfulResult>(
        const ApiError(code: ApiErrorCode.notFound, message: '该问题不存在'),
        traceId: MockControls.traceId,
      );
    }
    if (voterId.trim().isEmpty) {
      return Err<FaqHelpfulResult>(
        const ApiError(code: ApiErrorCode.validationFailed, message: '缺少投票者标识'),
        traceId: MockControls.traceId,
      );
    }

    final Set<String> voters = _helpfulVoters.putIfAbsent(
      articleId,
      () => <String>{},
    );
    // 幂等：已经投过 → 计数不变，返回 counted=false（不是失败）。
    if (voters.contains(voterId)) {
      return Ok<FaqHelpfulResult>(
        FaqHelpfulResult(
          articleId: articleId,
          helpfulCount: article.helpfulCount,
          counted: false,
        ),
      );
    }
    voters.add(voterId);
    final FaqArticle updated =
        article.copyWith(helpfulCount: article.helpfulCount + 1);
    _articles[articleId] = updated;
    return Ok<FaqHelpfulResult>(
      FaqHelpfulResult(
        articleId: articleId,
        helpfulCount: updated.helpfulCount,
        counted: true,
      ),
    );
  }

  @override
  Future<Result<Page<FaqTicket>>> listMyTickets(
      {String? cursor, int limit = defaultPageSize}) async {
    await controls.simulate();
    if (controls.failure != null)
      return controls.failureResult<Page<FaqTicket>>();
    if (controls.emptyResults) {
      return Ok<Page<FaqTicket>>(
          const Page<FaqTicket>(items: <FaqTicket>[], total: 0));
    }

    final List<FaqTicket> all = _tickets
        .where((FaqTicket ticket) => ticket.userId == mockUser.userId)
        .toList(growable: false);
    all.sort((FaqTicket a, FaqTicket b) => b.createdAt.compareTo(a.createdAt));

    final int start = _parseCursor(cursor);
    final int effectiveLimit = _clampLimit(limit);
    final List<FaqTicket> window =
        all.skip(start).take(effectiveLimit).toList(growable: false);
    final int consumed = start + window.length;
    return Ok<Page<FaqTicket>>(
      Page<FaqTicket>(
        items: window,
        nextCursor: consumed < all.length ? '$consumed' : null,
        total: all.length,
      ),
    );
  }

  @override
  Future<Result<FaqTicket>> submitTicket(SubmitFaqTicketCommand command) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<FaqTicket>();

    final String? contactError = faqTicketContactError(command.contact);
    if (contactError != null) {
      return Err<FaqTicket>(
        ApiError(code: ApiErrorCode.validationFailed, message: contactError),
        traceId: MockControls.traceId,
      );
    }
    final String? questionError = faqTicketQuestionError(command.question);
    if (questionError != null) {
      return Err<FaqTicket>(
        ApiError(code: ApiErrorCode.validationFailed, message: questionError),
        traceId: MockControls.traceId,
      );
    }

    final FaqTicket created = FaqTicket(
      id: 'ft-${_ticketSequence++}',
      userId: mockUser.userId,
      contact: command.contact.trim(),
      question: command.question.trim(),
      status: FaqTicketStatus.open,
      createdAt: mockNow,
    );
    _tickets.add(created);
    return Ok<FaqTicket>(created);
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
}
