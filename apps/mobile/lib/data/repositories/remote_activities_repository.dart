import '../../domain/models/activity.dart';
import '../../domain/models/api_request.dart';
import '../../domain/models/json_read.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/models/wechat_history.dart';
import '../../domain/ports/activities_port.dart';
import '../../domain/ports/kedaya_api_port.dart';
import '../api/request_ids.dart';

/// [ActivitiesPort] 的远端实现（`/api/v1/activities/*`）。
///
/// 形状约定：
/// - 集合统一按游标分页 `Page<T>`；也接受裸数组（有界字典的常见形状）。
/// - 动作端点可能返回裸 `ActivityItem`，也可能包一层 `{ item: ... }`，两者都接受。
/// - 写操作带 `Idempotency-Key`（契约 §6.1）。
/// - `PATCH` 使用 `application/merge-patch+json`。
///
/// 两个客户端容错（不改变契约）：
/// 1. 动作端点可能返回裸 `ActivityItem`，也可能包一层 `{ item: ... }`，两者都接受；
/// 2. 提醒列表可能省略 `activityId`；按活动过滤时这类条目**不会**显示在任何
///    活动详情里（无法判断归属），仅在“我的提醒”总列表保留。
final class RemoteActivitiesRepository implements ActivitiesPort {
  const RemoteActivitiesRepository(this._api);

  static const String _base = 'activities';
  static const String _items = '$_base/items';
  static const String _reminders = '$_base/reminders';

  final KedayaApiPort _api;

  @override
  Future<Result<Page<ActivityItem>>> list({
    ActivitySource? source,
    ActivityStatus? status,
    String? cursor,
    int limit = defaultPageSize,
  }) =>
      _api.send<Page<ActivityItem>>(
        ApiRequest(
          path: _items,
          method: ApiMethod.get,
          query: <String, Object?>{
            if (source != null) 'source': source.wire,
            if (status != null) 'status': status.wire,
            if (cursor != null && cursor.isNotEmpty) 'cursor': cursor,
            'limit': limit,
          },
        ),
        (Object? data) => _decodePage(data, 'activities items'),
      );

  @override
  Future<Result<ActivityItem>> get(String id) => _api.send<ActivityItem>(
        ApiRequest(path: '$_items/$id', method: ApiMethod.get),
        (Object? data) => _decodeItem(data, 'activity'),
      );

  @override
  Future<Result<ActivityItem>> createManual(ActivityDraft draft) =>
      _api.send<ActivityItem>(
        ApiRequest(
          path: _items,
          method: ApiMethod.post,
          body: draft.toJson(),
          idempotencyKey: newIdempotencyKey(),
        ),
        (Object? data) => _decodeItem(data, 'activity'),
      );

  @override
  Future<Result<ActivityItem>> patch(
    String id,
    Map<String, Object?> changes,
  ) =>
      _api.send<ActivityItem>(
        ApiRequest(
          path: '$_items/$id',
          method: ApiMethod.patch,
          body: changes,
          contentType: mergePatchContentType,
        ),
        (Object? data) => _decodeItem(data, 'activity'),
      );

  @override
  Future<Result<ActivityItem>> confirm(String id) => _api.send<ActivityItem>(
        ApiRequest(
          path: '$_items/$id/confirm',
          method: ApiMethod.post,
          idempotencyKey: newIdempotencyKey(),
        ),
        (Object? data) => _decodeItem(data, 'activity'),
      );

  @override
  Future<Result<ActivityItem>> dismiss(String id) => _api.send<ActivityItem>(
        ApiRequest(
          path: '$_items/$id/dismiss',
          method: ApiMethod.post,
          idempotencyKey: newIdempotencyKey(),
        ),
        (Object? data) => _decodeItem(data, 'activity'),
      );

  @override
  Future<Result<ActivityItem>> importWechat(WechatImportDraft draft) =>
      _api.send<ActivityItem>(
        ApiRequest(
          path: '$_base/imports/wechat',
          method: ApiMethod.post,
          body: draft.toJson(),
          idempotencyKey: newIdempotencyKey(),
        ),
        (Object? data) => _decodeItem(data, 'activity'),
      );

  @override
  Future<Result<WechatHistoryPage>> listWechatHistory(
    String savedPageHtml,
  ) =>
      _api.send<WechatHistoryPage>(
        // 这个端点在 `/api/v1/wechat` 下，不在 `/activities` 下：
        // 它只做「解析这段 HTML」，与活动存储无关。
        ApiRequest(
          path: 'wechat/profile-list',
          method: ApiMethod.post,
          body: <String, Object?>{'html': savedPageHtml},
        ),
        (Object? data) {
          final Map<String, Object?> map =
              requireJsonMap(data, what: 'wechat profile list');
          // 服务端用 200 + `ok:false` 表达「这段 HTML 不是历史页」，
          // 到不了这里就会先被错误层拦下；能到这里说明解析成功。
          return WechatHistoryPage.fromJson(map);
        },
      );

