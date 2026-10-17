import 'dart:convert';

import '../../domain/models/api_error.dart';
import '../../domain/models/buddy.dart';
import '../../domain/models/buddy_application.dart';
import '../../domain/models/buddy_matching.dart';
import '../../domain/models/buddy_profile.dart';
import '../../domain/models/buddy_tags.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/buddy_port.dart';
import 'buddy_fixtures.dart';
import 'mock_controls.dart';

/// [BuddyPort] 的内存实现 —— 让「找搭子」在**无后端**时可跑（契约 §7 硬规则 4）。
///
/// 实现的是**真实行为**而不是假数据：
///
/// - 游标分页（**不透明复合游标**，契约 §11.10-E），翻页不重不漏；
/// - 硬过滤 F1–F7 + 软打分（规格 §3.3）+ 可解释理由（§5.7）；
/// - `join` 只是**申请**、不占名额；`decide(ACCEPTED)` 才 `joinedCount += 1`（§5.5）；
/// - `@@unique([postId, applicantId])`：撤回后重新申请是**更新同一行**（§2.4）；
/// - 反馈 UPSERT + **section 隔离**（§3.6 / §8.2 T6）；
/// - 隐私：`BuddyProfile` 只进不出（没有任何响应模型带它），
///   `description` 里的联系方式被拒（§6.4）。
///
/// **mock 扮演服务端**：它内部持有各发起人的 [BuddyProfile] 只为算分，
/// 这些资料**不会**出现在任何返回给 UI 的模型里（规格 §6.1 的可见性矩阵）。
final class MockBuddyRepository implements BuddyPort {
  factory MockBuddyRepository({
    List<BuddyPost>? posts,
    List<BuddyApplication>? applications,
    BuddyProfile? profile,
    Map<String, BuddyProfile>? creatorProfiles,
    MockControls? controls,
    DateTime Function()? clock,
    String? currentUserId,
    String? currentUserName,
    String? currentUserGender,
    Map<String, String>? creatorGenders,
  }) {
    final DateTime Function() resolvedClock = clock ?? DateTime.now;
    final DateTime now = resolvedClock().toUtc();
    return MockBuddyRepository._(
      posts: posts ?? mockBuddyPosts(now),
      applications: applications ?? mockBuddyApplications(now),
      profile: profile ?? mockBuddyProfile(),
      creatorProfiles: creatorProfiles ?? mockBuddyCreatorProfiles(),
      controls: controls ?? MockControls(),
      clock: resolvedClock,
      currentUserId: currentUserId ?? buddyMockCurrentUserId,
      currentUserName: currentUserName ?? buddyMockCurrentUserName,
      currentUserGender: currentUserGender,
      creatorGenders: creatorGenders ?? const <String, String>{},
    );
  }

  MockBuddyRepository._({
    required List<BuddyPost> posts,
    required List<BuddyApplication> applications,
    required BuddyProfile? profile,
    required Map<String, BuddyProfile> creatorProfiles,
    required this.controls,
    required this.clock,
    required this.currentUserId,
    required this.currentUserName,
    required this.currentUserGender,
    required this.creatorGenders,
  })  : _posts = <String, BuddyPost>{
          for (final BuddyPost post in posts) post.id: post,
        },
        _applications = <String, BuddyApplication>{
          for (final BuddyApplication application in applications)
            application.id: application,
        },
        _creatorProfiles = Map<String, BuddyProfile>.of(creatorProfiles),
        _profile = profile;

  /// 当前登录用户 id。真实实现里它来自 JWT（由服务端决定）。
  final String currentUserId;

  final String currentUserName;

  /// **仅用于模拟 F5 / `GENDER_PREFERENCE_MISMATCH` 的测试旋钮**。
  ///
  /// 客户端**不采集**性别（规格 §6.3：无 `gender`、无 `age`、无 `birthDate`），
  /// 因此真实的 F5 判定只能在**服务端**做（服务端从 `profile` 模块知道性别）。
  /// mock 里 `null` 表示"未知 → 不做判定"。
  final String? currentUserGender;

  /// 各发起人的性别（同上，仅测试旋钮）。
  final Map<String, String> creatorGenders;

  /// 可在运行时切换延迟与故障（UI 三态演示 / 测试注入）。
  final MockControls controls;

  /// 时钟（fixtures 相对它生成，测试传固定值以获得可复现结果）。
  final DateTime Function() clock;

  final Map<String, BuddyPost> _posts;
  final Map<String, BuddyApplication> _applications;
  final Map<String, BuddyProfile> _creatorProfiles;

