import '../models/campus_binding.dart';
import '../models/result.dart';

/// 第二级 · 能力层端口（冻结契约 §5）。
///
/// 这是**唯一**可以触碰校园系统 cookie / session / tgc 的出口。它的产物绝不上抛
/// 为身份，也绝不进入 `AuthPort`。契约 §5 硬规则 2：任何校园系统能力必须通过
/// 本端口获取，不得从 `AuthPort` 读取。
///
/// 凭据的持久化只发生在实现内部（`data/storage/`），[CampusBinding] 只暴露元数据。
abstract interface class CampusSessionPort {
  /// 已绑定的校园系统（只含元数据，不含凭据）。
  List<CampusBinding> get bindings;

  /// 绑定变化流。
  Stream<List<CampusBinding>> get changes;

  /// 契约 §8 第 1 步：只读本地缓存，**禁止网络**。
  List<CampusBinding> hydrateFromCache();

  /// 绑定一个校园系统。
  ///
  /// [credential] 只在本方法入参中出现一次，实现**不得**把它写进日志或错误信息。
  /// 绑定成功返回元数据；凭据留在实现内部。
  Future<Result<CampusBinding>> bind(CampusSystem system, {required String credential});

  /// 解绑；未绑定视为成功。成功值为 [Unit.instance]。
  Future<Result<Unit>> unbind(CampusSystem system);

  /// **仅限**平台 WebView 注入 / 校园系统适配器调用。
  ///
  /// 返回可直接放进 `Cookie` 请求头的字符串；未绑定或已过期返回 null。
  /// 这是全项目唯一读取校园系统 cookie 的入口。
  Future<String?> cookieHeaderFor(CampusSystem system);

  /// 契约 §8 第 3 步：后台续期。**不得抛异常**，失败静默降级。
  Future<void> renewInBackground();
}
