/// 本地缓存端口（SharedPreferences 一类）。
///
/// 契约 §8 第 1 步要求"同步 hydrate 缓存"：因此 [readJson] **必须是同步的**
/// （实现用 `SharedPreferences` 的内存快照），且**禁止**在其中触发网络。
abstract interface class LocalCachePort {
  /// 同步读取已解码的 JSON；不存在或损坏返回 null。
  Object? readJson(String key);

  Future<void> writeJson(String key, Object? value);

  Future<void> remove(String key);

  /// 清空本应用命名空间下的缓存。
  Future<void> clear();
}
