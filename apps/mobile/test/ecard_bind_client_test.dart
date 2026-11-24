import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/campus/ecard_api_client.dart' show EcardException;
import 'package:kedaya/data/campus/ecard_bind_client.dart';

void main() {
  const String token = 'test-token';

  EcardBindTransport responding(
    EcardBindHttpResponse response, {
    void Function(Uri uri, String body, Map<String, String> headers)? inspect,
  }) {
    return ({
      required String method,
      required Uri uri,
      required String body,
      required Map<String, String> headers,
    }) async {
      inspect?.call(uri, body, headers);
      return response;
    };
  }

  group('EcardBindClient 构造', () {
    test('空密钥直接拒绝构造', () {
      expect(
        () => EcardBindClient(bindToken: '   '),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('密钥不进入 toString 之外的任何字符串', () {
      final EcardBindClient client = EcardBindClient(
        bindToken: 'SUPER-SECRET',
        transport: responding(
          const EcardBindHttpResponse(statusCode: 500, body: ''),
        ),
      );
      expect(client.toString(), isNot(contains('SUPER-SECRET')));
    });
  });

  group('EcardBindClient.exchange', () {
    test('成功：规整绑定码后换成 OPENID', () async {
      Uri? seenUri;
      String? seenBody;
      Map<String, String>? seenHeaders;

      final EcardBindClient client = EcardBindClient(
        bindToken: token,
        transport: responding(
          const EcardBindHttpResponse(
            statusCode: 200,
            body: '{"ok":true,"openid":"oid-123","usertype":"wechat","orgid":"shanghaitech"}',
          ),
          inspect: (Uri uri, String body, Map<String, String> headers) {
            seenUri = uri;
            seenBody = body;
            seenHeaders = headers;
          },
        ),
      );

      final EcardBindResult result = await client.exchange('  ab12cd ');

      expect(result.openId, 'oid-123');
      expect(result.channel, 'wechat');
      expect(result.orgId, 'shanghaitech');

      expect(seenUri!.path, EcardBindClient.exchangePath);
      expect(
        jsonDecode(seenBody!) as Map<String, dynamic>,
        <String, dynamic>{'code': 'AB12CD'},
      );
      expect(seenHeaders!['X-Bind-Token'], token);
    });

    test('usertype 缺失时默认 wechat，其他渠道原样返回', () async {
      final EcardBindClient missing = EcardBindClient(
        bindToken: token,
        transport: responding(
          const EcardBindHttpResponse(
            statusCode: 200,
            body: '{"ok":true,"openid":"oid"}',
          ),
        ),
      );
      expect((await missing.exchange('X1')).channel, 'wechat');

      final EcardBindClient other = EcardBindClient(
        bindToken: token,
        transport: responding(
          const EcardBindHttpResponse(
            statusCode: 200,
            body: '{"ok":true,"openid":"oid","usertype":"alipay"}',
          ),
        ),
      );
      expect((await other.exchange('X1')).channel, 'alipay');
    });

    test('空码不发请求', () async {
      bool called = false;
      final EcardBindClient client = EcardBindClient(
        bindToken: token,
        transport: responding(
          const EcardBindHttpResponse(statusCode: 200, body: '{"ok":true}'),
          inspect: (_, __, ___) => called = true,
        ),
      );
      await expectLater(client.exchange('  '), throwsA(isA<EcardException>()));
      expect(called, isFalse);
    });

    test('200 但 ok 不是 true 视为异常（强制门户/别的服务）', () async {
      final EcardBindClient client = EcardBindClient(
        bindToken: token,
        transport: responding(
          const EcardBindHttpResponse(
            statusCode: 200,
            body: '<html>welcome to campus wifi</html>',
          ),
        ),
      );
      await expectLater(
        client.exchange('AB12CD'),
        throwsA(
          isA<EcardException>().having(
            (EcardException e) => e.message,
            'message',
            contains('返回异常'),
          ),
        ),
      );
    });

    test('200 且有 ok 但缺 openid 也视为异常', () async {
      final EcardBindClient client = EcardBindClient(
        bindToken: token,
        transport: responding(
          const EcardBindHttpResponse(statusCode: 200, body: '{"ok":true}'),
        ),
      );
      await expectLater(
        client.exchange('AB12CD'),
        throwsA(
          isA<EcardException>().having(
            (EcardException e) => e.message,
            'message',
            contains('OPENID'),
          ),
        ),
      );
    });

    test('状态码映射到可读文案', () async {
      Future<String> messageFor(int status) async {
        final EcardBindClient client = EcardBindClient(
          bindToken: token,
          transport: responding(
            EcardBindHttpResponse(statusCode: status, body: '{}'),
          ),
        );
        try {
          await client.exchange('AB12CD');
          fail('应当抛出');
        } on EcardException catch (error) {
          return error.message;
        }
      }

      expect(await messageFor(400), contains('格式'));
      expect(await messageFor(401), contains('未授权'));
      expect(await messageFor(404), contains('过期'));
      expect(await messageFor(410), contains('过期'));
      expect(await messageFor(500), contains('500'));
    });

    test('超时与网络异常都转成 EcardException', () async {
      final EcardBindClient slow = EcardBindClient(
        bindToken: token,
        timeout: const Duration(milliseconds: 20),
        transport: ({
          required String method,
          required Uri uri,
          required String body,
          required Map<String, String> headers,
        }) =>
            Completer<EcardBindHttpResponse>().future,
      );
      await expectLater(
        slow.exchange('AB12CD'),
        throwsA(
          isA<EcardException>().having(
            (EcardException e) => e.message,
            'message',
            contains('超时'),
          ),
        ),
      );

      final EcardBindClient broken = EcardBindClient(
        bindToken: token,
        transport: ({
          required String method,
          required Uri uri,
          required String body,
          required Map<String, String> headers,
        }) async =>
            throw const SocketishException(),
      );
      await expectLater(
        broken.exchange('AB12CD'),
        throwsA(isA<EcardException>()),
      );
    });
  });

  group('EcardBindClient.health', () {
    test('ok:true 才算健康', () async {
      Future<bool> forBody(String body) {
        return EcardBindClient(
          bindToken: token,
          transport: responding(EcardBindHttpResponse(statusCode: 200, body: body)),
        ).health();
      }

      expect(await forBody('{"ok":true,"codes":0}'), isTrue);
      expect(await forBody('{"ok":false}'), isFalse);
      expect(await forBody('not json'), isFalse);
      expect(await forBody(''), isFalse);
    });

    test('非 200 与非 Exception 之外的失败都返回 false', () async {
      final EcardBindClient notFound = EcardBindClient(
        bindToken: token,
        transport: responding(
          const EcardBindHttpResponse(statusCode: 404, body: '{"ok":true}'),
        ),
      );
      expect(await notFound.health(), isFalse);
    });
  });
}

/// 模拟一次底层网络异常（避免测试依赖 dart:io 的具体异常类型）。
final class SocketishException implements Exception {
  const SocketishException();
}
