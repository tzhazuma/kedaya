import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/anonymous_identity.dart';
import 'package:kedaya/domain/models/forum.dart';

/// 论坛模型的纯逻辑测试（domain 层零框架依赖，因此不需要任何 mock）。
void main() {
  Map<String, Object?> realPostJson({String status = 'PUBLISHED'}) =>
      <String, Object?>{
        'id': 'fp-1',
        'boardId': 'fb-1',
        'boardName': '校园生活',
        'title': '标题',
        'body': '正文',
        'anonymous': false,
        'authorId': 'u-1',
        'authorName': '鸭鸭一号',
        'status': status,
        'tags': <String>['食堂'],
        'replyCount': 2,
        'likeCount': 5,
        'createdAt': '2026-10-16T12:00:00.000Z',
      };

  group('ForumPost 解析', () {
    test('实名主题：author 是 RealAuthor，anonymous=false，authorId=userId', () {
      final ForumPost post = ForumPost.fromJson(realPostJson());

      expect(post.author, isA<RealAuthor>());
      expect(post.anonymous, isFalse);
      expect(post.authorId, 'u-1');
      expect(post.author.realUserIdOrNull, 'u-1');
      expect(post.author.displayName, '鸭鸭一号');
      expect(post.status, ForumPostStatus.published);
      expect(post.canReply, isTrue);
      expect(post.tags, <String>['食堂']);
      expect(post.createdAt, DateTime.utc(2026, 10, 16, 12));
    });

    test('匿名主题：author 是 AnonymousAuthor，authorId 是匿名 id', () {
      final ForumPost post = ForumPost.fromJson(<String, Object?>{
        ...realPostJson(),
        'anonymous': true,
        'anonymousIdentity': <String, Object?>{
          'id': 'anon-fb-1-7',
          'alias': '匿名鸭 #7',
          'boardId': 'fb-1',
        },
      });

      expect(post.author, isA<AnonymousAuthor>());
      expect(post.anonymous, isTrue);
      expect(post.authorId, 'anon-fb-1-7');
      expect(post.author.displayName, '匿名鸭 #7');
      expect(post.author.realUserIdOrNull, isNull);
    });

    test('未知状态收敛为 unknown，且按不可回复处理（保守）', () {
      final ForumPost post =
          ForumPost.fromJson(realPostJson(status: 'BRAND_NEW'));

      expect(post.status, ForumPostStatus.unknown);
      expect(post.canReply, isFalse);
      expect(post.isVisible, isFalse);
    });

    test('LOCKED 状态：可见但禁止新回复（契约 §2.4 状态机）', () {
      final ForumPost post = ForumPost.fromJson(realPostJson(status: 'LOCKED'));

      expect(post.status, ForumPostStatus.locked);
      expect(post.isLocked, isTrue);
      expect(post.isVisible, isTrue);
      expect(post.canReply, isFalse);
    });

    test('pinnedAt 非空 => isPinned', () {
      final ForumPost post = ForumPost.fromJson(<String, Object?>{
        ...realPostJson(),
        'pinnedAt': '2026-10-16T09:00:00.000Z',
      });

      expect(post.isPinned, isTrue);
      expect(post.pinnedAt, DateTime.utc(2026, 10, 16, 9));
    });

    test('toJson 往返：匿名主题的匿名身份保持不变', () {
      final ForumPost original = ForumPost.fromJson(<String, Object?>{
        ...realPostJson(),
        'anonymous': true,
        'anonymousIdentity': <String, Object?>{
          'id': 'anon-fb-1-7',
          'alias': '匿名鸭 #7',
          'boardId': 'fb-1',
        },
      });

      final ForumPost restored = ForumPost.fromJson(original.toJson());

      expect(restored.id, original.id);
      expect(restored.title, original.title);
      expect(restored.anonymous, isTrue);
      expect(restored.authorId, original.authorId);
      expect(restored.createdAt, original.createdAt);
      expect(restored.status, original.status);
      expect(restored.tags, original.tags);
    });
  });

  group('ForumPostQuery', () {
    test('游标分页参数收敛：空 boardId 被丢弃，limit 收敛到上限', () {
      expect(
          const ForumPostQuery(boardId: '', limit: 500).toQuery(),
          <String, Object?>{
            'limit': 100,
          });
    });

    test('boardId 与 keyword 参与查询串，keyword 去空白', () {
      final Map<String, Object?> query = const ForumPostQuery(
        boardId: 'fb-1',
        cursor: '4',
        keyword: '  食堂  ',
        limit: 10,
      ).toQuery();

      expect(query['board'], 'fb-1');
      expect(query['cursor'], '4');
      expect(query['q'], '食堂');
      expect(query['limit'], 10);
    });
  });

  group('ForumPostDraft 校验（发帖表单）', () {
    test('空标题 / 空正文分别报错', () {
      const ForumPostDraft draft = ForumPostDraft();

      expect(draft.titleError, '请填写标题');
      expect(draft.bodyError, '请填写正文');
      expect(draft.isValid, isFalse);
    });

    test('超长标题（>100 字）报错', () {
      final ForumPostDraft draft = ForumPostDraft(title: 'a' * 101, body: '正文');

      expect(draft.titleError, isNotNull);
      expect(draft.bodyError, isNull);
      expect(draft.isValid, isFalse);
    });

    test('合法草稿通过校验，且标签默认值不影响通过', () {
      const ForumPostDraft draft = ForumPostDraft(
        title: '一食堂新窗口测评',
        body: '均价 12 元。',
        tags: <String>['食堂', '测评'],
      );

      expect(draft.isValid, isTrue);
      expect(draft.anonymous, isFalse, reason: '契约 §2.4：anonymous 默认 false');
    });

    test('标签超过 5 个或单个超过 16 字报错', () {
      expect(
        const ForumPostDraft(
          title: 't',
          body: 'b',
          tags: <String>['1', '2', '3', '4', '5', '6'],
        ).tagsError,
        '最多 5 个标签',
      );
      expect(
        ForumPostDraft(
          title: 't',
          body: 'b',
          tags: <String>['x' * 17],
        ).tagsError,
        isNotNull,
      );
    });
  });

  group('匿名开关语义（契约 §9）', () {
    test('toCommand 保留匿名开关，且请求体不含任何实名标识', () {
      const ForumPostDraft draft = ForumPostDraft(
        title: '标题',
        body: '正文',
        anonymous: true,
      );

      final CreateForumPostCommand command = draft.toCommand(boardId: 'fb-1');
      final Map<String, Object?> json = command.toJson();

      expect(command.anonymous, isTrue);
      expect(json['anonymous'], isTrue);
      expect(json['board'], 'fb-1', reason: 'services/api 的字段名是 board');
      expect(json.containsKey('authorId'), isFalse);
      expect(json.containsKey('userId'), isFalse);
      expect(json.containsKey('authorName'), isFalse);
    });

    test('匿名说明文案与契约措辞一致，且默认关闭匿名', () {
      expect(anonymousPostNotice, '匿名后你的实名身份不会与帖子关联');
      expect(anonymousReplyNotice, '匿名后你的实名身份不会与回复关联');
      expect(const ForumPostDraft().anonymous, isFalse);
      expect(const ForumPostDraft(anonymous: true).anonymityNotice,
          anonymousPostNotice);
    });

    test('ReplyDraft：空回复报错，匿名开关同样默认关闭', () {
      expect(const ForumReplyDraft().bodyError, '请填写回复内容');
      expect(const ForumReplyDraft(body: '好的').isValid, isTrue);
      expect(const ForumReplyDraft(body: '好的').anonymous, isFalse);
      expect(
        const ForumReplyDraft(body: '好的', anonymous: true)
            .toCommand(postId: 'fp-1')
            .toJson()['anonymous'],
        isTrue,
      );
    });
  });

  group('parseForumTags', () {
    test('支持中英文逗号 / 顿号 / 空格，去空、去重、保序', () {
      expect(parseForumTags('食堂, 测评、食堂  咖啡'), <String>['食堂', '测评', '咖啡']);
      expect(parseForumTags('   '), isEmpty);
      expect(parseForumTags('a,b,c,d,e,f,g'), hasLength(5));
    });
  });

  group('举报模型', () {
    test('ForumReport 解析：理由与状态收敛，举报人可匿名', () {
      final ForumReport report = ForumReport.fromJson(<String, Object?>{
        'id': 'frp-1',
        'targetType': 'REPLY',
        'targetId': 'fr-1',
        'reason': 'privacy',
        'status': 'UPHELD',
        'anonymous': true,
        'anonymousIdentity': <String, Object?>{
          'id': 'anon-fb-1-1',
          'alias': '匿名鸭 #1',
        },
        'createdAt': '2026-10-16T12:00:00.000Z',
      });

      expect(report.targetType, ForumReportTargetType.reply);
      expect(report.reason, ForumReportReason.privacy);
      expect(report.status, ForumReportStatus.upheld);
      expect(report.anonymous, isTrue);
      expect(report.reporter.realUserIdOrNull, isNull);
    });

    test('未知举报理由收敛为 other（不会丢举报）', () {
      expect(ForumReportReason.fromWire('nonsense'), ForumReportReason.other);
      expect(ForumReportTargetType.fromWire('nonsense'),
          ForumReportTargetType.post);
    });
  });

  group('兼容 services/api 的 wire 形状（跨端实测差异）', () {
    /// services/api 的 `ForumPostModel`：`board`（不是 boardId）、
    /// `status` 小写、匿名时 `authorId: null` 且**不下发** anonymousIdentity。
    Map<String, Object?> backendPostJson({
      String status = 'published',
      Object? authorId = 'u-1',
    }) =>
        <String, Object?>{
          'id': 'fp-be-1',
          'board': 'fb-campus',
          'authorId': authorId,
          'anonHandle': 'hmac-should-not-be-used',
          'title': '后端形状的主题',
          'body': '正文',
          'status': status,
          'tags': <String>['x'],
          'replyCount': 1,
          'likeCount': 2,
          'pinnedAt': null,
          'createdAt': '2026-10-16T12:00:00.000Z',
          'updatedAt': '2026-10-16T12:00:00.000Z',
        };

    test('board 字段被接受为 boardId；小写状态被正确解析', () {
      final ForumPost post = ForumPost.fromJson(backendPostJson());

      expect(post.boardId, 'fb-campus');
      expect(post.status, ForumPostStatus.published);
      expect(post.canReply, isTrue);
      expect(post.anonymous, isFalse);
      expect(post.authorId, 'u-1');
    });

    test('authorId 为 null => 判定为匿名，且合成只用于展示的匿名身份', () {
      final ForumPost post =
          ForumPost.fromJson(backendPostJson(authorId: null));

      expect(post.anonymous, isTrue);
      expect(post.author, isA<AnonymousAuthor>());
      expect(post.author.realUserIdOrNull, isNull);
      expect(post.author.displayName, '匿名用户');
      // 后端下发的 anonHandle（可用于跨帖关联同一匿名作者）**绝不**进入模型。
      expect(post.toJson().containsKey('anonHandle'), isFalse);
      expect(post.authorId, isNot('hmac-should-not-be-used'));
    });

    test('小写 locked / hidden 也按状态机处理', () {
      expect(
        ForumPost.fromJson(backendPostJson(status: 'locked')).canReply,
        isFalse,
      );
      expect(
        ForumPost.fromJson(backendPostJson(status: 'hidden')).isVisible,
        isFalse,
      );
      expect(
        ForumReplyStatus.fromWire('published'),
        ForumReplyStatus.published,
      );
    });

    test('举报理由：规范值 pii 与旧写法 privacy 都收敛到同一枚举', () {
      expect(ForumReportReason.fromWire('pii'), ForumReportReason.privacy);
      expect(ForumReportReason.fromWire('privacy'), ForumReportReason.privacy);
      expect(ForumReportReason.privacy.wire, 'pii', reason: '发送规范值');
      expect(ForumReportReason.fromWire('SPAM'), ForumReportReason.spam);
    });

    test('举报的 detail 字段（services/api）与旧 note 都能读', () {
      Map<String, Object?> reportJson(String key) => <String, Object?>{
            'id': 'frp-1',
            'targetType': 'POST',
            'targetId': 'fp-1',
            'reason': 'spam',
            'status': 'PENDING',
            'reporterId': 'u-1',
            key: '补充说明',
            'createdAt': '2026-10-16T12:00:00.000Z',
          };

      expect(ForumReport.fromJson(reportJson('detail')).detail, '补充说明');
      expect(ForumReport.fromJson(reportJson('note')).detail, '补充说明');
      expect(
        ForumReport.fromJson(reportJson('detail')).toJson()['detail'],
        '补充说明',
      );
    });

    test('举报命令的请求体只带 reason / detail / anonymous（目标在路径里）', () {
      final Map<String, Object?> json = const CreateForumReportCommand(
        targetType: ForumReportTargetType.post,
        targetId: 'fp-1',
        reason: ForumReportReason.privacy,
        detail: '说明',
        anonymous: true,
      ).toJson();

      expect(json, <String, Object?>{
        'reason': 'pii',
        'detail': '说明',
        'anonymous': true,
      });
    });

    test('回复命令的请求体不含 postId（它在路径 items/:id/replies 里）', () {
      final Map<String, Object?> json = const CreateForumReplyCommand(
        postId: 'fp-1',
        body: '回复',
        anonymous: false,
      ).toJson();

      expect(json.containsKey('postId'), isFalse);
      expect(json, <String, Object?>{
        'body': '回复',
        'anonymous': false,
        'parentReplyId': null,
      });
    });
  });

  group('AnonymousIdentity', () {
    test('derive 是单向的：只由 boardId + sequence 决定', () {
      final AnonymousIdentity identity = AnonymousIdentity.derive(
        boardId: 'fb-campus',
        sequence: 7,
      );

      expect(identity.id, 'anon-fb-campus-7');
      expect(identity.alias, '匿名鸭 #7');
      expect(identity.boardId, 'fb-campus');
      expect(identity.displayName, '匿名鸭 #7');
      // 相同入参 -> 相同身份（版块内稳定，版主可追溯）。
      expect(identity,
          AnonymousIdentity.derive(boardId: 'fb-campus', sequence: 7));
      // 不同版块 -> 不同身份（跨版块不可关联）。
      expect(
        identity == AnonymousIdentity.derive(boardId: 'fb-study', sequence: 7),
        isFalse,
      );
    });

    test('toJson 往返一致', () {
      final AnonymousIdentity identity = AnonymousIdentity.derive(
        boardId: 'fb-1',
        sequence: 2,
      );

      expect(AnonymousIdentity.fromJson(identity.toJson()), identity);
    });
  });
}
