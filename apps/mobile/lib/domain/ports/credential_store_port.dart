/// 安全凭据存储端口（Keychain / Android Keystore / 鸿蒙 HUKS）。
///
/// 只存**小体积的敏感字符串**（JWT、校园系统凭据）。普通缓存走
/// `LocalCachePort`（SharedPreferences），两者不要混用。
abstract interface class CredentialStorePort {
  Future<String?> read(String key);

  Future<void> write(String key, String value);

  Future<void> delete(String key);

  /// 清空本应用命名空间下的全部凭据（登出/退出登录用）。
  Future<void> clear();
}
