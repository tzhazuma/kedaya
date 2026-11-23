import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/zhishu_workspace.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/zhishu_providers.dart';

class ZhishuHomePage extends StatelessWidget {
  const ZhishuHomePage({super.key});

  static const List<(String, String, String, IconData)> _features =
      <(String, String, String, IconData)>[
    (
      '日报',
      '按关注话题整理校园邮件、公众号、知乎与 QQ 导入内容。',
      '/zhishu/daily',
      Icons.newspaper_outlined
    ),
    ('JARVIS', '检索本机工作区，回答附带引用；未配置模型时不伪装成 AI。', '/zhishu/jarvis', Icons.search),
    ('资料库', '保存笔记与来源摘要，支持搜索和删除。', '/zhishu/materials', Icons.folder_outlined),
    ('知乎', '管理手动添加的推荐与反推荐条目，可存入资料库。', '/zhishu/zhihu', Icons.bookmark_outline),
    (
      'QQ 聊天',
      '导入自己的聊天文本，提取到日报；不控制或结束 QQ 进程。',
      '/zhishu/qq',
      Icons.chat_outlined
    ),
  ];

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('知枢工作台')),
        body: ListView(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          children: <Widget>[
            const Card(
              child: Padding(
                padding: EdgeInsets.all(KedaYaTokens.space4),
                child: Text('日报、检索、资料与消息导入共享一份本机工作区。内置条目标有演示；在线同步需要授权来源。'),
              ),
            ),
            for (final (
                  String title,
                  String description,
                  String path,
                  IconData icon
                ) in _features)
              Card(
                child: ListTile(
                  leading: Icon(icon),
                  title: Text(title),
                  subtitle: Text(description),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.push(path),
                ),
              ),
          ],
        ),
      );
}

class ZhishuFeedCard extends StatelessWidget {
  const ZhishuFeedCard(
      {required this.item, this.onIgnore, this.onSave, super.key});

  final ZhishuFeedItem item;
  final VoidCallback? onIgnore;
  final VoidCallback? onSave;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(item.title, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: KedaYaTokens.space2),
              Text(
                  '${item.source.label} · ${item.topic} · ${item.publishedAt.substring(0, 10)}'),
              const SizedBox(height: KedaYaTokens.space2),
              Text(item.excerpt),
              if (onSave != null || onIgnore != null)
                OverflowBar(
                  children: <Widget>[
                    if (onSave != null)
                      TextButton(onPressed: onSave, child: const Text('存入资料库')),
                    if (onIgnore != null)
                      TextButton(onPressed: onIgnore, child: const Text('忽略')),
                  ],
                ),
            ],
          ),
        ),
      );
}

class ZhishuDailyPage extends ConsumerStatefulWidget {
  const ZhishuDailyPage({super.key});

  @override
  ConsumerState<ZhishuDailyPage> createState() => _ZhishuDailyPageState();
}

class _ZhishuDailyPageState extends ConsumerState<ZhishuDailyPage> {
  final TextEditingController _query = TextEditingController();
  static const List<String> _topics = <String>['学术', '学习', '活动', '校园'];

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ZhishuWorkspace workspace = ref.watch(zhishuWorkspaceProvider);
    final ZhishuWorkspaceController controller =
        ref.read(zhishuWorkspaceProvider.notifier);
    final List<ZhishuFeedItem> daily = searchZhishuItems(
      buildZhishuDaily(workspace.items,
          focusTopics: workspace.focusTopics, limit: 20),
      _query.text,
    );
    return Scaffold(
      appBar: AppBar(title: const Text('知枢日报')),
      body: ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          const Text('固定关注话题'),
          Wrap(
            spacing: KedaYaTokens.space2,
            children: _topics
                .map((String topic) => ChoiceChip(
                      label: Text(topic),
                      selected: workspace.focusTopics.contains(topic),
                      onSelected: (_) => controller
                          .update((ZhishuWorkspace current) => current.copyWith(
                                focusTopics: current.focusTopics.contains(topic)
                                    ? current.focusTopics
                                        .where((String item) => item != topic)
                                        .toList()
                                    : <String>[...current.focusTopics, topic],
                              )),
                    ))
                .toList(),
          ),
          TextField(
            controller: _query,
            decoration: const InputDecoration(labelText: '检索今日内容'),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: KedaYaTokens.space4),
          if (daily.isEmpty) const Text('没有匹配的日报条目，请换关键词或先导入内容。'),
          for (final ZhishuFeedItem item in daily)
            ZhishuFeedCard(
              item: item,
              onSave: () => controller.update(
                (ZhishuWorkspace current) =>
                    saveFeedItemToMaterials(current, item),
              ),
              onIgnore: () => controller
                  .update((ZhishuWorkspace current) => current.copyWith(
                        items: current.items
                            .map((ZhishuFeedItem entry) => entry.id == item.id
                                ? entry.copyWith(ignored: true)
                                : entry)
                            .toList(),
                      )),
            ),
        ],
      ),
    );
  }
}

