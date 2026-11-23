enum ZhishuSource {
  mail('校园邮箱'),
  wechat('公众号'),
  zhihu('知乎'),
  qq('QQ'),
  material('资料');

  const ZhishuSource(this.label);
  final String label;

  static ZhishuSource fromWire(String value) => ZhishuSource.values.firstWhere(
        (ZhishuSource source) => source.name == value,
        orElse: () => ZhishuSource.material,
      );
}

final class ZhishuFeedItem {
  const ZhishuFeedItem({
    required this.id,
    required this.source,
    required this.title,
    required this.excerpt,
    required this.topic,
    required this.url,
    required this.publishedAt,
    this.ignored = false,
  });

  final String id;
  final ZhishuSource source;
  final String title;
  final String excerpt;
  final String topic;
  final String? url;
  final String publishedAt;
  final bool ignored;

  ZhishuFeedItem copyWith({
    String? id,
    ZhishuSource? source,
    String? title,
    String? excerpt,
    String? topic,
    String? url,
    String? publishedAt,
    bool? ignored,
  }) =>
      ZhishuFeedItem(
        id: id ?? this.id,
        source: source ?? this.source,
        title: title ?? this.title,
        excerpt: excerpt ?? this.excerpt,
        topic: topic ?? this.topic,
        url: url ?? this.url,
        publishedAt: publishedAt ?? this.publishedAt,
        ignored: ignored ?? this.ignored,
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'source': source.name,
        'title': title,
        'excerpt': excerpt,
        'topic': topic,
        'url': url,
        'publishedAt': publishedAt,
        'ignored': ignored,
      };

  static ZhishuFeedItem fromJson(Map<String, Object?> json) => ZhishuFeedItem(
        id: json['id']! as String,
        source: ZhishuSource.fromWire(json['source']! as String),
        title: json['title']! as String,
        excerpt: json['excerpt']! as String,
        topic: json['topic']! as String,
        url: json['url'] as String?,
        publishedAt: json['publishedAt']! as String,
        ignored: json['ignored']! as bool,
      );
}

final class ZhishuMaterial {
  const ZhishuMaterial({
    required this.id,
    required this.title,
    required this.content,
    required this.createdAt,
    required this.sourceUrl,
  });

  final String id;
  final String title;
  final String content;
  final String createdAt;
  final String? sourceUrl;

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'title': title,
        'content': content,
        'createdAt': createdAt,
        'sourceUrl': sourceUrl,
      };

  static ZhishuMaterial fromJson(Map<String, Object?> json) => ZhishuMaterial(
        id: json['id']! as String,
        title: json['title']! as String,
        content: json['content']! as String,
        createdAt: json['createdAt']! as String,
        sourceUrl: json['sourceUrl'] as String?,
      );
}

final class QqChatMessage {
  const QqChatMessage({
    required this.id,
    required this.sender,
    required this.sentAt,
    required this.text,
  });

  final String id;
  final String sender;
  final String sentAt;
  final String text;

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'sender': sender,
        'sentAt': sentAt,
        'text': text,
      };

  static QqChatMessage fromJson(Map<String, Object?> json) => QqChatMessage(
        id: json['id']! as String,
        sender: json['sender']! as String,
        sentAt: json['sentAt']! as String,
        text: json['text']! as String,
      );
}

final class ZhishuWorkspace {
  const ZhishuWorkspace({
    this.items = const <ZhishuFeedItem>[],
    this.materials = const <ZhishuMaterial>[],
    this.qqMessages = const <QqChatMessage>[],
    this.focusTopics = const <String>[],
  });

  final List<ZhishuFeedItem> items;
  final List<ZhishuMaterial> materials;
  final List<QqChatMessage> qqMessages;
  final List<String> focusTopics;

