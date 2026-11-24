import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/dorm_post.dart';
import 'package:kedaya/features/dorm_harmony/data/dorm_harmony_repository.dart';
import 'package:kedaya/features/dorm_harmony/domain/dorm_board.dart';

String repeat(String value, int count) =>
    List<String>.filled(count, value).join();

void main() {
  final DateTime now = DateTime(2026, 11, 24, 12);

  DormHarmonyRepository repository() => DormHarmonyRepository(
        clock: () => now,
        seed: buildDormSeedPosts(now),
      );

  group('楼栋筛选', () {
    test('「全部」返回所有帖子，按时间倒序', () {
      final List<DormPost> posts = repository().snapshot();

      expect(posts, hasLength(5));
      expect(filterDormPosts(posts, null), hasLength(5));
      expect(filterDormPosts(posts, '全部'), hasLength(5));
    });

    test('选中楼栋后只剩该楼栋，且保持时间倒序', () {
      final List<DormPost> posts = repository().snapshot();
      final List<DormPost> floorOne = filterDormPosts(posts, '1 号楼');

      expect(floorOne, hasLength(2));
      expect(
        floorOne.map((DormPost post) => post.id),
        <String>['dorm-4004', 'dorm-4001'],
      );
      expect(
        floorOne.every((DormPost post) => post.building == '1 号楼'),
        isTrue,
      );
    });

    test('没有帖子的楼栋返回空列表', () {
      final List<DormPost> none = filterDormPosts(
        repository().snapshot(),
        '4 号楼',
      );
      expect(none, isEmpty);
    });
  });

  group('回复计数', () {
    test('新增回复后计数 +1，并生成匿名代号', () {
      final DormHarmonyRepository repo = repository();
      final DormPost before = repo.byId('dorm-4003')!;
      expect(before.replyCount, 0);

      final DormReply reply = repo.addReply('dorm-4003', '可以试试按周轮值。');

      expect(reply.alias, '3 号楼 · 匿名 A');
      expect(reply.body, '可以试试按周轮值。');

      final DormPost after = repo.byId('dorm-4003')!;
      expect(after.replyCount, 1);
      expect(after.replies.single.id, reply.id);
      expect(after.replies.single.alias, '3 号楼 · 匿名 A');
    });

    test('演示数据的回复数与回复列表一致', () {
      for (final DormPost post in repository().snapshot()) {
        expect(post.replyCount, post.replies.length);
      }
    });

    test('帖子不存在或回复为空时抛错', () {
      final DormHarmonyRepository repo = repository();

      expect(
        () => repo.addReply('dorm-9999', '你好'),
        throwsA(isA<DormHarmonyException>()),
      );
      expect(
        () => repo.addReply('dorm-4003', '   '),
        throwsA(isA<DormHarmonyException>()),
      );
    });
  });

  group('正文长度校验', () {
    test('500 字合法，501 字不合法', () {
      final List<DormPostProblem> atLimit = validateDormPostDraft(
        DormPostDraft(
          building: '1 号楼',
          title: '标题',
          body: repeat('字', dormPostBodyMax),
        ),
      );
      final List<DormPostProblem> overLimit = validateDormPostDraft(
        DormPostDraft(
          building: '1 号楼',
          title: '标题',
          body: repeat('字', dormPostBodyMax + 1),
        ),
      );

      expect(atLimit, isEmpty);
      expect(overLimit, contains(DormPostProblem.bodyTooLong));
      expect(
        describeDormPostProblem(DormPostProblem.bodyTooLong),
        contains('500'),
      );
    });

    test('标题/正文为空会被拒绝，仓库不写入', () {
      final DormHarmonyRepository repo = repository();

      expect(
        validateDormPostDraft(
          const DormPostDraft(building: '1 号楼', title: ' ', body: '正文'),
        ),
        contains(DormPostProblem.titleRequired),
      );
      expect(
        validateDormPostDraft(
          const DormPostDraft(building: '1 号楼', title: '标题', body: ' '),
        ),
        contains(DormPostProblem.bodyRequired),
      );
      expect(
        () => repo.create(
          DormPostDraft(
            building: '1 号楼',
            title: '标题',
            body: repeat('字', dormPostBodyMax + 1),
          ),
        ),
        throwsA(isA<DormHarmonyException>()),
      );
      expect(repo.length, 5);
    });
  });

  group('匿名代号', () {
    test('按楼栋内发帖顺序生成 A / B / …', () {
      final DormHarmonyRepository repo = repository();

      final DormPost created = repo.create(
        const DormPostDraft(
          building: '2 号楼',
          title: '公共区域值日',
          body: '想问问大家怎么分工。',
        ),
      );

      expect(created.alias, '2 号楼 · 同学 B');
      expect(created.aliasTail, '同学 B');
      expect(created.alias.contains('u-'), isFalse);
    });

    test('超过 26 个后进入 AA / AB', () {
      expect(dormAliasLetter(1), 'A');
      expect(dormAliasLetter(26), 'Z');
      expect(dormAliasLetter(27), 'AA');
      expect(dormAliasLetter(28), 'AB');
    });
  });
}
