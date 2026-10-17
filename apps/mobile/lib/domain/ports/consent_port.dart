import '../models/api_error.dart';

/// 二次同意端口（冻结契约 §9）。
///
/// 需要同意门的模块 = `packages/contracts` 里 `requiresConsent: true` 的模块，
/// 即 `wellbeing` / `dorm-harmony` / `ai-portrait`。
///
/// **注意**：`auth` / `campus-card` 虽然也是 high 敏感（需审计 + 最小采集），
/// 但**不设同意门** —— 登录/开卡这个行为本身就是同意。判定规则镜像
/// `packages/contracts/src/modules.test.ts`，见 `domain/models/kedaya_module.dart`。
abstract interface class ConsentPort {
  /// 已同意的模块 id 集合。
  Set<String> get grantedModuleIds;

  /// 同意变化流。
  Stream<Set<String>> get changes;

  /// 契约 §8 第 1 步：只读本地缓存，**禁止网络**。
  Set<String> hydrateFromCache();

  bool hasConsent(String moduleId);

  Future<void> grant(String moduleId);

  Future<void> revoke(String moduleId);

  /// 契约 §8 第 3 步：后台与服务端同意记录对账。**不得抛异常**。
  Future<void> refreshInBackground();

  /// 未同意时的标准错误，供上层统一渲染为同意门（`CONSENT_REQUIRED`）。
  ApiError consentRequiredError(String moduleId);
}
