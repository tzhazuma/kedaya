import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/campus/ecard_cipher.dart';

void main() {
  const String key = '0123456789abcdef';

  group('头部编码', () {
    test('已知向量：前 10 位后置再整体反转', () {
      expect(EcardCipher.encodeHeader(key), '9876543210fedcba');
    });

    test('decodeHeader 是 encodeHeader 的逆运算', () {
      expect(EcardCipher.decodeHeader(EcardCipher.encodeHeader(key)), key);
    });

    test('非 16 位字母数字 key 直接拒绝', () {
      expect(() => EcardCipher.encodeHeader('short'), throwsFormatException);
      expect(() => EcardCipher.encodeHeader('0123456789abcde-'),
          throwsFormatException);
    });
  });

  group('请求 / 响应往返', () {
    test('encodeWithKey 的产物能被 decodeEnvelope 解回原对象', () {
      final Map<String, Object?> payload = <String, Object?>{
        'account': '20265555',
        'page': 1,
      };
      final String encoded = EcardCipher.encodeWithKey(payload, key);
      expect(encoded.substring(0, 16), EcardCipher.encodeHeader(key));

      final Object? decoded = EcardCipher.decodeEnvelope(encoded);
      expect(decoded, isA<Map<String, dynamic>>());
      expect((decoded! as Map<String, dynamic>)['account'], '20265555');
    });

    test('decodeResponse 解开 {datajson: 密文}', () {
      final String envelope = EcardCipher.encodeWithKey(
        <String, Object?>{'balanceFen': 12345},
        key,
      );
      final Object? decoded = EcardCipher.decodeResponse(
        jsonEncode(<String, Object?>{'code': 0, 'datajson': envelope}),
      );
      expect((decoded! as Map<String, dynamic>)['balanceFen'], 12345);
    });

    test('非 datajson 的纯 JSON 原样返回', () {
      final Object? decoded = EcardCipher.decodeResponse('{"code":0,"msg":"ok"}');
      expect((decoded! as Map<String, dynamic>)['msg'], 'ok');
    });

    test('密文被篡改 → FormatException（不会静默返回空）', () {
      final String encoded = EcardCipher.encodeWithKey(<String, Object?>{'a': 1}, key);
      final String tampered =
          encoded.substring(0, 16) + base64Encode(List<int>.filled(32, 7));
      expect(() => EcardCipher.decodeEnvelope(tampered), throwsFormatException);
    });

    test('过短的密文 → FormatException', () {
      expect(() => EcardCipher.decodeEnvelope('short'), throwsFormatException);
    });
  });

  test('secureKey 生成 16 位字母数字且每次不同', () {
    final String a = EcardCipher.secureKey();
    final String b = EcardCipher.secureKey();
    expect(a, matches(RegExp(r'^[A-Za-z0-9]{16}$')));
    expect(b, matches(RegExp(r'^[A-Za-z0-9]{16}$')));
    expect(a, isNot(b));
  });
}
