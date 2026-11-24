import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/campus/campus_cookie_jar.dart';
import 'package:kedaya/data/campus/cas_ticket_client.dart';

void main() {
  group('CampusCookieJar', () {
    test('吸收多条 Set-Cookie 并生成 Cookie 头', () {
      final CampusCookieJar jar = CampusCookieJar(
        clock: () => DateTime(2026, 3, 2, 12),
      );
      jar.absorb('ids.shanghaitech.edu.cn', <String>[
        'CASTGC=TGT-123; Path=/; Secure; HttpOnly',
        'JSESSIONID=abc; Path=/authserver',
      ]);
      expect(
        jar.headerFor('ids.shanghaitech.edu.cn'),
        'CASTGC=TGT-123; JSESSIONID=abc',
      );
    });

    test('host 之间互相隔离', () {
      final CampusCookieJar jar = CampusCookieJar();
      jar.set('a.example.edu.cn', 'sid', '1');
      expect(jar.headerFor('a.example.edu.cn'), 'sid=1');
      expect(jar.headerFor('b.example.edu.cn'), isNull);
    });

    test('Max-Age=0 立即删除；过期 cookie 不再出现在头里', () {
      DateTime now = DateTime(2026, 3, 2, 12);
      final CampusCookieJar jar = CampusCookieJar(clock: () => now);
      jar.absorb('x.edu.cn', <String>['a=1; Max-Age=60']);
      expect(jar.headerFor('x.edu.cn'), 'a=1');

      now = now.add(const Duration(seconds: 61));
      expect(jar.headerFor('x.edu.cn'), isNull);

      jar.absorb('x.edu.cn', <String>['b=2; Max-Age=0']);
      expect(jar.hasCookiesFor('x.edu.cn'), isFalse);
    });

    test('clear 清空所有 host', () {
      final CampusCookieJar jar = CampusCookieJar();
      jar.set('a.edu.cn', 'k', 'v');
      jar.set('b.edu.cn', 'k', 'v');
      jar.clear();
      expect(jar.headerFor('a.edu.cn'), isNull);
      expect(jar.headerFor('b.edu.cn'), isNull);
    });

    test('toString 不泄露 cookie 值', () {
      final CampusCookieJar jar = CampusCookieJar();
      jar.set('a.edu.cn', 'CASTGC', 'SECRET-TICKET');
      expect(jar.toString(), isNot(contains('SECRET-TICKET')));
    });
  });

  group('CAS serviceValidate', () {
    test('成功响应提取 cas:user', () {
      const String xml = '''
<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
  <cas:authenticationSuccess>
    <cas:user>20265555</cas:user>
  </cas:authenticationSuccess>
</cas:serviceResponse>''';
      final CasValidationResult result = parseCasServiceValidate(xml);
      expect(result.ok, isTrue);
      expect(result.user, '20265555');
    });

    test('失败响应带 code 与 message', () {
      const String xml = '''
<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
  <cas:authenticationFailure code="INVALID_TICKET">
    Ticket ST-1 not recognized
  </cas:authenticationFailure>
</cas:serviceResponse>''';
      final CasValidationResult result = parseCasServiceValidate(xml);
      expect(result.ok, isFalse);
      expect(result.failureCode, 'INVALID_TICKET');
      expect(result.failureMessage, contains('not recognized'));
    });

    test('不是 CAS 响应时返回 INVALID_RESPONSE', () {
      final CasValidationResult result =
          parseCasServiceValidate('<html>登录页</html>');
      expect(result.ok, isFalse);
      expect(result.failureCode, 'INVALID_RESPONSE');
    });

    test('校验 URL 带 service 与 ticket，且路径以 /serviceValidate 结尾', () {
      final Uri uri = buildCasServiceValidateUri(
        casBaseUrl: 'https://ids.shanghaitech.edu.cn/authserver/',
        service: 'https://api.example.cn/auth/cas/callback',
        ticket: 'ST-123',
      );
      expect(uri.path, '/authserver/serviceValidate');
      expect(uri.queryParameters['ticket'], 'ST-123');
      expect(uri.queryParameters['service'],
          'https://api.example.cn/auth/cas/callback');
    });
  });
}
