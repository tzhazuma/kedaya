import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/features/campus_web/domain/campus_bridge_protocol.dart';

void main() {
  group('CampusBridgeRequest', () {
    test('编码包含 id / url / method / form', () {
      const CampusBridgeRequest request = CampusBridgeRequest(
        id: 'r1',
        url: '/learn/v1/course/video/review/1',
        method: 'POST',
        form: <String, String>{'a': '1', 'b': '中文'},
      );
      final Map<String, dynamic> decoded =
          jsonDecode(request.encode()) as Map<String, dynamic>;
      expect(decoded['id'], 'r1');
      expect(decoded['method'], 'POST');
      expect((decoded['form'] as Map<String, dynamic>)['b'], '中文');
    });

    test('默认 GET，无 form', () {
      const CampusBridgeRequest request =
          CampusBridgeRequest(id: 'r2', url: '/x');
      final Map<String, dynamic> decoded =
          jsonDecode(request.encode()) as Map<String, dynamic>;
      expect(decoded['method'], 'GET');
      expect(decoded['form'], isNull);
    });
  });

  group('CampusBridgeResponse', () {
    test('正常消息解析出 id / status / body', () {
      final CampusBridgeResponse? response = CampusBridgeResponse.decode(
        jsonEncode(<String, Object?>{
          'id': 'r1',
          'status': 200,
          'body': '{"ok":true}',
          'error': null,
        }),
      );
      expect(response, isNotNull);
      expect(response!.id, 'r1');
      expect(response.isOk, isTrue);
      expect(response.tryJson()?['ok'], isTrue);
    });

    test('缺 id 或 status 类型不对 → null（不许静默当成功）', () {
      expect(CampusBridgeResponse.decode('{}'), isNull);
      expect(
        CampusBridgeResponse.decode('{"id":"r1","status":"200"}'),
        isNull,
      );
      expect(CampusBridgeResponse.decode('not json'), isNull);
    });

    test('error 非空视为失败，即使 status=200', () {
      final CampusBridgeResponse? response = CampusBridgeResponse.decode(
        jsonEncode(<String, Object?>{
          'id': 'r1',
          'status': 200,
          'body': '',
          'error': 'TypeError',
        }),
      );
      expect(response!.isOk, isFalse);
    });

    test('body 是 HTML 时 tryJson 返回 null', () {
      final CampusBridgeResponse response = CampusBridgeResponse(
        id: 'r1',
        status: 200,
        body: '<html></html>',
      );
      expect(response.tryJson(), isNull);
      expect(response.isOk, isTrue);
    });
  });

  group('注入脚本', () {
    test('回传原样 id，且不读取 document.cookie', () {
      expect(campusBridgeScript, contains('payload.id'));
      expect(campusBridgeScript, contains("credentials: 'include'"));
      expect(campusBridgeScript, contains('KedayaBridge.postMessage'));
      expect(campusBridgeScript, isNot(contains('document.cookie')));
    });

    test('POST 表单用 form-urlencoded', () {
      expect(campusBridgeScript, contains('URLSearchParams'));
      expect(campusBridgeScript,
          contains('application/x-www-form-urlencoded'));
    });
  });
}
