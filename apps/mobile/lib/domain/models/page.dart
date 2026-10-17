import 'json_read.dart';

/// 契约 §6.1 `Page<T>` —— 游标分页（不用 offset）。
final class Page<T> {
  const Page({required this.items, this.nextCursor, this.total});

  /// [decodeItem] 由调用方提供（通常是模型的 `fromJson` 工厂 tear-off）。
  factory Page.fromJson(
    Map<String, Object?> json,
    T Function(Map<String, Object?> item) decodeItem,
  ) =>
      Page<T>(
        items: readListOrEmpty(json, 'items')
            .map((Object? item) =>
                decodeItem(requireJsonMap(item, what: 'items[] 元素')))
            .toList(growable: false),
        nextCursor: readStringOrNull(json, 'nextCursor'),
        total: readIntOrNull(json, 'total'),
      );

  final List<T> items;

  /// 下一页游标；null 表示已到末页。
  final String? nextCursor;

  final int? total;

  bool get hasMore => nextCursor != null && nextCursor!.isNotEmpty;

  bool get isEmpty => items.isEmpty;

  int get length => items.length;

  /// 追加下一页（游标分页合并）。
  Page<T> append(Page<T> other) => Page<T>(
        items: <T>[...items, ...other.items],
        nextCursor: other.nextCursor,
        total: other.total ?? total,
      );

  Map<String, Object?> toJson(
          Map<String, Object?> Function(T item) encodeItem) =>
      <String, Object?>{
        'items': items.map(encodeItem).toList(growable: false),
        'nextCursor': nextCursor,
        if (total != null) 'total': total,
      };

  @override
  String toString() => 'Page(${items.length} items, nextCursor=$nextCursor)';
}
