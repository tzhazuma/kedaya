/// 校园活动（`activities`）—— 独立域，**不塞进**课程 `deadlines`。
///
/// 契约要点（逐条落到类型上）：
///
/// - 来源只有三种：[ActivitySource.campusMail] / [ActivitySource.wechatMp] /
///   [ActivitySource.manual]；未知取值直接拒绝，不静默降级。
/// - 状态只有四种：`candidate` / `confirmed` / `dismissed` / `archived`。
///   **候选活动必须由用户确认后**才允许创建提醒或进入日程
///   （[ActivityItem.canScheduleReminders]）。
/// - 只存活动字段与 **≤200 字**证据片段（[activityEvidenceMaxChars]）；
///   模型里**没有**邮件正文、附件、公众号全文这些字段，因此类型上就写不出来。
/// - 时间存 UTC instant；展示走 `activity_time.dart` 的 Asia/Shanghai 换算。
/// - 无法确定的报名截止时刻保留 [ActivityItem.registrationDeadlineRaw]，
///   **不得**擅自补 `23:59`。
library;

import 'activity_time.dart';
import 'json_read.dart';

/// 证据片段上限（字符数，按 Unicode code point 计）。
const int activityEvidenceMaxChars = 200;

const int activityTitleMinChars = 1;
const int activityTitleMaxChars = 160;
const int activityShortTextMaxChars = 160;
const int activityDeadlineRawMaxChars = 200;

/// 手动创建活动的默认 `kind`（OpenAPI `ActivityCreate.kind` 的枚举之一）。
const String defaultActivityKind = 'other';

/// 契约冻结的活动类型枚举（OpenAPI `ActivityItem.kind`）。
const List<String> activityKinds = <String>[
  'lecture',
  'meeting',
  'info-session',
  'sports',
  'club',
  'other',
];

const Map<String, String> activityKindLabels = <String, String>{
  'lecture': '讲座',
  'meeting': '会议',
  'info-session': '宣讲会',
  'sports': '体育活动',
  'club': '社团活动',
  'other': '其他',
};

String? _clean(String? value) {
  if (value == null) return null;
  final String trimmed = value.trim();
  return trimmed.isEmpty ? null : trimmed;
}

/// 活动时间字段：null / 空串 / date-only / 无时区 → 视为“没有可确定时刻”。
///
/// 这里刻意不抛错：`registrationDeadlineRaw` 已经保存了原文，客户端不该因为
/// 上游多给了一个 `2026-11-30` 就让整条活动解析失败，更不该把它补成午夜。
DateTime? _readActivityInstantOrNull(Map<String, Object?> json, String key) {
  final Object? value = json[key];
  if (value == null) return null;
  if (value is! String) {
    throw FormatException(
      'JSON 字段 "$key" 期望带时区的 ISO-8601 时刻，实际为 '
      '${value.runtimeType}',
    );
  }
  if (value.trim().isEmpty) return null;
  return parseActivityInstant(value);
}

/// 必填时刻（提醒的 `remindAt`）：date-only 直接拒绝，不补午夜。
DateTime _readActivityInstant(Map<String, Object?> json, String key) {
  final DateTime? parsed = _readActivityInstantOrNull(json, key);
  if (parsed == null) {
    throw FormatException(
      'JSON 字段 "$key" 期望带时区的 ISO-8601 时刻（不接受 date-only）',
    );
  }
  return parsed;
}

/// 归一证据片段：去首尾空白、空串归 null、超过 200 字截断。
///
/// 截断发生在**解析与写回两侧**，所以即使上游多给了正文，也不会被客户端
/// 二次保存或上传。
String? normalizeActivityEvidence(String? raw) {
  final String? cleaned = _clean(raw);
  if (cleaned == null) return null;
  final Iterable<int> runes = cleaned.runes;
  if (runes.length <= activityEvidenceMaxChars) return cleaned;
  return String.fromCharCodes(runes.take(activityEvidenceMaxChars)).trim();
}

