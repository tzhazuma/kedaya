import '../models/bind_credential.dart';
import '../models/campus_capability.dart';
import '../models/campus_web_entry.dart';
import '../models/result.dart';
import '../models/techpie_link.dart';

/// 第二级 · 能力层的 **techpie 模块端口**（契约 §5 / §11.4 能力集；规格 §8.1）。
///
/// 三条硬边界，全部有机械测试兜底：
///
/// 1. **没有身份**。本端口不出现、不返回第一级身份的任何东西
///    （JWT / accessToken / 学号 / 姓名）—— 那些属于 `AuthPort`
///    （`domain/ports/auth_port.dart`）。两者是**两个类型**，除装配层
///    （`lib/app/`）外，任何文件都不得同时 import 两者
///    （`test/domain/techpie_two_tier_boundary_test.dart`）。
/// 2. **没有校园会话串出口**。本端口**没有** `cookieHeaderFor` 之类的方法：
///    校园系统会话串的唯一出口是既有的 `CampusSessionPort.cookieHeaderFor`，
///    且只服务 WebView 注入（契约 §11.4 I3）。
/// 3. **票据只是一次性引用**。`createWebViewSession` 返回的票据**不含**任何
///    校园会话；它用后即焚，且不进入任何上抛对象（规格 §8.4 / §10.3）。
///
/// 命名与分组按 Dart 惯例本地化（契约 §11.4 的"明确允许的形状适配"第 4 条）。
abstract interface class TechpiePort {
  /// `GET /techpie/links` —— 我的全部绑定（**不含凭证**，规格 §8.3）。
  Future<Result<List<TechpieLink>>> listLinks();

  /// `POST /techpie/links` —— 发起绑定。
  ///
  /// [credential] 只在本方法入参里出现一次；实现**不得**把它写进日志、
  /// 错误信息或本地存储。Phase 0 只接受免口令的两种形态（见 [BindCredential]）。
  Future<Result<TechpieLink>> bind(
    CampusPlatform platform, {
    required BindCredential credential,
  });

  /// `DELETE /techpie/links/:id` —— 解绑。未绑定视为成功（幂等）。
  Future<Result<Unit>> unbind(String linkId);

  /// `POST /techpie/links/:id/renew` —— **手动**续期（契约 §11.2 的 `techpie.renew`）。
  ///
  /// ⚠️ 只做手动：**自动续期属于 Phase 3**（依赖 U8），本端口**不提供**
  /// 后台定时续期，也不提供 `renewInBackground`。
  Future<Result<TechpieLink>> renew(String linkId);

  /// `GET /techpie/capabilities` —— 能力清单（含未绑定项的 `CAMPUS_BINDING_REQUIRED`）。
  ///
  /// 上游可用性以服务端为权威；本端只用它**覆盖**状态，不改变阶段判定。
  Future<Result<List<CampusCapability>>> listCapabilities();

  /// `POST /techpie/webview-session` —— 换取**一次性** WebView 票据（规格 §8.4）。
  ///
  /// [targetUrl] 由服务端按域名白名单再次校验（客户端校验只是提前拦截）。
  ///
  /// [platform] **可空**：传了才要求该平台已 `LINKED`（否则 409
  /// `CAMPUS_BINDING_REQUIRED`，**不是** `UNAUTHENTICATED`）；不传则服务端
  /// **不要求绑定** —— 这正是 Phase 0 的 W4 直连（用户自登录，我们不接触会话）。
  /// 这与 `services/api` 的 `resolvePlatform()` 行为一致。
  Future<Result<WebViewTicket>> createWebViewSession({
    CampusPlatform? platform,
    required String targetUrl,
  });

  /// `POST /techpie/webview-session/:ticket` —— 用票据换取**一次性**打开地址。
  ///
  /// ⚠️ 规格 §8.4 写的是 `GET`，而 `services/api` 实现为 `POST`。本端**跟随实现**
  /// （跨端能跑通优先），并已把该偏离登记进交付说明。
  ///
  /// 票据**只能成功使用一次**：重复换取必须失败（防重放）。
  Future<Result<WebViewHandoff>> redeemWebViewTicket(WebViewTicket ticket);
}
