import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/anonymous_identity.dart';
import 'package:kedaya/domain/models/forum.dart';

/// **契约 §9 的机械校验**：匿名身份与实名身份在模型层面就解耦。
///
/// 与 `auth_session_boundary_test.dart`（契约 §5 的校园凭据边界）同一思路：
/// 不靠"记得清理字段"，而是让序列化结果**机械地**不可能带上实名信息。
void main() {
  /// 出现这些片段就说明实名信息泄漏到了匿名路径上。
  const List<String> forbiddenFragments = <String>[
    'userId',
    'studentId',
    'realName',
    'department',
    'email',
  ];

  Map<String, Object?> anonymousIdentityJson() => <String, Object?>{
    'id': 'anon-fb-campus-7',
    'alias': '匿名鸭 #7',
    'boardId': 'fb-campus',
  };

  Map<String, Object?> anonymousPostJson() => <String, Object?>{
    'id': 'fp-1',
    'boardId': 'fb-campus',
    'boardName': '校园生活',
    'title': '匿名主题',
    'body': '正文',
    'anonymous': true,
    'anonymousIdentity': anonymousIdentityJson(),
    'status': 'PUBLISHED',
    'tags': <String>[],
    'replyCount': 0,
    'likeCount': 0,
    'createdAt': '2026-10-16T12:00:00.000Z',
  };

  group('匿名作者不携带任何实名出口', () {
    test('AnonymousAuthor.realUserIdOrNull 恒为 null', () {
      final AnonymousAuthor author = AnonymousAuthor(
        AnonymousIdentity.derive(boardId: 'fb-campus', sequence: 7),
      );

      expect(author.isAnonymous, isTrue);
      expect(author.realUserIdOrNull, isNull);
      expect(author.authorId, 'anon-fb-campus-7');
      expect(author.displayName, '匿名鸭 #7');
    });

    test('AnonymousAuthor.toJson 既没有 authorId 也没有任何实名片段', () {
      final Map<String, Object?> json = AnonymousAuthor(
        AnonymousIdentity.derive(boardId: 'fb-campus', sequence: 7),
      ).toJson();

      expect(json['anonymous'], isTrue);
      expect(json.containsKey('authorId'), isFalse, reason: '匿名路径不得出现 authorId');
      expect(json.containsKey('userId'), isFalse);
      for (final String fragment in forbiddenFragments) {
        expect(
          json.keys.any((String key) => key.contains(fragment)),
          isFalse,
          reason: '匿名序列化结果出现了实名片段 "$fragment"',
        );
      }
    });

    test('实名作者与匿名作者是不同的类型（不可能互相赋值）', () {
      const ForumAuthor real = RealAuthor(userId: 'u-1', name: '鸭鸭');
      final ForumAuthor anonymous = AnonymousAuthor(
        AnonymousIdentity.derive(boardId: 'fb-campus', sequence: 1),
      );

      expect(real, isA<RealAuthor>());
      expect(real, isNot(isA<AnonymousAuthor>()));
      expect(anonymous, isA<AnonymousAuthor>());
      expect(anonymous, isNot(isA<RealAuthor>()));
      expect(real.realUserIdOrNull, 'u-1');
    });
  });

  group('解析层防御：payload 混入实名 id 也必须丢弃', () {
    test('anonymous=true 时忽略同级的 authorId（后端泄漏也进不来）', () {
      final ForumAuthor author = ForumAuthor.fromJson(<String, Object?>{
        'anonymous': true,
        // 一个"泄漏的"后端在这里多带了实名 id —— 客户端必须无视它。
        'authorId': 'u-1001',
        'authorName': '真实姓名',
        'anonymousIdentity': anonymousIdentityJson(),
      });

      expect(author, isA<AnonymousAuthor>());
      expect(author.realUserIdOrNull, isNull);
      expect(author.authorId, 'anon-fb-campus-7');
      expect(author.displayName, '匿名鸭 #7');
    });

    test('anonymous=false 时才读 authorId', () {
      final ForumAuthor author = ForumAuthor.fromJson(<String, Object?>{
        'anonymous': false,
        'authorId': 'u-1001',
        'authorName': '可达鸭测试账号',
      });

      expect(author, isA<RealAuthor>());
      expect(author.realUserIdOrNull, 'u-1001');
      expect(author.displayName, '可达鸭测试账号');
    });
  });

  group('序列化层：匿名帖子整体不含实名信息', () {
    test('ForumPost.toJson 的键名里没有实名片段', () {
      final ForumPost post = ForumPost.fromJson(anonymousPostJson());
      final Map<String, Object?> json = post.toJson();

      for (final String fragment in forbiddenFragments) {
        expect(
          json.keys.any((String key) => key.contains(fragment)),
          isFalse,
          reason: '匿名帖子序列化结果出现了实名片段 "$fragment"',
        );
      }
      // 值层面也不得出现实名 id。
      expect(json.values.contains('u-1001'), isFalse);
      expect(post.authorId, 'anon-fb-campus-7');
      expect(post.anonymous, isTrue);
    });

    test('匿名回复同样不含实名信息', () {
      final ForumReply reply = ForumReply.fromJson(<String, Object?>{
        'id': 'fr-1',
        'postId': 'fp-1',
        'body': '匿名回复',
        'anonymous': true,
        'anonymousIdentity': anonymousIdentityJson(),
        'status': 'PUBLISHED',
        'createdAt': '2026-10-16T12:00:00.000Z',
      });
      final Map<String, Object?> json = reply.toJson();

      expect(reply.anonymous, isTrue);
      expect(reply.author.realUserIdOrNull, isNull);
      expect(json.containsKey('authorId'), isFalse);
      for (final String fragment in forbiddenFragments) {
        expect(json.keys.any((String key) => key.contains(fragment)), isFalse);
      }
    });

    test('匿名举报的记录里也不含实名信息', () {
      final ForumReport report = ForumReport.fromJson(<String, Object?>{
        'id': 'frp-1',
        'targetType': 'POST',
        'targetId': 'fp-1',
        'reason': 'spam',
        'status': 'PENDING',
        'anonymous': true,
        'anonymousIdentity': anonymousIdentityJson(),
        'createdAt': '2026-10-16T12:00:00.000Z',
      });

      expect(report.anonymous, isTrue);
      expect(report.reporter.realUserIdOrNull, isNull);
      expect(report.toJson().containsKey('authorId'), isFalse);
    });
  });
}
