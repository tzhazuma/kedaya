import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/repositories/remote_activities_repository.dart';
import 'package:kedaya/domain/models/activity.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/api_request.dart';
import 'package:kedaya/domain/models/page.dart';
import 'package:kedaya/domain/models/result.dart';
import 'package:kedaya/domain/ports/kedaya_api_port.dart';

final class _RecordingApi implements KedayaApiPort {
  _RecordingApi(this.responder);

  final Object? Function(ApiRequest request) responder;
  final List<ApiRequest> requests = <ApiRequest>[];

  @override
  String? lastTraceId;

  @override
  Future<Result<T>> send<T>(
    ApiRequest request,
    T Function(Object? data) decode,
  ) async {
    requests.add(request);
    return Ok<T>(decode(responder(request)));
  }

  @override
  Future<Result<Unit>> sendVoid(ApiRequest request) async {
    requests.add(request);
    return Ok<Unit>(Unit.instance);
  }

  @override
  Future<Result<T>> sendMultipart<T>(
    ApiRequest request,
    List<ApiUploadFile> files,
    T Function(Object? data) decode,
  ) =>
      throw UnimplementedError('activities 不使用 multipart');
}

Map<String, Object?> _itemPayload({
  String id = 'act-1',
  String status = 'candidate',
  String source = 'campus-mail',
}) =>
    <String, Object?>{
      'id': id,
      'source': source,
      'kind': 'lecture',
      'title': '活动 $id',
      'startsAt': '2026-11-25T02:00:00.000Z',
      'endsAt': null,
      'location': '信息学院 1-101',
      'organizer': null,
      'registrationDeadlineAt': null,
      'registrationDeadlineRaw': '11 月 30 日闭馆前',
      'registrationUrl': null,
      'evidenceText': '邮件摘录',
      'confidence': 0.7,
      'status': status,
      'sourceUrl': null,
      'sourceLabel': '校园邮箱',
      'publishedAt': '2026-11-20T00:00:00.000Z',
      'stale': false,
    };

Map<String, Object?> _pagePayload({String? nextCursor}) => <String, Object?>{
      'items': <Object?>[_itemPayload()],
      'nextCursor': nextCursor,
      'total': 1,
    };

Map<String, Object?> _reminderPayload({
  String id = 'rem-1',
  String? activityId = 'act-1',
}) =>
    <String, Object?>{
      'id': id,
      'kind': 'registration',
      'remindAt': '2026-11-24T02:00:00.000Z',
      'channel': 'inapp',
      'status': 'pending',
      'activityId': activityId,
      'activityTitle': '活动 act-1',
    };

Object? _defaultPayload(ApiRequest request) {
  if (request.path == 'activities/items' && request.method == ApiMethod.get) {
    return _pagePayload();
  }
  if (request.path == 'activities/reminders' &&
      request.method == ApiMethod.get) {
    return <String, Object?>{
      'items': <Object?>[_reminderPayload()],
      'nextCursor': null,
      'total': 1,
    };
  }
  if (request.path == 'activities/items/act-1/reminders') {
    return _reminderPayload();
  }
  return _itemPayload(status: 'confirmed');
}

/// 只用于错误传播测试：所有请求都返回 [Err]。
final class _FailingApi implements KedayaApiPort {
  const _FailingApi();

  @override
  String? get lastTraceId => 'trace-error';

  @override
  Future<Result<T>> send<T>(
    ApiRequest request,
    T Function(Object? data) decode,
  ) async =>
      Err<T>(
        const ApiError(
          code: ApiErrorCode.upstreamUnavailable,
          message: '校园系统暂时不可用',
        ),
        traceId: 'trace-error',
      );

  @override
  Future<Result<Unit>> sendVoid(ApiRequest request) async => Err<Unit>(
        const ApiError(
          code: ApiErrorCode.upstreamUnavailable,
          message: '校园系统暂时不可用',
        ),
        traceId: 'trace-error',
      );

  @override
  Future<Result<T>> sendMultipart<T>(
    ApiRequest request,
    List<ApiUploadFile> files,
    T Function(Object? data) decode,
  ) =>
      throw UnimplementedError('activities 不使用 multipart');
}