/// 只接受 `http` / `https` 的绝对地址（拒绝 `javascript:` / 相对路径）。
bool isHttpUrl(String? value) {
  final String? cleaned = _clean(value);
  if (cleaned == null) return false;
  final Uri? uri = Uri.tryParse(cleaned);
  return uri != null &&
      (uri.scheme == 'http' || uri.scheme == 'https') &&
      uri.host.isNotEmpty;
}

/* ------------------------------------------------------------------ *
 * 1. 来源与状态
 * ------------------------------------------------------------------ */

/// 活动的来源（契约只允许这三种）。
enum ActivitySource {
  campusMail('campus-mail', '校园邮箱', '来自校园邮箱同步归一的邮件事件；只保留活动字段与证据摘录，不保存正文与附件'),
  wechatMp('wechat-mp', '公众号', '来自你主动提交的单篇公众号文章；不做自动发现，也不抓取历史文章'),
  manual('manual', '手动创建', '由你手动填写，不依赖任何外部来源');

  const ActivitySource(this.wire, this.label, this.description);

  final String wire;
  final String label;
  final String description;

  /// 未知取值返回 null —— 调用方必须显式决定怎么处理。
  static ActivitySource? fromWire(String wire) {
    final String normalized = wire.trim().toLowerCase();
    for (final ActivitySource source in ActivitySource.values) {
      if (source.wire == normalized) return source;
    }
    return null;
  }
}

/// 活动状态（契约四种）。
enum ActivityStatus {
  candidate('candidate', '待确认'),
  confirmed('confirmed', '已确认'),
  dismissed('dismissed', '已忽略'),
  archived('archived', '已归档');

  const ActivityStatus(this.wire, this.label);

  final String wire;
  final String label;