  ZhishuWorkspace copyWith({
    List<ZhishuFeedItem>? items,
    List<ZhishuMaterial>? materials,
    List<QqChatMessage>? qqMessages,
    List<String>? focusTopics,
  }) =>
      ZhishuWorkspace(
        items: items ?? this.items,
        materials: materials ?? this.materials,
        qqMessages: qqMessages ?? this.qqMessages,
        focusTopics: focusTopics ?? this.focusTopics,
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'items': items.map((ZhishuFeedItem item) => item.toJson()).toList(),
        'materials':
            materials.map((ZhishuMaterial item) => item.toJson()).toList(),
        'qqMessages':
            qqMessages.map((QqChatMessage item) => item.toJson()).toList(),
        'focusTopics': focusTopics,
      };
}

final class QqChatImport {
  const QqChatImport({required this.messages, required this.rejected});
  final List<QqChatMessage> messages;
  final List<String> rejected;
}

final RegExp _qqHeader = RegExp(
  r'^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s+(.+?)(?:\(([^()]*)\))?\s*$',
);

QqChatImport parseQqChatExport(String input) {
  if (input.length > 500000) {
    throw const FormatException('QQ 聊天记录不能超过 500KB，请分批导入');
  }
  final List<QqChatMessage> messages = <QqChatMessage>[];
  final List<String> rejected = <String>[];
  String? sender;
  String? sentAt;
  List<String> lines = <String>[];

  void flush() {
    final String text = lines.join('\n').trim();
    if (sender != null && sentAt != null && text.isNotEmpty) {
      messages.add(QqChatMessage(
        id: 'qq-${messages.length + 1}',
        sender: sender!,
        sentAt: sentAt!,
        text: text,
      ));
    }
    sender = null;
    sentAt = null;
    lines = <String>[];
  }

  final String normalized =
      input.startsWith('\uFEFF') ? input.substring(1) : input;
  for (final String rawLine in normalized.split(RegExp(r'\r?\n'))) {
    final String line = rawLine.trimRight();
    if (line.contains('\u0000')) {
      rejected.add(line);
      continue;
    }
    final RegExpMatch? match = _qqHeader.firstMatch(line.trim());
    if (match != null) {
      final DateTime? parsed =
          DateTime.tryParse('${match.group(1)}T${match.group(2)}+08:00');
      if (parsed != null) {
        flush();
        sender = match.group(3)!.trim();
        sentAt = parsed.toUtc().toIso8601String();
        continue;
      }
    }
    if (sender != null && line.trim().isNotEmpty) {
      lines.add(line.trim());
    } else if (sender == null && line.trim().isNotEmpty) {
      rejected.add(line);
    }
  }
  flush();
  if (messages.isEmpty) {
    throw const FormatException('没有可导入的消息，请检查 QQ 导出格式');
  }
  return QqChatImport(messages: messages, rejected: rejected);
}

List<ZhishuFeedItem> buildZhishuDaily(
  List<ZhishuFeedItem> items, {
  List<String> focusTopics = const <String>[],
  int perSource = 2,
  int limit = 10,
}) {
  final Set<String> focus = focusTopics.toSet();
  final List<ZhishuFeedItem> sorted =
      items.where((ZhishuFeedItem item) => !item.ignored).toList()
        ..sort((ZhishuFeedItem left, ZhishuFeedItem right) {
          final int focusDelta = (focus.contains(right.topic) ? 1 : 0) -
              (focus.contains(left.topic) ? 1 : 0);
          if (focusDelta != 0) return focusDelta;
          final int timeDelta = right.publishedAt.compareTo(left.publishedAt);
          return timeDelta != 0 ? timeDelta : left.id.compareTo(right.id);
        });
  final Map<ZhishuSource, int> counts = <ZhishuSource, int>{};
  final List<ZhishuFeedItem> result = <ZhishuFeedItem>[];
  for (final ZhishuFeedItem item in sorted) {
    final int count = counts[item.source] ?? 0;
    if (count >= perSource) continue;
    counts[item.source] = count + 1;
    result.add(item);
    if (result.length >= limit) break;
  }
  return result;
}

