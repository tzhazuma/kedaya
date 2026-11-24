import 'json_read.dart';
import 'time_text.dart';

/// 画像标签。
///
/// **来源是必填项**：没有来源就没有画像标签。这不是展示层约定，
/// 而是在构造函数里直接拒绝空来源，避免某条路径悄悄产出"无出处的标签"。
final class PortraitTag {
  PortraitTag({
    required String label,
    required String source,
    required this.updatedAt,
    String? detail,
  })  : label = label.trim(),
        source = source.trim(),
        detail =
            (detail == null || detail.trim().isEmpty) ? null : detail.trim() {
    if (this.label.isEmpty) {
      throw ArgumentError.value(label, 'label', '画像标签必须有标签名');
    }
    if (this.source.isEmpty) {
      throw ArgumentError.value(source, 'source', '画像标签必须标注来源');
    }
  }

  factory PortraitTag.fromJson(Map<String, Object?> json) => PortraitTag(
        label: readString(json, 'label'),
        source: readString(json, 'source'),
        updatedAt: readDateTime(json, 'updatedAt'),
        detail: readStringOrNull(json, 'detail'),
      );

  final String label;

  /// 标签来自哪里，例如「课表」「图书馆门禁」「校园卡消费」「社团活动」。
  final String source;

  final DateTime updatedAt;

  /// 可选的一句话解释；不得包含聊天内容、咨询记录等敏感原文。
  final String? detail;

  /// 例：`来源：课表 · 2026-11-20`。
  String get sourceLine {
    final DateTime local = updatedAt.isUtc ? updatedAt.toLocal() : updatedAt;
    return '来源：$source · ${toDateKey(local)}';
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'label': label,
        'source': source,
        'updatedAt': isoUtc(updatedAt),
        'detail': detail,
      };
}

/// 一份已有的 AI 校园画像。
///
/// 客户端对它是**只读**的：没有生成、推断、补全标签的方法。
/// 「没有画像」用 `null` 表示，而不是一个空对象 —— 两者在产品语义上不同。
final class CampusPortrait {
  CampusPortrait({
    required String id,
    required this.updatedAt,
    required List<PortraitTag> tags,
    this.isDemo = false,
  })  : id = id.trim(),
        tags = List<PortraitTag>.unmodifiable(tags) {
    if (this.id.isEmpty) {
      throw ArgumentError.value(id, 'id', '画像必须有 id');
    }
    if (this.tags.isEmpty) {
      throw ArgumentError('画像至少需要一个标签；没有画像请使用 null');
    }
  }

  factory CampusPortrait.fromJson(Map<String, Object?> json) => CampusPortrait(
        id: readString(json, 'id'),
        updatedAt: readDateTime(json, 'updatedAt'),
        isDemo: readBoolOr(json, 'isDemo', false),
        tags: readListOrEmpty(json, 'tags')
            .map(
              (Object? item) => PortraitTag.fromJson(
                requireJsonMap(item, what: 'tags[] 元素'),
              ),
            )
            .toList(growable: false),
      );

  final String id;
  final DateTime updatedAt;
  final List<PortraitTag> tags;

  /// 演示数据必须显式标记，页面据此展示「演示数据」徽章。
  final bool isDemo;

  bool get hasTags => tags.isNotEmpty;

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'updatedAt': isoUtc(updatedAt),
        'isDemo': isDemo,
        'tags': <Map<String, Object?>>[
          for (final PortraitTag tag in tags) tag.toJson(),
        ],
      };
}

/// `2026-11-20 09:00`（本地时区，展示用）。
String formatPortraitTimestamp(DateTime value) {
  final DateTime local = value.isUtc ? value.toLocal() : value;
  final String year = local.year.toString().padLeft(4, '0');
  final String month = local.month.toString().padLeft(2, '0');
  final String day = local.day.toString().padLeft(2, '0');
  final String hour = local.hour.toString().padLeft(2, '0');
  final String minute = local.minute.toString().padLeft(2, '0');
  return '$year-$month-$day $hour:$minute';
}