class ZhishuJarvisPage extends ConsumerStatefulWidget {
  const ZhishuJarvisPage({super.key});

  @override
  ConsumerState<ZhishuJarvisPage> createState() => _ZhishuJarvisPageState();
}

class _ZhishuJarvisPageState extends ConsumerState<ZhishuJarvisPage> {
  final TextEditingController _query = TextEditingController();
  ZhishuAnswer? _result;

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ZhishuWorkspace workspace = ref.watch(zhishuWorkspaceProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('JARVIS')),
      body: ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          const Text('本机检索助手：回答必须能回到工作区里的引用。'),
          TextField(
            controller: _query,
            decoration: const InputDecoration(
                labelText: '问题关键词', hintText: '例如：信息论、讲座、报名'),
            onSubmitted: (_) => setState(
                () => _result = answerFromWorkspace(workspace, _query.text)),
          ),
          const SizedBox(height: KedaYaTokens.space3),
          FilledButton(
            onPressed: () => setState(
                () => _result = answerFromWorkspace(workspace, _query.text)),
            child: const Text('本地检索'),
          ),
          if (_result != null) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space4),
            Text(_result!.answer),
            for (final ZhishuFeedItem item in _result!.references)
              ZhishuFeedCard(item: item),
          ],
          const SizedBox(height: KedaYaTokens.space4),
          const Text('当前页面不调用大模型，不生成引用之外的事实。'),
        ],
      ),
    );
  }
}

class ZhishuMaterialsPage extends ConsumerStatefulWidget {
  const ZhishuMaterialsPage({super.key});

  @override
  ConsumerState<ZhishuMaterialsPage> createState() =>
      _ZhishuMaterialsPageState();
}

class _ZhishuMaterialsPageState extends ConsumerState<ZhishuMaterialsPage> {
  final TextEditingController _title = TextEditingController();
  final TextEditingController _content = TextEditingController();
  final TextEditingController _query = TextEditingController();

  @override
  void dispose() {
    _title.dispose();
    _content.dispose();
    _query.dispose();
    super.dispose();
  }

