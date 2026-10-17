import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/buddy.dart';
import 'package:kedaya/domain/models/buddy_application.dart';
import 'package:kedaya/domain/models/buddy_matching.dart';
import 'package:kedaya/domain/models/buddy_profile.dart';

/// **隐私与合规边界的机械校验**（规格 §6.1–§6.4 / §8.4 / 契约 §11.10-G）。
///
/// 这个文件不测"逻辑对不对"，而是测**不该存在的东西确实不存在**：
/// 类型里没有敏感字段、端口里没有读别人资料的出口、代码里没有 dating 板块。
/// 风格参照 `test/domain/wildlife_datum_boundary_test.dart`。
void main() {
  /// 递归收集 JSON 里的全部键名。
  Set<String> allKeys(Object? value) {
    final Set<String> keys = <String>{};
    void walk(Object? node) {
      if (node is Map<String, Object?>) {
        for (final MapEntry<String, Object?> entry in node.entries) {
          keys.add(entry.key);
          walk(entry.value);
        }
        return;
      }
      if (node is List<Object?>) {
        for (final Object? item in node) {
          walk(item);
        }
      }
    }

    walk(value);
    return keys;
  }

  const List<String> forbiddenKeys = <String>[
    'gender',
    'age',
    'birthDate',
    'mbti',
    'datingPurpose',
    'familyStatus',
    'idealPerson',
    'embedding',
    'embeddingModel',
    'cookie',
    'session',
    'tgc',
    'castgc',
    'exactLat',
    'exactLng',
    'lat',
    'lng',
  ];

  group('契约 §11.10-G：不做 dating 板块', () {
    test('BuddySection 里没有任何交友/约会语义的成员', () {
      final Set<String> wires = BuddySection.values
          .map((BuddySection section) => section.wire)
          .toSet();
      expect(wires, <String>{'academic', 'daily', 'sport', 'unknown'});
      expect(wires, isNot(contains('dating')));
    });

    test('下发的 dating 板块收敛为 unknown，且**不是**可用板块', () {
      final BuddySection parsed = BuddySection.fromWire('dating');
      expect(parsed, BuddySection.unknown);
      expect(parsed.isMatchable, isFalse);
      expect(BuddySection.tryFromWire('dating'), isNull);
      // unknown 不能作为筛选条件下发。
      expect(
        BuddyPostQuery(section: parsed).toQuery().containsKey('section'),
        isFalse,
      );
    });

    test('真实板块恰好三个', () {
      expect(buddyMatchableSections, <BuddySection>[
        BuddySection.academic,
        BuddySection.daily,
        BuddySection.sport,
      ]);
      expect(
        BuddySection.values.where((BuddySection s) => s.isMatchable),
        hasLength(3),
      );
    });

    test('帖子上的 dating 板块字段被忽略（板块恒由 activity 派生）', () {
      final BuddyPost post = BuddyPost.fromJson(<String, Object?>{
        'id': 'bp-1',
        'activity': 'meal',
        'section': 'dating',
        'title': 't',
        'location': '二食堂',
        'startsAt': '2026-10-19T06:00:00.000Z',
        'capacity': 4,
      });
      expect(post.section, BuddySection.daily);
    });
  });

  group('规格 §8.4 T26/T27：响应里不得出现敏感字段', () {
    test('BuddyPost 序列化', () {
      final BuddyPost post = BuddyPost(
        id: 'bp-1',
        activity: BuddyActivity.sport,
        title: 't',
        location: '体育馆',
        startsAt: DateTime.utc(2026, 10, 19, 6),
        capacity: 4,
        creator: const BuddyCreator(id: 'u-1', nickname: '鸭鸭一号'),
        tags: const <String>['badminton'],
        createdAt: DateTime.utc(2026, 10, 17, 4),
      );
      final Set<String> keys = allKeys(post.toJson());
      for (final String forbidden in forbiddenKeys) {
        expect(keys, isNot(contains(forbidden)),
            reason: 'BuddyPost 不得含 $forbidden');
      }
    });

    test('BuddyProfile 序列化（含 embedding 禁令）', () {
      final Set<String> keys = allKeys(
        BuddyProfile(
          userId: 'u-1',
          sections: const <BuddySection>[BuddySection.sport],
          department: '信息学院',
          matchEnabled: true,
        ).toJson(),
      );
      for (final String forbidden in forbiddenKeys) {
        expect(keys, isNot(contains(forbidden)),
            reason: 'BuddyProfile 不得含 $forbidden');
      }
    });

    test('BuddyCreator 只有三个字段（联系方式不可能出现在类型里）', () {
      final Map<String, Object?> json = const BuddyCreator(
        id: 'u-1',
        nickname: '鸭鸭一号',
        avatarUrl: 'https://example.com/a.png',
      ).toJson();
      expect(json.keys.toSet(), <String>{'id', 'nickname', 'avatarUrl'});
      for (final String key in json.keys) {
        expect(
          <String>['contact', 'phone', 'wechat', 'qq', 'email', 'mobile'],
          isNot(contains(key)),
        );
      }
    });

    test('BuddyMatchFeedback 反馈的是**帖子**，不是人（§3.6 D10）', () {
      final Set<String> keys = allKeys(
        BuddyMatchFeedback(
          userId: 'u-1',
          targetPostId: 'bp-1',
          section: BuddySection.sport,
          action: BuddyMatchFeedbackAction.like,
          createdAt: DateTime.utc(2026, 10, 17, 4),
        ).toJson(),
      );
      expect(keys, contains('targetPostId'));
      expect(keys, isNot(contains('targetUserId')));
    });

    test('BuddyApplication 不下发任何校园凭据', () {
      final Set<String> keys = allKeys(
        BuddyApplication(
          id: 'ba-1',
          postId: 'bp-1',
          applicantId: 'u-1',
          createdAt: DateTime.utc(2026, 10, 17, 4),
          message: '一起？',
        ).toJson(),
      );
      for (final String forbidden in forbiddenKeys) {
        expect(keys, isNot(contains(forbidden)));
      }
    });

    test('推荐理由一定非空（§1.1 G3）', () {
      final BuddyRecommendation recommendation = BuddyRecommendation(
        post: BuddyPost(
          id: 'bp-1',
          activity: BuddyActivity.sport,
          title: 't',
          location: '体育馆',
          startsAt: DateTime.utc(2026, 10, 19, 6),
          capacity: 4,
          creator: const BuddyCreator(id: 'u-1'),
        ),
        score: 0,
        reason: buddyFallbackReason,
      );
      expect(recommendation.reason, isNotEmpty);
      expect(recommendation.toJson()['reason'], isNotEmpty);
    });
  });

  group('规格 §6.1：端口里没有「读别人匹配资料」的出口', () {
    test('端口只有 getMyProfile，没有任何他人视角的方法', () {
      final String source =
          File('lib/domain/ports/buddy_port.dart').readAsStringSync();
      final String code = source
          .split('\n')
          .map((String line) => line.split('///').first)
          .join('\n');

      expect(code, contains('getMyProfile'));
      for (final String forbidden in <String>[
        'getProfile(',
        'getUserProfile',
        'getOtherProfile',
        'profileOf(',
        'listProfiles',
        'searchProfiles',
      ]) {
        expect(
          code.contains(forbidden),
          isFalse,
          reason: '端口不得提供「读他人匹配资料」的方法：$forbidden',
        );
      }
    });
  });

  group('源码层面：buddy 相关代码里没有 dating 板块（机械扫描）', () {
    test('没有 `dating` 字符串字面量（注释除外）', () {
      final List<String> targets = <String>[];
      for (final String root in <String>[
        'lib/domain',
        'lib/data',
        'lib/features/buddy'
      ]) {
        final Directory directory = Directory(root);
        if (!directory.existsSync()) continue;
        for (final FileSystemEntity entity
            in directory.listSync(recursive: true)) {
          if (entity is! File || !entity.path.endsWith('.dart')) continue;
          final String path = entity.path;
          if (!path.contains('buddy')) continue;
          targets.add(path);
        }
      }
      expect(targets, isNotEmpty, reason: '扫描目标为空，说明路径写错了');

      final RegExp dating = RegExp("['\"]dating['\"]");
      final List<String> offenders = <String>[];
      for (final String path in targets) {
        final List<String> lines = File(path).readAsLinesSync();
        for (int index = 0; index < lines.length; index++) {
          final String code = lines[index].split('//').first;
          if (dating.hasMatch(code)) {
            offenders.add('$path:${index + 1}: ${lines[index].trim()}');
          }
        }
      }
      expect(
        offenders,
        isEmpty,
        reason: '契约 §11.10-G 禁止 dating 板块，发现:\n${offenders.join('\n')}',
      );
    });
  });
}
