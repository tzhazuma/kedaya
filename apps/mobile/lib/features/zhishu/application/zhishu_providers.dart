import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/app_providers.dart';
import '../../../data/repositories/local_zhishu_repository.dart';
import '../../../domain/models/zhishu_workspace.dart';

final zhishuWorkspaceProvider =
    NotifierProvider<ZhishuWorkspaceController, ZhishuWorkspace>(
  ZhishuWorkspaceController.new,
);

final class ZhishuWorkspaceController extends Notifier<ZhishuWorkspace> {
  LocalZhishuRepository? _repository;

  LocalZhishuRepository get repository =>
      _repository ??= LocalZhishuRepository(ref.read(localCacheProvider));

  @override
  ZhishuWorkspace build() {
    ref.watch(localCacheProvider);
    final ZhishuWorkspace stored = repository.read();
    final bool empty = stored.items.isEmpty &&
        stored.materials.isEmpty &&
        stored.qqMessages.isEmpty;
    return empty
        ? ZhishuWorkspace(
            items: demoZhishuItems(),
            focusTopics: const <String>['学术', '学习'],
          )
        : stored;
  }

  void update(ZhishuWorkspace Function(ZhishuWorkspace current) change) {
    state = change(state);
    unawaited(repository.write(state));
  }

  void importQq(String input) {
    final QqChatImport imported = parseQqChatExport(input);
    final int stamp = DateTime.now().microsecondsSinceEpoch;
    final List<QqChatMessage> messages = imported.messages
        .asMap()
        .entries
        .map((MapEntry<int, QqChatMessage> entry) => QqChatMessage(
              id: 'qq-local-$stamp-${entry.key}',
              sender: entry.value.sender,
              sentAt: entry.value.sentAt,
              text: entry.value.text,
            ))
        .toList();
    final List<ZhishuFeedItem> feedItems = messages
        .map((QqChatMessage message) => ZhishuFeedItem(
              id: 'feed-${message.id}',
              source: ZhishuSource.qq,
              title: '${message.sender}的群消息',
              excerpt: message.text.length <= 200
                  ? message.text
                  : message.text.substring(0, 200),
              topic:
                  RegExp(r'讲座|活动|报名|会议').hasMatch(message.text) ? '活动' : '群聊',
              url: null,
              publishedAt: message.sentAt,
            ))
        .toList();
    update((ZhishuWorkspace current) => current.copyWith(
          qqMessages: <QqChatMessage>[...messages, ...current.qqMessages],
          items: <ZhishuFeedItem>[...feedItems, ...current.items],
        ));
  }
}