  static ActivityStatus? fromWire(String wire) {
    final String normalized = wire.trim().toLowerCase();
    for (final ActivityStatus status in ActivityStatus.values) {
      if (status.wire == normalized) return status;
    }
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 2. 提醒
 * ------------------------------------------------------------------ */

enum ActivityReminderKind {
  registration('registration', '报名截止提醒'),
  start('start', '开始提醒'),
  custom('custom', '自定义提醒');

  const ActivityReminderKind(this.wire, this.label);

  final String wire;
  final String label;

  static ActivityReminderKind? fromWire(String wire) {
    final String normalized = wire.trim().toLowerCase();
    for (final ActivityReminderKind kind in ActivityReminderKind.values) {
      if (kind.wire == normalized) return kind;
    }
    return null;
  }
}

enum ActivityReminderChannel {
  inapp('inapp', '站内信'),
  wechatSubscribe('wechat-subscribe', '微信订阅消息（未接通）');

  const ActivityReminderChannel(this.wire, this.label);

  final String wire;
  final String label;

  static ActivityReminderChannel? fromWire(String wire) {
    final String normalized = wire.trim().toLowerCase();
    for (final ActivityReminderChannel channel
        in ActivityReminderChannel.values) {
      if (channel.wire == normalized) return channel;
    }
    return null;
  }
}

/// 提醒状态。
///
/// 契约只固定字段名，没有冻结取值；这里对未知值做**显示层**兜底
/// （[unknown]），而不是让整条提醒解析失败。发送语义不因此改变。
enum ActivityReminderStatus {
  pending('pending', '待发送'),
  sending('sending', '发送中'),
  sent('sent', '已发送'),
  failed('failed', '发送失败'),
  cancelled('cancelled', '已取消'),
  unknown('unknown', '状态未知');

  const ActivityReminderStatus(this.wire, this.label);

  final String wire;
  final String label;

  /// 容忍常见别名（`scheduled` / `dispatched` / `canceled`），未知值收敛为
  /// [unknown] —— 提醒状态是展示信息，不该让整页失败。
  static ActivityReminderStatus fromWire(String wire) {
    switch (wire.trim().toLowerCase()) {
      case 'pending':
      case 'scheduled':
        return ActivityReminderStatus.pending;
      case 'sending':
        return ActivityReminderStatus.sending;
      case 'sent':
      case 'dispatched':
        return ActivityReminderStatus.sent;
      case 'cancelled':
      case 'canceled':
        return ActivityReminderStatus.cancelled;
      case 'failed':
        return ActivityReminderStatus.failed;
      default:
        return ActivityReminderStatus.unknown;
    }
  }
}

/* ------------------------------------------------------------------ *
 * 3. 活动
 * ------------------------------------------------------------------ */

/// 一条活动（共同契约 `ActivityItem`）。
final class ActivityItem {
  const ActivityItem({
    required this.id,
    required this.source,
    required this.kind,
    required this.title,
    required this.status,
    this.startsAt,
    this.endsAt,
    this.location,
    this.organizer,
    this.registrationDeadlineAt,
    this.registrationDeadlineRaw,
    this.registrationUrl,
    this.evidenceText,
    this.confidence,
    this.sourceUrl,
    this.sourceLabel,
    this.publishedAt,
    this.stale = false,
  });

  factory ActivityItem.fromJson(Map<String, Object?> json) {
    final String rawSource = readString(json, 'source');
    final ActivitySource? source = ActivitySource.fromWire(rawSource);
    if (source == null) {
      throw FormatException('ActivityItem: 未知来源 "$rawSource"');
    }
    final String rawStatus = readString(json, 'status');
    final ActivityStatus? status = ActivityStatus.fromWire(rawStatus);
    if (status == null) {
      throw FormatException('ActivityItem: 未知状态 "$rawStatus"');
    }

    return ActivityItem(
      id: readString(json, 'id'),
      source: source,
      kind: readStringOr(json, 'kind', defaultActivityKind),
      title: readString(json, 'title'),
      startsAt: _readActivityInstantOrNull(json, 'startsAt'),
      endsAt: _readActivityInstantOrNull(json, 'endsAt'),
      location: _clean(readStringOrNull(json, 'location')),
      organizer: _clean(readStringOrNull(json, 'organizer')),
      registrationDeadlineAt:
          _readActivityInstantOrNull(json, 'registrationDeadlineAt'),
      registrationDeadlineRaw:
          _clean(readStringOrNull(json, 'registrationDeadlineRaw')),
      registrationUrl: _clean(readStringOrNull(json, 'registrationUrl')),
      evidenceText:
          normalizeActivityEvidence(readStringOrNull(json, 'evidenceText')),
      confidence: readDoubleOrNull(json, 'confidence'),
      status: status,
      sourceUrl: _clean(readStringOrNull(json, 'sourceUrl')),
      sourceLabel: _clean(readStringOrNull(json, 'sourceLabel')),
      publishedAt: _readActivityInstantOrNull(json, 'publishedAt'),
      stale: readBoolOr(json, 'stale', false),
    );
  }

  final String id;
  final ActivitySource source;

  /// 活动类型（讲座 / 工作坊 / 社团活动…），由来源归一或手动填写。
  final String kind;

  final String title;

  /// 开始时刻（UTC instant）。来源只给了日期、没给时刻时为 null。
  final DateTime? startsAt;

  final DateTime? endsAt;
  final String? location;
  final String? organizer;

  /// 报名截止的**可确定时刻**（UTC instant）。
  final DateTime? registrationDeadlineAt;

  /// 原文里的报名截止描述。没有可确定时刻时**只保留它**，不补 23:59。
  final String? registrationDeadlineRaw;

  final String? registrationUrl;

  /// ≤200 字证据摘录（不是正文、不是全文）。
  final String? evidenceText;

  /// 归一置信度（0–1）；手动创建通常为 1。
  final double? confidence;

  final ActivityStatus status;
  final String? sourceUrl;
  final String? sourceLabel;
  final DateTime? publishedAt;

  /// 上次同步失败、这是旧结果 —— UI 必须明示。
  final bool stale;

  String get kindLabel => activityKindLabels[kind] ?? kind;

  bool get isPending => status == ActivityStatus.candidate;

  /// 候选活动**不得**创建提醒；确认后才允许。
  bool get canScheduleReminders => status == ActivityStatus.confirmed;

  bool get registrationDeadlineIsUncertain =>
      registrationDeadlineAt == null && registrationDeadlineRaw != null;

  String get startsAtLabel =>
      startsAt == null ? '时间待确认' : formatShanghaiInstant(startsAt!);

  String get timeRangeLabel {
    final DateTime? start = startsAt;
    if (start == null) return '时间待确认（原文未给出可确定时刻）';
    final DateTime? end = endsAt;
    if (end == null || !end.isAfter(start)) {
      return formatShanghaiInstant(start);
    }
    if (formatShanghaiDate(start) == formatShanghaiDate(end)) {
      return '${formatShanghaiInstant(start)}–${formatShanghaiTime(end)}';
    }
    return '${formatShanghaiInstant(start)} – ${formatShanghaiInstant(end)}';
  }

  String get registrationDeadlineLabel {
    if (registrationDeadlineAt != null) {
      return formatShanghaiInstantWithZone(registrationDeadlineAt!);
    }
    return registrationDeadlineRaw ?? '未注明';
  }

  ActivityItem withStatus(ActivityStatus next) => ActivityItem(
        id: id,
        source: source,
        kind: kind,
        title: title,
        status: next,
        startsAt: startsAt,
        endsAt: endsAt,
        location: location,
        organizer: organizer,
        registrationDeadlineAt: registrationDeadlineAt,
        registrationDeadlineRaw: registrationDeadlineRaw,
        registrationUrl: registrationUrl,
        evidenceText: evidenceText,
        confidence: confidence,
        sourceUrl: sourceUrl,
        sourceLabel: sourceLabel,
        publishedAt: publishedAt,
        stale: stale,
      );

  ActivityItem withStale(bool next) => ActivityItem(
        id: id,
        source: source,
        kind: kind,
        title: title,
        status: status,
        startsAt: startsAt,
        endsAt: endsAt,
        location: location,
        organizer: organizer,
        registrationDeadlineAt: registrationDeadlineAt,
        registrationDeadlineRaw: registrationDeadlineRaw,
        registrationUrl: registrationUrl,
        evidenceText: evidenceText,
        confidence: confidence,
        sourceUrl: sourceUrl,
        sourceLabel: sourceLabel,
        publishedAt: publishedAt,
        stale: next,
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'source': source.wire,
        'kind': kind,
        'title': title,
        'startsAt': startsAt == null ? null : isoUtc(startsAt!),
        'endsAt': endsAt == null ? null : isoUtc(endsAt!),
        'location': location,
        'organizer': organizer,
        'registrationDeadlineAt': registrationDeadlineAt == null
            ? null
            : isoUtc(registrationDeadlineAt!),
        'registrationDeadlineRaw': registrationDeadlineRaw,
        'registrationUrl': registrationUrl,
        'evidenceText': evidenceText,
        'confidence': confidence,
        'status': status.wire,
        'sourceUrl': sourceUrl,
        'sourceLabel': sourceLabel,
        'publishedAt': publishedAt == null ? null : isoUtc(publishedAt!),
        'stale': stale,
      };

  @override
  bool operator ==(Object other) =>
      other is ActivityItem &&
      other.id == id &&
      other.source == source &&
      other.kind == kind &&
      other.title == title &&
      other.startsAt == startsAt &&
      other.endsAt == endsAt &&
      other.location == location &&
      other.organizer == organizer &&
      other.registrationDeadlineAt == registrationDeadlineAt &&
      other.registrationDeadlineRaw == registrationDeadlineRaw &&
      other.registrationUrl == registrationUrl &&
      other.evidenceText == evidenceText &&
      other.confidence == confidence &&
      other.status == status &&
      other.sourceUrl == sourceUrl &&
      other.sourceLabel == sourceLabel &&
      other.publishedAt == publishedAt &&
      other.stale == stale;

  @override
  int get hashCode => Object.hash(
        id,
        source,
        kind,
        title,
        startsAt,
        endsAt,
        location,
        organizer,
        registrationDeadlineAt,
        registrationDeadlineRaw,
        registrationUrl,
        evidenceText,
        confidence,
        status,
        sourceUrl,
        sourceLabel,
        publishedAt,
        stale,
      );

  @override
  String toString() =>
      'ActivityItem($id, ${source.wire}, ${status.wire}, $title)';
}

/// 一条提醒（共同契约 `ActivityReminderItem`，只有五个字段）。
final class ActivityReminderItem {
  const ActivityReminderItem({
    required this.id,
    required this.kind,
    required this.remindAt,
    required this.channel,
    required this.status,
    this.activityId,
    this.activityTitle,
  });

  factory ActivityReminderItem.fromJson(Map<String, Object?> json) {
    final String rawKind = readString(json, 'kind');
    final ActivityReminderKind? kind = ActivityReminderKind.fromWire(rawKind);
    if (kind == null) {
      throw FormatException('ActivityReminderItem: 未知提醒类型 "$rawKind"');
    }
    final String rawChannel = readString(json, 'channel');
    final ActivityReminderChannel? channel =
        ActivityReminderChannel.fromWire(rawChannel);
    if (channel == null) {
      throw FormatException('ActivityReminderItem: 未知提醒渠道 "$rawChannel"');
    }
    return ActivityReminderItem(
      id: readString(json, 'id'),
      kind: kind,
      remindAt: _readActivityInstant(json, 'remindAt'),
      channel: channel,
      status: ActivityReminderStatus.fromWire(readString(json, 'status')),
      activityId: _clean(readStringOrNull(json, 'activityId')),
      activityTitle: _clean(readStringOrNull(json, 'activityTitle')),
    );
  }

  final String id;
  final ActivityReminderKind kind;
  final DateTime remindAt;
  final ActivityReminderChannel channel;
  final ActivityReminderStatus status;

  /// 所属活动（OpenAPI 仅列表端点返回；详情可省略）。
  final String? activityId;

  /// 所属活动标题（OpenAPI 仅列表端点返回）。
  final String? activityTitle;

  String get remindAtLabel => formatShanghaiInstantWithZone(remindAt);

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'kind': kind.wire,
        'remindAt': isoUtc(remindAt),
        'channel': channel.wire,
        'status': status.wire,
        if (activityId != null) 'activityId': activityId,
        if (activityTitle != null) 'activityTitle': activityTitle,
      };

  @override
  bool operator ==(Object other) =>
      other is ActivityReminderItem &&
      other.id == id &&
      other.kind == kind &&
      other.remindAt == remindAt &&
      other.channel == channel &&
      other.status == status &&
      other.activityId == activityId &&
      other.activityTitle == activityTitle;

  @override
  int get hashCode => Object.hash(
        id,
        kind,
        remindAt,
        channel,
        status,
        activityId,
        activityTitle,
      );

  @override
  String toString() =>
      'ActivityReminderItem($id, ${kind.wire}, ${channel.wire}, '
      '${status.wire})';
}

/* ------------------------------------------------------------------ *
 * 4. 手动创建草稿
 * ------------------------------------------------------------------ */

enum ActivityDraftProblem {
  titleTooShort('title-too-short'),
  titleTooLong('title-too-long'),
  invalidKind('invalid-kind'),
  endBeforeStart('end-before-start'),
  shortTextTooLong('short-text-too-long'),
  invalidUrl('invalid-url'),
  deadlineRawTooLong('deadline-raw-too-long'),
  evidenceTooLong('evidence-too-long');