List<ZhishuFeedItem> searchZhishuItems(
    List<ZhishuFeedItem> items, String query) {
  final String needle = query.trim().toLowerCase();
  return items.where((ZhishuFeedItem item) {
    if (item.ignored) return false;
    if (needle.isEmpty) return true;
    return <String>[item.title, item.excerpt, item.topic, item.source.name]
        .any((String value) => value.toLowerCase().contains(needle));
  }).toList();
}

String? normalizeZhishuUrl(String raw) {
  final Uri? url = Uri.tryParse(raw.trim());
  if (url == null ||
      url.scheme != 'https' ||
      url.host.isEmpty ||
      url.userInfo.isNotEmpty) {
    return null;
  }
  const Set<String> sessionKeys = <String>{
    'token',
    'sid',
    'scene',
    'chksm',
    'srcid',
    'exportkey',
    'signature',
    'sig',
    'key',
  };
  final Map<String, String> query =
      Map<String, String>.from(url.queryParameters)
        ..removeWhere((String key, String _) =>
            sessionKeys.contains(key.toLowerCase()) ||
            key.toLowerCase().startsWith('utm_'));
  return url.replace(queryParameters: query).toString();
}

final class ZhishuAnswer {
  const ZhishuAnswer({required this.answer, required this.references});
  final String answer;
  final List<ZhishuFeedItem> references;
}

ZhishuAnswer answerFromWorkspace(ZhishuWorkspace workspace, String query) {
  final List<ZhishuFeedItem> references =
      searchZhishuItems(workspace.items, query).take(3).toList();
  if (query.trim().isEmpty) {
    return const ZhishuAnswer(
      answer: '输入关键词后，JARVIS 会检索本机工作区并给出引用。',
      references: <ZhishuFeedItem>[],
    );
  }
  if (references.isEmpty) {
    return const ZhishuAnswer(
      answer: '本地检索没有找到相关内容。可以换关键词，或先导入文章、知乎条目和 QQ 消息。',
      references: <ZhishuFeedItem>[],
    );
  }
  return ZhishuAnswer(
    answer: '本地检索找到 ${references.length} 条相关内容；以下答案只来自这些引用，未调用大模型。',
    references: references,
  );
}

ZhishuWorkspace saveFeedItemToMaterials(
    ZhishuWorkspace workspace, ZhishuFeedItem item) {
  final String id = 'material-${item.id}';
  if (workspace.materials.any((ZhishuMaterial material) => material.id == id)) {
    return workspace;
  }
  return workspace.copyWith(materials: <ZhishuMaterial>[
    ZhishuMaterial(
      id: id,
      title: item.title,
      content: item.excerpt,
      createdAt: DateTime.now().toUtc().toIso8601String(),
      sourceUrl: item.url == null ? null : normalizeZhishuUrl(item.url!),
    ),
    ...workspace.materials,
  ]);
}

List<ZhishuFeedItem> demoZhishuItems() => <ZhishuFeedItem>[
      _demoItem('demo-zhihu-1', ZhishuSource.zhihu, '【演示】信息论学习路线',
          '从课程基础到科研入门的资料索引', '学习'),
      _demoItem('demo-wechat-1', ZhishuSource.wechat, '【演示】信息学院讲座通知',
          '明天 14:00，信息学院 1-101', '学术'),
      _demoItem('demo-qq-1', ZhishuSource.qq, '【演示】课程群活动提醒', '报名截止本周五，请自行核对原消息',
          '活动'),
      _demoItem('demo-mail-1', ZhishuSource.mail, '【演示】校园邮箱周报',
          '三封邮件中包含两个待确认活动', '校园'),
    ];

ZhishuFeedItem _demoItem(
  String id,
  ZhishuSource source,
  String title,
  String excerpt,
  String topic,
) =>
    ZhishuFeedItem(
      id: id,
      source: source,
      title: title,
      excerpt: excerpt,
      topic: topic,
      url: source == ZhishuSource.zhihu
          ? 'https://www.zhihu.com/question/1?token=demo'
          : null,
      publishedAt: '2026-11-23T01:00:00.000Z',
    );
