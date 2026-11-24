import 'json_read.dart';

/// 预约话题的字数上限（与页面输入框、模型校验共用同一常量）。
const int wellbeingBookingTopicMaxLength = 200;

/// 希望的时间段。
///
/// 只提供粗粒度窗口：心理支持预约不需要精确到分钟，也不在本机做排班。
enum WellbeingTimeWindow {
  today('today', '今天'),
  tomorrow('tomorrow', '明天'),
  thisWeek('this_week', '本周内');

  const WellbeingTimeWindow(this.wire, this.label);

  final String wire;
  final String label;

  static WellbeingTimeWindow fromWire(String wire) {
    for (final WellbeingTimeWindow value in WellbeingTimeWindow.values) {
      if (value.wire == wire) return value;
    }
    throw FormatException('未知的预约时间段: $wire');
  }
}

/// 希望的方式。
enum WellbeingTalkMode {
  inPerson('in_person', '面谈'),
  phone('phone', '电话'),
  online('online', '线上');

  const WellbeingTalkMode(this.wire, this.label);

  final String wire;
  final String label;

  static WellbeingTalkMode fromWire(String wire) {
    for (final WellbeingTalkMode value in WellbeingTalkMode.values) {
      if (value.wire == wire) return value;
    }
    throw FormatException('未知的预约方式: $wire');
  }
}

/// 本机预约状态。
///
/// **刻意只有一个状态**：本机演示不会假装「已确认 / 已完成」。
/// 真实排班确认只能由学校心理中心完成，客户端不编造。
enum WellbeingBookingStatus {
  submittedDemo('submitted_demo', '已提交（演示）');

  const WellbeingBookingStatus(this.wire, this.label);

  final String wire;
  final String label;

  static WellbeingBookingStatus fromWire(String wire) {
    for (final WellbeingBookingStatus value in WellbeingBookingStatus.values) {
      if (value.wire == wire) return value;
    }
    throw FormatException('未知的预约状态: $wire');
  }
}

/// 预约表单里可能出错的字段（用于把错误显示在对应控件旁边）。
enum WellbeingBookingField { timeWindow, mode, topic }

/// 一条**只存在本机**的预约记录。
///
/// 红线：不包含诊断、量表、风险等级、咨询师私人联系方式等字段；
/// 联系方式只记录「是否愿意」，本机不保存手机号/微信号/QQ 号。
final class WellbeingBooking {
  const WellbeingBooking({
    required this.id,
    required this.createdAt,
    required this.timeWindow,
    required this.mode,
    this.topic,
    this.contactAllowed = false,
    this.status = WellbeingBookingStatus.submittedDemo,
  });

  factory WellbeingBooking.fromJson(Map<String, Object?> json) {
    final String? rawTopic = readStringOrNull(json, 'topic');
    final String? topic =
        (rawTopic == null || rawTopic.trim().isEmpty) ? null : rawTopic.trim();
    if (topic != null && topic.length > wellbeingBookingTopicMaxLength) {
      throw FormatException(
        '预约话题超过 $wellbeingBookingTopicMaxLength 字的上限',
      );
    }
    return WellbeingBooking(
      id: readString(json, 'id'),
      createdAt: readDateTime(json, 'createdAt'),
      timeWindow: WellbeingTimeWindow.fromWire(readString(json, 'timeWindow')),
      mode: WellbeingTalkMode.fromWire(readString(json, 'mode')),
      topic: topic,
      contactAllowed: readBoolOr(json, 'contactAllowed', false),
      status: WellbeingBookingStatus.fromWire(
        readStringOr(json, 'status', WellbeingBookingStatus.submittedDemo.wire),
      ),
    );
  }

  final String id;
  final DateTime createdAt;
  final WellbeingTimeWindow timeWindow;
  final WellbeingTalkMode mode;

  /// 想聊的话题；可选。仅本人可见，不进入任何画像。
  final String? topic;

  /// 是否愿意让学校心理中心通过校园账号联系。
  ///
  /// 注意：这里**只有布尔值**，本机不保存任何电话号码或社交账号。
  final bool contactAllowed;

  final WellbeingBookingStatus status;

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'createdAt': isoUtc(createdAt),
        'timeWindow': timeWindow.wire,
        'mode': mode.wire,
        'topic': topic,
        'contactAllowed': contactAllowed,
        'status': status.wire,
      };

  @override
  bool operator ==(Object other) => other is WellbeingBooking && other.id == id;

  @override
  int get hashCode => id.hashCode;

  @override
  String toString() =>
      'WellbeingBooking($id, ${timeWindow.wire}, ${mode.wire})';
}

/// 预约表单草稿。校验规则只写在这里，页面不复制一份。
final class WellbeingBookingDraft {
  const WellbeingBookingDraft({
    this.timeWindow,
    this.mode,
    this.topic = '',
    this.contactAllowed = false,
  });

  final WellbeingTimeWindow? timeWindow;
  final WellbeingTalkMode? mode;
  final String topic;
  final bool contactAllowed;

  /// 字段 -> 用户可读的错误文案；空 Map 表示可以提交。
  Map<WellbeingBookingField, String> validate() {
    final Map<WellbeingBookingField, String> problems =
        <WellbeingBookingField, String>{};
    if (timeWindow == null) {
      problems[WellbeingBookingField.timeWindow] = '请选择希望的时间段';
    }
    if (mode == null) {
      problems[WellbeingBookingField.mode] = '请选择希望的方式';
    }
    if (topic.trim().length > wellbeingBookingTopicMaxLength) {
      problems[WellbeingBookingField.topic] =
          '想聊的话题最多 $wellbeingBookingTopicMaxLength 字';
    }
    return problems;
  }

  bool get isValid => validate().isEmpty;

  /// 生成一条本机预约。非法草稿直接抛错，避免调用方绕过校验。
  WellbeingBooking toBooking({
    required String id,
    required DateTime createdAt,
  }) {
    final Map<WellbeingBookingField, String> problems = validate();
    if (problems.isNotEmpty) {
      throw ArgumentError(problems.values.join('；'));
    }
    final String normalizedTopic = topic.trim();
    return WellbeingBooking(
      id: id,
      createdAt: createdAt,
      timeWindow: timeWindow!,
      mode: mode!,
      topic: normalizedTopic.isEmpty ? null : normalizedTopic,
      contactAllowed: contactAllowed,
    );
  }
}

/// `2026-11-24 09:30`（本地时区，展示用）。
String formatWellbeingTimestamp(DateTime value) {
  final DateTime local = value.isUtc ? value.toLocal() : value;
  final String year = local.year.toString().padLeft(4, '0');
  final String month = local.month.toString().padLeft(2, '0');
  final String day = local.day.toString().padLeft(2, '0');
  final String hour = local.hour.toString().padLeft(2, '0');
  final String minute = local.minute.toString().padLeft(2, '0');
  return '$year-$month-$day $hour:$minute';
}
