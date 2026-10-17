import 'api_error.dart';

/// 无返回值的成功结果占位。
///
/// Dart 的 `void` 不适合作为泛型实参承载"成功但没有值"，因此用一个单例标记。
final class Unit {
  const Unit();

  static const Unit instance = Unit();

  @override
  String toString() => 'Unit';
}

/// 契约 §6.3 的 `Result<T, E>` —— 不抛异常的成功/失败二元结果。
///
/// `sealed` 让调用方用 `switch` 表达式穷尽两个分支；`domain` 层零框架依赖。
sealed class Result<T> {
  const Result();

  bool get isOk => this is Ok<T>;

  bool get isErr => this is Err<T>;

  /// 成功值；失败为 null。
  T? get valueOrNull => switch (this) {
    Ok<T>(:final T value) => value,
    Err<T>() => null,
  };

  /// 失败原因；成功为 null。
  ApiError? get errorOrNull => switch (this) {
    Ok<T>() => null,
    Err<T>(:final ApiError error) => error,
  };

  String? get traceIdOrNull => switch (this) {
    Ok<T>() => null,
    Err<T>(:final String? traceId) => traceId,
  };

  /// 成功值，失败抛 [ApiException]。
  T get unwrap => switch (this) {
    Ok<T>(:final T value) => value,
    Err<T>(:final ApiError error, :final String? traceId) =>
      throw ApiException(error, traceId: traceId),
  };

  T unwrapOr(T fallback) => valueOrNull ?? fallback;

  Result<R> map<R>(R Function(T value) transform) => switch (this) {
    Ok<T>(:final T value) => Ok<R>(transform(value)),
    Err<T>(:final ApiError error, :final String? traceId) =>
      Err<R>(error, traceId: traceId),
  };

  Result<R> flatMap<R>(Result<R> Function(T value) transform) => switch (this) {
    Ok<T>(:final T value) => transform(value),
    Err<T>(:final ApiError error, :final String? traceId) =>
      Err<R>(error, traceId: traceId),
  };
}

final class Ok<T> extends Result<T> {
  const Ok(this.value);

  final T value;

  @override
  String toString() => 'Ok($value)';
}

final class Err<T> extends Result<T> {
  const Err(this.error, {this.traceId});

  final ApiError error;
  final String? traceId;

  @override
  String toString() => 'Err($error${traceId == null ? '' : ', traceId=$traceId'})';
}

/// 把可能抛异常的异步操作收敛为 [Result]（网络层与 mock 共用）。
Future<Result<T>> runGuarded<T>(
  Future<T> Function() body, {
  String? traceId,
  String? what,
}) async {
  try {
    return Ok<T>(await body());
  } on ApiException catch (error) {
    return Err<T>(error.error, traceId: error.traceId ?? traceId);
  } on Object catch (error) {
    return Err<T>(
      ApiError(
        code: ApiErrorCode.internal,
        message: what == null ? '$error' : '$what 失败：$error',
      ),
      traceId: traceId,
    );
  }
}
