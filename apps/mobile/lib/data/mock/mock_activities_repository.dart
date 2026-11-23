import '../../domain/models/activity.dart';
import '../../domain/models/activity_reminders.dart';
import '../../domain/models/api_error.dart';
import '../../domain/models/api_request.dart';
import '../../domain/models/page.dart';
import '../../domain/models/result.dart';
import '../../domain/ports/activities_port.dart';
import 'activity_fixtures.dart';
import 'mock_controls.dart';

/// [ActivitiesPort] 的内存实现 —— 让 activities 在无后端时可跑。
///
/// 行为不是“假展示”：确认会真的改状态并生成默认提醒；忽略会删掉待发提醒；
/// 手动创建与单篇导入都会走同一套领域校验。
///
/// 明确的模拟边界：
/// - 微信订阅消息**未接通**，因此创建该类提醒会被拒绝（不假装排期成功）；
/// - 公众号导入只保存用户提交的链接 / ≤200 字摘录，**不解析**文章正文；
/// - 邮件提升只认演示事件 `mail-1001`（真实实现由服务端从 mail 模块取数）。
final class MockActivitiesRepository implements ActivitiesPort {
  MockActivitiesRepository({
    List<ActivityItem>? activities,
    MockControls? controls,
    DateTime Function()? clock,
  })  : controls = controls ?? MockControls(),
        _clock = clock ?? DateTime.now {
    final DateTime now = _clock().toUtc();
    for (final ActivityItem item in activities ?? buildMockActivities(now)) {
      _activities[item.id] = item;
    }
    for (final ActivityItem item in _activities.values) {
      _seedDefaultReminders(item);
    }
  }

  final MockControls controls;
  final DateTime Function() _clock;

  final Map<String, ActivityItem> _activities = <String, ActivityItem>{};
  final Map<String, ActivityReminderItem> _reminders =
      <String, ActivityReminderItem>{};

  /// 提醒 → 所属活动（共同契约的提醒模型只有五个字段，关联关系留在仓库内部）。
  final Map<String, String> _reminderOwner = <String, String>{};

  int _sequence = 9100;
  int _reminderSequence = 5100;

  int get debugLength => _activities.length;

  ActivityItem? debugById(String id) => _activities[id];

  List<ActivityReminderItem> debugReminders(String activityId) =>
      _ownedReminders(activityId);

