import '../models/mail_activity.dart';
import '../models/result.dart';

/// 校园邮箱端口（`/mail`）。
///
/// 边界：
/// - 只传邮箱地址 + 一次性的 IMAP 密码；**没有**「读某封邮件正文」的方法，
///   类型上就写不出来；
/// - 绑定失败（含 IMAP 连不上）时服务端不落库，客户端也不缓存任何凭证；
/// - 同步失败时服务端保留上次结果并标 `stale`，UI 必须如实提示「上次同步失败」。
abstract interface class MailPort {
  /// `POST /mail/account` —— 先真连一次 IMAP 验证，坏凭证不落库。
  Future<Result<Unit>> link(MailLinkRequest request);

  /// `DELETE /mail/account` —— 硬删凭证与由该邮箱归一出的活动（幂等）。
  Future<Result<Unit>> unlink();

  /// `POST /mail/sync` —— 只读收信，不发信。
  Future<Result<MailEventsSnapshot>> sync();

  /// `GET /mail/events` —— 归一后的活动列表。
  Future<Result<MailEventsSnapshot>> events();
}
