import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/api/api_envelope.dart';
import 'package:kedaya/data/api/kedaya_api_client.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/json_read.dart';
import 'package:kedaya/domain/models/result.dart';

/// 信封解包是"所有网络访问的收口"（契约 §6.1），必须逐条钉死。
void main() {
  test('成功信封：解包 data 并保留 traceId', () {
    final ApiEnvelope<int> envelope = ApiEnvelope.parseBody<int>(
      '{"ok":true,"data":{"value":42},"traceId":"t-1"}',
      (Object? data) => readInt(requireJsonMap(data), 'value'),
    );
    expect(envelope.isOk, isTrue);
    expect(envelope.isFailure, isFalse);
    expect(envelope.traceId, 't-1');
    expect(toResult<int>(envelope).valueOrNull, 42);
  });

  test('失败信封：保留 code / message / traceId，并映射为 Err', () {
    final ApiEnvelope<int> envelope = ApiEnvelope.parseBody<int>(
      '{"ok":false,"error":{"code":"CAMPUS_BINDING_REQUIRED","message":"请先绑定校园系统"},"traceId":"t-2"}',
      (Object? data) => 0,
    );
    final Result<int> result = toResult<int>(envelope);
    expect(result.isErr, isTrue);
    expect(result.errorOrNull!.code, ApiErrorCode.campusBindingRequired);
    expect(result.errorOrNull!.needsCampusBinding, isTrue);
    expect(result.errorOrNull!.userMessage, '请先绑定校园系统');
    expect(result.traceIdOrNull, 't-2');
  });

  test('未知错误码 / 缺 error 字段都不会抛异常', () {
    final ApiEnvelope<int> unknownCode = ApiEnvelope.parseBody<int>(
      '{"ok":false,"error":{"code":"BRAND_NEW","message":"新错误"},"traceId":"t-3"}',
      (Object? data) => 0,
    );
    expect(toResult<int>(unknownCode).errorOrNull!.code, ApiErrorCode.internal);

    final ApiEnvelope<int> noError = ApiEnvelope.parseBody<int>(
      '{"ok":false,"traceId":"t-4"}',
      (Object? data) => 0,
    );
    expect(noError.isFailure, isTrue);
    expect(toResult<int>(noError).errorOrNull!.userMessage, isNotEmpty);
  });

  test('非 JSON / 空响应体收敛为 INTERNAL，而不是崩溃', () {
    final ApiEnvelope<int> html = ApiEnvelope.parseBody<int>(
      '<html>502 Bad Gateway</html>',
      (Object? data) => 0,
    );
    expect(html.isFailure, isTrue);
    expect(toResult<int>(html).errorOrNull!.code, ApiErrorCode.internal);

    final ApiEnvelope<int> empty = ApiEnvelope.parseBody<int>('   ', (Object? data) => 0);
    expect(empty.isFailure, isTrue);

    final ApiEnvelope<int> array = ApiEnvelope.parseBody<int>('[1,2,3]', (Object? data) => 0);
    expect(array.isFailure, isTrue);
  });

  test('decode 只在成功时被调用（失败信封不解析 data）', () {
    int calls = 0;
    final ApiEnvelope<int> envelope = ApiEnvelope.parseBody<int>(
      '{"ok":false,"error":{"code":"NOT_FOUND","message":"没了"},"traceId":"t-5"}',
      (Object? data) {
        calls++;
        return 0;
      },
    );
    expect(envelope.isFailure, isTrue);
    expect(calls, 0);
  });

  test('normalizePath 收敛 /api/v1 前缀与首斜杠', () {
    expect(normalizePath('groupbuy/items'), '/groupbuy/items');
    expect(normalizePath('/api/v1/groupbuy/items'), '/groupbuy/items');
    expect(normalizePath(' /groupbuy/items '), '/groupbuy/items');
    expect(normalizePath(''), '/');
  });
}
