import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/features/auth/domain/cas_callback.dart';

void main() {
  group('extractCasCode', () {
    test('直接粘贴 code', () {
      expect(extractCasCode('abc123XYZ_-'), 'abc123XYZ_-');
      expect(extractCasCode('  abc123  '), 'abc123');
    });

    test('粘贴完整回调地址', () {
      expect(
        extractCasCode('https://localhost:8080/cas/callback?code=CODE-1&state=ok'),
        'CODE-1',
      );
      expect(extractCasCode('kedaya://cas?code=CODE-2'), 'CODE-2');
    });

    test('粘贴被截断的地址片段', () {
      expect(extractCasCode('?code=CODE-3&state=x'), 'CODE-3');
      expect(extractCasCode('…&code=CODE%204'), 'CODE 4');
    });

    test('取不出来时如实返回 null', () {
      expect(extractCasCode(''), isNull);
      expect(extractCasCode('   '), isNull);
      expect(extractCasCode('https://example.com/callback?state=ok'), isNull);
      expect(extractCasCode('这不是授权码，也不是地址'), isNull);
    });
  });
}
