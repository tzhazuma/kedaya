import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/data/mock/mock_faq_repository.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/faq.dart';
import 'package:kedaya/features/faq/application/faq_providers.dart';

/// FAQ application 层的测试。
///
/// `faqVoterProvider` 直接 override 成固定幂等键 —— 这样测试不依赖登录态，
/// 又完整覆盖了"同一用户重复点只算一次"。
void main() {
  const String voterId = 'u:u-1001';

  ProviderContainer containerWith(MockFaqRepository repository) {
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[
        faqRepositoryProvider.overrideWithValue(repository),
        faqVoterProvider.overrideWithValue(voterId),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  MockFaqRepository repo({MockControls? controls}) => MockFaqRepository(
      controls: controls ?? MockControls(latency: Duration.zero));

  /// 等到状态不再是 loading（依赖失效后的重建是异步的）。
  Future<FaqListState> settle(ProviderContainer container) async {
    for (int i = 0; i < 50; i++) {
      final AsyncValue<FaqListState> value =
          container.read(faqListControllerProvider);
      if (value.hasValue && !value.isLoading) return value.requireValue;
      await Future<void>.delayed(Duration.zero);
    }
    return container.read(faqListControllerProvider).requireValue;
  }

  group('三态', () {
    test('loading -> data：初态 loading，加载成功 7 篇（DRAFT 不计）', () async {
      final ProviderContainer container = containerWith(repo());

      expect(container.read(faqListControllerProvider).isLoading, isTrue);

      final FaqListState state =
          await container.read(faqListControllerProvider.future);

      expect(state.articles, hasLength(7));
      expect(state.isEmpty, isFalse);
      expect(state.total, 7);
    });

    test('empty：空结果时 isEmpty 为 true', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..emptyResults = true;
      final ProviderContainer container =
          containerWith(repo(controls: controls));

      final FaqListState state =
          await container.read(faqListControllerProvider.future);

      expect(state.isEmpty, isTrue);
    });

    test('error：上游故障抛出 ApiException', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..failureMode = MockFailureMode.upstreamUnavailable;
      final ProviderContainer container =
          containerWith(repo(controls: controls));

      await expectLater(
        container.read(faqListControllerProvider.future),
        throwsA(isA<ApiException>()),
      );
      expect(
        (container.read(faqListControllerProvider).error! as ApiException).code,
        ApiErrorCode.upstreamUnavailable,
      );
    });

    test('分类 provider 暴露 4 个分类', () async {
      final ProviderContainer container = containerWith(repo());

      expect(await container.read(faqCategoriesProvider.future), hasLength(4));
    });
  });

  group('分类 + 搜索筛选', () {
    test('分类筛选在首次加载时生效', () async {
      final ProviderContainer container = containerWith(repo());
      container.read(faqFilterProvider.notifier).selectCategory('fc-account');

      final FaqListState state =
          await container.read(faqListControllerProvider.future);

      expect(state.articles, hasLength(3));
      expect(
        state.articles
            .every((FaqArticle article) => article.category == 'fc-account'),
        isTrue,
      );
    });

    test('关键词搜索在首次加载时生效（防抖后只发一次请求的最终值）', () async {
      final ProviderContainer container = containerWith(repo());
      container.read(faqFilterProvider.notifier).setKeyword('匿名');

      final FaqListState state =
          await container.read(faqListControllerProvider.future);

      expect(state.articles.map((FaqArticle article) => article.id),
          <String>['fa-1004']);
    });

    test('切换筛选条件会重新加载；搜索无结果 => 空态而不是错误态', () async {
      final ProviderContainer container = containerWith(repo());

      expect((await container.read(faqListControllerProvider.future)).articles,
          hasLength(7));

      container.read(faqFilterProvider.notifier).setKeyword('zzz-不存在-zzz');
      final FaqListState noMatch = await settle(container);
      expect(noMatch.isEmpty, isTrue);
      expect(noMatch.articles, isEmpty);

      container.read(faqFilterProvider.notifier).clear();
      final FaqListState cleared = await settle(container);
      expect(cleared.articles, hasLength(7));
    });
  });

  group('「有用」幂等（端到端走 provider）', () {
    test('第一次 counted=true 且计数 +1；重复点击 counted=false 且计数不变', () async {
      final MockFaqRepository repository = repo();
      final ProviderContainer container = containerWith(repository);
      final FaqHelpfulActions actions = container.read(faqHelpfulProvider);

      final FaqHelpfulResult first = await actions.markHelpful('fa-1001');
      expect(first.counted, isTrue);
      expect(first.helpfulCount, 43, reason: 'fixture 里是 42');

      final FaqHelpfulResult second = await actions.markHelpful('fa-1001');
      expect(second.counted, isFalse);
      expect(second.alreadyVoted, isTrue);
      expect(second.helpfulCount, 43);
      expect(repository.helpfulVoterCountFor('fa-1001'), 1);
    });

    test('投票后写入局部覆盖，UI 据此显示"已标记有用"', () async {
      final ProviderContainer container = containerWith(repo());
      final FaqHelpfulActions actions = container.read(faqHelpfulProvider);

      expect(container.read(faqHelpfulOverridesProvider), isEmpty);

      await actions.markHelpful('fa-1005');

      final Map<String, int> overrides =
          container.read(faqHelpfulOverridesProvider);
      expect(overrides.containsKey('fa-1005'), isTrue);
      expect(overrides['fa-1005'], 12, reason: 'fixture 里是 11');
      expect(
          container
              .read(faqHelpfulOverridesProvider.notifier)
              .hasVoted('fa-1005'),
          isTrue);
      // 未投票的文章不受影响。
      expect(overrides.containsKey('fa-1001'), isFalse);
    });

    test('投票失败时抛出 ApiException，且不写入覆盖', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..failureMode = MockFailureMode.upstreamUnavailable;
      final ProviderContainer container =
          containerWith(repo(controls: controls));

      await expectLater(
        container.read(faqHelpfulProvider).markHelpful('fa-1001'),
        throwsA(isA<ApiException>()),
      );
      expect(container.read(faqHelpfulOverridesProvider), isEmpty);
    });

    test('voterId 来自 faqVoterProvider（登录态 -> u: 前缀）', () async {
      final ProviderContainer container = containerWith(repo());

      expect(container.read(faqVoterProvider), voterId);
      expect(container.read(faqHelpfulProvider).voterId, voterId);
    });
  });

  group('我的工单', () {
    test('loading -> data：3 条工单，按时间倒序', () async {
      final ProviderContainer container = containerWith(repo());

      expect(container.read(faqTicketsControllerProvider).isLoading, isTrue);

      final FaqTicketListState state = await container.read(
        faqTicketsControllerProvider.future,
      );

      expect(state.tickets, hasLength(3));
      expect(
        state.tickets.map((FaqTicket ticket) => ticket.id),
        <String>['ft-3002', 'ft-3001', 'ft-3003'],
      );
    });

    test('empty：没有工单时 isEmpty 为 true（UI 渲染空态）', () async {
      final MockFaqRepository repository = MockFaqRepository(
        tickets: <FaqTicket>[],
        controls: MockControls(latency: Duration.zero),
      );
      final ProviderContainer container = containerWith(repository);

      final FaqTicketListState state = await container.read(
        faqTicketsControllerProvider.future,
      );

      expect(state.isEmpty, isTrue);
    });

    test('error：上游故障抛出 ApiException', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..failureMode = MockFailureMode.upstreamUnavailable;
      final ProviderContainer container =
          containerWith(repo(controls: controls));

      await expectLater(
        container.read(faqTicketsControllerProvider.future),
        throwsA(isA<ApiException>()),
      );
    });

    test('提交工单后失效重取，列表多一条', () async {
      final ProviderContainer container = containerWith(repo());
      await container.read(faqTicketsControllerProvider.future);

      await container.read(faqTicketActionsProvider).submit(
            const SubmitFaqTicketCommand(
              contact: 'test@shanghaitech.edu.cn',
              question: '新问题',
            ),
          );

      final FaqTicketListState state = await container.read(
        faqTicketsControllerProvider.future,
      );
      expect(state.tickets, hasLength(4));
      expect(state.tickets.first.question, '新问题');
    });

    test('提交手机号被拒绝 => ApiException(VALIDATION_FAILED)', () async {
      final ProviderContainer container = containerWith(repo());

      await expectLater(
        container.read(faqTicketActionsProvider).submit(
              const SubmitFaqTicketCommand(
                  contact: '13800138000', question: '问题'),
            ),
        throwsA(
          isA<ApiException>().having(
            (ApiException error) => error.code,
            'code',
            ApiErrorCode.validationFailed,
          ),
        ),
      );
    });
  });
}
