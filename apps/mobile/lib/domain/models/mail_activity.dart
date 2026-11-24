import 'json_read.dart';

/// 校园邮箱归一出的活动事件（服务端 `/mail/events`）。
///
/// 服务端已经做完三件事：只读 IMAP、AES-256-GCM 加密落库、只落归一后的活动。
/// 客户端只负责展示与「提升为候选活动」，**不碰密码、不解密、不存正文**。
final class MailEventItem {
  const MailEventItem({
    required this.id,
    required this.title,
    required this.startsAt,
    required this.matchedText,
    required this.stale,
    this.location,
    this.organizer,
    this.confidence = 0,
    this.receivedAt,
  });

  factory MailEventItem.fromJson(Map<String, Object?> json) => MailEventItem(
        id: readString(json, 'id'),
        title: readString(json, 'title'),
        startsAt: readDateTime(json, 'startsAt'),
        location: readStringOrNull(json, 'location'),
        organizer: readStringOrNull(json, 'organizer'),
        confidence: (json['confidence'] is num)
            ? (json['confidence']! as num).toDouble()
            : 0,
        matchedText: readStringOr(json, 'matchedText', ''),
        receivedAt: readDateTimeOrNull(json, 'receivedAt'),
        stale: json['stale'] == true,
      );

  final String id;
  final String title;

  /// 归一出的开始时间；服务端保证有值（没有明确时间的邮件不会进来）。
  final DateTime startsAt;

  final String? location;
  final String? organizer;

  /// 归一置信度（0–1），用于告诉用户「这条有多可靠」。
  final double confidence;

  /// ≤200 字证据片段，**不是邮件正文**。
  final String matchedText;

  final DateTime? receivedAt;

  /// 上次同步失败、这是上次结果。
  final bool stale;

  @override
  String toString() => 'MailEventItem($id, $title)';
}

/// `GET /mail/events` 的响应。
final class MailEventsSnapshot {
  const MailEventsSnapshot({required this.items, required this.stale});

  factory MailEventsSnapshot.fromJson(Map<String, Object?> json) =>
      MailEventsSnapshot(
        items: readListOrEmpty(json, 'items')
            .map((Object? item) => MailEventItem.fromJson(
                  requireJsonMap(item, what: 'items[] 元素'),
                ))
            .toList(growable: false),
        stale: json['stale'] == true,
      );

  final List<MailEventItem> items;

  /// 整批数据来自上次成功的同步（本次同步失败）。UI 必须如实提示。
  final bool stale;

  bool get isEmpty => items.isEmpty;
}

/// `POST /mail/account` 的入参（只在提交瞬间存在于内存）。
final class MailLinkRequest {
  const MailLinkRequest({
    required this.email,
    required this.imapHost,
    required this.password,
    this.imapPort = campusImapPort,
  });

  static const String campusImapHost = 'imap.shanghaitech.edu.cn';
  static const int campusImapPort = 993;

  /// 学校邮箱只认这两个域；别的域直接拒，避免把密码发到不该去的地方。
  static const List<String> campusDomains = <String>[
    'shanghaitech.edu.cn',
    'stu.shanghaitech.edu.cn',
  ];

  final String email;
  final String imapHost;
  final int imapPort;
  final String password;

  Map<String, Object?> toJson() => <String, Object?>{
        'email': email.trim(),
        'imapHost': imapHost.trim(),
        'imapPort': imapPort,
        'password': password,
      };

  /// 刻意不打印密码。
  @override
  String toString() => 'MailLinkRequest(${email.trim()}, host=$imapHost)';
}

/// 邮箱地址的学校域校验。
///
/// 返回 null 表示通过；否则是给人看的一句话。
String? validateCampusMailAddress(String raw) {
  final String email = raw.trim().toLowerCase();
  if (email.isEmpty) return '请填写学校邮箱地址';
  final int at = email.lastIndexOf('@');
  if (at <= 0 || at == email.length - 1) return '邮箱地址格式不正确';
  final String domain = email.substring(at + 1);
  if (!MailLinkRequest.campusDomains.contains(domain)) {
    return '只支持 @shanghaitech.edu.cn 或 @stu.shanghaitech.edu.cn 的邮箱';
  }
  return null;
}
