import 'json_read.dart';

/// 契约 §6.1 冻结常量。
const String apiBasePath = '/api/v1';
const String traceHeader = 'X-KedaYa-Trace';
const String idempotencyHeader = 'Idempotency-Key';
const String authHeader = 'Authorization';

/// 默认页大小与上限（契约 §6.1：游标分页，不用 offset）。
const int defaultPageSize = 20;
const int maxPageSize = 100;

enum ApiMethod {
  get('GET'),
  post('POST'),
  patch('PATCH'),
  put('PUT'),
  delete('DELETE');

  const ApiMethod(this.wire);

  final String wire;
}

/// 契约 §6.1 `ApiRequest` —— 所有请求都走这个形状。
final class ApiRequest {
  const ApiRequest({
    required this.path,
    required this.method,
    this.body,
    this.query,
    this.idempotencyKey,
  });

  /// 不含 `/api/v1` 前缀，例: `groupbuy/items`。
  final String path;

  final ApiMethod method;

  /// 会被 JSON 编码的请求体。
  final Object? body;

  /// 查询参数；null 值由网络层丢弃。
  final Map<String, Object?>? query;

  /// 写操作的幂等键（契约 §6.1 `Idempotency-Key`）。
  final String? idempotencyKey;

  ApiRequest copyWith({
    String? path,
    ApiMethod? method,
    Object? body,
    Map<String, Object?>? query,
    String? idempotencyKey,
  }) => ApiRequest(
    path: path ?? this.path,
    method: method ?? this.method,
    body: body ?? this.body,
    query: query ?? this.query,
    idempotencyKey: idempotencyKey ?? this.idempotencyKey,
  );

  @override
  String toString() => '${method.wire} $path';
}

/// 契约 §6.1 `PageQuery`。
final class PageQuery {
  const PageQuery({this.cursor, this.limit = defaultPageSize});

  final String? cursor;
  final int limit;

  /// 收敛到 [maxPageSize] 以内，并丢弃 null。
  Map<String, Object?> toQuery() => <String, Object?>{
    if (cursor != null && cursor!.isNotEmpty) 'cursor': cursor,
    'limit': limit < 1 ? 1 : (limit > maxPageSize ? maxPageSize : limit),
  };

  /// 从查询串还原（供 mock 与测试复用）。
  factory PageQuery.fromJson(Map<String, Object?> json) => PageQuery(
    cursor: readStringOrNull(json, 'cursor'),
    limit: readIntOr(json, 'limit', defaultPageSize),
  );
}
