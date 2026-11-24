/// 校园系统 cookie 的**内存**存储。
///
/// 设计约束（与 `docs/architecture` 的凭证边界一致）：
/// - 只存内存，不落盘、不进日志、不 toString 出值；
/// - 按 host 作用域隔离，避免把 A 站的票带给 B 站；
/// - 只保留 `name=value`，忽略属性（Path/Domain/Secure 已经由 host 作用域近似覆盖），
///   并在 `Expires`/`Max-Age` 过期时删除。
///
/// 这个类被 `CampusHttpClient` 与 WebView 注入共用；它不是"凭据仓库"，
/// 真正的口令/票据仍然只在登录流程里出现一次。
library;

/// 单个 cookie。
final class StoredCookie {
  StoredCookie(this.name, this.value, {this.expiresAt});

  final String name;
  final String value;
  final DateTime? expiresAt;

  bool isExpiredAt(DateTime now) =>
      expiresAt != null && !expiresAt!.isAfter(now);
}

/// host → cookies 的映射。
final class CampusCookieJar {
  CampusCookieJar({DateTime Function()? clock})
      : _clock = clock ?? DateTime.now;

  final DateTime Function() _clock;
  final Map<String, Map<String, StoredCookie>> _byHost =
      <String, Map<String, StoredCookie>>{};

  /// 解析响应里的 `Set-Cookie`（可多条）。
  void absorb(String host, Iterable<String> setCookieHeaders) {
    for (final String raw in setCookieHeaders) {
      final List<String> parts = raw.split(';');
      if (parts.isEmpty) continue;
      final int equals = parts.first.indexOf('=');
      if (equals <= 0) continue;
      final String name = parts.first.substring(0, equals).trim();
      final String value = parts.first.substring(equals + 1).trim();
      if (name.isEmpty) continue;

      DateTime? expiresAt;
      for (final String attr in parts.skip(1)) {
        final String lower = attr.toLowerCase().trim();
        if (lower.startsWith('max-age=')) {
          final int? seconds = int.tryParse(lower.substring(8));
          if (seconds != null) {
            expiresAt = _clock().add(Duration(seconds: seconds));
          }
        } else if (lower.startsWith('expires=')) {
          final DateTime? parsed =
              _tryParseHttpDate(attr.substring(8).trim());
          if (parsed != null) expiresAt = parsed;
        }
      }

      final Map<String, StoredCookie> hostJar =
          _byHost.putIfAbsent(host, () => <String, StoredCookie>{});
      if (expiresAt != null && !expiresAt.isAfter(_clock())) {
        hostJar.remove(name);
      } else {
        hostJar[name] = StoredCookie(name, value, expiresAt: expiresAt);
      }
    }
  }

  /// 直接写入一条 cookie（WebView 登录后回填 / 测试用）。
  void set(String host, String name, String value, {DateTime? expiresAt}) {
    _byHost.putIfAbsent(host, () => <String, StoredCookie>{})[name] =
        StoredCookie(name, value, expiresAt: expiresAt);
  }

  /// 生成 `Cookie` 请求头；host 没有任何有效 cookie 时返回 `null`。
  String? headerFor(String host) {
    final Map<String, StoredCookie>? hostJar = _byHost[host];
    if (hostJar == null || hostJar.isEmpty) return null;
    final DateTime now = _clock();
    hostJar.removeWhere((_, StoredCookie c) => c.isExpiredAt(now));
    if (hostJar.isEmpty) return null;
    return hostJar.values
        .map((StoredCookie c) => '${c.name}=${c.value}')
        .join('; ');
  }

  /// 清空（切换账号时必须调用）。
  void clear() => _byHost.clear();

  /// 某个 host 下是否有 cookie（不暴露值）。
  bool hasCookiesFor(String host) =>
      (_byHost[host] ?? const <String, StoredCookie>{})
          .values
          .any((StoredCookie c) => !c.isExpiredAt(_clock()));

  @override
  String toString() => 'CampusCookieJar(hosts: ${_byHost.length})';

  static DateTime? _tryParseHttpDate(String raw) {
    // RFC 1123 形如 `Wed, 21 Oct 2026 07:28:00 GMT`；Dart 的 parse 对 GMT 可用。
    try {
      return DateTime.parse(raw.replaceFirst('GMT', 'Z')).toLocal();
    } catch (_) {
      return null;
    }
  }
}
