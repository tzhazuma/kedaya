import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/data/mock/mock_teabreak_repository.dart';
import 'package:kedaya/data/mock/teabreak_fixtures.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/result.dart';
import 'package:kedaya/domain/models/teabreak.dart';

void main() {
  final DateTime now = DateTime.utc(2026, 10, 22, 6);

  MockTeabreakRepository repo({
    List<Teabreak>? teabreaks,
    String postedBy = mockTeabreakPosterName,
  }) =>
      MockTeabreakRepository(
        teabreaks: teabreaks,
        controls: MockControls(latency: Duration.zero),
        clock: () => now,
        postedBy: postedBy,
      );

  group('演示数据相对 now 生成（不会过几天就全变成 over）', () {
    test('同一个 now 下，四条数据覆盖 fresh / stale / notStarted / over', () {
      final List<Teabreak> items = buildMockTeabreaks(now);
      expect(items, hasLength(4));
      expect(
        items
            .map((Teabreak t) => teabreakStatus(t, now).freshness)
            .toSet(),
        <TeabreakFreshness>{
          TeabreakFreshness.fresh,
          TeabreakFreshness.stale,
          TeabreakFreshness.notStarted,
          TeabreakFreshness.over,
        },
      );
    });

    test('三种 access 都出现', () {
      final Set<TeabreakAccess> accesses = buildMockTeabreaks(now)
          .map((Teabreak t) => t.access)
          .toSet();
      expect(accesses, hasLength(3));
    });

    test('fresh 那条确实是「20 分钟内刚确认」且茶歇窗包含 now', () {
      final Teabreak fresh = buildMockTeabreaks(now).firstWhere(
        (Teabreak t) =>
            teabreakStatus(t, now).freshness == TeabreakFreshness.fresh,
      );
      final TeabreakStatus status = teabreakStatus(fresh, now);
      expect(status.sinceLastConfirmMs, lessThanOrEqualTo(teabreakFreshnessMs));
      expect(now.isAfter(fresh.teaStartsAt), isTrue);
      expect(now.isBefore(fresh.teaEndsAt), isTrue);
      expect(fresh.note, isNotNull, reason: '示例里要展示"有什么吃的"');
    });

    test('stale 那条在时间窗内、但已经 2 小时没人确认', () {
      final Teabreak stale = buildMockTeabreaks(now).firstWhere(
        (Teabreak t) =>
            teabreakStatus(t, now).freshness == TeabreakFreshness.stale,
      );
      final TeabreakStatus status = teabreakStatus(stale, now);
      expect(status.worthGoing, isTrue);
      expect(status.sinceLastConfirmMs, const Duration(hours: 2).inMilliseconds);
    });

    test('notStarted 那条永远是「下午场」（换任何一个 now 都成立）', () {
      for (final DateTime probe in <DateTime>[
        DateTime.utc(2026, 10, 22, 0), // 本地 08:00
        DateTime.utc(2026, 10, 22, 6), // 本地 14:00
        DateTime.utc(2026, 10, 22, 15), // 本地 23:00
      ]) {
        final Teabreak upcoming = buildMockTeabreaks(probe).firstWhere(
          (Teabreak t) =>
              teabreakStatus(t, probe).freshness ==
              TeabreakFreshness.notStarted,
        );
        final DateTime local = upcoming.teaStartsAt.toLocal();
        expect(local.hour, 15, reason: '茶歇必须在 15:00 开始（下午场）');
        expect(upcoming.teaStartsAt.isAfter(probe), isTrue);
      }
    });

    test('所有时刻都是相对 now 的偏移，没有写死绝对日期', () {
      final List<Teabreak> a = buildMockTeabreaks(now);
      final DateTime later = now.add(const Duration(days: 400));
      final List<Teabreak> b = buildMockTeabreaks(later);
      for (int i = 0; i < a.length; i++) {
        expect(
          b[i].teaStartsAt.difference(later),
          a[i].teaStartsAt.difference(now),
          reason: '${a[i].id} 的茶歇开始时间不是相对 now 算出来的',
        );
      }
    });
  });

  group('list', () {
    test('默认返回 4 条，且不排序（排序是页面的职责）', () async {
      final Result<List<Teabreak>> result = await repo().list();
      final List<Teabreak> items = result.unwrap;
      expect(items, hasLength(4));
      expect(
        items.map((Teabreak t) => t.id).toList(),
        <String>['tb-1001', 'tb-1002', 'tb-1003', 'tb-1004'],
      );
    });

    test('拒绝调用方传入的列表被重新排序（保持插入顺序）', () async {
      final List<Teabreak> custom = <Teabreak>[
        buildMockTeabreaks(now)[3],
        buildMockTeabreaks(now)[0],
      ];
      final List<Teabreak> items = (await repo(teabreaks: custom).list()).unwrap;
      expect(
        items.map((Teabreak t) => t.id).toList(),
        <String>['tb-1004', 'tb-1001'],
      );
    });

    test('空列表开关与故障注入', () async {
      final MockTeabreakRepository empty = repo();
      empty.controls.emptyResults = true;
      expect((await empty.list()).unwrap, isEmpty);

      final MockTeabreakRepository failing = repo();
      failing.controls.failureMode = MockFailureMode.upstreamUnavailable;
      final Result<List<Teabreak>> result = await failing.list();
      expect(result.isErr, isTrue);
      expect(result.errorOrNull?.code, ApiErrorCode.upstreamUnavailable);
    });
  });

  group('confirm', () {
    test('追加一条确认，并让 stale 变 fresh', () async {
      final MockTeabreakRepository repository = repo();
      final Teabreak stale = repository.debugById('tb-1002')!;
      expect(
        teabreakStatus(stale, now).freshness,
        TeabreakFreshness.stale,
      );

      final Result<Unit> result = await repository.confirm('tb-1002');
      expect(result.isOk, isTrue);

      final Teabreak updated = repository.debugById('tb-1002')!;
      expect(updated.confirms.length, stale.confirms.length + 1);
      final TeabreakStatus status = teabreakStatus(updated, now);
      expect(status.freshness, TeabreakFreshness.fresh);
      expect(status.sinceLastConfirmMs, 0);
    });

    test('确认不存在的 id → NOT_FOUND（带 reason）', () async {
      final Result<Unit> result = await repo().confirm('tb-不存在');
      expect(result.isErr, isTrue);
      expect(result.errorOrNull?.code, ApiErrorCode.notFound);
      expect(result.errorOrNull?.details, containsPair('reason', 'TEABREAK_NOT_FOUND'));
    });

    test('故障注入时不动内部状态', () async {
      final MockTeabreakRepository repository = repo();
      final int before = repository.debugById('tb-1002')!.confirms.length;
      repository.controls.failureMode = MockFailureMode.notFound;
      expect((await repository.confirm('tb-1002')).isErr, isTrue);
      expect(repository.debugById('tb-1002')!.confirms.length, before);
    });
  });

  group('create', () {
    TeabreakDraft validDraft() => TeabreakDraft(
          conferenceName: '  计算生物学论坛  ',
          venue: '  生命学院 4-102 ',
          conferenceStartsAt: now.add(const Duration(minutes: 30)),
          conferenceEndsAt: now.add(const Duration(hours: 2)),
          teaStartsAt: now.add(const Duration(minutes: 45)),
          teaEndsAt: now.add(const Duration(minutes: 75)),
          access: TeabreakAccess.registered,
          note: '  有抹茶卷  ',
        );

    test('合法草稿 → 追加成功，文本被 trim，发布者来自构造参数', () async {
      final MockTeabreakRepository repository = repo(postedBy: '我');
      final Teabreak created = (await repository.create(validDraft())).unwrap;
      expect(created.conferenceName, '计算生物学论坛');
      expect(created.venue, '生命学院 4-102');
      expect(created.note, '有抹茶卷');
      expect(created.postedBy, '我');
      expect(created.access, TeabreakAccess.registered);
      expect(created.confirms, isEmpty);
      expect(repository.debugLength, 5);
      expect(repository.debugById(created.id), created);
    });

    test('新建后立刻是 notStarted（茶歇在 45 分钟后）', () async {
      final Teabreak created = (await repo().create(validDraft())).unwrap;
      expect(
        teabreakStatus(created, now).freshness,
        TeabreakFreshness.notStarted,
      );
    });

    test('不合法草稿 → VALIDATION_FAILED，message 是具体问题，且没有写入', () async {
      final MockTeabreakRepository repository = repo();
      final Result<Teabreak> result = await repository.create(
        TeabreakDraft(
          conferenceName: '会',
          venue: '1',
          conferenceStartsAt: now.add(const Duration(hours: 2)),
          conferenceEndsAt: now.add(const Duration(hours: 1)),
          teaStartsAt: now.add(const Duration(hours: 2)),
          teaEndsAt: now.add(const Duration(hours: 3)),
        ),
      );
      expect(result.isErr, isTrue);
      expect(result.errorOrNull?.code, ApiErrorCode.validationFailed);
      expect(result.errorOrNull?.message, contains('会议名称至少 3 个字'));
      final Object? details = result.errorOrNull?.details;
      expect(details, isA<Map<String, Object?>>());
      expect(
        (details! as Map<String, Object?>)['problems'],
        contains('conference-too-short'),
      );
      expect(repository.debugLength, 4);
    });
  });
}
