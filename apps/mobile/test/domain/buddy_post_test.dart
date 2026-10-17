import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/buddy.dart';
import 'package:kedaya/domain/models/buddy_tags.dart';

/// `BuddyPost` 与状态机的领域测试（规格 §2.3 / §2.8 / §5.4）。
void main() {
  /// Dart 没有字符串重复运算符，测试里造超长文本用它。
  String repeat(String unit, int count) =>
      List<String>.filled(count, unit).join();

  group('sectionOf(activity) —— 板块派生（规格 §2.3，T2）', () {
    test('6 个 activity 全部覆盖', () {
      expect(sectionOfActivity(BuddyActivity.study), BuddySection.academic);
      expect(sectionOfActivity(BuddyActivity.meal), BuddySection.daily);
      expect(sectionOfActivity(BuddyActivity.travel), BuddySection.daily);
      expect(sectionOfActivity(BuddyActivity.other), BuddySection.daily);
      expect(sectionOfActivity(BuddyActivity.sport), BuddySection.sport);
      expect(sectionOfActivity(BuddyActivity.game), BuddySection.sport);
    });

    test('反向投影与派生一致', () {
      for (final BuddySection section in buddyMatchableSections) {
        for (final BuddyActivity activity in activitiesOfSection(section)) {
          expect(sectionOfActivity(activity), section);
        }
      }
      expect(activitiesOfSection(BuddySection.academic), <BuddyActivity>[
        BuddyActivity.study,
      ]);
      expect(activitiesOfSection(BuddySection.sport), <BuddyActivity>[
        BuddyActivity.sport,
        BuddyActivity.game,
      ]);
    });

    test('未知 activity 收敛为 other（daily 板块），不抛异常', () {
      expect(BuddyActivity.fromWire('quidditch'), BuddyActivity.other);
      expect(BuddyActivity.fromWire('STUDY'), BuddyActivity.study);
    });
  });

  group('BuddyPost 状态机（规格 §2.8，T1）', () {
    const List<BuddyPostStatus> real = <BuddyPostStatus>[
      BuddyPostStatus.open,
      BuddyPostStatus.full,
      BuddyPostStatus.closed,
      BuddyPostStatus.expired,
      BuddyPostStatus.cancelled,
    ];
    const Map<BuddyPostStatus, Set<BuddyPostStatus>> allowed =
        <BuddyPostStatus, Set<BuddyPostStatus>>{
      BuddyPostStatus.open: <BuddyPostStatus>{
        BuddyPostStatus.full,
        BuddyPostStatus.closed,
        BuddyPostStatus.expired,
        BuddyPostStatus.cancelled,
      },
      BuddyPostStatus.full: <BuddyPostStatus>{
        BuddyPostStatus.open,
        BuddyPostStatus.closed,
        BuddyPostStatus.expired,
        BuddyPostStatus.cancelled,
      },
      BuddyPostStatus.closed: <BuddyPostStatus>{},
      BuddyPostStatus.expired: <BuddyPostStatus>{},
      BuddyPostStatus.cancelled: <BuddyPostStatus>{},
    };

    test('5×5 全矩阵逐格校验', () {
      for (final BuddyPostStatus from in real) {
        for (final BuddyPostStatus to in real) {
          expect(
            canTransitionBuddyPost(from, to),
            allowed[from]!.contains(to),
            reason: '${from.wire} → ${to.wire}',
          );
        }
      }
    });

    test('自反一律为 false；unknown 永不参与转移', () {
      for (final BuddyPostStatus status in BuddyPostStatus.values) {
        expect(canTransitionBuddyPost(status, status), isFalse);
        expect(
            canTransitionBuddyPost(status, BuddyPostStatus.unknown), isFalse);
        expect(
            canTransitionBuddyPost(BuddyPostStatus.unknown, status), isFalse);
      }
    });

    test('状态收敛与语义', () {
      expect(BuddyPostStatus.fromWire('open'), BuddyPostStatus.open);
      expect(BuddyPostStatus.fromWire('FULL'), BuddyPostStatus.full);
      expect(BuddyPostStatus.fromWire('weird'), BuddyPostStatus.unknown);
      expect(BuddyPostStatus.open.isOpen, isTrue);
      expect(BuddyPostStatus.full.isOpen, isFalse);
      expect(BuddyPostStatus.closed.isTerminal, isTrue);
      expect(BuddyPostStatus.expired.isTerminal, isTrue);
      expect(BuddyPostStatus.cancelled.isTerminal, isTrue);
      expect(BuddyPostStatus.unknown.isTerminal, isTrue);
      expect(BuddyPostStatus.open.isTerminal, isFalse);
      expect(BuddyPostStatus.full.isTerminal, isFalse);
      // §5.9：列表查询条件是 status: 'OPEN'，FULL 帖只在详情可达。
      expect(BuddyPostStatus.open.appearsInList, isTrue);
      expect(BuddyPostStatus.full.appearsInList, isFalse);
      expect(BuddyPostStatus.open.canBeClosed, isTrue);
      expect(BuddyPostStatus.full.canBeClosed, isTrue);
      expect(BuddyPostStatus.closed.canBeClosed, isFalse);
    });
  });

  group('BuddyPost 解析与序列化', () {
    test('板块由 activity 派生，payload 里的 section 一律被忽略', () {
      final BuddyPost post = BuddyPost.fromJson(<String, Object?>{
        'id': 'bp-1',
        'activity': 'sport',
        // 恶意/异常 payload：客户端绝不能因此造出一个 dating 帖子。
        'section': 'dating',
        'title': '羽毛球',
        'location': '体育馆',
        'startsAt': '2026-10-19T06:00:00.000Z',
        'capacity': 4,
        'joinedCount': 2,
      });
      expect(post.section, BuddySection.sport);
      expect(post.activity, BuddyActivity.sport);
      expect(post.seatsLabel, '2/4 人');
      expect(post.remainingSeats, 2);
      expect(post.isFull, isFalse);
      expect(post.canJoin, isTrue);
    });

    test('敏感键（gender/age/birthDate/mbti/embedding/联系方式）永不被读取', () {
      final BuddyPost post = BuddyPost.fromJson(<String, Object?>{
        'id': 'bp-1',
        'activity': 'study',
        'title': '自习',
        'location': '图书馆',
        'startsAt': '2026-10-19T06:00:00.000Z',
        'capacity': 3,
        'joinedCount': 1,
        'gender': 'female',
        'age': 20,
        'birthDate': '2006-01-01',
        'mbti': 'INFP',
        'embedding': <double>[0.1, 0.2],
        'contact': 'vx: abc',
        'phone': '13800138000',
      });
      expect(post.toJson().containsKey('gender'), isFalse);
      expect(post.toJson().containsKey('age'), isFalse);
      expect(post.toJson().containsKey('birthDate'), isFalse);
      expect(post.toJson().containsKey('mbti'), isFalse);
      expect(post.toJson().containsKey('embedding'), isFalse);
      expect(post.toJson().containsKey('contact'), isFalse);
      expect(post.toJson().containsKey('phone'), isFalse);
      // 合法字段照常序列化（性别**偏好**是准入约束，不是被禁止的性别本身）。
      expect(post.toJson()['genderPreference'], 'any');
    });

    test('creator 支持嵌套对象与扁平字段两种形状', () {
      final BuddyPost nested = BuddyPost.fromJson(<String, Object?>{
        'id': 'bp-1',
        'activity': 'sport',
        'title': 't',
        'location': '体育馆',
        'startsAt': '2026-10-19T06:00:00.000Z',
        'capacity': 4,
        'creator': <String, Object?>{'id': 'u-1', 'nickname': '鸭鸭一号'},
      });
      expect(nested.creator.id, 'u-1');
      expect(nested.creator.displayName, '鸭鸭一号');
      expect(nested.isCreatedBy('u-1'), isTrue);

      final BuddyPost flat = BuddyPost.fromJson(<String, Object?>{
        'id': 'bp-2',
        'activity': 'sport',
        'title': 't',
        'location': '体育馆',
        'startsAt': '2026-10-19T06:00:00.000Z',
        'capacity': 4,
        'creatorId': 'u-2',
        'creatorName': '论文中',
      });
      expect(flat.creator.displayName, '论文中');
    });

    test('minSkillLevel / durationMin / endsAtOrNull', () {
      final BuddyPost post = BuddyPost.fromJson(<String, Object?>{
        'id': 'bp-1',
        'activity': 'sport',
        'title': 't',
        'location': '体育馆',
        'startsAt': '2026-10-19T06:00:00.000Z',
        'capacity': 4,
        'durationMin': 120,
        'minSkillLevel': 'regular',
      });
      expect(post.minSkillLevel, BuddySkillLevel.regular);
      expect(post.durationMin, 120);
      expect(post.endsAtOrNull, DateTime.utc(2026, 10, 19, 8));

      // `copyWith` 的 `??` 语义无法把可空字段置空，因此这里直接构造。
      final BuddyPost noDuration = BuddyPost(
        id: post.id,
        activity: post.activity,
        title: post.title,
        location: post.location,
        startsAt: post.startsAt,
        capacity: post.capacity,
        creator: post.creator,
      );
      expect(noDuration.durationMin, isNull);
      expect(noDuration.endsAtOrNull, isNull);
    });

    test('满员帖不可申请；joinedCount 含发起人（契约 §11.10-D）', () {
      final BuddyPost full = BuddyPost(
        id: 'bp-1',
        activity: BuddyActivity.sport,
        title: 't',
        location: '体育馆',
        startsAt: DateTime.utc(2026, 10, 19, 6),
        capacity: 4,
        joinedCount: 4,
        creator: const BuddyCreator(id: 'u-1'),
      );
      expect(full.isFull, isTrue);
      expect(full.remainingSeats, 0);
      expect(full.canJoin, isFalse);
      expect(full.seatsLabel, '4/4 人');
    });
  });

  group('BuddyPostQuery 查询串', () {
    test('板块 / 活动 / 标签 / 时间 / 游标 / 排序', () {
      final Map<String, Object?> query = BuddyPostQuery(
        section: BuddySection.sport,
        activities: const <BuddyActivity>[
          BuddyActivity.sport,
          BuddyActivity.game
        ],
        tags: const <String>['badminton', 'gym'],
        startsAfter: DateTime.utc(2026, 10, 17, 4),
        cursor: 'opaque-cursor',
        limit: 20,
      ).toQuery();

      expect(query['section'], 'sport');
      expect(query['activity'], 'sport,game');
      expect(query['tags'], 'badminton,gym');
      expect(query['startsAfter'], '2026-10-17T04:00:00.000Z');
      expect(query['cursor'], 'opaque-cursor');
      expect(query['limit'], 20);
      expect(query['sort'], 'startsAt_asc');
    });

    test('unknown 板块不作为筛选条件下发；limit 收敛到 1–100', () {
      final Map<String, Object?> query = BuddyPostQuery(
        section: BuddySection.unknown,
        limit: 500,
      ).toQuery();
      expect(query.containsKey('section'), isFalse);
      expect(query['limit'], maxBuddyPageSize);

      expect(BuddyPostQuery(limit: 0).toQuery()['limit'], 1);
    });
  });

  group('BuddyPostDraft 校验（规格 §5.4 的错误表）', () {
    final DateTime now = DateTime.utc(2026, 10, 17, 4);
    BuddyPostDraft valid() => BuddyPostDraft(
          activity: BuddyActivity.sport,
          title: '周六下午羽毛球，缺 2 人',
          description: '体育馆 3 号场，打两小时，新手也行',
          location: '体育馆',
          startsAt: now.add(const Duration(days: 2)),
          durationMin: 120,
          capacity: 4,
          tags: const <String>['badminton', 'gym'],
        );

    test('合法草稿：无错误，且命令里不含 creatorId / section', () {
      final BuddyPostDraft draft = valid();
      expect(draft.validationErrorsAt(now), isEmpty);
      expect(draft.isValidAt(now), isTrue);

      final Map<String, Object?> body = draft.toCommand().toJson();
      expect(body.containsKey('creatorId'), isFalse, reason: '发起人由后端从 JWT 取');
      expect(body.containsKey('section'), isFalse, reason: '板块由 activity 派生');
      expect(body['activity'], 'sport');
      expect(body['tags'], <String>['badminton', 'gym']);
      expect(body['startsAt'], isA<String>());
    });

    test('标题：空 / 超 60 字', () {
      expect(valid().copyWith(title: '  ').titleError, isNotNull);
      expect(
        valid().copyWith(title: repeat('鸭', 61)).titleError,
        contains('$buddyTitleMaxLength'),
      );
      expect(valid().copyWith(title: repeat('鸭', 60)).titleError, isNull);
    });

    test('说明：超 1000 字 / 含联系方式', () {
      expect(
        valid().copyWith(description: repeat('鸭', 1001)).descriptionError,
        isNotNull,
      );
      expect(
        valid().copyWith(description: '加我微信：abc123').descriptionError,
        contains('微信号'),
      );
      expect(
        valid().copyWith(description: '电话 13800138000').descriptionError,
        contains('手机号'),
      );
      expect(
        valid().copyWith(description: 'QQ: 123456789').descriptionError,
        contains('QQ'),
      );
      expect(valid().copyWith(description: '一起打羽毛球').descriptionError, isNull);
    });

    test('联系方式检测不误伤普通英文单词（对规格正则的收敛）', () {
      // 规格 §6.4 的 `[Vv]信?\s*[:：]?\s*\w+` 会把 video / version 判成微信。
      expect(buddyContactInfoKind('watch a video together'), isNull);
      expect(buddyContactInfoKind('version 2 of the plan'), isNull);
      expect(buddyContactInfoKind('v: myid'), isNotNull);
      expect(buddyContactInfoKind('v信：myid'), isNotNull);
    });

    test('地点：必须在校园地点白名单里', () {
      expect(valid().copyWith(location: '').locationError, isNotNull);
      expect(valid().copyWith(location: '月球基地').locationError, contains('白名单'));
      expect(valid().copyWith(location: '图书馆').locationError, isNull);
    });

    test('开始时间：必须晚于当前', () {
      expect(valid().copyWith(startsAt: now).startsAtErrorAt(now), isNotNull);
      expect(
        valid()
            .copyWith(startsAt: now.subtract(const Duration(minutes: 1)))
            .startsAtErrorAt(now),
        isNotNull,
      );
      expect(valid().startsAtErrorAt(now), isNull);
    });

    test('人数 2–20、时长 30–480', () {
      expect(valid().copyWith(capacity: 1).capacityError, isNotNull);
      expect(valid().copyWith(capacity: 21).capacityError, isNotNull);
      expect(valid().copyWith(capacity: 2).capacityError, isNull);
      expect(valid().copyWith(capacity: 20).capacityError, isNull);

      expect(valid().copyWith(durationMin: 10).durationError, isNotNull);
      expect(valid().copyWith(durationMin: 481).durationError, isNotNull);
      expect(valid().copyWith(durationMin: 30).durationError, isNull);
      expect(valid().copyWith(durationMin: 480).durationError, isNull);
    });

    test('标签：封闭表 + 数量上限（UNKNOWN_TAG:<key>）', () {
      expect(isKnownBuddyTag('badminton'), isTrue);
      expect(isKnownBuddyTag('quidditch'), isFalse);
      expect(
        valid()
            .copyWith(tags: const <String>['badminton', 'quidditch']).tagsError,
        contains('UNKNOWN_TAG:quidditch'),
      );
      expect(
        valid().copyWith(
          tags: const <String>[
            'badminton',
            'gym',
            'hiking',
            'running',
            'gym',
            'swimming',
            'tennis',
            'yoga',
            'cycling',
          ],
        ).tagsError,
        contains('$buddyPostTagMaxCount'),
      );
      expect(valid().tagsError, isNull);
    });

    test('minSkillLevel 只对 sport 板块生效', () {
      final BuddyPostDraft sport = valid().copyWith(
        minSkillLevel: BuddySkillLevel.regular,
      );
      expect(sport.effectiveMinSkillLevel, BuddySkillLevel.regular);

      final BuddyPostDraft academic = valid()
          .copyWith(activity: BuddyActivity.study)
          .copyWith(minSkillLevel: BuddySkillLevel.regular);
      expect(academic.section, BuddySection.academic);
      expect(academic.effectiveMinSkillLevel, isNull,
          reason: '§2.3：仅 sport 使用');
    });

    test('validationErrorsAt 一次给出全部字段错误', () {
      final Map<String, String> errors = BuddyPostDraft(
        activity: BuddyActivity.sport,
        startsAt: now,
        capacity: 1,
        tags: const <String>['nope'],
      ).validationErrorsAt(now);

      expect(
          errors.keys, containsAll(<String>['title', 'location', 'startsAt']));
      expect(errors.keys, containsAll(<String>['capacity', 'tags']));
    });
  });

  group('性别偏好与技能水平', () {
    test('性别偏好收敛（是准入约束，不参与打分）', () {
      expect(
          BuddyGenderPreference.fromWire('same'), BuddyGenderPreference.same);
      expect(BuddyGenderPreference.fromWire('nonsense'),
          BuddyGenderPreference.any);
      expect(BuddyGenderPreference.same.label, '同性');
    });

    test('技能水平有单调序（F6 的硬过滤用 rank 比较）', () {
      expect(
          BuddySkillLevel.beginner.rank, lessThan(BuddySkillLevel.casual.rank));
      expect(
          BuddySkillLevel.casual.rank, lessThan(BuddySkillLevel.regular.rank));
      expect(BuddySkillLevel.regular.rank,
          lessThan(BuddySkillLevel.competitive.rank));
      expect(BuddySkillLevel.fromWire('weird'), BuddySkillLevel.casual);
    });
  });
}
