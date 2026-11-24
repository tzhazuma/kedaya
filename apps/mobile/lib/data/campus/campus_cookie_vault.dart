import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// 校园各站 cookie 的**加密**持久化（架构 A：Dart 侧持有会话）。
///
/// 与 WebView 方案的区别：校园卡等接口需要自定义头与 GET-with-body，
/// 浏览器 fetch 发不出来，只能由 Dart 直连；因此 cookie 必须由 Dart 持有。
///
/// 安全约束：
/// - 只存 `host -> Cookie 头字符串`，不存账号密码、不存 ticket；
/// - 走 Keychain / Keystore（`flutter_secure_storage`）；
/// - `clear()` 只清本命名空间，切号时必须调用；
/// - `toString` 不输出任何值。
abstract interface class CampusCookieVault {
  /// 读取某个 host 的 Cookie 头；没有返回 null。
  Future<String?> read(String host);

  /// 覆盖写入；传 null 等价于清除该 host。
  Future<void> write(String host, String? cookieHeader);

  /// 清空全部（切号 / 退出登录）。
  Future<void> clear();

  /// 已有 cookie 的 host 列表（不含值）。
  Future<List<String>> hosts();
}

/// Keychain / Keystore 实现。
final class SecureCookieVault implements CampusCookieVault {
  SecureCookieVault({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions:
                  IOSOptions(accessibility: KeychainAccessibility.first_unlock),
            );

  static const String _key = 'kedaya.campus.cookieVault.v1';

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String host) async {
    final Map<String, String> all = await _readAll();
    return all[host];
  }

  @override
  Future<void> write(String host, String? cookieHeader) async {
    final Map<String, String> all = await _readAll();
    if (cookieHeader == null || cookieHeader.trim().isEmpty) {
      all.remove(host);
    } else {
      all[host] = cookieHeader;
    }
    await _storage.write(key: _key, value: jsonEncode(all));
  }

  @override
  Future<void> clear() => _storage.delete(key: _key);

  @override
  Future<List<String>> hosts() async => (await _readAll()).keys.toList()..sort();

  Future<Map<String, String>> _readAll() async {
    final String? raw = await _storage.read(key: _key);
    if (raw == null || raw.isEmpty) return <String, String>{};
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return <String, String>{};
      return decoded.map(
        (String key, Object? value) => MapEntry<String, String>(key, '$value'),
      );
    } on FormatException {
      // 损坏时当作空，不阻塞登录流程。
      return <String, String>{};
    }
  }

  @override
  String toString() => 'SecureCookieVault()';
}

/// 内存实现（测试 / 不应期）。
final class InMemoryCookieVault implements CampusCookieVault {
  final Map<String, String> _values = <String, String>{};

  @override
  Future<String?> read(String host) async => _values[host];

  @override
  Future<void> write(String host, String? cookieHeader) async {
    if (cookieHeader == null || cookieHeader.trim().isEmpty) {
      _values.remove(host);
    } else {
      _values[host] = cookieHeader;
    }
  }

  @override
  Future<void> clear() async => _values.clear();

  @override
  Future<List<String>> hosts() async => _values.keys.toList()..sort();

  @override
  String toString() => 'InMemoryCookieVault(hosts: ${_values.length})';
}