  /// 我对每个 (postId, section) 的反馈（`@@unique([userId, targetPostId, section])`）。
  final Map<String, BuddyMatchFeedback> _feedbacks =
      <String, BuddyMatchFeedback>{};

  BuddyProfile? _profile;

  int _postSequence = 1100;
  int _applicationSequence = 2100;

  DateTime get _now => clock().toUtc();

  // ------------------------------------------------------------ 测试观测点

  /// 供测试断言内部状态（不参与 UI）。
  List<BuddyPost> snapshotPosts() =>
      List<BuddyPost>.unmodifiable(_posts.values);

  List<BuddyApplication> snapshotApplications() =>
      List<BuddyApplication>.unmodifiable(_applications.values);

  List<BuddyMatchFeedback> snapshotFeedbacks() =>
      List<BuddyMatchFeedback>.unmodifiable(_feedbacks.values);

  BuddyProfile? snapshotProfile() => _profile;

  // ------------------------------------------------------------ 匹配资料

  @override
  Future<Result<BuddyProfile>> getMyProfile() async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<BuddyProfile>();
    // 没有资料时返回一份**空白**资料（`matchEnabled: false`），不是 404 ——
    // 「还没填」是正常状态，UI 需要能渲染空表单。
    return Ok<BuddyProfile>(_profile ?? BuddyProfile.empty(currentUserId));
  }

  @override
  Future<Result<BuddyProfile>> saveMyProfile(BuddyProfile profile) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<BuddyProfile>();

    final Map<String, String> errors = profile.validationErrors();
    if (errors.isNotEmpty) {
      final String field = errors.keys.first;
      return _fail<BuddyProfile>(
        ApiErrorCode.validationFailed,
        errors[field]!,
        reason: field,
      );
    }
    _profile = profile.copyWith(userId: currentUserId);
    return Ok<BuddyProfile>(_profile!);
  }

  @override
  Future<Result<Unit>> deleteMyProfile() async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<Unit>();
    // 硬删（含 embedding）：立即从推荐池移除（规格 §6.3「可随时撤回」）。
    _profile = null;
    _feedbacks.clear();
    return const Ok<Unit>(Unit.instance);
  }

  // ------------------------------------------------------------ 列表

  @override
  Future<Result<Page<BuddyPost>>> listPosts(BuddyPostQuery query) async {
    await controls.simulate();
    if (controls.failure != null)
      return controls.failureResult<Page<BuddyPost>>();
    if (controls.emptyResults) {
      return Ok<Page<BuddyPost>>(
          const Page<BuddyPost>(items: <BuddyPost>[], total: 0));
    }

    // 规格 §5.9 的列表条件逐字：`status: 'OPEN'` + `startsAt > startsAfter ?? now`
    // + `deletedAt: null`。`FULL` 帖不出现在列表，但可按 id 打开详情。
    Iterable<BuddyPost> candidates = _posts.values
        .where((BuddyPost post) => post.status.appearsInList)
        .where(
          (BuddyPost post) => post.startsAt.isAfter(query.startsAfter ?? _now),
        );

    final BuddySection? section = query.section;
    if (section != null && section.isMatchable) {
      candidates =
          candidates.where((BuddyPost post) => post.section == section);
    }
    if (query.activities.isNotEmpty) {
      candidates = candidates.where(
        (BuddyPost post) => query.activities.contains(post.activity),
      );
    }
    if (query.tags.isNotEmpty) {
      candidates = candidates.where(
        (BuddyPost post) => post.tags.any(query.tags.contains),
      );
    }

    final List<BuddyPost> all = candidates.toList(growable: false);
    _sortPosts(all, query.sort);

    final List<BuddyPost> window = _afterCursor(all, query.sort, query.cursor);
    final int limit = _clampLimit(query.limit, maxBuddyPageSize);
    final List<BuddyPost> pageItems =
        window.take(limit).toList(growable: false);
    final bool hasMore = window.length > pageItems.length;
    return Ok<Page<BuddyPost>>(
      Page<BuddyPost>(
        items: pageItems,
        nextCursor: hasMore && pageItems.isNotEmpty
            ? _encodeCursor(
                _sortKeyString(_sortKeyOf(pageItems.last, query.sort)),
                pageItems.last.id,
              )
            : null,
        total: all.length,
      ),
    );
  }

  @override
  Future<Result<BuddyPost>> getPost(String id) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<BuddyPost>();
    final BuddyPost? post = _posts[id];
    if (post == null) return _notFoundPost<BuddyPost>();
    // 已取消的活动对**非发起人**等同"不存在"（不泄露"它存在但被取消了"）。
    if (post.status == BuddyPostStatus.cancelled &&
        !post.isCreatedBy(currentUserId)) {
      return _notFoundPost<BuddyPost>();
    }
    return Ok<BuddyPost>(post);
  }

  @override
  Future<Result<BuddyPost>> createPost(CreateBuddyPostCommand command) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<BuddyPost>();

    final String title = command.title.trim();
    if (title.isEmpty) return _validation<BuddyPost>('请填写标题', 'title');
    if (title.runes.length > buddyTitleMaxLength) {
      return _validation<BuddyPost>(
        '标题请控制在 $buddyTitleMaxLength 字以内',
        'title',
      );
    }
    final String? description = command.description?.trim();
    if (description != null &&
        description.runes.length > buddyDescriptionMaxLength) {
      return _validation<BuddyPost>(
        '说明请控制在 $buddyDescriptionMaxLength 字以内',
        'description',
      );
    }
    if (description != null && buddyContactInfoKind(description) != null) {
      return _validation<BuddyPost>(
        '说明里不要填联系方式，组队成功后系统会自动交换',
        'CONTACT_INFO_IN_DESCRIPTION',
      );
    }
    if (!isKnownCampusLocation(command.location)) {
      return _validation<BuddyPost>('地点不在校园地点白名单里', 'UNKNOWN_LOCATION');
    }
    if (!command.startsAt.toUtc().isAfter(_now)) {
      return _validation<BuddyPost>('开始时间必须晚于当前时间', 'startsAt');
    }
    if (command.capacity < buddyCapacityMin ||
        command.capacity > buddyCapacityMax) {
      return _validation<BuddyPost>(
        '人数请填 $buddyCapacityMin–$buddyCapacityMax 人',
        'capacity',
      );
    }
    final int? duration = command.durationMin;
    if (duration != null &&
        (duration < buddyDurationMinMin || duration > buddyDurationMinMax)) {
      return _validation<BuddyPost>(
        '时长请填 $buddyDurationMinMin–$buddyDurationMinMax 分钟',
        'durationMin',
      );
    }
    if (command.tags.length > buddyPostTagMaxCount) {
      return _validation<BuddyPost>(
        '最多选 $buddyPostTagMaxCount 个标签',
        'tags',
      );
    }
    for (final String tag in command.tags) {
      if (!isKnownBuddyTag(tag)) {
        return _validation<BuddyPost>('标签「$tag」未登记', 'UNKNOWN_TAG:$tag');
      }
      if (!isActiveBuddyTag(tag)) {
        return _validation<BuddyPost>(
          '标签「${buddyTagLabel(tag)}」已下架',
          'UNKNOWN_TAG:$tag',
        );
      }
    }

    final BuddyPost created = BuddyPost(
      id: 'bp-${_postSequence++}',
      activity: command.activity,
      title: title,
      description: description,
      location: command.location.trim(),
      startsAt: command.startsAt.toUtc(),
      durationMin: duration,
      capacity: command.capacity,
      // 契约 §11.10-D：`joinedCount` **含发起人**，初值 1。
      joinedCount: 1,
      genderPreference: command.genderPreference,
      tags: command.tags,
      minSkillLevel: command.minSkillLevel,
      creator: BuddyCreator(id: currentUserId, nickname: currentUserName),
      status: BuddyPostStatus.open,
      createdAt: _now,
    );
    _posts[created.id] = created;
    return Ok<BuddyPost>(created);
  }

  @override
  Future<Result<BuddyPost>> closePost(String postId) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<BuddyPost>();
    final BuddyPost? post = _posts[postId];
    if (post == null) return _notFoundPost<BuddyPost>();
    if (!post.isCreatedBy(currentUserId)) {
      return _fail<BuddyPost>(ApiErrorCode.forbidden, '只有发起人可以关闭这个活动');
    }
    if (!post.status.canBeClosed) {
      return _fail<BuddyPost>(
        ApiErrorCode.conflict,
        '活动当前状态为「${post.status.label}」，不能关闭',
        reason: 'POST_NOT_OPEN',
      );
    }
    // 状态流转只走纯函数（契约 `02-domain-model.md:36` 规则 2）。
    if (!canTransitionBuddyPost(post.status, BuddyPostStatus.closed)) {
      return _fail<BuddyPost>(
        ApiErrorCode.conflict,
        '活动当前状态为「${post.status.label}」，不能关闭',
        reason: 'POST_NOT_OPEN',
      );
    }
    final BuddyPost closed = post.copyWith(status: BuddyPostStatus.closed);
    _posts[closed.id] = closed;
    return Ok<BuddyPost>(closed);
  }

  // ------------------------------------------------------------ 申请与审批

  @override
  Future<Result<BuddyApplication>> join(BuddyJoinCommand command) async {
    await controls.simulate();
    if (controls.failure != null)
      return controls.failureResult<BuddyApplication>();

    final String? messageError = command.messageError;
    if (messageError != null) {
      return _validation<BuddyApplication>(messageError, 'message');
    }

    final BuddyPost? post = _posts[command.postId];
    if (post == null) return _notFoundApplication<BuddyApplication>();

    if (post.isCreatedBy(currentUserId)) {
      return _fail<BuddyApplication>(
        ApiErrorCode.conflict,
        '不能申请自己发布的活动',
        reason: 'CANNOT_JOIN_OWN_POST',
      );
    }
    if (!post.status.isOpen) {
      return _fail<BuddyApplication>(
        ApiErrorCode.conflict,
        '活动当前状态为「${post.status.label}」，不能申请',
        reason: 'POST_NOT_OPEN',
      );
    }
    if (post.isFull) {
      return _fail<BuddyApplication>(
        ApiErrorCode.conflict,
        '活动已满员',
        reason: 'POST_FULL',
      );
    }

    final BuddyApplication? existing = _applicationOf(post.id, currentUserId);
    if (existing != null) {
      if (existing.status == BuddyApplicationStatus.pending ||
          existing.status == BuddyApplicationStatus.accepted ||
          existing.status == BuddyApplicationStatus.rejected) {
        return _fail<BuddyApplication>(
          ApiErrorCode.conflict,
          '你已经申请过这个活动了',
          reason: 'ALREADY_APPLIED',
        );
      }
      // WITHDRAWN → PENDING：复用同一行（`@@unique([postId, applicantId])`，规格 §2.4）。
      if (!canTransitionBuddyApplication(
        existing.status,
        BuddyApplicationStatus.pending,
      )) {
        return _fail<BuddyApplication>(
          ApiErrorCode.conflict,
          '当前状态不能重新申请',
          reason: 'ALREADY_APPLIED',
        );
      }
    }

    final String? genderError = _genderMismatchReason(post);
    if (genderError != null) {
      return _fail<BuddyApplication>(
        ApiErrorCode.forbidden,
        genderError,
        reason: 'GENDER_PREFERENCE_MISMATCH',
      );
    }
    final String? skillError = _skillLevelTooLowReason(post);
    if (skillError != null) {
      return _fail<BuddyApplication>(
        ApiErrorCode.forbidden,
        skillError,
        reason: 'SKILL_LEVEL_TOO_LOW',
      );
    }

    final String? trimmedMessage = command.message?.trim();
    final BuddyApplication application = BuddyApplication(
      id: existing?.id ?? 'ba-${_applicationSequence++}',
      postId: post.id,
      applicantId: currentUserId,
      applicantName: currentUserName,
      message: (trimmedMessage == null || trimmedMessage.isEmpty)
          ? null
          : trimmedMessage,
      status: BuddyApplicationStatus.pending,
      createdAt: _now,
    );
    _applications[application.id] = application;
    // ⚠️ `join` **不**递增 `joinedCount`（规格 §5.5 的语义澄清）。
    return Ok<BuddyApplication>(application);
  }

  @override
  Future<Result<BuddyApplication>> leave(String postId) async {
    await controls.simulate();
    if (controls.failure != null)
      return controls.failureResult<BuddyApplication>();

    final BuddyApplication? existing = _applicationOf(postId, currentUserId);
    if (existing == null) return _notFoundApplication<BuddyApplication>();
    if (!existing.status.isPending) {
      return _fail<BuddyApplication>(
        ApiErrorCode.conflict,
        '只有待审批的申请可以撤回',
        reason: 'APPLICATION_NOT_PENDING',
      );
    }
    if (!canTransitionBuddyApplication(
      existing.status,
      BuddyApplicationStatus.withdrawn,
    )) {
      return _fail<BuddyApplication>(
        ApiErrorCode.conflict,
        '只有待审批的申请可以撤回',
        reason: 'APPLICATION_NOT_PENDING',
      );
    }
    final BuddyApplication withdrawn = existing.copyWith(
      status: BuddyApplicationStatus.withdrawn,
    );
    _applications[withdrawn.id] = withdrawn;
    return Ok<BuddyApplication>(withdrawn);
  }

  @override
  Future<Result<BuddyApplication>> decide(BuddyDecideCommand command) async {
    await controls.simulate();
    if (controls.failure != null)
      return controls.failureResult<BuddyApplication>();

    final BuddyPost? post = _posts[command.postId];
    if (post == null) return _notFoundApplication<BuddyApplication>();
    if (!post.isCreatedBy(currentUserId)) {
      return _fail<BuddyApplication>(
        ApiErrorCode.forbidden,
        '只有发起人可以审批申请',
      );
    }
    final BuddyApplication? application = _applications[command.applicationId];
    if (application == null || application.postId != post.id) {
      return _notFoundApplication<BuddyApplication>();
    }
    if (!application.status.isPending) {
      return _fail<BuddyApplication>(
        ApiErrorCode.conflict,
        '该申请已经是「${application.status.label}」',
        reason: 'APPLICATION_NOT_PENDING',
      );
    }
    if (!canTransitionBuddyApplication(
        application.status, command.decision.targetStatus)) {
      return _fail<BuddyApplication>(
        ApiErrorCode.conflict,
        '该申请不能转移到「${command.decision.targetStatus.label}」',
        reason: 'APPLICATION_NOT_PENDING',
      );
    }

    if (command.decision == BuddyDecision.accepted) {
      if (post.isFull) {
        return _fail<BuddyApplication>(
          ApiErrorCode.conflict,
          '活动已满员',
          reason: 'POST_FULL',
        );
      }
      final int joined = post.joinedCount + 1;
      _posts[post.id] = post.copyWith(
        joinedCount: joined,
        status: joined >= post.capacity ? BuddyPostStatus.full : post.status,
      );
    }

    final BuddyApplication decided = application.copyWith(
      status: command.decision.targetStatus,
      decidedAt: _now,
      decidedBy: currentUserId,
    );
    _applications[decided.id] = decided;
    return Ok<BuddyApplication>(decided);
  }

  @override
  Future<Result<List<BuddyApplication>>> listApplications(
      {String? postId}) async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<List<BuddyApplication>>();
    }
    if (postId == null || postId.isEmpty) {
      // 我作为**申请人**的申请列表。
      final List<BuddyApplication> mine = _applications.values
          .where((BuddyApplication item) => item.isFrom(currentUserId))
          .toList(growable: false)
        ..sort(
          (BuddyApplication a, BuddyApplication b) =>
              b.createdAt.compareTo(a.createdAt),
        );
      return Ok<List<BuddyApplication>>(mine);
    }
    final BuddyPost? post = _posts[postId];
    if (post == null) return _notFoundPost<List<BuddyApplication>>();
    // 规格 §6.1：**申请人列表**只有发起人（与申请人本人）能看到。
    if (!post.isCreatedBy(currentUserId)) {
      return _fail<List<BuddyApplication>>(
        ApiErrorCode.forbidden,
        '只有发起人可以查看这个活动的申请列表',
      );
    }
    final List<BuddyApplication> received = _applications.values
        .where((BuddyApplication item) => item.postId == postId)
        .toList(growable: false)
      ..sort(
        (BuddyApplication a, BuddyApplication b) =>
            a.createdAt.compareTo(b.createdAt),
      );
    return Ok<List<BuddyApplication>>(received);
  }

  // ------------------------------------------------------------ 推荐与反馈

  @override
  Future<Result<BuddyRecommendationPage>> recommend(
      BuddyRecommendQuery query) async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<BuddyRecommendationPage>();
    }
    if (!query.isSectionValid) {
      return _validation<BuddyRecommendationPage>(
        'section 必须是 academic / daily / sport 之一',
        'section',
      );
    }
    if (controls.emptyResults) {
      return Ok<BuddyRecommendationPage>(
        BuddyRecommendationPage(
          items: const <BuddyRecommendation>[],
          matchMode: BuddyMatchMode.rule,
        ),
      );
    }

    final BuddyProfile? profile = _profile;
    final List<BuddyPost> openPosts = _posts.values
        .where((BuddyPost post) => post.status.appearsInList)
        .where((BuddyPost post) => post.startsAt.isAfter(_now))
        .where((BuddyPost post) => post.section == query.section)
        .toList(growable: false);

    // 规格 §5.7：未开启匹配资料时**不报错**，返回 `matchMode: "rule"` +
    // 按 `startsAt` 排序的开放帖子，`reason` 统一为「按时间排序」，`score` 为 0。
    // 「这保证『没填资料也能用』。」
    if (profile == null || !profile.isRecommendable) {
      final List<BuddyPost> sorted = List<BuddyPost>.of(openPosts)
        ..sort((BuddyPost a, BuddyPost b) => a.startsAt.compareTo(b.startsAt));
      final List<BuddyRecommendation> items = sorted
          .take(_clampLimit(query.limit, maxBuddyRecommendLimit))
          .map(
            (BuddyPost post) => BuddyRecommendation(
              post: post,
              score: 0,
              reason: buddyTimeSortedReason,
            ),
          )
          .toList(growable: false);
      return Ok<BuddyRecommendationPage>(
        BuddyRecommendationPage(
          items: items,
          matchMode: BuddyMatchMode.rule,
        ),
      );
    }

    // 硬过滤 F1–F7（规格 §3.3），在打分**之前**。
    final List<BuddyPost> candidates = openPosts
        // F1 已由 `appearsInList`（OPEN）承担；这里补 `joinedCount < capacity`。
        .where((BuddyPost post) => !post.isFull)
        // F2 已由 `startsAt.isAfter(_now)` 承担。
        // F3 不推荐自己发的。
        .where((BuddyPost post) => !post.isCreatedBy(currentUserId))
        // F4 我未申请过（无 PENDING/ACCEPTED 的申请）。
        .where((BuddyPost post) {
          final BuddyApplication? mine = _applicationOf(post.id, currentUserId);
          return mine == null ||
              (mine.status != BuddyApplicationStatus.pending &&
                  mine.status != BuddyApplicationStatus.accepted);
        })
        // F5 性别准入相容（客户端不采集性别，真实判定在服务端）。
        .where((BuddyPost post) => _genderMismatchReason(post) == null)
        // F6 `minSkillLevel` 存在时，我的 skillLevel ≥ 它。
        .where((BuddyPost post) => _skillLevelTooLowReason(post) == null)
        // F7 我的 availability 与 [startsAt, startsAt + durationMin] 有交集。
        .where((BuddyPost post) => _availabilityPasses(post, profile))
        .toList(growable: false);

    final List<BuddyMatchFeedback> sectionFeedbacks = _feedbacks.values
        .where(
            (BuddyMatchFeedback feedback) => feedback.section == query.section)
        .toList(growable: false);
    final Map<String, double> adjustments = buddyFeedbackAdjustment(
      sectionFeedbacks,
      _now,
    );

    final List<BuddyRecommendation> scored = candidates.map((BuddyPost post) {
      final BuddyProfile creatorProfile = _creatorProfiles[post.creator.id] ??
          BuddyProfile.empty(post.creator.id);
      final BuddyRuleScore rule = buddyRuleScoreFor(
        section: query.section,
        post: post,
        me: profile,
        creatorProfile: creatorProfile,
      );
      // mock 无 embedding 能力 → 恒为 `rule` 降级档（规格 §3.5 模式 C）。
      final double score = buddyFinalScore(
        mode: BuddyMatchMode.rule,
        ruleScore: rule.score,
        feedbackAdjustment: adjustments[post.id] ?? 0,
      );
      return BuddyRecommendation(
        post: post,
        score: buddyRound3(score),
        reason: rule.reason,
      );
    }).toList(growable: false);

    scored.sort((BuddyRecommendation a, BuddyRecommendation b) {
      final int byScore = b.score.compareTo(a.score);
      if (byScore != 0) return byScore;
      return a.post.startsAt.compareTo(b.post.startsAt);
    });

    final ({String key, String id})? cursor = _decodeCursor(query.cursor);
    // 游标必须携带**完整排序键**，不能只带 score + id：
    //   - 同分时排序键是 `startsAt`（升序），而 id 是任意字符串；
    //   - 只比较 id 的字典序会把 `bp-seed-10` 排到 `bp-seed-9` 前面，
    //     导致第二页被整页跳过（实测 12 条只返回 10 条）。
    final ({double score, DateTime startsAt, String id})? decoded =
        cursor == null ? null : _decodeRecommendCursor(cursor);
    final List<BuddyRecommendation> afterCursor = decoded == null
        ? scored
        : scored.where((BuddyRecommendation item) {
            final ({double score, DateTime startsAt, String id}) sortKey =
                _recommendCursorKey(item);
            if (sortKey.score != decoded.score) {
              // 分高者在前：游标之后 = 分数更小。
              return sortKey.score < decoded.score;
            }
            if (sortKey.startsAt != decoded.startsAt) {
              return sortKey.startsAt.isAfter(decoded.startsAt);
            }
            return sortKey.id.compareTo(decoded.id) > 0;
          }).toList(growable: false);

    final int limit = _clampLimit(query.limit, maxBuddyRecommendLimit);
    final List<BuddyRecommendation> pageItems =
        afterCursor.take(limit).toList(growable: false);
    final bool hasMore = afterCursor.length > pageItems.length;
    return Ok<BuddyRecommendationPage>(
      BuddyRecommendationPage(
        items: pageItems,
        matchMode: BuddyMatchMode.rule,
        nextCursor: hasMore && pageItems.isNotEmpty
            ? _encodeRecommendCursor(pageItems.last)
            : null,
      ),
    );
  }

  @override
  Future<Result<BuddyMatchFeedback>> submitFeedback(
    BuddyMatchFeedback feedback,
  ) async {
    await controls.simulate();
    if (controls.failure != null)
      return controls.failureResult<BuddyMatchFeedback>();

    final BuddyPost? post = _posts[feedback.targetPostId];
    if (post == null) return _notFoundPost<BuddyMatchFeedback>();
    if (!feedback.section.isMatchable || feedback.section != post.section) {
      return _validation<BuddyMatchFeedback>(
        'section 与该帖子所属板块不一致',
        'SECTION_MISMATCH',
      );
    }
    // 反馈者由服务端从 JWT 取；mock 同样**忽略**入参里的 `userId`。
    final BuddyMatchFeedback stored = BuddyMatchFeedback(
      userId: currentUserId,
      targetPostId: post.id,
      section: post.section,
      action: feedback.action,
      createdAt: _now,
    );
    // UPSERT：`@@unique([userId, targetPostId, section])`（规格 §2.5 / §3.6 D11）。
    _feedbacks[
            _feedbackKey(stored.userId, stored.targetPostId, stored.section)] =
        stored;
    return Ok<BuddyMatchFeedback>(stored);
  }

  // ------------------------------------------------------------ 内部

  String _feedbackKey(String userId, String postId, BuddySection section) =>
      '$userId::$postId::${section.wire}';

  /// 我在 [postId] 上的申请（唯一约束保证至多一条）。
  BuddyApplication? _applicationOf(String postId, String applicantId) {
    for (final BuddyApplication application in _applications.values) {
      if (application.postId == postId &&
          application.applicantId == applicantId) {
        return application;
      }
    }
    return null;
  }

  /// F5：性别准入是否相容。`null` = 相容（或信息不足，不做判定）。
  String? _genderMismatchReason(BuddyPost post) {
    final String? mine = currentUserGender;
    if (mine == null) return null;
    final String? creator = creatorGenders[post.creator.id];
    if (creator == null) return null;
    return switch (post.genderPreference) {
      BuddyGenderPreference.any => null,
      BuddyGenderPreference.same => creator == mine ? null : '这个活动限同性参加',
      BuddyGenderPreference.other => creator != mine ? null : '这个活动限异性参加',
    };
  }

  /// F6：我的运动水平是否达到 `minSkillLevel`。`null` = 通过。
  String? _skillLevelTooLowReason(BuddyPost post) {
    final BuddySkillLevel? min = post.minSkillLevel;
    if (min == null) return null;
    final BuddySkillLevel mine = _profile?.skillLevel ?? BuddySkillLevel.casual;
    if (mine.rank >= min.rank) return null;
    return '这个活动要求至少「${min.label}」水平';
  }

  /// F7：时段重叠。
  ///
  /// ⚠️ **两处刻意的宽松（已在 feature README §6 上报）**：
  ///   1. 我**没有填任何可用时段**时，F7 不作为约束 —— 否则"只填了兴趣、没填时段"
  ///      的用户会看到**空推荐**，而规格 §3.3 自己把这条注解为
  ///      「非硬过滤时的软分」，说明它本来就有软的一面；
  ///   2. 帖子没有 `durationMin` 时无法判定窗口 → 不作约束。
  bool _availabilityPasses(BuddyPost post, BuddyProfile profile) {
    if (profile.availability.isEmpty) return true;
    final int? duration = post.durationMin;
    if (duration == null) return true;
    return buddyOverlapsAvailability(
        profile.availability, post.startsAt, duration);
  }

  DateTime _sortKeyOf(BuddyPost post, BuddyPostSort sort) =>
      sort == BuddyPostSort.startsAtAsc
          ? post.startsAt.toUtc()
          : (post.createdAt ?? post.startsAt).toUtc();

  /// 游标里的排序键：**定宽 20 位十进制微秒**。
  ///
  /// 为什么不用 `toIso8601String()`：ISO 串在微秒为 0 时是 `…00.000Z`、
  /// 非 0 时是 `…00.000123Z`，两者**长度不同**，字符串比较会在
  /// `'Z'(0x5A) > '1'(0x31)` 上给出与时间相反的顺序。定宽数字串才是
  /// 字典序 == 时间序。
  String _sortKeyString(DateTime value) =>
      value.toUtc().microsecondsSinceEpoch.toString().padLeft(20, '0');

  void _sortPosts(List<BuddyPost> items, BuddyPostSort sort) {
    items.sort((BuddyPost a, BuddyPost b) {
      final int byKey = sort == BuddyPostSort.startsAtAsc
          ? _sortKeyOf(a, sort).compareTo(_sortKeyOf(b, sort))
          : _sortKeyOf(b, sort).compareTo(_sortKeyOf(a, sort));
      if (byKey != 0) return byKey;
      return sort == BuddyPostSort.startsAtAsc
          ? a.id.compareTo(b.id)
          : b.id.compareTo(a.id);
    });
  }

  /// 复合游标（`(sortKey, id)`）过滤，契约 §11.10-E 允许服务端自由编码。
  List<BuddyPost> _afterCursor(
    List<BuddyPost> sorted,
    BuddyPostSort sort,
    String? cursor,
  ) {
    final ({String key, String id})? decoded = _decodeCursor(cursor);
    if (decoded == null) return sorted;
    return sorted.where((BuddyPost post) {
      final String key = _sortKeyString(_sortKeyOf(post, sort));
      final int cmp = key.compareTo(decoded.key);
      if (sort == BuddyPostSort.startsAtAsc) {
        return cmp > 0 || (cmp == 0 && post.id.compareTo(decoded.id) > 0);
      }
      return cmp < 0 || (cmp == 0 && post.id.compareTo(decoded.id) < 0);
    }).toList(growable: false);
  }

  /// 游标对客户端**不透明**：base64url 编码的 `(sortKey, id)`。
  String _encodeCursor(String key, String id) =>
      base64Url.encode(utf8.encode('$key|$id'));

  ({String key, String id})? _decodeCursor(String? cursor) {
    if (cursor == null || cursor.isEmpty) return null;
    try {
      final String raw = utf8.decode(base64Url.decode(cursor));
      final int separator = raw.lastIndexOf('|');
      if (separator <= 0) return null;
      return (
        key: raw.substring(0, separator),
        id: raw.substring(separator + 1)
      );
    } on Object {
      // 损坏 / 被客户端篡改的游标：忽略它（等价于第一页），不抛异常。
      return null;
    }
  }

  ({double score, DateTime startsAt, String id}) _recommendCursorKey(
    BuddyRecommendation item,
  ) =>
      (
        score: item.score,
        startsAt: item.post.startsAt.toUtc(),
        id: item.post.id,
      );

  String _encodeRecommendCursor(BuddyRecommendation item) {
    final ({double score, DateTime startsAt, String id}) key =
        _recommendCursorKey(item);
    return _encodeCursor(
      '${key.score.toStringAsFixed(6)}|${key.startsAt.microsecondsSinceEpoch}',
      key.id,
    );
  }

  /// 损坏 / 旧格式游标 → null（等价于第一页），与 [_decodeCursor] 的容错一致。
  ({double score, DateTime startsAt, String id})? _decodeRecommendCursor(
    ({String key, String id}) cursor,
  ) {
    final List<String> parts = cursor.key.split('|');
    if (parts.length != 2) return null;
    final double? score = double.tryParse(parts[0]);
    final int? micros = int.tryParse(parts[1]);
    if (score == null || micros == null) return null;
    return (
      score: score,
      startsAt: DateTime.fromMicrosecondsSinceEpoch(micros, isUtc: true),
      id: cursor.id,
    );
  }

  int _clampLimit(int limit, int max) {
    if (limit < 1) return 1;
    return limit > max ? max : limit;
  }

  Err<T> _fail<T>(ApiErrorCode code, String message, {String? reason}) =>
      Err<T>(
        ApiError(
          code: code,
          message: message,
          details: reason == null ? null : <String, Object?>{'reason': reason},
        ),
        traceId: MockControls.traceId,
      );

  Err<T> _validation<T>(String message, String reason) =>
      _fail<T>(ApiErrorCode.validationFailed, message, reason: reason);

  Err<T> _notFoundPost<T>() => _fail<T>(
        ApiErrorCode.notFound,
        '该活动不存在或不可见',
      );

  Err<T> _notFoundApplication<T>() => _fail<T>(
        ApiErrorCode.notFound,
        '该申请不存在或不可见',
      );
}
