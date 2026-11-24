/// 宿舍矛盾的**本机内存仓库**（演示用）。
///
/// 帖子与回复都只存在内存里；匿名代号在写入时生成，仓库不保存任何用户 id。
library;

import '../../../domain/models/dorm_post.dart';

/// 仓库层错误（页面只展示 [message]）。
final class DormHarmonyException implements Exception {
  const DormHarmonyException(this.message);

  final String message;

  @override
  String toString() => message;
}

final class DormHarmonyRepository {
  factory DormHarmonyRepository({
    DateTime Function()? clock,
    List<DormPost>? seed,
  }) {
    final DateTime Function() resolvedClock = clock ?? DateTime.now;
    final List<DormPost> initial = seed ?? buildDormSeedPosts(resolvedClock());
    return DormHarmonyRepository._(resolvedClock, initial);
  }

  DormHarmonyRepository._(this._clock, Iterable<DormPost> seed)
      : _posts = <String, DormPost>{
          for (final DormPost post in seed) post.id: post,
        };

  final DateTime Function() _clock;
  final Map<String, DormPost> _posts;
  int _sequence = 7100;

  int get length => _posts.length;

  /// 最新的在前。
  List<DormPost> snapshot() {
    final List<DormPost> posts = _posts.values.toList(growable: false);
    posts.sort(
      (DormPost a, DormPost b) => b.createdAt.compareTo(a.createdAt),
    );
    return List<DormPost>.unmodifiable(posts);
  }

  DormPost? byId(String id) => _posts[id];

  /// 发帖：校验失败抛 [DormHarmonyException]。
  DormPost create(DormPostDraft draft) {
    final List<DormPostProblem> problems = validateDormPostDraft(draft);
    if (problems.isNotEmpty) {
      throw DormHarmonyException(
        problems.map(describeDormPostProblem).join(' '),
      );
    }

    final String building = draft.building;
    final int existingInBuilding = _posts.values
        .where((DormPost post) => post.building == building)
        .length;
    final DormPost post = DormPost(
      id: 'dorm-${_sequence++}',
      building: building,
      title: draft.title.trim(),
      body: draft.body.trim(),
      alias: dormAnonymousAlias(
        building: building,
        sequence: existingInBuilding + 1,
      ),
      createdAt: _clock(),
    );
    _posts[post.id] = post;
    return post;
  }

  /// 回复：正文为空抛 [DormHarmonyException]。
  DormReply addReply(String postId, String body) {
    final DormPost? post = _posts[postId];
    if (post == null) {
      throw const DormHarmonyException('这个帖子不存在，可能已经被删除。');
    }
    final String text = body.trim();
    if (text.isEmpty) {
      throw const DormHarmonyException('回复不能为空。');
    }

    final DormReply reply = DormReply(
      id: 'dorm-r-${_sequence++}',
      alias: dormAnonymousAlias(
        building: post.building,
        sequence: post.replies.length + 1,
        role: '匿名',
      ),
      body: text,
      createdAt: _clock(),
    );
    _posts[postId] = post.copyWith(
      replies: <DormReply>[...post.replies, reply],
    );
    return reply;
  }
}

