import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/result.dart';

void main() {
  group('ApiErrorCode', () {
    test('wire 往返一致', () {
      for (final ApiErrorCode code in ApiErrorCode.values) {
        expect(ApiErrorCode.fromWire(code.wire), code);
      }
    });

    test('未知错误码收敛为 INTERNAL（不把失败误判为成功）', () {
      expect(ApiErrorCode.fromWire('SOMETHING_NEW_FROM_BACKEND'), ApiErrorCode.internal);
    });

    test('needsCampusBinding / needsConsent 对应契约 §5 与 §9', () {
      const ApiError binding = ApiError(
        code: ApiErrorCode.campusBindingRequired,
        message: '',
      );
      const ApiError consent = ApiError(code: ApiErrorCode.consentRequired, message: '');
      const ApiError notFound = ApiError(code: ApiErrorCode.notFound, message: '');
      expect(binding.needsCampusBinding, isTrue);
      expect(binding.needsConsent, isFalse);
      expect(consent.needsConsent, isTrue);
      expect(notFound.needsConsent, isFalse);
    });

    test('userMessage 回落到中文兜底文案', () {
      expect(const ApiError(code: ApiErrorCode.notFound, message: '').userMessage, '内容不存在或已下架');
      expect(const ApiError(code: ApiErrorCode.notFound, message: '自定义文案').userMessage, '自定义文案');
      for (final ApiErrorCode code in ApiErrorCode.values) {
        expect(apiErrorFallbackMessages[code], isNotNull, reason: '${code.wire} 缺少兜底文案');
      }
    });

    test('fromJson 解析 code / message / details', () {
      final ApiError error = ApiError.fromJson(<String, Object?>{
        'code': 'VALIDATION_FAILED',
        'message': '标题太短',
        'details': <String, Object?>{'field': 'title'},
      });
      expect(error.code, ApiErrorCode.validationFailed);
      expect(error.message, '标题太短');
      expect(error.details, isA<Map<String, Object?>>());
      expect(error.toJson()['code'], 'VALIDATION_FAILED');
    });

    test('fromJson 对缺失字段容错', () {
      final ApiError error = ApiError.fromJson(const <String, Object?>{});
      expect(error.code, ApiErrorCode.internal);
      expect(error.userMessage, isNotEmpty);
    });
  });

  group('Result', () {
    test('Ok：取值、判定、unwrap', () {
      const Result<int> ok = Ok<int>(7);
      expect(ok.isOk, isTrue);
      expect(ok.isErr, isFalse);
      expect(ok.valueOrNull, 7);
      expect(ok.errorOrNull, isNull);
      expect(ok.traceIdOrNull, isNull);
      expect(ok.unwrap, 7);
      expect(ok.unwrapOr(1), 7);
    });

    test('Err：unwrap 抛 ApiException 并携带 traceId', () {
      const Result<int> err = Err<int>(
        ApiError(code: ApiErrorCode.conflict, message: '操作冲突'),
        traceId: 't-1',
      );
      expect(err.isErr, isTrue);
      expect(err.valueOrNull, isNull);
      expect(err.errorOrNull!.code, ApiErrorCode.conflict);
      expect(err.traceIdOrNull, 't-1');
      expect(() => err.unwrap, throwsA(isA<ApiException>()));
      expect(err.unwrapOr(42), 42);
    });

    test('map / flatMap 只在 Ok 上生效，Err 原样传递', () {
      expect(const Ok<int>(2).map<String>((int value) => 'v$value').valueOrNull, 'v2');
      expect(
        const Ok<int>(2).flatMap<String>((int value) => Ok<String>('v$value')).valueOrNull,
        'v2',
      );
      const Result<int> err = Err<int>(ApiError(code: ApiErrorCode.internal, message: 'x'));
      expect(err.map<String>((int value) => 'v$value').errorOrNull!.code, ApiErrorCode.internal);
      expect(
        err.flatMap<String>((int value) => Ok<String>('v$value')).errorOrNull!.code,
        ApiErrorCode.internal,
      );
    });

    test('runGuarded 把异常收敛为 Err，并保留 ApiException 的 traceId', () async {
      final Result<int> ok = await runGuarded<int>(() async => 1);
      expect(ok.valueOrNull, 1);

      final Result<int> failed = await runGuarded<int>(() async {
        throw StateError('boom');
      });
      expect(failed.errorOrNull!.code, ApiErrorCode.internal);

      final Result<int> apiFailed = await runGuarded<int>(() async {
        throw const ApiException(
          ApiError(code: ApiErrorCode.forbidden, message: '没有权限'),
          traceId: 't-9',
        );
      });
      expect(apiFailed.errorOrNull!.code, ApiErrorCode.forbidden);
      expect(apiFailed.traceIdOrNull, 't-9');
    });
  });
}