  const ActivityDraftProblem(this.wire);

  final String wire;
}

/// 手动创建活动的草稿。
///
/// 只含活动字段：**没有**正文、附件、HTML 这些入口。
final class ActivityDraft {
  const ActivityDraft({
    required this.title,
    required this.startsAt,
    this.kind = defaultActivityKind,
    this.endsAt,
    this.location,
    this.organizer,
    this.registrationDeadlineAt,
    this.registrationDeadlineRaw,
    this.registrationUrl,
    this.evidenceText,
    this.sourceUrl,
    this.sourceLabel,
  });

  final String title;
  final DateTime? startsAt;
  final String kind;
  final DateTime? endsAt;
  final String? location;
  final String? organizer;
  final DateTime? registrationDeadlineAt;
  final String? registrationDeadlineRaw;
  final String? registrationUrl;
  final String? evidenceText;
  final String? sourceUrl;
  final String? sourceLabel;

  Map<String, Object?> toJson() => <String, Object?>{
        // OpenAPI `ActivityCreate` 明确禁止客户端指定 source / status / confidence；
        // source 由服务端固定为 manual，status 固定为 candidate。
        'kind': _clean(kind) ?? defaultActivityKind,
        'title': title.trim(),
        if (startsAt != null) 'startsAt': isoUtc(startsAt!),
        if (endsAt != null) 'endsAt': isoUtc(endsAt!),
        if (_clean(location) != null) 'location': _clean(location),
        if (_clean(organizer) != null) 'organizer': _clean(organizer),
        if (registrationDeadlineAt != null)
          'registrationDeadlineAt': isoUtc(registrationDeadlineAt!),
        if (_clean(registrationDeadlineRaw) != null)
          'registrationDeadlineRaw': _clean(registrationDeadlineRaw),
        if (_clean(registrationUrl) != null)
          'registrationUrl': _clean(registrationUrl),
        if (normalizeActivityEvidence(evidenceText) != null)
          'evidenceText': normalizeActivityEvidence(evidenceText),
        if (_clean(sourceUrl) != null) 'sourceUrl': _clean(sourceUrl),
        if (_clean(sourceLabel) != null) 'sourceLabel': _clean(sourceLabel),
      };

