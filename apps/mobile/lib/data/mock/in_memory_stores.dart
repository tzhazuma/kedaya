import '../../domain/ports/credential_store_port.dart';
import '../../domain/ports/local_cache_port.dart';

/// 内存版安全存储（mock 运行时 + 单元测试用）。
///
/// 语义与 `SecureCredentialStore` 一致：只按 key 读写字符串，`clear()` 只清自己
/// 命名空间内的键。额外提供 `snapshotForTesting()` 以便断言"凭据确实被写入"。
final class InMemoryCredentialStore implements CredentialStorePort {
  final Map<String, String> _values = <String, String>{};

  /// 读次数，用于断言热路径没有反复打 Keychain。
  int readsForTesting = 0;

  Map<String, String> snapshotForTesting() =>
      Map<String, String>.unmodifiable(_values);

  @override
  Future<String?> read(String key) async {
    readsForTesting++;
    return _values[key];
  }

  @override
  Future<void> write(String key, String value) async {
    _values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    _values.remove(key);
  }

  @override
  Future<void> clear() async {
    _values.clear();
  }
}

/// 内存版本地缓存（mock 运行时 + 单元测试用）。
///
/// [readJson] 是同步的 —— 与 `PreferencesCacheStore` 的契约一致，
/// 这样契约 §8 第 1 步的 hydrate 在任何实现下都不需要 await 网络。
final class InMemoryCacheStore implements LocalCachePort {
  final Map<String, Object?> _values = <String, Object?>{};

  Map<String, Object?> snapshotForTesting() =>
      Map<String, Object?>.unmodifiable(_values);

  @override
  Object? readJson(String key) => _values[key];

  @override
  Future<void> writeJson(String key, Object? value) async {
    if (value == null) {
      _values.remove(key);
      return;
    }
    _values[key] = value;
  }

  @override
  Future<void> remove(String key) async {
    _values.remove(key);
  }

  @override
  Future<void> clear() async {
    _values.clear();
  }
}
