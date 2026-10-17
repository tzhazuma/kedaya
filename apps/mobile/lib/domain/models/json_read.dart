/// 纯 `dart:core` 的 JSON 读取助手（冻结契约 §7 硬规则 1）。
///
/// `domain` 层只接收**已解码**的 `Map<String, Object?>`；`dart:convert` 的调用
/// 一律留在 `data/api/`。因此本文件不 import 任何库（连 `dart:convert` 都不用）。
library;

String _typeName(Object? value) =>
    value == null ? 'null' : value.runtimeType.toString();

Never _mismatch(String key, String expected, Object? value) =>
    throw FormatException(
        'JSON 字段 "$key" 期望 $expected，实际为 ${_typeName(value)}');

/// 断言 [value] 是 JSON 对象，并收敛为 `Map<String, Object?>`。
///
/// `jsonDecode` 产出的是 `Map<String, dynamic>`；`dynamic` 与 `Object?` 互为子类型，
/// 因此第一个分支即可命中。第二个分支兜住其它来源（如手写的 `Map<Object?, Object?>`）。
Map<String, Object?> requireJsonMap(Object? value, {String what = '响应'}) {
  if (value is Map<String, Object?>) return value;
  if (value is Map<Object?, Object?>) {
    return <String, Object?>{
      for (final MapEntry<Object?, Object?> entry in value.entries)
        '${entry.key}': entry.value,
    };
  }
  throw FormatException('$what 期望 JSON 对象，实际为 ${_typeName(value)}');
}

String readString(Map<String, Object?> json, String key) {
  final Object? value = json[key];
  if (value is String) return value;
  _mismatch(key, 'String', value);
}

String? readStringOrNull(Map<String, Object?> json, String key) {
  final Object? value = json[key];
  if (value == null) return null;
  if (value is String) return value;
  _mismatch(key, 'String?', value);
}

String readStringOr(Map<String, Object?> json, String key, String fallback) =>
    readStringOrNull(json, key) ?? fallback;

int? _asInt(Object? value) {
  if (value is int) return value;
  if (value is double && value == value.roundToDouble()) return value.toInt();
  if (value is String) return int.tryParse(value);
  return null;
}

int readInt(Map<String, Object?> json, String key) {
  final Object? value = json[key];
  final int? parsed = _asInt(value);
  if (parsed != null) return parsed;
  _mismatch(key, 'int', value);
}

int? readIntOrNull(Map<String, Object?> json, String key) {
  final Object? value = json[key];
  if (value == null) return null;
  final int? parsed = _asInt(value);
  if (parsed != null) return parsed;
  _mismatch(key, 'int?', value);
}

int readIntOr(Map<String, Object?> json, String key, int fallback) =>
    readIntOrNull(json, key) ?? fallback;

double? _asDouble(Object? value) {
  if (value is double) return value;
  if (value is int) return value.toDouble();
  if (value is String) return double.tryParse(value);
  return null;
}

double readDouble(Map<String, Object?> json, String key) {
  final Object? value = json[key];
  final double? parsed = _asDouble(value);
  if (parsed != null) return parsed;
  _mismatch(key, 'double', value);
}

double? readDoubleOrNull(Map<String, Object?> json, String key) {
  final Object? value = json[key];
  if (value == null) return null;
  final double? parsed = _asDouble(value);
  if (parsed != null) return parsed;
  _mismatch(key, 'double?', value);
}

double readDoubleOr(Map<String, Object?> json, String key, double fallback) =>
    readDoubleOrNull(json, key) ?? fallback;

bool readBool(Map<String, Object?> json, String key) {
  final Object? value = json[key];
  if (value is bool) return value;
  _mismatch(key, 'bool', value);
}

bool? readBoolOrNull(Map<String, Object?> json, String key) {
  final Object? value = json[key];
  if (value == null) return null;
  if (value is bool) return value;
  _mismatch(key, 'bool?', value);
}

bool readBoolOr(Map<String, Object?> json, String key, bool fallback) {
  final Object? value = json[key];
  if (value == null) return fallback;
  if (value is bool) return value;
  _mismatch(key, 'bool', value);
}

DateTime? _asDateTime(Object? value) {
  if (value is String && value.isNotEmpty) {
    final DateTime? parsed = DateTime.tryParse(value);
    if (parsed != null) return parsed.toUtc();
  }
  return null;
}

/// 契约 §6.1：时间是 ISO-8601 UTC 字符串。
DateTime readDateTime(Map<String, Object?> json, String key) {
  final Object? value = json[key];
  final DateTime? parsed = _asDateTime(value);
  if (parsed != null) return parsed;
  _mismatch(key, 'ISO-8601 时间字符串', value);
}

DateTime? readDateTimeOrNull(Map<String, Object?> json, String key) {
  final Object? value = json[key];
  if (value == null) return null;
  final DateTime? parsed = _asDateTime(value);
  if (parsed != null) return parsed;
  _mismatch(key, 'ISO-8601 时间字符串', value);
}

/// 写回时统一用 UTC ISO-8601（与后端约定一致）。
String isoUtc(DateTime value) => value.toUtc().toIso8601String();

/// wire 枚举值比较：**忽略大小写与首尾空白**。
///
/// 为什么需要它：`docs/architecture/02-domain-model.md` 用
/// `enum<DRAFT|PUBLISHED|…>` 的大写记号描述取值，而 `services/api` 实现里
/// 论坛主题/回复的状态是**小写**（`published`）、举报状态却是**大写**
/// （`PENDING`）。同一个契约下两种大小写并存，客户端只能用不敏感比较兜住，
/// 否则一个大小写差异就会让整条数据收敛成 `unknown`（帖子变成不可见/不可回复）。
bool wireEquals(String a, String b) =>
    a.trim().toLowerCase() == b.trim().toLowerCase();

List<Object?> readList(Map<String, Object?> json, String key) {
  final Object? value = json[key];
  if (value is List<Object?>) return value;
  _mismatch(key, 'List', value);
}

List<Object?> readListOrEmpty(Map<String, Object?> json, String key) {
  final Object? value = json[key];
  if (value == null) return const <Object?>[];
  if (value is List<Object?>) return value;
  _mismatch(key, 'List', value);
}

/// 读取字符串数组；非字符串元素被丢弃（后端新增字段时不至于整条解析失败）。
List<String> readStringList(Map<String, Object?> json, String key) =>
    readListOrEmpty(json, key)
        .where((Object? value) => value is String)
        .map((Object? value) => value! as String)
        .toList(growable: false);

Map<String, Object?> readMap(Map<String, Object?> json, String key) =>
    requireJsonMap(json[key], what: 'JSON 字段 "$key"');

Map<String, Object?>? readMapOrNull(Map<String, Object?> json, String key) {
  final Object? value = json[key];
  if (value == null) return null;
  return requireJsonMap(value, what: 'JSON 字段 "$key"');
}