  void _add() {
    if (_title.text.trim().isEmpty || _content.text.trim().isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('请填写资料标题和正文')));
      return;
    }
    ref
        .read(zhishuWorkspaceProvider.notifier)
        .update((ZhishuWorkspace current) {
      final ZhishuMaterial material = ZhishuMaterial(
        id: 'material-local-${DateTime.now().microsecondsSinceEpoch}',
        title: _title.text.trim(),
        content: _content.text.trim(),
        createdAt: DateTime.now().toUtc().toIso8601String(),
        sourceUrl: null,
      );
      return current.copyWith(
          materials: <ZhishuMaterial>[material, ...current.materials]);
    });
    _title.clear();
    _content.clear();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final ZhishuWorkspace workspace = ref.watch(zhishuWorkspaceProvider);
    final String needle = _query.text.trim().toLowerCase();
    final List<ZhishuMaterial> materials = workspace.materials
        .where((ZhishuMaterial item) =>
            '${item.title}\n${item.content}'.toLowerCase().contains(needle))
        .toList();
    return Scaffold(
      appBar: AppBar(title: const Text('资料库')),
      body: ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          TextField(
              controller: _title,
              decoration: const InputDecoration(labelText: '标题')),
          TextField(
            controller: _content,
            decoration: const InputDecoration(labelText: '正文'),
            maxLines: 4,
          ),
          const SizedBox(height: KedaYaTokens.space3),
          FilledButton(onPressed: _add, child: const Text('保存资料')),
          TextField(
            controller: _query,
            decoration: const InputDecoration(labelText: '搜索资料'),
            onChanged: (_) => setState(() {}),
          ),
          if (materials.isEmpty) const Text('还没有资料，请新建或从日报和知乎保存。'),
          for (final ZhishuMaterial item in materials)
            Card(
              child: ListTile(
                title: Text(item.title),
                subtitle: Text(item.content),
                trailing: IconButton(
                  tooltip: '删除',
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () => ref
                      .read(zhishuWorkspaceProvider.notifier)
                      .update(
                        (ZhishuWorkspace current) => current.copyWith(
                          materials: current.materials
                              .where(
                                  (ZhishuMaterial entry) => entry.id != item.id)
                              .toList(),
                        ),
                      ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class ZhishuZhihuPage extends ConsumerStatefulWidget {
  const ZhishuZhihuPage({super.key});

  @override
  ConsumerState<ZhishuZhihuPage> createState() => _ZhishuZhihuPageState();
}

class _ZhishuZhihuPageState extends ConsumerState<ZhishuZhihuPage> {
  final TextEditingController _title = TextEditingController();
  final TextEditingController _url = TextEditingController();

  @override
  void dispose() {
    _title.dispose();
    _url.dispose();
    super.dispose();
  }

  void _add() {
    final String title = _title.text.trim();
    final String? url =
        _url.text.trim().isEmpty ? null : normalizeZhishuUrl(_url.text);
    if (title.isEmpty || (_url.text.trim().isNotEmpty && url == null)) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('请填写标题和有效的 https 链接')));
      return;
    }
    final ZhishuFeedItem item = ZhishuFeedItem(
      id: 'zhihu-local-${DateTime.now().microsecondsSinceEpoch}',
      source: ZhishuSource.zhihu,
      title: title,
      excerpt: '用户手动添加的知乎条目；未在线读取正文。',
      topic: '知乎',
      url: url,
      publishedAt: DateTime.now().toUtc().toIso8601String(),
    );
    ref.read(zhishuWorkspaceProvider.notifier).update(
          (ZhishuWorkspace current) =>
              current.copyWith(items: <ZhishuFeedItem>[item, ...current.items]),
        );
    _title.clear();
    _url.clear();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final ZhishuWorkspace workspace = ref.watch(zhishuWorkspaceProvider);
    final List<ZhishuFeedItem> items = workspace.items
        .where((ZhishuFeedItem item) =>
            item.source == ZhishuSource.zhihu && !item.ignored)
        .toList();
    return Scaffold(
      appBar: AppBar(title: const Text('知乎推荐与反推荐')),
      body: ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          const Text('管理手动添加的条目；本页不声称已同步知乎推荐流。'),
          TextField(
              controller: _title,
              decoration: const InputDecoration(labelText: '标题')),
          TextField(
              controller: _url,
              decoration: const InputDecoration(labelText: 'https 链接（可选）')),
          FilledButton(onPressed: _add, child: const Text('添加')),
          if (items.isEmpty) const Text('没有知乎条目。'),
          for (final ZhishuFeedItem item in items)
            ZhishuFeedCard(
              item: item,
              onSave: () => ref.read(zhishuWorkspaceProvider.notifier).update(
                    (ZhishuWorkspace current) =>
                        saveFeedItemToMaterials(current, item),
                  ),
              onIgnore: () => ref.read(zhishuWorkspaceProvider.notifier).update(
                    (ZhishuWorkspace current) => current.copyWith(
                      items: current.items
                          .map((ZhishuFeedItem entry) => entry.id == item.id
                              ? entry.copyWith(ignored: true)
                              : entry)
                          .toList(),
                    ),
                  ),
            ),
        ],
      ),
    );
  }
}

class ZhishuQqPage extends ConsumerStatefulWidget {
  const ZhishuQqPage({super.key});

  @override
  ConsumerState<ZhishuQqPage> createState() => _ZhishuQqPageState();
}

class _ZhishuQqPageState extends ConsumerState<ZhishuQqPage> {
  final TextEditingController _input = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  void _import() {
    try {
      ref.read(zhishuWorkspaceProvider.notifier).importQq(_input.text);
      _input.clear();
      setState(() => _error = null);
    } on Object catch (error) {
      setState(() => _error = '$error');
    }
  }

  @override
  Widget build(BuildContext context) {
    final ZhishuWorkspace workspace = ref.watch(zhishuWorkspaceProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('QQ 聊天导入')),
      body: ListView(
        padding: const EdgeInsets.all(KedaYaTokens.space4),
        children: <Widget>[
          const Text('只处理你主动粘贴的文本，不读取进程、不控制 QQ、不自动抓取群聊。'),
          const Text('消息头格式：2026-11-23 09:30:00 张三(10001)，下一行写正文；上限 500KB。'),
          TextField(
            controller: _input,
            decoration: const InputDecoration(labelText: '聊天记录'),
            maxLines: 6,
            maxLength: 500000,
          ),
          if (_error != null) Text(_error!),
          FilledButton(onPressed: _import, child: const Text('导入到工作区')),
          if (workspace.qqMessages.isEmpty) const Text('还没有导入消息。'),
          for (final QqChatMessage message in workspace.qqMessages)
            Card(
              child: ListTile(
                title: Text(message.sender),
                subtitle: Text(message.text),
                trailing: const Text('QQ'),
              ),
            ),
        ],
      ),
    );
  }
}
