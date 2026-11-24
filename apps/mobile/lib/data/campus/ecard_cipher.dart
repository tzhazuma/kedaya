import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:pointycastle/export.dart';

/// 校园卡接口的载荷加解密（对齐 TechPie 的 `EcardCipher`，GeekPie，经允许复用）。
///
/// 协议形态：
/// - 请求体 = `encodeHeader(key)` + base64(AES-ECB/PKCS7(JSON))
/// - 响应体 = `{datajson: "<16 字符头><base64 密文>"}`
///
/// 安全边界：
/// - 这是**传输混淆**，不是端到端加密；真正的机密性靠 HTTPS；
/// - key 只在本进程内存里存在一个请求生命周期，不落盘、不打印；
/// - `toString` 不输出 key 或明文。
final class EcardCipher {
  EcardCipher({String Function()? keyGenerator})
      : _keyGenerator = keyGenerator ?? secureKey;

  static const String _charset =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  final String Function() _keyGenerator;

  /// 16 位字母数字随机 key（`Random.secure`）。
  static String secureKey() {
    final Random random = Random.secure();
    return List<String>.generate(
      16,
      (_) => _charset[random.nextInt(_charset.length)],
      growable: false,
    ).join();
  }

  /// 请求头：先把 key 前 10 位移到末尾，再整体反转。
  static String encodeHeader(String key) {
    _requireAsciiKey(key);
    final String rotated = key.substring(10) + key.substring(0, 10);
    return String.fromCharCodes(rotated.codeUnits.reversed);
  }

  /// 逆运算：反转后把末尾 6 位移回开头。
  static String decodeHeader(String header) {
    _requireAsciiKey(header);
    final String reversed = String.fromCharCodes(header.codeUnits.reversed);
    return reversed.substring(6) + reversed.substring(0, 6);
  }

  /// 用随机 key 加密一个 JSON 载荷。
  String encodeRequest(Map<String, Object?> payload) =>
      encodeWithKey(payload, _keyGenerator());

  static String encodeWithKey(Object? payload, String key) {
    _requireAsciiKey(key);
    final Uint8List plain =
        Uint8List.fromList(utf8.encode(jsonEncode(payload)));
    final Uint8List encrypted = _aesEcb(
      plain,
      Uint8List.fromList(ascii.encode(key)),
      true,
    );
    return encodeHeader(key) + base64Encode(encrypted);
  }

  /// 解析响应：兼容纯 JSON、`{datajson: ...}` 与密文三种形态。
  static Object? decodeResponse(Object? body) {
    final Object? normalized = _decodeJsonBody(body);
    if (normalized is! Map<dynamic, dynamic> ||
        !normalized.containsKey('datajson')) {
      return normalized;
    }
    final Object? raw = normalized['datajson'];
    if (raw is! String) {
      throw const FormatException('Response datajson must be a string');
    }
    return decodeEnvelope(raw);
  }

  static Object? _decodeJsonBody(Object? body) {
    if (body is! String) return body;
    final String candidate = body.trim();
    if (!(candidate.startsWith('{') || candidate.startsWith('['))) {
      return body;
    }
    try {
      return jsonDecode(candidate);
    } on FormatException {
      return body;
    }
  }

  static Object? decodeEnvelope(String raw) {
    if (raw.length <= 16) {
      throw const FormatException('Encrypted response is too short');
    }
    final String key = decodeHeader(raw.substring(0, 16));
    late Uint8List encrypted;
    try {
      encrypted = base64Decode(raw.substring(16));
    } on FormatException {
      throw const FormatException('Encrypted response contains invalid base64');
    }
    final Uint8List plain = _aesEcb(
      encrypted,
      Uint8List.fromList(ascii.encode(key)),
      false,
    );
    late String text;
    try {
      text = utf8.decode(plain);
    } on FormatException {
      throw const FormatException('Encrypted response is not valid UTF-8');
    }
    final String candidate = text.trim();
    if (candidate.startsWith('{') || candidate.startsWith('[')) {
      try {
        return jsonDecode(candidate);
      } on FormatException {
        throw const FormatException('Encrypted response contains invalid JSON');
      }
    }
    if (candidate.startsWith('"')) {
      try {
        final Object? decoded = jsonDecode(candidate);
        if (decoded is String) {
          final String nested = decoded.trim();
          if (nested.startsWith('{') || nested.startsWith('[')) {
            return jsonDecode(nested);
          }
          return decoded;
        }
      } on FormatException {
        // 明文本身就是合法的文档形态，继续原样返回。
      }
    }
    return text;
  }

  static Uint8List _aesEcb(Uint8List data, Uint8List key, bool encrypt) {
    if (key.length != 16) {
      throw const FormatException('AES key must be 16 bytes');
    }
    final PaddedBlockCipher cipher =
        PaddedBlockCipherImpl(PKCS7Padding(), ECBBlockCipher(AESEngine()))
          ..init(
            encrypt,
            PaddedBlockCipherParameters<KeyParameter, Null>(
              KeyParameter(key),
              null,
            ),
          );
    try {
      return cipher.process(data);
    } on ArgumentError {
      throw const FormatException('Encrypted response failed AES validation');
    } on InvalidCipherTextException {
      throw const FormatException(
        'Encrypted response failed padding validation',
      );
    }
  }

  static void _requireAsciiKey(String key) {
    if (key.length != 16 || !RegExp(r'^[A-Za-z0-9]{16}$').hasMatch(key)) {
      throw const FormatException(
        'Ecard key header must be 16 alphanumeric ASCII characters',
      );
    }
  }
}
