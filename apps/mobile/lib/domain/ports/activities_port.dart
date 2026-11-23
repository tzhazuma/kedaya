import '../models/activity.dart';
import '../models/api_request.dart';
import '../models/page.dart';
import '../models/result.dart';

/// 校园活动端口（共同 REST 契约 `/activities`）。
///
/// 边界：
/// - 本端口**没有**邮件正文、附件、公众号全文的读取方法；
///   来源导入只有“用户主动提交的 [WechatImportDraft]”与“邮件事件提升”两种。
/// - 候选活动能否建提醒由服务端最终裁决；客户端用
///   [ActivityItem.canScheduleReminders] 提前隐藏入口。
/// - 提醒渠道当前 MVP 只有站内信；`wechat-subscribe` 在契约里保留，
///   但**未接通**，UI 必须如实标注。
abstract interface class ActivitiesPort {
  /// `GET /activities/items`（游标分页，可按来源 / 状态过滤）。
  Future<Result<Page<ActivityItem>>> list({
    ActivitySource? source,
    ActivityStatus? status,
    String? cursor,
    int limit = defaultPageSize,
  });

  /// `GET /activities/items/:id`。
  Future<Result<ActivityItem>> get(String id);

  /// `POST /activities/items` —— 手动创建（`source=manual`，默认 candidate）。
  Future<Result<ActivityItem>> createManual(ActivityDraft draft);

  /// `PATCH /activities/items/:id` —— JSON Merge Patch；状态只能走确认/忽略。
  Future<Result<ActivityItem>> patch(
    String id,
    Map<String, Object?> changes,
  );

  /// `POST /activities/items/:id/confirm` —— 用户确认；确认后才允许提醒。
  Future<Result<ActivityItem>> confirm(String id);

  /// `POST /activities/items/:id/dismiss` —— 用户忽略。
  Future<Result<ActivityItem>> dismiss(String id);

  /// `POST /activities/imports/wechat` —— 用户主动提交的**单篇**公众号文章。
  Future<Result<ActivityItem>> importWechat(WechatImportDraft draft);

  /// `POST /activities/imports/mail` —— 把校园邮箱归一出的邮件事件提升为活动。
  ///
  /// OpenAPI `ActivityMailImport` 要求 `{ eventIds: [id] }`：只接受用户明确勾选
  /// 的邮件事件 id，不做全箱扫描。本端口为 MVP 便利只暴露单个 id，实现会包成数组。
  Future<Result<ActivityItem>> promoteMail(String mailEventId);

  /// `GET /activities/reminders`（游标分页；可按活动在客户端过滤）。
  ///
  /// 契约没有 `activityId` 查询参数，列表端点会返回 `activityId`；
  /// 按活动过滤时**只保留明确属于该活动**的提醒 —— `activityId` 缺失的条目
  /// 无法判断归属，不能显示在每一个活动详情里。
  Future<Result<Page<ActivityReminderItem>>> listReminders({
    String? activityId,
    String? cursor,
    int limit = defaultPageSize,
  });

  /// `POST /activities/items/:id/reminders`。
  Future<Result<ActivityReminderItem>> createReminder(
    String activityId, {
    required ActivityReminderKind kind,
    required DateTime remindAt,
    ActivityReminderChannel channel = ActivityReminderChannel.inapp,
  });

  /// `DELETE /activities/reminders/:id`（幂等）。
  Future<Result<Unit>> deleteReminder(String reminderId);

  /// `POST /activities/reminders/dispatch` —— 管理员派发（MVP 站内信）。
  Future<Result<Unit>> dispatchReminders();
}