  @override
  Future<Result<ActivityItem>> promoteMail(String mailEventId) =>      _api.send<ActivityItem>(
        ApiRequest(
          path: '$_base/imports/mail',
          method: ApiMethod.post,
          body: <String, Object?>{
            'eventIds': <String>[mailEventId.trim()],
          },
          idempotencyKey: newIdempotencyKey(),
        ),
        (Object? data) => _decodeItem(data, 'activity'),
      );

  @override
  Future<Result<Page<ActivityReminderItem>>> listReminders({
    String? activityId,
    String? cursor,
    int limit = defaultPageSize,
  }) =>
      _api.send<Page<ActivityReminderItem>>(
        // OpenAPI 的 GET /activities/reminders 没有 activityId 查询参数；
        // 列表端点会返回 activityId，客户端据此过滤。
        ApiRequest(
          path: _reminders,
          method: ApiMethod.get,
          query: <String, Object?>{
            if (cursor != null && cursor.isNotEmpty) 'cursor': cursor,
            'limit': limit,
          },
        ),
        (Object? data) {
          final Page<ActivityReminderItem> page = _decodeReminderPage(data);
          if (activityId == null || activityId.isEmpty) return page;
          // 归属未知（activityId 缺失）的提醒不能显示在每一个活动详情里。
          final List<ActivityReminderItem> owned = page.items
              .where((ActivityReminderItem reminder) =>
                  reminder.activityId == activityId)
              .toList(growable: false);
          return Page<ActivityReminderItem>(
            items: owned,
            nextCursor: page.nextCursor,
            total: page.total,
          );
        },
      );

  @override
  Future<Result<ActivityReminderItem>> createReminder(
    String activityId, {
    required ActivityReminderKind kind,
    required DateTime remindAt,
    ActivityReminderChannel channel = ActivityReminderChannel.inapp,
  }) =>
      _api.send<ActivityReminderItem>(
        ApiRequest(
          path: '$_items/$activityId/reminders',
          method: ApiMethod.post,
          body: <String, Object?>{
            'kind': kind.wire,
            'remindAt': isoUtc(remindAt),
            'channel': channel.wire,
          },
          idempotencyKey: newIdempotencyKey(),
        ),
        (Object? data) => ActivityReminderItem.fromJson(
          requireJsonMap(data, what: 'activity reminder'),
        ),
      );

  @override
  Future<Result<Unit>> deleteReminder(String reminderId) => _api.sendVoid(
        ApiRequest(
          path: '$_reminders/$reminderId',
          method: ApiMethod.delete,
        ),
      );

  @override
  Future<Result<Unit>> dispatchReminders() => _api.sendVoid(
        ApiRequest(
          path: '$_reminders/dispatch',
          method: ApiMethod.post,
          idempotencyKey: newIdempotencyKey(),
        ),
      );

  /// 裸数组与 `{ items, nextCursor }` 两种形状都接受。
  Page<ActivityItem> _decodePage(Object? data, String what) {
    if (data is List<Object?>) {
      return Page<ActivityItem>(
        items: data
            .whereType<Map<String, Object?>>()
            .map(ActivityItem.fromJson)
            .toList(growable: false),
        total: data.length,
      );
    }
    final Map<String, Object?> map = requireJsonMap(data, what: what);
    return Page<ActivityItem>.fromJson(map, ActivityItem.fromJson);
  }

  /// 裸 item 或 `{ item: {...} }`。
  ActivityItem _decodeItem(Object? data, String what) {
    final Map<String, Object?> map = requireJsonMap(data, what: what);
    final Object? nested = map['item'];
    if (nested is Map<String, Object?>) {
      return ActivityItem.fromJson(nested);
    }
    return ActivityItem.fromJson(map);
  }

  Page<ActivityReminderItem> _decodeReminderPage(Object? data) {
    if (data is List<Object?>) {
      return Page<ActivityReminderItem>(
        items: data
            .whereType<Map<String, Object?>>()
            .map(ActivityReminderItem.fromJson)
            .toList(growable: false),
        total: data.length,
      );
    }
    final Map<String, Object?> map =
        requireJsonMap(data, what: 'activity reminders');
    return Page<ActivityReminderItem>.fromJson(
      map,
      ActivityReminderItem.fromJson,
    );
  }
}