/// 演示数据（相对 [now] 生成）。
List<DormPost> buildDormSeedPosts(DateTime now) {
  final DormPost oneA = DormPost(
    id: 'dorm-4001',
    building: '1 号楼',
    title: '晚上 11 点后能不能戴耳机',
    body: '我习惯早睡，但室友经常在 11 点后外放视频。'
        '不想把关系搞僵，也不知道怎么开口。'
        '想听听大家有没有不伤和气的沟通方式。',
    alias: dormAnonymousAlias(building: '1 号楼', sequence: 1),
    createdAt: now.subtract(const Duration(hours: 2)),
    replies: <DormReply>[
      DormReply(
        id: 'dorm-r-4001',
        alias: dormAnonymousAlias(
          building: '1 号楼',
          sequence: 1,
          role: '匿名',
        ),
        body: '可以先从「我最近睡得浅」说起，把问题放在自己身上，通常对方更容易接受。',
        createdAt: now.subtract(const Duration(minutes: 90)),
      ),
      DormReply(
        id: 'dorm-r-4002',
        alias: dormAnonymousAlias(
          building: '1 号楼',
          sequence: 2,
          role: '匿名',
        ),
        body: '我们宿舍是约好 11 点后统一戴耳机，写在纸上贴门后，大家都认。',
        createdAt: now.subtract(const Duration(minutes: 40)),
      ),
    ],
  );

  final DormPost twoA = DormPost(
    id: 'dorm-4002',
    building: '2 号楼',
    title: '阳台晾衣服的时间怎么排',
    body: '四个人都习惯周末洗衣服，阳台经常挂满。'
        '想问问别的宿舍有没有排班或者错峰的经验。',
    alias: dormAnonymousAlias(building: '2 号楼', sequence: 1),
    createdAt: now.subtract(const Duration(hours: 5)),
    replies: <DormReply>[
      DormReply(
        id: 'dorm-r-4003',
        alias: dormAnonymousAlias(
          building: '2 号楼',
          sequence: 1,
          role: '匿名',
        ),
        body: '我们按床号错开，周一到周四一人一天，周五公共。',
        createdAt: now.subtract(const Duration(hours: 4)),
      ),
      DormReply(
        id: 'dorm-r-4004',
        alias: dormAnonymousAlias(
          building: '2 号楼',
          sequence: 2,
          role: '匿名',
        ),
        body: '买一个折叠晾衣架也能缓解，收起来不占地方。',
        createdAt: now.subtract(const Duration(hours: 3)),
      ),
      DormReply(
        id: 'dorm-r-4005',
        alias: dormAnonymousAlias(
          building: '2 号楼',
          sequence: 3,
          role: '匿名',
        ),
        body: '关键是先问一句「你们介意吗」，很多矛盾其实是没人先开口。',
        createdAt: now.subtract(const Duration(hours: 2)),
      ),
    ],
  );

  final DormPost threeA = DormPost(
    id: 'dorm-4003',
    building: '3 号楼',
    title: '想聊聊公共区域值日',
    body: '客厅和卫生间最近总是没人主动打扫。'
        '我不想变成那个一直催的人，也不想默默做完再生气。'
        '有没有比较公平、又不尴尬的分工办法？',
    alias: dormAnonymousAlias(building: '3 号楼', sequence: 1),
    createdAt: now.subtract(const Duration(days: 1)),
  );

  final DormPost oneB = DormPost(
    id: 'dorm-4004',
    building: '1 号楼',
    title: '室友打电话声音有点大',
    body: '不是故意针对谁，只是晚上想安静看会儿书。'
        '打算这周找个大家都在的时间说一下，先来问问怎么表达比较合适。',
    alias: dormAnonymousAlias(building: '1 号楼', sequence: 2),
    createdAt: now.subtract(const Duration(minutes: 30)),
    replies: <DormReply>[
      DormReply(
        id: 'dorm-r-4006',
        alias: dormAnonymousAlias(
          building: '1 号楼',
          sequence: 1,
          role: '匿名',
        ),
        body: '可以具体说时间段，比如「十点以后」，比「你总是很吵」好接受。',
        createdAt: now.subtract(const Duration(minutes: 10)),
      ),
    ],
  );

  final DormPost fiveA = DormPost(
    id: 'dorm-4005',
    building: '5 号楼',
    title: '求一个不吵醒室友的早起闹钟方案',
    body: '早八起不来，但普通闹钟会把全宿舍叫醒。'
        '试过手环，震动不太够。大家有什么办法吗？',
    alias: dormAnonymousAlias(building: '5 号楼', sequence: 1),
    createdAt: now.subtract(const Duration(days: 3)),
    replies: <DormReply>[
      DormReply(
        id: 'dorm-r-4007',
        alias: dormAnonymousAlias(
          building: '5 号楼',
          sequence: 1,
          role: '匿名',
        ),
        body: '手环调到最紧一格试试，或者放在枕边。',
        createdAt: now.subtract(const Duration(days: 3)).add(
              const Duration(hours: 1),
            ),
      ),
      DormReply(
        id: 'dorm-r-4008',
        alias: dormAnonymousAlias(
          building: '5 号楼',
          sequence: 2,
          role: '匿名',
        ),
        body: '把手机放在床下，必须下床才能关，亲测有效。',
        createdAt: now.subtract(const Duration(days: 3)).add(
              const Duration(hours: 2),
            ),
      ),
      DormReply(
        id: 'dorm-r-4009',
        alias: dormAnonymousAlias(
          building: '5 号楼',
          sequence: 3,
          role: '匿名',
        ),
        body: '和室友说一声你在试方法，比偷偷设十个闹钟好。',
        createdAt: now.subtract(const Duration(days: 3)).add(
              const Duration(hours: 4),
            ),
      ),
      DormReply(
        id: 'dorm-r-4010',
        alias: dormAnonymousAlias(
          building: '5 号楼',
          sequence: 4,
          role: '匿名',
        ),
        body: '窗帘留一条缝，早上有光会自然醒一点。',
        createdAt: now.subtract(const Duration(days: 2)),
      ),
    ],
  );

  return <DormPost>[oneA, twoA, threeA, oneB, fiveA];
}
