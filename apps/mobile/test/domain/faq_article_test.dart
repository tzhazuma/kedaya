import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/faq.dart';

/// FAQ 模型的纯逻辑测试。
void main() {
  FaqArticle article({
    String id = 'fa-1',
    String question = '怎么登录？',
    String answer = '在「我的」页点登录。',
    String category = 'fc-account',
    FaqArticleStatus status = FaqArticleStatus.published,
    int helpfulCount = 10,
    List<String> tags = const <String>['登录'],
  }) =>
      FaqArticle(
        id: id,
        question: question,
        answer: answer,
        category: category,
        status: status,
        helpfulCount: helpfulCount,
        tags: tags,
      );

  group('FaqArticle', () {
    test('解析：字段齐全，未知状态收敛为 unknown 且不可见', () {
      final FaqArticle parsed = FaqArticle.fromJson(<String, Object?>{
        'id': 'fa-9',
        'slug': 'x',
        'question': '问题',
        'answer': '答案',
        'category': 'fc-other',
        'status': 'WAT',
        'helpfulCount': 3,
        'unhelpfulCount': 1,
        'tags': <Object?>['a', 1, 'b'],
        'updatedAt': '2026-10-15T12:00:00.000Z',
      });

      expect(parsed.id, 'fa-9');
      expect(parsed.status, FaqArticleStatus.unknown);
      expect(parsed.isPublished, isFalse, reason: '未知状态不得当作已发布');
      expect(parsed.helpfulCount, 3);
      // 非字符串标签被丢弃，而不是让整条解析失败。
      expect(parsed.tags, <String>['a', 'b']);
      expect(parsed.updatedAt, DateTime.utc(2026, 10, 15, 12));
    });

    test('copyWith 只改 helpfulCount（幂等计数的落点）', () {
      final FaqArticle before = article(helpfulCount: 10);
      final FaqArticle after = before.copyWith(helpfulCount: 11);

      expect(after.helpfulCount, 11);
      expect(after.id, before.id);
      expect(after.question, before.question);
      expect(before.helpfulCount, 10, reason: 'copyWith 不得就地修改');
    });

    test('toJson 往返一致', () {
      final FaqArticle original = article();
      final FaqArticle restored = FaqArticle.fromJson(original.toJson());

      expect(restored.id, original.id);
      expect(restored.question, original.question);
      expect(restored.answer, original.answer);
      expect(restored.category, original.category);
      expect(restored.status, original.status);
      expect(restored.helpfulCount, original.helpfulCount);
      expect(restored.tags, original.tags);
    });
  });

  group('FaqArticle.matches（搜索纯逻辑）', () {
    test('空关键词匹配一切', () {
      expect(article().matches(''), isTrue);
      expect(article().matches('   '), isTrue);
    });

    test('命中问题 / 答案 / 分类 / 标签，且大小写不敏感', () {
      final FaqArticle a = article(
        question: 'How to Login',
        answer: '统一身份认证',
        category: 'fc-account',
        tags: const <String>['Anonymous'],
      );

      expect(a.matches('login'), isTrue, reason: '问题命中且忽略大小写');
      expect(a.matches('身份认证'), isTrue, reason: '答案命中');
      expect(a.matches('fc-account'), isTrue, reason: '分类命中');
      expect(a.matches('anony'), isTrue, reason: '标签命中');
      expect(a.matches('不存在的东西'), isFalse);
    });
  });

  group('FaqQuery', () {
    test('查询串收敛：空分类丢弃，关键词去空白，limit 收敛', () {
      expect(
          const FaqQuery(category: '', limit: 999).toQuery(), <String, Object?>{
        'limit': 100,
      });

      final Map<String, Object?> query = const FaqQuery(
        category: 'fc-account',
        keyword: '  登录 ',
        cursor: '10',
        limit: 10,
      ).toQuery();

      expect(query['category'], 'fc-account');
      expect(query['q'], '登录');
      expect(query['cursor'], '10');
      expect(query['limit'], 10);
    });

    test('值相等语义（Riverpod 依赖变更检测依赖它）', () {
      expect(const FaqQuery(keyword: 'a'), const FaqQuery(keyword: 'a'));
      expect(const FaqQuery(keyword: 'a') == const FaqQuery(keyword: 'b'),
          isFalse);
    });
  });

  group('FaqTicket', () {
    test('未登录也能有工单：userId 为 null', () {
      final FaqTicket ticket = FaqTicket.fromJson(<String, Object?>{
        'id': 'ft-1',
        'contact': 'wechat: abc',
        'question': '问题',
        'status': 'OPEN',
        'createdAt': '2026-10-16T12:00:00.000Z',
      });

      expect(ticket.userId, isNull);
      expect(ticket.status, FaqTicketStatus.open);
      expect(ticket.isOpen, isTrue);
      expect(ticket.hasAnswer, isFalse);
    });

    test('状态机辅助：只有 ANSWERED 可以追问', () {
      expect(FaqTicketStatus.answered.canFollowUp, isTrue);
      expect(FaqTicketStatus.open.canFollowUp, isFalse);
      expect(FaqTicketStatus.closed.canFollowUp, isFalse);
      expect(FaqTicketStatus.fromWire('WAT'), FaqTicketStatus.unknown);
    });

    test('toJson 往返：带回复的工单保持一致', () {
      final FaqTicket original = FaqTicket(
        id: 'ft-2',
        userId: 'u-1',
        contact: 'test@shanghaitech.edu.cn',
        question: '问题',
        status: FaqTicketStatus.answered,
        answer: '回复',
        createdAt: DateTime.utc(2026, 10, 16, 12),
        answeredAt: DateTime.utc(2026, 10, 16, 13),
      );
      final FaqTicket restored = FaqTicket.fromJson(original.toJson());

      expect(restored.status, FaqTicketStatus.answered);
      expect(restored.hasAnswer, isTrue);
      expect(restored.answer, '回复');
      expect(restored.answeredAt, original.answeredAt);
    });
  });

  group('工单草稿校验（契约 §2.8：不存明文手机号）', () {
    test('联系方式为空报错', () {
      expect(faqTicketContactError('   '), isNotNull);
    });

    test('**手机号被拒绝**（不存明文手机号）', () {
      final String? error = faqTicketContactError('13800138000');

      expect(error, isNotNull);
      expect(error, contains('手机号'));
    });

    test('邮箱与微信号通过', () {
      expect(faqTicketContactError('test@shanghaitech.edu.cn'), isNull);
      expect(faqTicketContactError('wechat: keda_duck'), isNull);
    });

    test('问题描述：空报错，超 2000 字报错', () {
      expect(faqTicketQuestionError(''), isNotNull);
      expect(faqTicketQuestionError('a' * 2000), isNull);
      expect(faqTicketQuestionError('a' * 2001), isNotNull);
    });

    test('FaqTicketDraft.isValid 汇总两个字段，toCommand 去空白', () {
      const FaqTicketDraft invalid =
          FaqTicketDraft(contact: '13800138000', question: '');
      expect(invalid.isValid, isFalse);

      const FaqTicketDraft valid = FaqTicketDraft(
        contact: '  test@shanghaitech.edu.cn  ',
        question: '  有个问题  ',
      );
      expect(valid.isValid, isTrue);
      expect(valid.toCommand().toJson(), <String, Object?>{
        'contact': 'test@shanghaitech.edu.cn',
        'question': '有个问题',
      });
    });
  });

  group('「有用」的幂等语义（模型层）', () {
    test('counted=false 表示幂等命中，且不是失败', () {
      const FaqHelpfulResult result = FaqHelpfulResult(
        articleId: 'fa-1',
        helpfulCount: 10,
        counted: false,
      );

      expect(result.alreadyVoted, isTrue);
      expect(result.helpfulCount, 10, reason: '幂等命中时计数不得变化');
      expect(result.articleId, 'fa-1');
    });

    test('counted=true 表示这一票被计入', () {
      const FaqHelpfulResult result = FaqHelpfulResult(
        articleId: 'fa-1',
        helpfulCount: 11,
        counted: true,
      );

      expect(result.alreadyVoted, isFalse);
      expect(result.helpfulCount, 11);
    });
  });
}
