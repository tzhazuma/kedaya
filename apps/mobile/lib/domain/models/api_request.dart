import 'json_read.dart';

/// 契约 §6.1 冻结常量。
const String apiBasePath = '/api/v1';
const String traceHeader = 'X-KedaYa-Trace';
const String idempotencyHeader = 'Idempotency-Key';
const String authHeader = 'Authorization';

/// 默认页大小与上限（契约 §6.1：游标分页，不用 offset）。
const int defaultPageSize = 20;
const int maxPageSize = 100;

/// 契约 §11.1：写操作统一采用 JSON Merge Patch（RFC 7396）时的媒体类型。
///
/// `PATCH` 只发要改的字段；显式传 `null` 表示清空该字段。
const String mergePatchContentType = 'application/merge-patch+json';

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
    this.contentType,
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

  /// 覆盖 `Content-Type`；null 表示用 Dio 的全局默认（`application/json`）。
  ///
  /// 目前只有一个消费点：[mergePatchContentType]（契约 §11.1 的 `PATCH`）。
  final String? contentType;

  ApiRequest copyWith({
    String? path,
    ApiMethod? method,
    Object? body,
    Map<String, Object?>? query,
    String? idempotencyKey,
    String? contentType,
  }) => ApiRequest(
    path: path ?? this.path,
    method: method ?? this.method,
    body: body ?? this.body,
    query: query ?? this.query,
    idempotencyKey: idempotencyKey ?? this.idempotencyKey,
    contentType: contentType ?? this.contentType,
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

/// 一个 multipart 上传项（`POST /api/v1/wildlife/media`，规格 §4.1）。
///
/// 字节用 `List<int>`：`domain` 层只允许 `dart:core`（冻结契约 §7 硬规则 1），
/// 而 `Uint8List` 需要 `dart:typed_data`。实现层（Dio）接受 `List<int>`，
/// 因此不需要为了类型好看而破坏分层。
final class ApiUploadFile {
  const ApiUploadFile({
    required this.field,
    required this.bytes,
    required this.fileName,
    this.mimeType,
  });

  /// 表单字段名，如 `file`。
  final String field;

  final List<int> bytes;
  final String fileName;

  /// 客户端声明的 MIME；服务端必须自己按魔数校验（规格 §4.2）。
  final String? mimeType;

  int get byteSize => bytes.length;

  @override
  String toString() => 'ApiUploadFile($field: $fileName, $byteSize bytes)';
}