  @override
  Future<Result<Page<ActivityItem>>> list({
    ActivitySource? source,
    ActivityStatus? status,
    String? cursor,
    int limit = defaultPageSize,
  }) async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<Page<ActivityItem>>();
    }
    if (controls.emptyResults) {
      return Ok<Page<ActivityItem>>(
        const Page<ActivityItem>(items: <ActivityItem>[], total: 0),
      );
    }
    final List<ActivityItem> filtered = _activities.values
        .where((ActivityItem item) {
          // OpenAPI：不传 status 时默认只返回 candidate + confirmed；
          // dismissed / archived 必须显式查询。
          if (status == null) {
            return item.status == ActivityStatus.candidate ||
                item.status == ActivityStatus.confirmed;
          }
          return item.status == status;
        })
        .where((ActivityItem item) => source == null || item.source == source)
        .toList(growable: false);
    final int offset = _cursorOffset(cursor);
    if (offset < 0) {
      return _err<Page<ActivityItem>>(
        ApiErrorCode.validationFailed,
        '分页游标不合法',
      );
    }
    final int pageSize = _clampLimit(limit);
    final List<ActivityItem> pageItems =
        filtered.skip(offset).take(pageSize).toList(growable: false);
    final int nextOffset = offset + pageItems.length;
    return Ok<Page<ActivityItem>>(
      Page<ActivityItem>(
        items: List<ActivityItem>.unmodifiable(pageItems),
        nextCursor: nextOffset < filtered.length ? 'offset:$nextOffset' : null,
        total: filtered.length,
      ),
    );
  }

  @override
  Future<Result<ActivityItem>> get(String id) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<ActivityItem>();
    final ActivityItem? item = _activities[id];
    if (item == null) return _err<ActivityItem>(ApiErrorCode.notFound, '活动不存在');
    return Ok<ActivityItem>(item);
  }

  @override
  Future<Result<ActivityItem>> createManual(ActivityDraft draft) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<ActivityItem>();

    final List<ActivityDraftProblem> problems = validateActivityDraft(draft);
    if (problems.isNotEmpty) {
      return _err<ActivityItem>(
        ApiErrorCode.validationFailed,
        problems.map(describeActivityDraftProblem).join('；'),
        details: <String, Object?>{
          'problems': problems
              .map((ActivityDraftProblem problem) => problem.wire)
              .toList(growable: false),
        },
      );
    }

    final DateTime now = _clock().toUtc();
    final ActivityItem created = ActivityItem(
      id: 'act-${_sequence++}',
      source: ActivitySource.manual,
      kind: _clean(draft.kind) ?? defaultActivityKind,
      title: draft.title.trim(),
      startsAt: draft.startsAt?.toUtc(),
      endsAt: draft.endsAt?.toUtc(),
      location: _clean(draft.location),
      organizer: _clean(draft.organizer),
      registrationDeadlineAt: draft.registrationDeadlineAt?.toUtc(),
      registrationDeadlineRaw: _clean(draft.registrationDeadlineRaw),
      registrationUrl: _clean(draft.registrationUrl),
      evidenceText: normalizeActivityEvidence(draft.evidenceText),
      confidence: 1,
      status: ActivityStatus.candidate,
      sourceUrl: _clean(draft.sourceUrl),
      sourceLabel: _clean(draft.sourceLabel) ?? '手动创建',
      publishedAt: now,
      stale: false,
    );
    _activities[created.id] = created;
    return Ok<ActivityItem>(created);
  }

  @override
  Future<Result<ActivityItem>> patch(
    String id,
    Map<String, Object?> changes,
  ) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<ActivityItem>();

    final ActivityItem? existing = _activities[id];
    if (existing == null) {
      return _err<ActivityItem>(ApiErrorCode.notFound, '活动不存在');
    }

    for (final String forbidden in <String>[
      'id',
      'source',
      'status',
      'confidence',
    ]) {
      if (changes.containsKey(forbidden)) {
        return _err<ActivityItem>(
          ApiErrorCode.validationFailed,
          '状态、来源与置信度不能通过编辑修改；请使用确认 / 忽略',
        );
      }
    }

    final Map<String, Object?> merged = existing.toJson()..addAll(changes);
    final ActivityItem updated;
    try {
      updated = ActivityItem.fromJson(merged);
    } on FormatException catch (error) {
      return _err<ActivityItem>(
        ApiErrorCode.validationFailed,
        '活动字段不合法：${error.message}',
      );
    }
    _activities[id] = updated;
    return Ok<ActivityItem>(updated);
  }

  @override
  Future<Result<ActivityItem>> confirm(String id) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<ActivityItem>();

    final ActivityItem? existing = _activities[id];
    if (existing == null) {
      return _err<ActivityItem>(ApiErrorCode.notFound, '活动不存在');
    }
    if (existing.status == ActivityStatus.confirmed) {
      return Ok<ActivityItem>(existing);
    }
    if (existing.status != ActivityStatus.candidate) {
      return _err<ActivityItem>(
        ApiErrorCode.conflict,
        '只有待确认的活动才能确认',
      );
    }

    final ActivityItem updated = existing.withStatus(ActivityStatus.confirmed);
    _activities[id] = updated;
    _seedDefaultReminders(updated);
    return Ok<ActivityItem>(updated);
  }

  @override
  Future<Result<ActivityItem>> dismiss(String id) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<ActivityItem>();

    final ActivityItem? existing = _activities[id];
    if (existing == null) {
      return _err<ActivityItem>(ApiErrorCode.notFound, '活动不存在');
    }
    if (existing.status == ActivityStatus.dismissed) {
      return Ok<ActivityItem>(existing);
    }
    if (existing.status == ActivityStatus.archived) {
      return _err<ActivityItem>(
        ApiErrorCode.conflict,
        '已归档的活动不能再忽略',
      );
    }

    final ActivityItem updated = existing.withStatus(ActivityStatus.dismissed);
    _activities[id] = updated;
    _removeRemindersFor(id);
    return Ok<ActivityItem>(updated);
  }

  @override
  Future<Result<ActivityItem>> importWechat(WechatImportDraft draft) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<ActivityItem>();

    final List<WechatImportProblem> problems = validateWechatImportDraft(draft);
    if (problems.isNotEmpty) {
      return _err<ActivityItem>(
        ApiErrorCode.validationFailed,
        problems.map(describeWechatImportProblem).join('；'),
        details: <String, Object?>{
          'problems': problems
              .map((WechatImportProblem problem) => problem.wire)
              .toList(growable: false),
        },
      );
    }

    final DateTime now = _clock().toUtc();
    final ActivityItem created = ActivityItem(
      id: 'act-${_sequence++}',
      source: ActivitySource.wechatMp,
      kind: 'other',
      title: _wechatTitle(draft),
      evidenceText: normalizeActivityEvidence(draft.normalizedText),
      confidence: 0.4,
      status: ActivityStatus.candidate,
      sourceUrl: draft.normalizedUrl,
      sourceLabel: '微信公众号',
      publishedAt: now,
      stale: false,
    );
    _activities[created.id] = created;
    return Ok<ActivityItem>(created);
  }

  @override
  Future<Result<ActivityItem>> promoteMail(String mailEventId) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<ActivityItem>();

    if (mailEventId.trim() != 'mail-1001') {
      return _err<ActivityItem>(
        ApiErrorCode.notFound,
        '邮件事件不存在或已失效',
      );
    }

    final DateTime now = _clock().toUtc();
    final ActivityItem created = ActivityItem(
      id: 'act-${_sequence++}',
      source: ActivitySource.campusMail,
      kind: 'lecture',
      title: '校园讲座（来自邮件，待确认）',
      confidence: 0.6,
      status: ActivityStatus.candidate,
      sourceLabel: '校园邮箱',
      publishedAt: now,
      stale: false,
    );
    _activities[created.id] = created;
    return Ok<ActivityItem>(created);
  }

  @override
  Future<Result<Page<ActivityReminderItem>>> listReminders({
    String? activityId,
    String? cursor,
    int limit = defaultPageSize,
  }) async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<Page<ActivityReminderItem>>();
    }
    final List<ActivityReminderItem> reminders = activityId == null
        ? (_reminders.values.toList(growable: false)..sort(_compareReminders))
        : _ownedReminders(activityId);
    final int offset = _cursorOffset(cursor);
    if (offset < 0) {
      return _err<Page<ActivityReminderItem>>(
        ApiErrorCode.validationFailed,
        '分页游标不合法',
      );
    }
    final int pageSize = _clampLimit(limit);
    final List<ActivityReminderItem> pageItems =
        reminders.skip(offset).take(pageSize).toList(growable: false);
    final int nextOffset = offset + pageItems.length;
    return Ok<Page<ActivityReminderItem>>(
      Page<ActivityReminderItem>(
        items: List<ActivityReminderItem>.unmodifiable(pageItems),
        nextCursor: nextOffset < reminders.length ? 'offset:$nextOffset' : null,
        total: reminders.length,
      ),
    );
  }

  @override
  Future<Result<ActivityReminderItem>> createReminder(
    String activityId, {
    required ActivityReminderKind kind,
    required DateTime remindAt,
    ActivityReminderChannel channel = ActivityReminderChannel.inapp,
  }) async {
    await controls.simulate();
    if (controls.failure != null) {
      return controls.failureResult<ActivityReminderItem>();
    }

    final ActivityItem? activity = _activities[activityId];
    if (activity == null) {
      return _err<ActivityReminderItem>(ApiErrorCode.notFound, '活动不存在');
    }
    if (!activity.canScheduleReminders) {
      return _err<ActivityReminderItem>(
        ApiErrorCode.conflict,
        '候选活动必须先确认，才能创建提醒',
      );
    }
    if (channel == ActivityReminderChannel.wechatSubscribe) {
      return _err<ActivityReminderItem>(
        ApiErrorCode.validationFailed,
        '微信订阅消息尚未接通，请选择站内信',
      );
    }
    if (!remindAt.toUtc().isAfter(_clock().toUtc())) {
      return _err<ActivityReminderItem>(
        ApiErrorCode.validationFailed,
        '提醒时间必须晚于当前时刻',
      );
    }

    final ActivityReminderItem created = ActivityReminderItem(
      id: 'rem-${_reminderSequence++}',
      kind: kind,
      remindAt: remindAt.toUtc(),
      channel: channel,
      status: ActivityReminderStatus.pending,
      activityId: activityId,
      activityTitle: activity.title,
    );
    _reminders[created.id] = created;
    _reminderOwner[created.id] = activityId;
    return Ok<ActivityReminderItem>(created);
  }

  @override
  Future<Result<Unit>> deleteReminder(String reminderId) async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<Unit>();
    _reminders.remove(reminderId);
    _reminderOwner.remove(reminderId);
    return Ok<Unit>(Unit.instance);
  }

  @override
  Future<Result<Unit>> dispatchReminders() async {
    await controls.simulate();
    if (controls.failure != null) return controls.failureResult<Unit>();

    final DateTime now = _clock().toUtc();
    for (final ActivityReminderItem reminder
        in _reminders.values.toList(growable: false)) {
      if (reminder.status != ActivityReminderStatus.pending) continue;
      if (reminder.channel != ActivityReminderChannel.inapp) continue;
      if (reminder.remindAt.isAfter(now)) continue;
      _reminders[reminder.id] = ActivityReminderItem(
        id: reminder.id,
        kind: reminder.kind,
        remindAt: reminder.remindAt,
        channel: reminder.channel,
        status: ActivityReminderStatus.sent,
        activityId: reminder.activityId,
        activityTitle: reminder.activityTitle,
      );
    }
    return Ok<Unit>(Unit.instance);
  }

  void _seedDefaultReminders(ActivityItem item) {
    if (!item.canScheduleReminders) return;
    if (_reminderOwner.values.contains(item.id)) return;

    for (final ActivityReminderPlan plan
        in defaultActivityReminders(item, _clock())) {
      final ActivityReminderItem reminder = ActivityReminderItem(
        id: 'rem-${_reminderSequence++}',
        kind: plan.kind,
        remindAt: plan.remindAt,
        channel: plan.channel,
        status: ActivityReminderStatus.pending,
        activityId: item.id,
        activityTitle: item.title,
      );
      _reminders[reminder.id] = reminder;
      _reminderOwner[reminder.id] = item.id;
    }
  }

  List<ActivityReminderItem> _ownedReminders(String activityId) {
    final List<ActivityReminderItem> owned = _reminders.values
        .where((ActivityReminderItem reminder) =>
            _reminderOwner[reminder.id] == activityId)
        .toList(growable: false);
    owned.sort(_compareReminders);
    return owned;
  }

  static int _compareReminders(
    ActivityReminderItem a,
    ActivityReminderItem b,
  ) {
    final int byTime = a.remindAt.compareTo(b.remindAt);
    return byTime != 0 ? byTime : a.id.compareTo(b.id);
  }

  static int _clampLimit(int limit) {
    if (limit < 1) return 1;
    return limit > maxPageSize ? maxPageSize : limit;
  }

  /// mock 的游标是内部约定 `offset:<n>`；非法游标返回 -1（调用方转校验错误）。
  static int _cursorOffset(String? cursor) {
    if (cursor == null || cursor.isEmpty) return 0;
    if (!cursor.startsWith('offset:')) return -1;
    final int? parsed = int.tryParse(cursor.substring('offset:'.length));
    if (parsed == null || parsed < 0) return -1;
    return parsed;
  }

  void _removeRemindersFor(String activityId) {
    final List<String> owned = _reminderOwner.entries
        .where((MapEntry<String, String> entry) => entry.value == activityId)
        .map((MapEntry<String, String> entry) => entry.key)
        .toList(growable: false);
    for (final String reminderId in owned) {
      _reminders.remove(reminderId);
      _reminderOwner.remove(reminderId);
    }
  }

  String _wechatTitle(WechatImportDraft draft) {
    final String? text = draft.normalizedText;
    if (text != null) {
      for (final String line in text.split(RegExp(r'\r?\n'))) {
        final String trimmed = line.trim();
        if (trimmed.isEmpty) continue;
        return trimmed.length <= 80 ? trimmed : trimmed.substring(0, 80);
      }
    }
    return '公众号活动（待确认）';
  }

  String? _clean(String? value) {
    if (value == null) return null;
    final String trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  Err<T> _err<T>(
    ApiErrorCode code,
    String message, {
    Map<String, Object?>? details,
  }) =>
      Err<T>(
        ApiError(code: code, message: message, details: details),
        traceId: MockControls.traceId,
      );
}
