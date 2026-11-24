import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// 已绑定的校园卡身份（OPENID 只在这里落地）。
///
/// 为什么必须存：架构 A 下客户端是唯一的会话持有者，直连
/// `ecard.shanghaitech.edu.cn` 时每个请求都要带 `openid`。服务端不代持，
/// 就没有别的地方能放它。
///
/// 与「不存长期标识」原则的关系：OpenID 不是凭证，单独拿它发不出有效请求
/// （还要 cookie + 加密信封），且落在 Keychain / Keystore 里、切号即清。
/// 因此这里存的是**本地会话标识**，不是密码，也不是 ticket。
final class EcardLink {
  const EcardLink({
    required this.openId,
    required this.channel,
    required this.linkedAt,
    this.orgId,
  });

  final String openId;
  final String channel;
  final DateTime linkedAt;
  final String? orgId;

  /// 只输出脱敏尾巴，避免日志里出现完整标识。
  @override
  String toString() => 'EcardLink(channel=$channel, openId=****'
      '${openId.length <= 4 ? '' : openId.substring(openId.length - 4)})';
}

abstract interface class EcardLinkStore {
  Future<EcardLink?> read();
  Future<void> write(EcardLink link);
  Future<void> clear();
}

final class SecureEcardLinkStore implements EcardLinkStore {
  SecureEcardLinkStore({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions:
                  IOSOptions(accessibility: KeychainAccessibility.first_unlock),
            );

  static const String _key = 'kedaya.campus.ecardLink.v1';

  final FlutterSecureStorage _storage;

  @override
  Future<EcardLink?> read() async {
    final String? raw = await _storage.read(key: _key);
    if (raw == null || raw.isEmpty) return null;
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return null;
      final String openId = '${decoded['openId'] ?? ''}'.trim();
      if (openId.isEmpty) return null;
      return EcardLink(
        openId: openId,
        channel: '${decoded['channel'] ?? 'wechat'}',
        orgId: decoded['orgId']?.toString(),
        linkedAt: DateTime.tryParse('${decoded['linkedAt'] ?? ''}')?.toUtc() ??
            DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      );
    } on FormatException {
      return null;
    }
  }

  @override
  Future<void> write(EcardLink link) => _storage.write(
        key: _key,
        value: jsonEncode(<String, Object?>{
          'openId': link.openId,
          'channel': link.channel,
          'orgId': link.orgId,
          'linkedAt': link.linkedAt.toUtc().toIso8601String(),
        }),
      );

  @override
  Future<void> clear() => _storage.delete(key: _key);

  @override
  String toString() => 'SecureEcardLinkStore()';
}

final class InMemoryEcardLinkStore implements EcardLinkStore {
  InMemoryEcardLinkStore([this._link]);

  EcardLink? _link;

  @override
  Future<EcardLink?> read() async => _link;

  @override
  Future<void> write(EcardLink link) async => _link = link;

  @override
  Future<void> clear() async => _link = null;

  @override
  String toString() => 'InMemoryEcardLinkStore(${_link == null ? '空' : '有'})';
}
