import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/data/mock/mock_activities_repository.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/data/mock/mock_failure.dart';
import 'package:kedaya/domain/models/activity.dart';
import 'package:kedaya/features/activities/application/activities_providers.dart';

void main() {
  final DateTime now = DateTime.utc(2026, 11, 22);

  MockActivitiesRepository buildRepo() => MockActivitiesRepository(
        controls: MockControls(latency: Duration.zero),
        clock: () => now,
      );

  ProviderContainer container(
    MockActivitiesRepository repository, {
    int? activitiesPageSize,
    int? remindersPageSize,
  }) {
    final ProviderContainer result = ProviderContainer(
      overrides: <Override>[
        activitiesRepositoryProvider.overrideWithValue(repository),
        activitiesClockProvider.overrideWithValue(() => now),
        if (activitiesPageSize != null)
          activitiesPageSizeProvider.overrideWithValue(activitiesPageSize),
        if (remindersPageSize != null)
          activityRemindersPageSizeProvider
              .overrideWithValue(remindersPageSize),
      ],
    );
    addTearDown(result.dispose);
    return result;
  }

  test('列表控制器取回全部活动，筛选在客户端即时生效', () async {
    final ProviderContainer providers = container(buildRepo());

    final ActivitiesListState all =
        await providers.read(activitiesListControllerProvider.future);
    expect(all.items, hasLength(5));

    providers.read(activityFilterProvider.notifier).state =
        const ActivityFilter(source: ActivitySource.wechatMp);
    expect(
      providers.read(filteredActivitiesProvider).valueOrNull,
      hasLength(2),
    );

    providers.read(activityFilterProvider.notifier).state =
        const ActivityFilter(
      source: ActivitySource.wechatMp,
      status: ActivityStatus.candidate,
    );
    final List<ActivityItem> filtered =
        providers.read(filteredActivitiesProvider).valueOrNull!;
    expect(filtered.single.id, 'act-1003');

    providers.read(activityFilterProvider.notifier).state =
        const ActivityFilter();
    expect(
      providers.read(filteredActivitiesProvider).valueOrNull,
      hasLength(5),
    );
  });

  test('确认候选活动后，详情与提醒 provider 一起刷新', () async {
    final ProviderContainer providers = container(buildRepo());

    final ActivityItem before =
        await providers.read(activityDetailProvider('act-1002').future);
    expect(before.status, ActivityStatus.candidate);
    expect(
      (await providers.read(activityRemindersProvider('act-1002').future))
          .reminders,
      isEmpty,
    );

    await providers.read(activitiesActionsProvider).confirm('act-1002');

    final ActivityItem after =
        await providers.read(activityDetailProvider('act-1002').future);
    expect(after.status, ActivityStatus.confirmed);
    expect(
      (await providers.read(activityRemindersProvider('act-1002').future))
          .reminders,
      hasLength(2),
    );
  });

  test('创建手动活动会失效列表，并返回 candidate', () async {
    final ProviderContainer providers = container(buildRepo());
    await providers.read(activitiesListControllerProvider.future);

    final ActivityItem created =
        await providers.read(activitiesActionsProvider).createManual(
              ActivityDraft(
                title: '新活动',
                startsAt: now.add(const Duration(days: 3)),
              ),
            );

    expect(created.source, ActivitySource.manual);
    expect(created.status, ActivityStatus.candidate);
    final ActivitiesListState reloaded =
        await providers.read(activitiesListControllerProvider.future);
    expect(
      reloaded.items.map((ActivityItem item) => item.id),
      contains(created.id),
    );
  });

  test('公众号单篇导入走同一个 actions，并刷新列表', () async {
    final ProviderContainer providers = container(buildRepo());
    await providers.read(activitiesListControllerProvider.future);

    final ActivityItem created =
        await providers.read(activitiesActionsProvider).importWechat(
              const WechatImportDraft(
                url: 'https://mp.weixin.qq.com/s/provider-test',
              ),
            );

    expect(created.source, ActivitySource.wechatMp);
    final ActivitiesListState reloaded =
        await providers.read(activitiesListControllerProvider.future);
    expect(
      reloaded.items.any((ActivityItem item) => item.id == created.id),
      isTrue,
    );
  });

  test('删除提醒后提醒 provider 刷新', () async {
    final ProviderContainer providers = container(buildRepo());
    final ActivityRemindersState seeded =
        await providers.read(activityRemindersProvider('act-1001').future);
    expect(seeded.reminders, hasLength(2));

    await providers
        .read(activitiesActionsProvider)
        .deleteReminder(seeded.reminders.first.id);

    final ActivityRemindersState after =
        await providers.read(activityRemindersProvider('act-1001').future);
    expect(after.reminders, hasLength(1));
  });

  test('活动列表跟随 nextCursor 翻页并去重', () async {
    final ProviderContainer providers = container(
      buildRepo(),
      activitiesPageSize: 2,
    );

    final ActivitiesListState first =
        await providers.read(activitiesListControllerProvider.future);
    expect(first.items, hasLength(4));
    expect(first.hasMore, isTrue);

    await providers.read(activitiesListControllerProvider.notifier).loadMore();

    final ActivitiesListState second =
        providers.read(activitiesListControllerProvider).valueOrNull!;
    expect(second.items, hasLength(5));
    expect(
      second.items.map((ActivityItem item) => item.id).toSet(),
      hasLength(5),
    );
    expect(second.hasMore, isFalse);
  });

  test('下拉刷新失败时保留旧数据，只记录刷新错误', () async {
    final MockActivitiesRepository repository = buildRepo();
    final ProviderContainer providers = container(repository);

    final ActivitiesListState before =
        await providers.read(activitiesListControllerProvider.future);
    expect(before.items, hasLength(5));

    repository.controls.failureMode = MockFailureMode.upstreamUnavailable;
    await providers.read(activitiesListControllerProvider.notifier).refresh();

    final ActivitiesListState after =
        providers.read(activitiesListControllerProvider).valueOrNull!;
    expect(after.items, hasLength(5));
    expect(after.refreshError, isNotNull);
  });

  test('提醒列表跟随 nextCursor 翻页', () async {
    final ProviderContainer providers = container(
      buildRepo(),
      remindersPageSize: 1,
    );

    final ActivityRemindersState first =
        await providers.read(activityRemindersProvider('act-1001').future);
    expect(first.reminders, hasLength(1));
    expect(first.hasMore, isTrue);

    await providers
        .read(activityRemindersProvider('act-1001').notifier)
        .loadMore();

    final ActivityRemindersState second =
        providers.read(activityRemindersProvider('act-1001')).valueOrNull!;
    expect(second.reminders, hasLength(2));
    expect(second.hasMore, isFalse);
    expect(
      second.reminders
          .map((ActivityReminderItem reminder) => reminder.id)
          .toSet(),
      hasLength(2),
    );
  });

  test('候选活动的提醒列表为空，不串入其他活动的提醒', () async {
    final ProviderContainer providers = container(buildRepo());
    final ActivityRemindersState state =
        await providers.read(activityRemindersProvider('act-1002').future);
    expect(state.reminders, isEmpty);
  });
}
