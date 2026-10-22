import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/teabreak.dart';

/// `teabreak` 的**规则层**测试：逐条对照 `packages/contracts/src/teabreaks.ts`。
///
/// 这里只测纯函数 —— 页面怎么画与规则无关，规则错了三端就会各说各话。
void main() {
  final DateTime now = DateTime.utc(2026, 10, 22, 6); // 本地 14:00

  Teabreak make({
    String id = 'tb-1',
    DateTime? teaStartsAt,
    DateTime? teaEndsAt,
    List<TeabreakConfirm> confirms = const <TeabreakConfirm>[],
    TeabreakAccess access = TeabreakAccess.open,
  }) =>
      Teabreak(
        id: id,
        conferenceName: '第七届信息科学前沿论坛',
        venue: '信息学院 1-101',
        conferenceStartsAt: now.subtract(const Duration(hours: 4)),
        conferenceEndsAt: now.add(const Duration(hours: 4)),
        teaStartsAt: teaStartsAt ?? now.subtract(const Duration(minutes: 10)),
        teaEndsAt: teaEndsAt ?? now.add(const Duration(minutes: 10)),
        access: access,
        postedBy: '测试发布者',
        createdAt: now.subtract(const Duration(hours: 5)),
        confirms: confirms,
      );

  TeabreakConfirm confirmAgo(Duration ago) => TeabreakConfirm(
        confirmId: 'c-${ago.inMinutes}',
        confirmedAt: now.subtract(ago),
      );

  group('枚举镜像契约', () {
    test('access 的取值 / label / hint 与 contracts 一致', () {
      expect(
        TeabreakAccess.values.map((TeabreakAccess a) => a.wire).toList(),
        <String>['open', 'registered', 'unknown'],
      );
      expect(TeabreakAccess.open.label, '对外开放（不需注册）');
      expect(TeabreakAccess.registered.label, '仅限注册参会者');
      expect(TeabreakAccess.unknown.label, '不确定');
      expect(TeabreakAccess.registered.hint, contains('胸牌'));
      expect(TeabreakAccess.fromWire('OPEN'), TeabreakAccess.open);
      expect(TeabreakAccess.fromWire('nope'), isNull);
    });

    test('freshness 的取值 / label 与 contracts 一致（notStarted 是驼峰）', () {
      expect(
        TeabreakFreshness.values
            .map((TeabreakFreshness f) => f.wire)
            .toList(),
        <String>['fresh', 'stale', 'over', 'notStarted'],
      );
      expect(TeabreakFreshness.fresh.label, '刚确认还有');
      expect(TeabreakFreshness.stale.label, '20 分钟没人确认了');
      expect(TeabreakFreshness.over.label, '已结束');
      expect(TeabreakFreshness.notStarted.label, '还没开始');
      expect(TeabreakFreshness.fromWire('notStarted'),
          TeabreakFreshness.notStarted);
      expect(TeabreakFreshness.fromWire('notstarted'), isNull);
    });

    test('20 分钟阈值是一个常量，不是散落在页面里的魔法数', () {
      expect(teabreakFreshnessMs, 20 * 60 * 1000);
    });
  });

  group('JSON 往返', () {
    test('toJson/fromJson 保持全部字段（时间写回 ISO-8601 UTC）', () {
      final Teabreak original = make(
        confirms: <TeabreakConfirm>[
          TeabreakConfirm(confirmId: 'c-1', confirmedAt: now),
        ],
      ).copyWith(note: '有咖啡和可颂');
      final Map<String, Object?> json = original.toJson();
      expect(json['teaStartsAt'], isA<String>());
      expect(Teabreak.fromJson(json), original);
    });

    test('未知 access 直接抛 FormatException（不静默降级）', () {
      final Map<String, Object?> json = make().toJson()
        ..['access'] = 'vip';
      expect(() => Teabreak.fromJson(json), throwsFormatException);
    });

    test('note 的空串归一为 null', () {
      final Map<String, Object?> json = make().toJson()..['note'] = '   ';
      expect(Teabreak.fromJson(json).note, isNull);
    });

    test('confirms 缺省为空列表', () {
      final Map<String, Object?> json = make().toJson()..remove('confirms');
      expect(Teabreak.fromJson(json).confirms, isEmpty);
    });
  });

  group('teabreakStatus：时效判定', () {
    test('时间窗内 + 5 分钟前确认 → fresh / 值得去', () {
      final TeabreakStatus status =
          teabreakStatus(make(confirms: <TeabreakConfirm>[confirmAgo(const Duration(minutes: 5))]), now);
      expect(status.freshness, TeabreakFreshness.fresh);
      expect(status.sinceLastConfirmMs, 5 * 60 * 1000);
      expect(status.worthGoing, isTrue);
    });

    test('恰好 20 分钟前确认仍算 fresh（<= 阈值），21 分钟即 stale', () {
      final Teabreak exact = make(
        confirms: <TeabreakConfirm>[confirmAgo(const Duration(minutes: 20))],
      );
      expect(teabreakStatus(exact, now).freshness, TeabreakFreshness.fresh);

      final Teabreak late = make(
        confirms: <TeabreakConfirm>[confirmAgo(const Duration(minutes: 21))],
      );
      expect(teabreakStatus(late, now).freshness, TeabreakFreshness.stale);
    });

    test('时间窗内但 2 小时没确认 → stale，**仍然**值得去', () {
      final TeabreakStatus status = teabreakStatus(
        make(confirms: <TeabreakConfirm>[confirmAgo(const Duration(hours: 2))]),
        now,
      );
      expect(status.freshness, TeabreakFreshness.stale);
      expect(status.worthGoing, isTrue,
          reason: '判断标准是「时间窗内」，新鲜度只影响文案的确定性');
    });

    test('从未确认 → stale + sinceLastConfirmMs == null', () {
      final TeabreakStatus status = teabreakStatus(make(), now);
      expect(status.freshness, TeabreakFreshness.stale);
      expect(status.sinceLastConfirmMs, isNull);
    });

    test('已过结束时间 → over / 不值得去（即便刚确认过）', () {
      final TeabreakStatus status = teabreakStatus(
        make(
          teaEndsAt: now.subtract(const Duration(minutes: 1)),
          confirms: <TeabreakConfirm>[confirmAgo(const Duration(minutes: 2))],
        ),
        now,
      );
      expect(status.freshness, TeabreakFreshness.over);
      expect(status.worthGoing, isFalse);
    });

    test('恰好等于结束时刻仍在窗口内（与 TS 的 nowMs > endMs 一致）', () {
      final TeabreakStatus status =
          teabreakStatus(make(teaEndsAt: now), now);
      expect(status.freshness, isNot(TeabreakFreshness.over));
      expect(status.worthGoing, isTrue);
    });

    test('还没到开始时间 → notStarted / 不值得去', () {
      final TeabreakStatus status = teabreakStatus(
        make(
          teaStartsAt: now.add(const Duration(minutes: 30)),
          teaEndsAt: now.add(const Duration(hours: 1)),
        ),
        now,
      );
      expect(status.freshness, TeabreakFreshness.notStarted);
      expect(status.worthGoing, isFalse);
      expect(status.freshness.isWithinWindow, isFalse);
    });

    test('多次确认取**最近**那一次', () {
      final TeabreakStatus status = teabreakStatus(
        make(confirms: <TeabreakConfirm>[
          confirmAgo(const Duration(hours: 2)),
          confirmAgo(const Duration(minutes: 1)),
          confirmAgo(const Duration(hours: 1)),
        ]),
        now,
      );
      expect(status.freshness, TeabreakFreshness.fresh);
      expect(status.sinceLastConfirmMs, 60 * 1000);
    });
  });

  group('sortTeabreaks：worthGoing → freshness → 结束时间 → 开始时间', () {
    test('四条典型数据的顺序：fresh → stale → notStarted → over', () {
      final Teabreak fresh = make(
        id: 'fresh',
        confirms: <TeabreakConfirm>[confirmAgo(const Duration(minutes: 3))],
      );
      final Teabreak stale = make(
        id: 'stale',
        confirms: <TeabreakConfirm>[confirmAgo(const Duration(hours: 2))],
      );
      final Teabreak notStarted = make(
        id: 'notStarted',
        teaStartsAt: now.add(const Duration(hours: 1)),
        teaEndsAt: now.add(const Duration(hours: 2)),
      );
      final Teabreak over = make(
        id: 'over',
        teaStartsAt: now.subtract(const Duration(days: 1, hours: 1)),
        teaEndsAt: now.subtract(const Duration(days: 1)),
      );

      final List<Teabreak> sorted = sortTeabreaks(
        <Teabreak>[over, notStarted, stale, fresh],
        now,
      );
      expect(
        sorted.map((Teabreak t) => t.id).toList(),
        <String>['fresh', 'stale', 'notStarted', 'over'],
      );
    });

    test('同样 fresh 时，结束得早的排前面（快没了先冲）', () {
      final Teabreak later = make(
        id: 'later',
        teaEndsAt: now.add(const Duration(minutes: 20)),
        confirms: <TeabreakConfirm>[confirmAgo(const Duration(minutes: 2))],
      );
      final Teabreak sooner = make(
        id: 'sooner',
        teaEndsAt: now.add(const Duration(minutes: 5)),
        confirms: <TeabreakConfirm>[confirmAgo(const Duration(minutes: 2))],
      );
      expect(
        sortTeabreaks(<Teabreak>[later, sooner], now)
            .map((Teabreak t) => t.id)
            .toList(),
        <String>['sooner', 'later'],
      );
    });

    test('所有键都相同时保留输入顺序（Dart sort 不保证稳定，这里必须兜住）', () {
      final Teabreak a = make(id: 'a');
      final Teabreak b = make(id: 'b');
      final Teabreak c = make(id: 'c');
      expect(
        sortTeabreaks(<Teabreak>[c, a, b], now)
            .map((Teabreak t) => t.id)
            .toList(),
        <String>['c', 'a', 'b'],
      );
    });

    test('不修改入参', () {
      final List<Teabreak> input = <Teabreak>[make(id: 'x'), make(id: 'y')];
      final List<String> before =
          input.map((Teabreak t) => t.id).toList(growable: false);
      sortTeabreaks(input, now);
      expect(input.map((Teabreak t) => t.id).toList(), before);
    });

    test('空列表与单元素不出错', () {
      expect(sortTeabreaks(const <Teabreak>[], now), isEmpty);
      expect(sortTeabreaks(<Teabreak>[make()], now), hasLength(1));
    });
  });

  group('validateTeabreakDraft', () {
    TeabreakDraft draft({
      String conferenceName = '信息科学前沿论坛',
      String venue = '信息学院 1-101',
      DateTime? conferenceStartsAt,
      DateTime? conferenceEndsAt,
      DateTime? teaStartsAt,
      DateTime? teaEndsAt,
    }) =>
        TeabreakDraft(
          conferenceName: conferenceName,
          venue: venue,
          conferenceStartsAt:
              conferenceStartsAt ?? now.add(const Duration(minutes: 30)),
          conferenceEndsAt:
              conferenceEndsAt ?? now.add(const Duration(hours: 2)),
          teaStartsAt: teaStartsAt ?? now.add(const Duration(minutes: 45)),
          teaEndsAt: teaEndsAt ?? now.add(const Duration(minutes: 75)),
        );

    test('合法草稿 → 没有问题', () {
      expect(validateTeabreakDraft(draft(), now), isEmpty);
    });

    test('会议名太短 / 太长', () {
      expect(
        validateTeabreakDraft(draft(conferenceName: ' 会 '), now),
        contains(TeabreakDraftProblem.conferenceTooShort),
      );
      expect(
        validateTeabreakDraft(draft(conferenceName: '会' * 81), now),
        contains(TeabreakDraftProblem.conferenceTooLong),
      );
    });

    test('地点太短', () {
      expect(
        validateTeabreakDraft(draft(venue: '1'), now),
        contains(TeabreakDraftProblem.venueTooShort),
      );
    });

    test('会议结束早于开始', () {
      expect(
        validateTeabreakDraft(
          draft(
            conferenceStartsAt: now.add(const Duration(hours: 2)),
            conferenceEndsAt: now.add(const Duration(hours: 1)),
            teaStartsAt: now.add(const Duration(hours: 2)),
            teaEndsAt: now.add(const Duration(hours: 3)),
          ),
          now,
        ),
        contains(TeabreakDraftProblem.conferenceEndBeforeStart),
      );
    });

    test('茶歇窗口 < 10 分钟 / > 3 小时', () {
      expect(
        validateTeabreakDraft(
          draft(
            teaStartsAt: now.add(const Duration(minutes: 45)),
            teaEndsAt: now.add(const Duration(minutes: 50)),
          ),
          now,
        ),
        contains(TeabreakDraftProblem.teaWindowTooShort),
      );
      expect(
        validateTeabreakDraft(
          draft(
            conferenceEndsAt: now.add(const Duration(hours: 8)),
            teaStartsAt: now.add(const Duration(minutes: 45)),
            teaEndsAt: now.add(const Duration(hours: 4)),
          ),
          now,
        ),
        contains(TeabreakDraftProblem.teaWindowTooLong),
      );
    });

    test('茶歇跑到会议时间之外', () {
      expect(
        validateTeabreakDraft(
          draft(
            teaStartsAt: now.add(const Duration(minutes: 10)),
            teaEndsAt: now.add(const Duration(minutes: 30)),
          ),
          now,
        ),
        contains(TeabreakDraftProblem.teaOutsideConference),
      );
    });

    test('已经结束的会不能发', () {
      expect(
        validateTeabreakDraft(
          draft(
            conferenceStartsAt: now.subtract(const Duration(hours: 3)),
            conferenceEndsAt: now.subtract(const Duration(hours: 1)),
            teaStartsAt: now.subtract(const Duration(hours: 3)),
            teaEndsAt: now.subtract(const Duration(hours: 2)),
          ),
          now,
        ),
        contains(TeabreakDraftProblem.inThePast),
      );
    });

    test('问题码 → 中文提示不是空串', () {
      for (final TeabreakDraftProblem problem in TeabreakDraftProblem.values) {
        expect(describeTeabreakProblem(problem), isNotEmpty);
        expect(describeTeabreakProblem(problem), isNot(problem.wire));
      }
      expect(
        describeTeabreakProblem(TeabreakDraftProblem.teaOutsideConference),
        '茶歇必须在会议时间之内',
      );
    });

    test('首尾空白不参与计数：trim 后 2 个字的会议名仍然太短', () {
      final TeabreakDraft d = draft(conferenceName: '  论坛  ');
      expect(d.toJson()['conferenceName'], '论坛');
      expect(
        validateTeabreakDraft(d, now),
        contains(TeabreakDraftProblem.conferenceTooShort),
      );

      final TeabreakDraft ok = draft(conferenceName: '  计算论坛  ');
      expect(validateTeabreakDraft(ok, now), isEmpty);
    });
  });

  group('文案', () {
    test('describeRemaining：分钟 / 小时 / 已结束 / 不到 1 分钟', () {
      expect(
        describeRemaining(now.add(const Duration(minutes: 25)), now),
        '还有 25 分钟',
      );
      expect(
        describeRemaining(now.add(const Duration(minutes: 90)), now),
        '还有 1 小时 30 分钟',
      );
      expect(
        describeRemaining(now.add(const Duration(hours: 2)), now),
        '还有 2 小时',
      );
      expect(describeRemaining(now, now), '已结束');
      expect(
        describeRemaining(now.add(const Duration(seconds: 20)), now),
        '不到 1 分钟',
      );
    });

    test('describeSinceConfirm：从未确认 / 刚刚 / 分钟 / 小时', () {
      expect(describeSinceConfirm(null), '还没有人确认');
      expect(describeSinceConfirm(30 * 1000), '刚刚确认');
      expect(describeSinceConfirm(5 * 60 * 1000), '5 分钟前确认');
      expect(describeSinceConfirm(2 * 60 * 60 * 1000), '2 小时前确认');
    });

    test('describeTeabreakTiming 三种时效措辞正确', () {
      final Teabreak fresh = make(
        confirms: <TeabreakConfirm>[confirmAgo(const Duration(minutes: 2))],
      );
      expect(
        describeTeabreakTiming(fresh, fresh.statusAt(now), now),
        '还有 10 分钟结束',
      );

      final Teabreak upcoming = make(
        teaStartsAt: now.add(const Duration(minutes: 30)),
        teaEndsAt: now.add(const Duration(minutes: 50)),
      );
      expect(
        describeTeabreakTiming(upcoming, upcoming.statusAt(now), now),
        '还有 30 分钟开始',
      );

      final Teabreak over = make(
        teaStartsAt: now.subtract(const Duration(hours: 2)),
        teaEndsAt: now.subtract(const Duration(hours: 1)),
      );
      expect(describeTeabreakTiming(over, over.statusAt(now), now), '已结束');
    });
  });
}
