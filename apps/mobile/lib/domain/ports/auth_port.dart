import '../models/auth_session.dart';

/// 第一级 · 身份层端口（冻结契约 §5）。
///
/// 只认 KedaYa 自有 JWT 会话。**硬规则**：本接口不得出现、也不得返回任何
/// 校园系统 cookie / session / tgc；校园系统能力必须走
/// `CampusSessionPort`（见 `campus_session_port.dart`）。
///
/// 可以"已登录但未绑定"：此时身份有效，校园系统功能返回
/// `CAMPUS_BINDING_REQUIRED`（契约 §5 硬规则 3）。
abstract interface class AuthPort {
  /// 当前会话；未登录为 null。
  ///
  /// 契约 §8 第 1 步之后这里必须已有值（同步 hydrate 的结果），
  /// 首屏据此渲染而**不等待网络**。
  AuthSession? get current;

  /// 会话变化流（登录 / 刷新 / 登出）。
  Stream<AuthSession?> get changes;

  /// 契约 §8 第 1 步：只读本地缓存，**禁止网络**。
  ///
  /// 返回 null 表示本地无会话（首屏按未登录渲染）。
  AuthSession? hydrateFromCache();

  /// 走学校统一身份认证（CAS / Egate OAuth）换取 KedaYa JWT。
  ///
  /// 只产出第一级身份；**不**返回任何校园系统凭据。
  /// 用户在授权页取消时抛 [StateError]。
  Future<AuthSession> signInWithUnifiedIdentity();

  /// 用**已拿到的一次性授权码**换取会话（CAS 回调 → `/auth/cas/exchange`）。
  ///
  /// 与 [signInWithUnifiedIdentity] 的区别：这里不负责打开浏览器，
  /// 授权码由调用方（登录页 / 深链）提供。这样就绕开了"客户端拿不到
  /// CAS 重定向"的平台差异，桌面端也能用。
  Future<AuthSession> signInWithCasCode(String code);

  /// 用 refreshToken 轮换 accessToken。
  ///
  /// 失败抛 [StateError]；调用方决定是否降级为登出。
  Future<AuthSession> refresh();

  /// 清空 KedaYa 会话。**不**负责解绑校园系统（那是 [CampusSessionPort]）。
  Future<void> signOut();

  /// 契约 §8 第 3 步：后台续期。**不得抛异常**，失败静默降级。
  ///
  /// 返回是否续期成功（false 表示保持原状，UI 无感）。
  Future<bool> refreshInBackground();
}
