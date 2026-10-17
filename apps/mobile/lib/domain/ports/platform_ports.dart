/// 平台差异适配端口（冻结契约 §7：`platform/` 承载 scanner / notification / share）。
library;

/// 系统分享 / 剪贴板。
abstract interface class SharePort {
  Future<void> shareText(String text, {String? subject});

  Future<void> shareLink(Uri uri, {String? title});

  Future<void> copyToClipboard(String text);
}

/// 一条本地通知。
final class AppNotification {
  const AppNotification({
    required this.title,
    required this.receivedAt,
    this.body,
    this.payload,
  });

  final String title;
  final String? body;

  /// 深链 payload，例如 `kedaya://groupbuy/42`。
  final String? payload;

  final DateTime receivedAt;

  @override
  String toString() => 'AppNotification($title, payload=$payload)';
}

/// 推送 / 本地通知。
abstract interface class NotificationPort {
  /// 立即展示一条通知（前台）。
  Future<void> show(String title, {String? body, String? payload});

  /// 收到通知的流（前台点击 / 静默推送）。
  Stream<AppNotification> get received;
}

/// 统一身份认证的平台入口（CAS / Egate OAuth 授权码）。
///
/// 实现由 `platform/` 提供：原生宿主（iOS / Android / 鸿蒙）拉起认证页并回传 code。
/// 这是**第一级身份**的唯一入口，绝不返回校园系统凭据。
abstract interface class UnifiedIdentityPort {
  /// 返回授权码；用户取消返回 null。
  Future<String?> requestAuthorizationCode();
}