  @override
  String toString() => 'ActivityDraft(${title.trim()}, kind=$kind)';
}

List<ActivityDraftProblem> validateActivityDraft(ActivityDraft draft) {
  final List<ActivityDraftProblem> problems = <ActivityDraftProblem>[];
  final String title = draft.title.trim();
  if (title.length < activityTitleMinChars) {
    problems.add(ActivityDraftProblem.titleTooShort);
  } else if (title.length > activityTitleMaxChars) {
    problems.add(ActivityDraftProblem.titleTooLong);
  }

  final String kind = _clean(draft.kind) ?? defaultActivityKind;
  if (!activityKinds.contains(kind)) {
    problems.add(ActivityDraftProblem.invalidKind);
  }

  if (draft.endsAt != null) {
    if (draft.startsAt == null || !draft.endsAt!.isAfter(draft.startsAt!)) {
      problems.add(ActivityDraftProblem.endBeforeStart);
    }
  }

  for (final String? text in <String?>[
    draft.location,
    draft.organizer,
    draft.sourceLabel,
  ]) {
    final String? value = _clean(text);
    if (value != null && value.length > activityShortTextMaxChars) {
      problems.add(ActivityDraftProblem.shortTextTooLong);
      break;
    }
  }

  for (final String? url in <String?>[
    draft.registrationUrl,
    draft.sourceUrl,
  ]) {
    final String? value = _clean(url);
    if (value != null && !isHttpUrl(value)) {
      problems.add(ActivityDraftProblem.invalidUrl);
      break;
    }
  }

  final String? rawDeadline = _clean(draft.registrationDeadlineRaw);
  if (rawDeadline != null && rawDeadline.length > activityDeadlineRawMaxChars) {
    problems.add(ActivityDraftProblem.deadlineRawTooLong);
  }

  final String? evidence = normalizeActivityEvidence(draft.evidenceText);
  if (draft.evidenceText != null &&
      draft.evidenceText!.trim().runes.length > activityEvidenceMaxChars) {
    problems.add(ActivityDraftProblem.evidenceTooLong);
  } else if (evidence != null &&
      evidence.runes.length > activityEvidenceMaxChars) {
    problems.add(ActivityDraftProblem.evidenceTooLong);
  }

  return problems;
}

String describeActivityDraftProblem(ActivityDraftProblem problem) =>
    switch (problem) {
      ActivityDraftProblem.titleTooShort => '请填写活动名称',
      ActivityDraftProblem.titleTooLong => '活动名称最多 $activityTitleMaxChars 个字',
      ActivityDraftProblem.invalidKind => '活动类型不在允许范围内',
      ActivityDraftProblem.endBeforeStart => '结束时间必须晚于开始时间',
      ActivityDraftProblem.shortTextTooLong =>
        '地点 / 主办方 / 来源名称最多 $activityShortTextMaxChars 个字',
      ActivityDraftProblem.invalidUrl => '链接必须是 http(s) 地址',
      ActivityDraftProblem.deadlineRawTooLong =>
        '报名截止原文最多 $activityDeadlineRawMaxChars 个字',
      ActivityDraftProblem.evidenceTooLong =>
        '证据摘录最多 $activityEvidenceMaxChars 字，请不要粘贴正文或全文',
    };

/* ------------------------------------------------------------------ *
 * 5. 公众号单篇导入
 * ------------------------------------------------------------------ */

enum WechatImportProblem {
  empty('empty'),
  invalidUrl('invalid-url'),
  bothProvided('both-provided');

