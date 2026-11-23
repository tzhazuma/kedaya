import '../../domain/models/zhishu_workspace.dart';
import '../../domain/ports/local_cache_port.dart';

const String zhishuWorkspaceStorageKey = 'zhishu.workspace.v1';

final class LocalZhishuRepository {
  const LocalZhishuRepository(this._cache);

  final LocalCachePort _cache;

  ZhishuWorkspace read() {
    final Object? raw = _cache.readJson(zhishuWorkspaceStorageKey);
    if (raw is! Map) return const ZhishuWorkspace();
    try {
      final Map<String, Object?> json = Map<String, Object?>.from(raw);
      return ZhishuWorkspace(
        items: _list(json['items'])
            .map((Map<String, Object?> item) =>
                _cleanItem(ZhishuFeedItem.fromJson(item)))
            .toList(),
        materials: _list(json['materials']).map((Map<String, Object?> item) {
          final ZhishuMaterial material = ZhishuMaterial.fromJson(item);
          return ZhishuMaterial(
            id: material.id,
            title: material.title,
            content: material.content,
            createdAt: material.createdAt,
            sourceUrl: material.sourceUrl == null
                ? null
                : normalizeZhishuUrl(material.sourceUrl!),
          );
        }).toList(),
        qqMessages:
            _list(json['qqMessages']).map(QqChatMessage.fromJson).toList(),
        focusTopics: (json['focusTopics'] as List? ?? const <Object?>[])
            .whereType<String>()
            .take(20)
            .toList(),
      );
    } on Object {
      return const ZhishuWorkspace();
    }
  }

  Future<void> write(ZhishuWorkspace workspace) async {
    final ZhishuWorkspace clean = workspace.copyWith(
      items: workspace.items.take(1000).map(_cleanItem).toList(),
      materials: workspace.materials.take(500).map((ZhishuMaterial item) {
        return ZhishuMaterial(
          id: item.id,
          title: item.title,
          content: item.content,
          createdAt: item.createdAt,
          sourceUrl: item.sourceUrl == null
              ? null
              : normalizeZhishuUrl(item.sourceUrl!),
        );
      }).toList(),
      qqMessages: workspace.qqMessages.take(1000).toList(),
      focusTopics: workspace.focusTopics.take(20).toList(),
    );
    await _cache.writeJson(zhishuWorkspaceStorageKey, clean.toJson());
  }

  Future<void> clear() => _cache.remove(zhishuWorkspaceStorageKey);
}

List<Map<String, Object?>> _list(Object? value) =>
    (value as List? ?? const <Object?>[])
        .whereType<Map>()
        .map((Map item) => Map<String, Object?>.from(item))
        .toList();

ZhishuFeedItem _cleanItem(ZhishuFeedItem item) => ZhishuFeedItem(
      id: item.id,
      source: item.source,
      title: item.title,
      excerpt: item.excerpt,
      topic: item.topic,
      url: item.url == null ? null : normalizeZhishuUrl(item.url!),
      publishedAt: item.publishedAt,
      ignored: item.ignored,
    );
