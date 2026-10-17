import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../domain/ports/credential_store_port.dart';

/// [CredentialStorePort] 的 Keychain / Android Keystore 实现。
///
/// **鸿蒙**：上游 `flutter_secure_storage` 不带 OHOS 实现，需按 TechPie 的做法
/// 换成 `flutter_secure_storage_ohos`（见 `apps/mobile/README.md` 的"鸿蒙"章节），
/// 本文件无需改动 —— 差异只在 pubspec 的依赖替换。
final class SecureCredentialStore implements CredentialStorePort {
  SecureCredentialStore({FlutterSecureStorage? storage})
    : _storage =
          storage ??
          const FlutterSecureStorage(
            aOptions: AndroidOptions(encryptedSharedPreferences: true),
            iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
          );

  final FlutterSecureStorage _storage;

  /// 命名空间，保证 [clear] 只清自己的键。
  static const String namespace = 'kedaya.';

  @override
  Future<String?> read(String key) => _storage.read(key: '$namespace$key');

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: '$namespace$key', value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: '$namespace$key');

  @override
  Future<void> clear() async {
    final Map<String, String> all = await _storage.readAll();
    final List<String> owned = all.keys
        .where((String key) => key.startsWith(namespace))
        .toList(growable: false);
    for (final String key in owned) {
      await _storage.delete(key: key);
    }
  }
}