  const WechatImportProblem(this.wire);

  final String wire;
}

/// 用户主动提交的**单篇**公众号文章（链接与正文至少一个）。
final class WechatImportDraft {
  const WechatImportDraft({this.url, this.text});

  final String? url;
  final String? text;

  String? get normalizedUrl => _clean(url);

  /// 请求里可携带用户粘贴的正文（服务端用于抽取，**不落库**）。
  String? get normalizedText => _clean(text);

  /// 真正允许落库的证据片段：≤200 字。
  String? get evidenceText => normalizeActivityEvidence(text);

  bool get isEmpty => normalizedUrl == null && normalizedText == null;

  Map<String, Object?> toJson() => <String, Object?>{
        if (normalizedUrl != null) 'url': normalizedUrl,
        if (normalizedText != null) 'text': normalizedText,
      };

  @override
  String toString() => 'WechatImportDraft(url=$normalizedUrl, '
      'text=${normalizedText == null ? 'null' : '${normalizedText!.length} 字'})';
}

List<WechatImportProblem> validateWechatImportDraft(
  WechatImportDraft draft,
) {
  final List<WechatImportProblem> problems = <WechatImportProblem>[];
  if (draft.isEmpty) problems.add(WechatImportProblem.empty);
  if (draft.normalizedUrl != null && draft.normalizedText != null) {
    problems.add(WechatImportProblem.bothProvided);
  }
  final String? url = draft.normalizedUrl;
  if (url != null && !isHttpUrl(url)) {
    problems.add(WechatImportProblem.invalidUrl);
  }
  return problems;
}

String describeWechatImportProblem(WechatImportProblem problem) =>
    switch (problem) {
      WechatImportProblem.empty => '请粘贴公众号文章链接或正文（至少一项）',
      WechatImportProblem.invalidUrl => '文章链接必须是 http(s) 地址',
      WechatImportProblem.bothProvided => '链接与正文只能填一个（单篇导入）',
    };

/* ------------------------------------------------------------------ *
 * 6. 列表筛选
 * ------------------------------------------------------------------ */

/// 来源 / 状态筛选；`null` 表示“全部”。
final class ActivityFilter {
  const ActivityFilter({this.source, this.status});

  final ActivitySource? source;
  final ActivityStatus? status;

  bool get isEmpty => source == null && status == null;

  ActivityFilter withSource(ActivitySource? next) =>
      ActivityFilter(source: next, status: status);

  ActivityFilter withStatus(ActivityStatus? next) =>
      ActivityFilter(source: source, status: next);

  @override
  bool operator ==(Object other) =>
      other is ActivityFilter &&
      other.source == source &&
      other.status == status;

  @override
  int get hashCode => Object.hash(source, status);
}

/// 纯函数筛选（保持输入顺序；组合条件是 AND）。
List<ActivityItem> filterActivities(
  List<ActivityItem> items,
  ActivityFilter filter,
) =>
    items
        .where((ActivityItem item) =>
            (filter.source == null || item.source == filter.source) &&
            (filter.status == null || item.status == filter.status))
        .toList(growable: false);