void main() {
  late _RecordingApi api;
  late RemoteActivitiesRepository repository;

  setUp(() {
    api = _RecordingApi(_defaultPayload);
    repository = RemoteActivitiesRepository(api);
  });

  test('列表：GET activities/items，带来源/状态/游标查询', () async {
    final Page<ActivityItem> page = (await repository.list(
      source: ActivitySource.wechatMp,
      status: ActivityStatus.candidate,
      cursor: 'cursor-1',
      limit: 10,
    ))
        .unwrap;

    final ApiRequest request = api.requests.single;
    expect(request.path, 'activities/items');
    expect(request.method, ApiMethod.get);
    expect(request.query, <String, Object?>{
      'source': 'wechat-mp',
      'status': 'candidate',
      'cursor': 'cursor-1',
      'limit': 10,
    });
    expect(page.items, hasLength(1));
    expect(page.items.single.id, 'act-1');
    expect(page.items.single.registrationDeadlineRaw, '11 月 30 日闭馆前');
  });

  test('详情：GET activities/items/:id', () async {
    final ActivityItem item = (await repository.get('act-1')).unwrap;
    expect(api.requests.single.path, 'activities/items/act-1');
    expect(api.requests.single.method, ApiMethod.get);
    expect(item.source, ActivitySource.campusMail);
  });

  test('确认 / 忽略：POST 动作端点并带幂等键', () async {
    await repository.confirm('act-1');
    await repository.dismiss('act-1');

    expect(api.requests[0].path, 'activities/items/act-1/confirm');
    expect(api.requests[0].method, ApiMethod.post);
    expect(api.requests[0].idempotencyKey, isNotNull);
    expect(api.requests[1].path, 'activities/items/act-1/dismiss');
    expect(api.requests[1].method, ApiMethod.post);
    expect(api.requests[1].idempotencyKey, isNotNull);
  });

  test('手动创建：POST activities/items，不传 source，时间是 UTC ISO', () async {
    final ActivityDraft draft = ActivityDraft(
      title: '  计算生物学论坛  ',
      startsAt: DateTime.utc(2026, 11, 25, 11),
      evidenceText: '  海报摘录 ',
    );
    await repository.createManual(draft);

    final ApiRequest request = api.requests.single;
    expect(request.path, 'activities/items');
    expect(request.method, ApiMethod.post);
    expect(request.idempotencyKey, isNotNull);
    final Map<String, Object?> body = request.body! as Map<String, Object?>;
    expect(body.containsKey('source'), isFalse);
    expect(body.containsKey('status'), isFalse);
    expect(body.containsKey('confidence'), isFalse);
    expect(body['title'], '计算生物学论坛');
    expect(body['startsAt'], '2026-11-25T11:00:00.000Z');
    expect(body['evidenceText'], '海报摘录');
  });

  test('PATCH 详情使用 JSON Merge Patch 媒体类型', () async {
    await repository.patch('act-1', <String, Object?>{'title': '新标题'});

    final ApiRequest request = api.requests.single;
    expect(request.path, 'activities/items/act-1');
    expect(request.method, ApiMethod.patch);
    expect(request.contentType, mergePatchContentType);
    expect(request.body, <String, Object?>{'title': '新标题'});
  });

  test('公众号单篇导入：POST activities/imports/wechat', () async {
    await repository.importWechat(
      const WechatImportDraft(url: 'https://mp.weixin.qq.com/s/demo'),
    );

    final ApiRequest request = api.requests.single;
    expect(request.path, 'activities/imports/wechat');
    expect(request.method, ApiMethod.post);
    expect(request.idempotencyKey, isNotNull);
    expect(request.body, <String, Object?>{
      'url': 'https://mp.weixin.qq.com/s/demo',
    });
  });

  test('邮件提升：POST activities/imports/mail，提交 eventIds 数组', () async {
    await repository.promoteMail('mail-1001');

    final ApiRequest request = api.requests.single;
    expect(request.path, 'activities/imports/mail');
    expect(request.method, ApiMethod.post);
    expect(request.body, <String, Object?>{
      'eventIds': <String>['mail-1001'],
    });
  });

  test('提醒列表：GET activities/reminders，按 activityId 客户端过滤', () async {
    final Page<ActivityReminderItem> page =
        (await repository.listReminders(activityId: 'act-1')).unwrap;

    final ApiRequest request = api.requests.single;
    expect(request.path, 'activities/reminders');
    expect(request.query, <String, Object?>{'limit': defaultPageSize});
    expect(page.items.single.kind, ActivityReminderKind.registration);
    expect(page.items.single.activityId, 'act-1');
  });

  test('提醒列表跟随游标分页：cursor/limit 透传，nextCursor 原样返回', () async {
    api = _RecordingApi((ApiRequest request) => <String, Object?>{
          'items': <Object?>[_reminderPayload(id: 'rem-2')],
          'nextCursor': 'rem-cursor-2',
          'total': 4,
        });
    repository = RemoteActivitiesRepository(api);

    final Page<ActivityReminderItem> page = (await repository.listReminders(
      activityId: 'act-1',
      cursor: 'rem-cursor-1',
      limit: 2,
    ))
        .unwrap;

    final ApiRequest request = api.requests.single;
    expect(request.query, <String, Object?>{
      'cursor': 'rem-cursor-1',
      'limit': 2,
    });
    expect(page.nextCursor, 'rem-cursor-2');
    expect(page.items.single.id, 'rem-2');
  });

  test('activityId 为 null 的提醒不串到任何活动详情', () async {
    api = _RecordingApi((ApiRequest request) => <String, Object?>{
          'items': <Object?>[
            _reminderPayload(id: 'rem-owned', activityId: 'act-1'),
            _reminderPayload(id: 'rem-other', activityId: 'act-2'),
            _reminderPayload(id: 'rem-unknown', activityId: null),
          ],
          'nextCursor': null,
          'total': 3,
        });
    repository = RemoteActivitiesRepository(api);

    final Page<ActivityReminderItem> page =
        (await repository.listReminders(activityId: 'act-1')).unwrap;

    expect(
      page.items.map((ActivityReminderItem reminder) => reminder.id),
      <String>['rem-owned'],
    );
  });

  test('不按活动过滤时保留 activityId 为 null 的提醒', () async {
    api = _RecordingApi((ApiRequest request) => <String, Object?>{
          'items': <Object?>[
            _reminderPayload(id: 'rem-owned', activityId: 'act-1'),
            _reminderPayload(id: 'rem-unknown', activityId: null),
          ],
          'nextCursor': null,
          'total': 2,
        });
    repository = RemoteActivitiesRepository(api);

    final Page<ActivityReminderItem> page =
        (await repository.listReminders()).unwrap;

    expect(
      page.items.map((ActivityReminderItem reminder) => reminder.id),
      <String>['rem-owned', 'rem-unknown'],
    );
  });

  test('活动列表分页：第二页使用 nextCursor，不丢 nextCursor', () async {
    api = _RecordingApi((ApiRequest request) {
      final bool secondPage = request.query?['cursor'] == 'cursor-2';
      return <String, Object?>{
        'items': <Object?>[_itemPayload(id: secondPage ? 'act-2' : 'act-1')],
        'nextCursor': secondPage ? null : 'cursor-2',
        'total': 2,
      };
    });
    repository = RemoteActivitiesRepository(api);

    final Page<ActivityItem> first = (await repository.list(limit: 1)).unwrap;
    expect(first.nextCursor, 'cursor-2');

    final Page<ActivityItem> second = (await repository.list(
      cursor: first.nextCursor,
      limit: 1,
    ))
        .unwrap;
    expect(second.items.single.id, 'act-2');
    expect(second.nextCursor, isNull);
    expect(api.requests[1].query?['cursor'], 'cursor-2');
  });

  test('活动列表错误原样返回 Err（不吞成空列表）', () async {
    final Result<Page<ActivityItem>> result =
        await const RemoteActivitiesRepository(_FailingApi()).list();

    expect(result.isErr, isTrue);
    expect(result.errorOrNull?.code, ApiErrorCode.upstreamUnavailable);
  });

  test('提醒列表错误原样返回 Err', () async {
    final Result<Page<ActivityReminderItem>> result =
        await const RemoteActivitiesRepository(_FailingApi())
            .listReminders(activityId: 'act-1');

    expect(result.isErr, isTrue);
    expect(result.errorOrNull?.message, contains('不可用'));
  });

  test('创建提醒：POST activities/items/:id/reminders', () async {
    await repository.createReminder(
      'act-1',
      kind: ActivityReminderKind.start,
      remindAt: DateTime.utc(2026, 11, 25, 1),
    );

    final ApiRequest request = api.requests.single;
    expect(request.path, 'activities/items/act-1/reminders');
    expect(request.method, ApiMethod.post);
    expect(request.idempotencyKey, isNotNull);
    expect(request.body, <String, Object?>{
      'kind': 'start',
      'remindAt': '2026-11-25T01:00:00.000Z',
      'channel': 'inapp',
    });
  });

  test('删除提醒：DELETE activities/reminders/:id', () async {
    await repository.deleteReminder('rem-1');
    final ApiRequest request = api.requests.single;
    expect(request.path, 'activities/reminders/rem-1');
    expect(request.method, ApiMethod.delete);
  });

  test('管理员派发：POST activities/reminders/dispatch', () async {
    await repository.dispatchReminders();
    final ApiRequest request = api.requests.single;
    expect(request.path, 'activities/reminders/dispatch');
    expect(request.method, ApiMethod.post);
    expect(request.idempotencyKey, isNotNull);
  });
}
