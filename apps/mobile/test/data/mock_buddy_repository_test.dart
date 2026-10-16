import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/mock/buddy_fixtures.dart';
import 'package:kedaya/data/mock/mock_buddy_repository.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/buddy.dart';
import 'package:kedaya/domain/models/buddy_application.dart';
import 'package:kedaya/domain/models/buddy_matching.dart';
import 'package:kedaya/domain/models/buddy_profile.dart';
import 'package:kedaya/domain/models/page.dart';
import 'package:kedaya/domain/models/result.dart';

/// `MockBuddyRepository` 的行为测试（规格 §5.3–§5.9 / §6.1）。
///
/// 固定时钟 = `2026-10-17T04:00Z`（上海 **周六 12:00**），因此 fixtures 的
/// 「未来活动」与星期判定都是可复现的。
void main() {
  final DateTime fixedNow = DateTime.utc(2026, 10, 17, 4);

  MockBuddyRepository repo({
    MockControls? controls,
    BuddyProfile? profile,
    List<BuddyPost>? posts,
    List<BuddyApplication>? applications,
    String? currentUserGender,
    Map<String, String>? creatorGenders,
  }) => MockBuddyRepository(
    controls: controls ?? MockControls(latency: Duration.zero),
    clock: () => fixedNow,
    profile: profile,
    posts: posts,
    applications: applications,
    currentUserGender: currentUserGender,
    creatorGenders: creatorGenders,
  );

  String? reasonOf(Result<Object?> result) {
    final Object? details = result.errorOrNull?.details;
    if (details is Map<String, Object?>) return details['reason'] as String?;
    return null;
  }

  /// 一份「可以自定义所有匹配特征」的帖子（默认在我可控的未来时间）。
  BuddyPost customPost({
    String id = 'bp-custom',
    BuddyActivity activity = BuddyActivity.sport,
    BuddyPostStatus status = BuddyPostStatus.open,
    int capacity = 4,
    int joinedCount = 1,
    int? durationMin = 60,
    BuddySkillLevel? minSkillLevel,
    BuddyGenderPreference genderPreference = BuddyGenderPreference.any,
    List<String> tags = const <String>['badminton'],
    String creatorId = 'u-9999',
    int dayOffset = 1,
    int hour = 19,
  }) => BuddyPost(
    id: id,
    activity: activity,
    title: '自定义活动',
    location: '体育馆',
    startsAt: buddyShanghaiInstant(fixedNow, dayOffset: dayOffset, hour: hour),
    durationMin: durationMin,
    capacity: capacity,
    joinedCount: joinedCount,
    status: status,
    minSkillLevel: minSkillLevel,
    genderPreference: genderPreference,
    tags: tags,
    creator: BuddyCreator(id: creatorId, nickname: creatorId),
    createdAt: fixedNow,
  );

  group('listPosts：状态 / 板块 / 过滤 / 排序', () {
    test('只返回 OPEN 且未开始的活动，按 startsAt 升序', () async {
      final Page<BuddyPost> page = (await repo().listPosts(
        const BuddyPostQuery(limit: 50),
      )).unwrap;

      expect(
        page.items.map((BuddyPost post) => post.id),
        <String>['bp-1003', 'bp-1002', 'bp-1001', 'bp-1006', 'bp-1005', 'bp-1010'],
      );
      expect(page.total, 6);
      // FULL / EXPIRED / CLOSED / CANCELLED 一律不在列表里（规格 §5.9）。
      final Set<String> ids = page.items.map((BuddyPost post) => post.id).toSet();
      expect(ids, isNot(contains('bp-1004')));
      expect(ids, isNot(contains('bp-1007')));
      expect(ids, isNot(contains('bp-1008')));
      expect(ids, isNot(contains('bp-1009')));
    });

    test('按板块筛选（三板块分栏）', () async {
      Future<List<String>> idsFor(BuddySection section) async => (await repo().listPosts(
        BuddyPostQuery(section: section, limit: 50),
      )).unwrap.items.map((BuddyPost post) => post.id).toList();

      expect(await idsFor(BuddySection.sport), <String>['bp-1001', 'bp-1006', 'bp-1010']);
      expect(await idsFor(BuddySection.academic), <String>['bp-1002']);
      expect(await idsFor(BuddySection.daily), <String>['bp-1003', 'bp-1005']);
      // unknown 板块不是筛选条件（不做 dating）。
      expect(
        (await repo().listPosts(const BuddyPostQuery(section: BuddySection.unknown, limit: 50)))
            .unwrap
            .total,
        6,
      );
    });

    test('按 activity 与 tags 过滤（标签命中任一即返回）', () async {
      final Page<BuddyPost> byActivity = (await repo().listPosts(
        const BuddyPostQuery(activities: <BuddyActivity>[BuddyActivity.game], limit: 50),
      )).unwrap;
      expect(byActivity.items.map((BuddyPost post) => post.id), <String>['bp-1006']);

      final Page<BuddyPost> byTag = (await repo().listPosts(
        const BuddyPostQuery(tags: <String>['hotpot'], limit: 50),
      )).unwrap;
      expect(byTag.items.map((BuddyPost post) => post.id), <String>['bp-1003']);
    });

    test('startsAfter 过滤', () async {
      final Page<BuddyPost> page = (await repo().listPosts(
        BuddyPostQuery(
          startsAfter: fixedNow.add(const Duration(days: 3)),
          limit: 50,
        ),
      )).unwrap;
      expect(page.items.map((BuddyPost post) => post.id), <String>['bp-1005', 'bp-1010']);
    });

    test('游标分页：不重不漏（契约 §11.10-E 的不透明复合游标）', () async {
      final MockBuddyRepository repository = repo();
      final List<String> collected = <String>[];
      String? cursor;
      int guard = 0;
      do {
        final Page<BuddyPost> page = (await repository.listPosts(
          BuddyPostQuery(cursor: cursor, limit: 4),
        )).unwrap;
        collected.addAll(page.items.map((BuddyPost post) => post.id));
        cursor = page.nextCursor;
        guard++;
      } while (cursor != null && guard < 10);

      expect(collected, <String>[
        'bp-1003',
        'bp-1002',
        'bp-1001',
        'bp-1006',
        'bp-1005',
        'bp-1010',
      ]);
      expect(collected.toSet(), hasLength(collected.length), reason: '不能重复');
    });

    test('游标对客户端不透明：损坏的游标被忽略（等价第一页），不抛异常', () async {
      final Page<BuddyPost> page = (await repo().listPosts(
        const BuddyPostQuery(cursor: 'not-a-valid-cursor!!', limit: 2),
      )).unwrap;
      expect(page.items, hasLength(2));
      expect(page.items.first.id, 'bp-1003');
    });

    test('limit 收敛到 1–100', () async {
      expect((await repo().listPosts(const BuddyPostQuery(limit: 0))).unwrap.items, hasLength(1));
      expect(
        (await repo().listPosts(const BuddyPostQuery(limit: 1000))).unwrap.items,
        hasLength(6),
      );
    });
  });

  group('getPost：可见性', () {
    test('已满 / 已过期可按 id 打开（不在列表里但详情可达）', () async {
      expect((await repo().getPost('bp-1004')).unwrap.status, BuddyPostStatus.full);
      expect((await repo().getPost('bp-1007')).unwrap.status, BuddyPostStatus.expired);
    });

    test('已取消的活动：发起人可见，他人按 NOT_FOUND（不泄露"它存在"）', () async {
      final Result<BuddyPost> other = await repo().getPost('bp-1009');
      expect(other.isErr, isTrue);
      expect(other.errorOrNull!.code, ApiErrorCode.notFound);

      final BuddyPost mine = customPost(
        id: 'bp-mine',
        status: BuddyPostStatus.cancelled,
        creatorId: buddyMockCurrentUserId,
      );
      final Result<BuddyPost> own = await repo(posts: <BuddyPost>[mine]).getPost('bp-mine');
      expect(own.isOk, isTrue);
    });

    test('不存在 → NOT_FOUND', () async {
      expect((await repo().getPost('bp-nope')).errorOrNull!.code, ApiErrorCode.notFound);
    });
  });

  group('createPost：校验与语义', () {
    CreateBuddyPostCommand command({
      String title = '周六下午羽毛球，缺 2 人',
      String? description,
      String location = '体育馆 3 号场',
      DateTime? startsAt,
      int capacity = 4,
      int? durationMin = 120,
      List<String> tags = const <String>['badminton', 'indoor'],
    }) => CreateBuddyPostCommand(
      activity: BuddyActivity.sport,
      title: title,
      description: description,
      location: location,
      startsAt: startsAt ?? fixedNow.add(const Duration(days: 2)),
      capacity: capacity,
      durationMin: durationMin,
      tags: tags,
    );

    test('成功：joinedCount 初值 1（含发起人）、状态 OPEN、creator 是我', () async {
      final BuddyPost created = (await repo().createPost(command())).unwrap;
      expect(created.joinedCount, 1);
      expect(created.status, BuddyPostStatus.open);
      expect(created.creator.id, buddyMockCurrentUserId);
      expect(created.section, BuddySection.sport);
      expect(created.seatsLabel, '1/4 人');
    });

    test('字段级校验逐条给出 details.reason（规格 §5.4）', () async {
      final MockBuddyRepository repository = repo();

      expect(reasonOf(await repository.createPost(command(title: ' '))), 'title');
      expect(
        reasonOf(await repository.createPost(command(location: '月球基地'))),
        'UNKNOWN_LOCATION',
      );
      expect(reasonOf(await repository.createPost(command(capacity: 1))), 'capacity');
      expect(
        reasonOf(await repository.createPost(command(durationMin: 5))),
        'durationMin',
      );
      expect(
        reasonOf(await repository.createPost(command(tags: const <String>['quidditch']))),
        'UNKNOWN_TAG:quidditch',
      );
      expect(
        reasonOf(await repository.createPost(command(description: '加我微信：abc'))),
        'CONTACT_INFO_IN_DESCRIPTION',
      );
      expect(
        reasonOf(
          await repository.createPost(
            command(startsAt: fixedNow.subtract(const Duration(hours: 1))),
          ),
        ),
        'startsAt',
      );
    });
  });

  group('join / leave：申请不占名额（规格 §5.5）', () {
    test('join 成功但 joinedCount **不变**', () async {
      final MockBuddyRepository repository = repo();
      final BuddyApplication application = (await repository.join(
        const BuddyJoinCommand(postId: 'bp-1003', message: '一起？'),
      )).unwrap;

      expect(application.status, BuddyApplicationStatus.pending);
      expect(application.applicantId, buddyMockCurrentUserId);
      expect(application.message, '一起？');
      expect((await repository.getPost('bp-1003')).unwrap.joinedCount, 3);
    });

    test('申请自己的活动 / 满员 / 非 OPEN / 重复申请 的冲突码', () async {
      final MockBuddyRepository repository = repo();

      final Result<BuddyApplication> own = await repository.join(
        const BuddyJoinCommand(postId: 'bp-1005'),
      );
      expect(own.errorOrNull!.code, ApiErrorCode.conflict);
      expect(reasonOf(own), 'CANNOT_JOIN_OWN_POST');

      // 规格 §5.5 的参考实现**先查 status 再查名额**，因此 FULL 帖报 POST_NOT_OPEN。
      // 这是规格自身的检查顺序，本端逐字对齐（并在 README §6 记录这个怪癖）。
      expect(
        reasonOf(await repository.join(const BuddyJoinCommand(postId: 'bp-1004'))),
        'POST_NOT_OPEN',
      );
      expect(
        reasonOf(await repository.join(const BuddyJoinCommand(postId: 'bp-1008'))),
        'POST_NOT_OPEN',
      );
      // `POST_FULL` 只在「状态还是 OPEN 但名额已满」这种不一致态下触发 ——
      // 它正是规格那段 `FOR UPDATE` 事务要防的情形。
      final MockBuddyRepository inconsistent = repo(
        posts: <BuddyPost>[customPost(id: 'bp-over', capacity: 2, joinedCount: 2)],
      );
      expect(
        reasonOf(await inconsistent.join(const BuddyJoinCommand(postId: 'bp-over'))),
        'POST_FULL',
      );
      // bp-1001 上我有一条 ACCEPTED 申请。
      expect(
        reasonOf(await repository.join(const BuddyJoinCommand(postId: 'bp-1001'))),
        'ALREADY_APPLIED',
      );
      expect((await repository.join(const BuddyJoinCommand(postId: 'bp-nope')))
          .errorOrNull!
          .code, ApiErrorCode.notFound);
    });

    test('撤回后重新申请**复用同一行**（@@unique([postId, applicantId])）', () async {
      final MockBuddyRepository repository = repo();
      // bp-1006 上我原本有一条 PENDING 的 ba-2003。
      final BuddyApplication withdrawn = (await repository.leave('bp-1006')).unwrap;
      expect(withdrawn.status, BuddyApplicationStatus.withdrawn);
      expect(withdrawn.id, 'ba-2003');

      final BuddyApplication again = (await repository.join(
        const BuddyJoinCommand(postId: 'bp-1006'),
      )).unwrap;
      expect(again.id, 'ba-2003', reason: '不是插新行，是更新回 PENDING');
      expect(again.status, BuddyApplicationStatus.pending);
      expect(
        repository
            .snapshotApplications()
            .where((BuddyApplication item) => item.postId == 'bp-1006')
            .length,
        1,
      );
    });

    test('已接受 / 非待审批的申请不能撤回', () async {
      final MockBuddyRepository repository = repo();
      final Result<BuddyApplication> accepted = await repository.leave('bp-1001');
      expect(accepted.errorOrNull!.code, ApiErrorCode.conflict);
      expect(reasonOf(accepted), 'APPLICATION_NOT_PENDING');

      expect((await repository.leave('bp-1003')).errorOrNull!.code, ApiErrorCode.notFound);
    });

    test('F5 性别准入（客户端不采集性别，这里是测试旋钮）', () async {
      final BuddyPost sameGender = customPost(
        id: 'bp-gender',
        genderPreference: BuddyGenderPreference.same,
        creatorId: 'u-3001',
      );

      final MockBuddyRepository compatible = repo(
        posts: <BuddyPost>[sameGender],
        currentUserGender: 'female',
        creatorGenders: <String, String>{'u-3001': 'female'},
      );
      expect(
        (await compatible.join(const BuddyJoinCommand(postId: 'bp-gender'))).isOk,
        isTrue,
      );

      final MockBuddyRepository incompatible = repo(
        posts: <BuddyPost>[sameGender],
        currentUserGender: 'female',
        creatorGenders: <String, String>{'u-3001': 'male'},
      );
      final Result<BuddyApplication> blocked = await incompatible.join(
        const BuddyJoinCommand(postId: 'bp-gender'),
      );
      expect(blocked.errorOrNull!.code, ApiErrorCode.forbidden);
      expect(reasonOf(blocked), 'GENDER_PREFERENCE_MISMATCH');

      // 不传性别（客户端真实情况）→ 不做判定，不误伤。
      final MockBuddyRepository unknown = repo(posts: <BuddyPost>[sameGender]);
      expect((await unknown.join(const BuddyJoinCommand(postId: 'bp-gender'))).isOk, isTrue);
    });

    test('F6 运动水平低于 minSkillLevel → FORBIDDEN', () async {
      final BuddyPost hard = customPost(
        id: 'bp-hard',
        minSkillLevel: BuddySkillLevel.competitive,
      );
      final Result<BuddyApplication> blocked = await repo(
        posts: <BuddyPost>[hard],
      ).join(const BuddyJoinCommand(postId: 'bp-hard'));

      expect(blocked.errorOrNull!.code, ApiErrorCode.forbidden);
      expect(reasonOf(blocked), 'SKILL_LEVEL_TOO_LOW');
    });
  });

  group('decide / close（规格 §5.6）', () {
    test('ACCEPTED 递增 joinedCount；满员自动转 FULL', () async {
      final MockBuddyRepository repository = repo();
      // bp-1005：capacity 2 / joined 1，ba-2001 是别人对我的待审批申请。
      final BuddyApplication decided = (await repository.decide(
        const BuddyDecideCommand(
          postId: 'bp-1005',
          applicationId: 'ba-2001',
          decision: BuddyDecision.accepted,
        ),
      )).unwrap;

      expect(decided.status, BuddyApplicationStatus.accepted);
      expect(decided.decidedBy, buddyMockCurrentUserId);
      expect(decided.decidedAt, isNotNull);

      final BuddyPost post = (await repository.getPost('bp-1005')).unwrap;
      expect(post.joinedCount, 2);
      expect(post.status, BuddyPostStatus.full);
      expect(post.isFull, isTrue);
    });

    test('REJECTED 不改变 joinedCount', () async {
      final MockBuddyRepository repository = repo();
      final BuddyApplication decided = (await repository.decide(
        const BuddyDecideCommand(
          postId: 'bp-1005',
          applicationId: 'ba-2001',
          decision: BuddyDecision.rejected,
        ),
      )).unwrap;
      expect(decided.status, BuddyApplicationStatus.rejected);
      expect((await repository.getPost('bp-1005')).unwrap.joinedCount, 1);
    });

    test('非发起人审批 → FORBIDDEN；重复审批 → CONFLICT', () async {
      final MockBuddyRepository repository = repo();
      final Result<BuddyApplication> foreign = await repository.decide(
        const BuddyDecideCommand(
          postId: 'bp-1001',
          applicationId: 'ba-2002',
          decision: BuddyDecision.accepted,
        ),
      );
      expect(foreign.errorOrNull!.code, ApiErrorCode.forbidden);

      await repository.decide(
        const BuddyDecideCommand(
          postId: 'bp-1005',
          applicationId: 'ba-2001',
          decision: BuddyDecision.accepted,
        ),
      );
      final Result<BuddyApplication> again = await repository.decide(
        const BuddyDecideCommand(
          postId: 'bp-1005',
          applicationId: 'ba-2001',
          decision: BuddyDecision.accepted,
        ),
      );
      expect(again.errorOrNull!.code, ApiErrorCode.conflict);
      expect(reasonOf(again), 'APPLICATION_NOT_PENDING');
    });

    test('名额已满时接受 → CONFLICT / POST_FULL', () async {
      final BuddyPost full = customPost(
        id: 'bp-full',
        capacity: 2,
        joinedCount: 2,
        creatorId: buddyMockCurrentUserId,
      );
      final MockBuddyRepository repository = repo(
        posts: <BuddyPost>[full],
        applications: <BuddyApplication>[
          BuddyApplication(
            id: 'ba-x',
            postId: 'bp-full',
            applicantId: 'u-9',
            createdAt: fixedNow,
          ),
        ],
      );
      final Result<BuddyApplication> result = await repository.decide(
        const BuddyDecideCommand(
          postId: 'bp-full',
          applicationId: 'ba-x',
          decision: BuddyDecision.accepted,
        ),
      );
      expect(result.errorOrNull!.code, ApiErrorCode.conflict);
      expect(reasonOf(result), 'POST_FULL');
    });

    test('close：仅发起人，且只在 OPEN / FULL 可关', () async {
      final MockBuddyRepository repository = repo();
      expect((await repository.closePost('bp-1005')).unwrap.status, BuddyPostStatus.closed);
      // 已关闭的再关一次 → CONFLICT / POST_NOT_OPEN。
      expect(reasonOf(await repository.closePost('bp-1005')), 'POST_NOT_OPEN');
      // 别人的帖子 → FORBIDDEN（先判归属，再判状态）。
      expect(
        (await repository.closePost('bp-1001')).errorOrNull!.code,
        ApiErrorCode.forbidden,
      );
      expect(
        (await repository.closePost('bp-1008')).errorOrNull!.code,
        ApiErrorCode.forbidden,
      );
      expect(
        (await repository.closePost('bp-nope')).errorOrNull!.code,
        ApiErrorCode.notFound,
      );
    });
  });

  group('listApplications（规格 §6.1 可见性）', () {
    test('不带 postId = 我作为申请人的列表（按时间倒序）', () async {
      final List<BuddyApplication> mine = (await repo().listApplications()).unwrap;
      expect(
        mine.map((BuddyApplication item) => item.id),
        <String>['ba-2003', 'ba-2002'],
      );
    });

    test('带 postId = 我作为发起人收到的申请', () async {
      final List<BuddyApplication> received = (await repo().listApplications(
        postId: 'bp-1005',
      )).unwrap;
      expect(received.map((BuddyApplication item) => item.id), <String>['ba-2001']);
    });

    test('不是发起人 → FORBIDDEN（申请人列表对他人不可见）', () async {
      final Result<List<BuddyApplication>> result = await repo().listApplications(
        postId: 'bp-1001',
      );
      expect(result.errorOrNull!.code, ApiErrorCode.forbidden);
    });
  });

  group('submitFeedback（规格 §5.8 / §2.5 的 UPSERT）', () {
    BuddyMatchFeedback feedback({
      String postId = 'bp-1001',
      BuddySection section = BuddySection.sport,
      BuddyMatchFeedbackAction action = BuddyMatchFeedbackAction.like,
    }) => BuddyMatchFeedback(
      userId: 'u-forged',
      targetPostId: postId,
      section: section,
      action: action,
      createdAt: fixedNow,
    );

    test('成功；反馈者由服务端决定（忽略入参里的 userId）', () async {
      final MockBuddyRepository repository = repo();
      final BuddyMatchFeedback stored = (await repository.submitFeedback(
        feedback(),
      )).unwrap;
      expect(stored.userId, buddyMockCurrentUserId);
      expect(stored.action, BuddyMatchFeedbackAction.like);
    });

    test('section 必须与帖子所属板块一致 → SECTION_MISMATCH', () async {
      final Result<BuddyMatchFeedback> result = await repo().submitFeedback(
        feedback(section: BuddySection.academic),
      );
      expect(result.errorOrNull!.code, ApiErrorCode.validationFailed);
      expect(reasonOf(result), 'SECTION_MISMATCH');
    });

    test('UPSERT：同一 (userId, postId, section) 只保留最后一条', () async {
      final MockBuddyRepository repository = repo();
      await repository.submitFeedback(feedback());
      await repository.submitFeedback(
        feedback(action: BuddyMatchFeedbackAction.dislike),
      );
      expect(repository.snapshotFeedbacks(), hasLength(1));
      expect(
        repository.snapshotFeedbacks().single.action,
        BuddyMatchFeedbackAction.dislike,
      );

      // 不同板块是不同的一行（隔离维度）。
      await repository.submitFeedback(
        feedback(postId: 'bp-1002', section: BuddySection.academic),
      );
      expect(repository.snapshotFeedbacks(), hasLength(2));
    });

    test('不存在的帖子 → NOT_FOUND', () async {
      expect(
        (await repo().submitFeedback(feedback(postId: 'bp-nope')))
            .errorOrNull!
            .code,
        ApiErrorCode.notFound,
      );
    });
  });

  group('匹配资料（规格 §2.2 / §6.3）', () {
    test('默认资料：matchEnabled=false（默认不参与）', () async {
      final BuddyProfile profile = (await repo().getMyProfile()).unwrap;
      expect(profile.matchEnabled, isFalse);
      expect(profile.isRecommendable, isFalse);
      expect(profile.hasAnySignal, isTrue);
    });

    test('保存合法资料；非法标签被拒（VALIDATION_FAILED）', () async {
      final MockBuddyRepository repository = repo();
      final BuddyProfile saved = (await repository.saveMyProfile(
        BuddyProfile(
          userId: 'someone-else',
          sections: const <BuddySection>[BuddySection.sport],
          interestTags: const <String>['badminton'],
          matchEnabled: true,
        ),
      )).unwrap;
      expect(saved.userId, buddyMockCurrentUserId, reason: 'userId 由服务端决定');
      expect(saved.isRecommendable, isTrue);

      final Result<BuddyProfile> bad = await repository.saveMyProfile(
        BuddyProfile(
          userId: buddyMockCurrentUserId,
          interestTags: const <String>['quidditch'],
          matchEnabled: true,
        ),
      );
      expect(bad.errorOrNull!.code, ApiErrorCode.validationFailed);
      expect(reasonOf(bad), 'interestTags');
    });

    test('删除资料后回到空白（可随时撤回）', () async {
      final MockBuddyRepository repository = repo();
      await repository.deleteMyProfile();
      final BuddyProfile profile = (await repository.getMyProfile()).unwrap;
      expect(profile.matchEnabled, isFalse);
      expect(profile.hasAnySignal, isFalse);
      expect(repository.snapshotProfile(), isNull);
    });
  });

  group('mock 三态开关', () {
    test('故障注入 → Err', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..failureMode = MockFailureMode.upstreamUnavailable;
      final Result<Page<BuddyPost>> result = await repo(
        controls: controls,
      ).listPosts(const BuddyPostQuery());
      expect(result.errorOrNull!.code, ApiErrorCode.upstreamUnavailable);
    });

    test('空结果开关 → Ok 空页', () async {
      final MockControls controls = MockControls(latency: Duration.zero)
        ..emptyResults = true;
      final Page<BuddyPost> page = (await repo(
        controls: controls,
      ).listPosts(const BuddyPostQuery())).unwrap;
      expect(page.items, isEmpty);
      expect(page.total, 0);
    });
  });
}
