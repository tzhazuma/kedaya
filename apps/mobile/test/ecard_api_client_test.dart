import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/campus/campus_cookie_vault.dart';
import 'package:kedaya/data/campus/campus_http_client.dart';
import 'package:kedaya/data/campus/ecard_api_client.dart';
import 'package:kedaya/data/campus/ecard_cipher.dart';

void main() {
  const String key = '0123456789abcdef';

  group('CampusCookieVault（内存实现）', () {
    test('按 host 读写、清空，hosts 排序', () async {
      final InMemoryCookieVault vault = InMemoryCookieVault();
      await vault.write('ecard.shanghaitech.edu.cn', 'a=1');
      await vault.write('oa.shanghaitech.edu.cn', 'b=2');
      expect(await vault.read('ecard.shanghaitech.edu.cn'), 'a=1');
      expect(await vault.hosts(),
          <String>['ecard.shanghaitech.edu.cn', 'oa.shanghaitech.edu.cn']);

      await vault.write('ecard.shanghaitech.edu.cn', null);
      expect(await vault.read('ecard.shanghaitech.edu.cn'), isNull);

      await vault.clear();
      expect(await vault.hosts(), isEmpty);
    });

    test('toString 不含值', () async {
      final InMemoryCookieVault vault = InMemoryCookieVault();
      await vault.write('x', 'SESSION=SECRET');
      expect(vault.toString(), isNot(contains('SECRET')));
    });
  });

  group('EcardApiClient', () {
    EcardTransport transportReturning(
      Object? data, {
      String? Function(String method, String path, String body, Map<String, String> headers)? assertRequest,
    }) {
      return ({
        required String method,
        required Uri uri,
        required String body,
        required Map<String, String> headers,
      }) async {
        final String? problem = assertRequest?.call(method, uri.path, body, headers);
        expect(problem, isNull, reason: problem ?? '');
        return CampusHttpResponse(
          statusCode: 200,
          body: jsonEncode(<String, Object?>{
            'datajson': EcardCipher.encodeWithKey(data, key),
          }),
          headers: const <String, List<String>>{},
        );
      };
    }

    test('请求体是 {datajson: 密文}，并注入 openid 与自定义头', () async {
      final EcardApiClient client = EcardApiClient(
        openId: 'openid-1',
        cookieHeader: 'SESSION=s1',
        transport: transportReturning(
          <String, Object?>{'balanceFen': 12345},
          assertRequest: (String method, String path, String body,
              Map<String, String> headers) {
            if (method != 'POST') return 'method 应为 POST';
            if (path != '/myaccount/openMyAccountApp') return 'path 不符';
            if (headers['session-type'] != 'uniapp') return '缺 session-type';
            if (headers['cookie'] != 'SESSION=s1') return '缺 cookie';
            final Map<String, dynamic> wire =
                jsonDecode(body) as Map<String, dynamic>;
            final String encrypted = wire['datajson'] as String;
            final Object? payload = EcardCipher.decodeEnvelope(encrypted);
            if ((payload! as Map<String, dynamic>)['openid'] != 'openid-1') {
              return '缺 openid';
            }
            return null;
          },
        ),
      );

      final Map<String, dynamic> account = await client.account();
      expect(account['balanceFen'], 12345);
    });

    test('流水的 GET 参数与分页边界', () async {
      final EcardApiClient client = EcardApiClient(
        openId: 'o',
        transport: transportReturning(
          <String, Object?>{'rows': <Object?>[]},
          assertRequest: (String method, String path, String body,
              Map<String, String> headers) {
            if (method != 'GET') return 'method 应为 GET';
            if (path != '/selftrade/queryCardSelfTradeList') return 'path 不符';
            final Map<String, dynamic> wire =
                jsonDecode(body) as Map<String, dynamic>;
            final Object? payload =
                EcardCipher.decodeEnvelope(wire['datajson'] as String);
            final Map<String, dynamic> map = payload! as Map<String, dynamic>;
            if (map['pageNumber'] != 2) return 'pageNumber 不符';
            if (map['pageSize'] != 20) return 'pageSize 不符';
            return null;
          },
        ),
      );

      final Map<String, dynamic> page = await client.transactions(
        beginDate: '2026-05-25',
        endDate: '2026-11-25',
        pageNumber: 2,
      );
      expect(page['rows'], isEmpty);
    });

    test('pageSize 越界在本地拒绝', () async {
      final EcardApiClient client = EcardApiClient(
        openId: 'o',
        transport: transportReturning(<String, Object?>{}),
      );
      expect(
        () => client.transactions(
          beginDate: '2026-05-25',
          endDate: '2026-11-25',
          pageSize: 51,
        ),
        throwsA(isA<EcardException>()),
      );
    });

    test('业务错误码 → 抛 EcardException（带上游 message）', () async {
      final EcardApiClient client = EcardApiClient(
        openId: 'o',
        transport: transportReturning(<String, Object?>{
          'code': 500,
          'message': '余额查询失败',
        }),
      );
      expect(
        () => client.account(),
        throwsA(
          isA<EcardException>().having(
            (EcardException e) => e.message,
            'message',
            '余额查询失败',
          ),
        ),
      );
    });

    test('401 → authExpired', () async {
      final EcardApiClient client = EcardApiClient(
        openId: 'o',
        transport: ({
          required String method,
          required Uri uri,
          required String body,
          required Map<String, String> headers,
        }) async =>
            const CampusHttpResponse(
          statusCode: 401,
          body: '',
          headers: <String, List<String>>{},
        ),
      );
      try {
        await client.account();
        fail('应当抛 EcardException');
      } on EcardException catch (error) {
        expect(error.authExpired, isTrue);
      }
    });
  });
}
