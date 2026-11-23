import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/data/mock/in_memory_stores.dart';
import 'package:kedaya/data/repositories/local_zhishu_repository.dart';
import 'package:kedaya/domain/models/zhishu_workspace.dart';

void main() {
  test('工作区写入后可读回，链接在落盘前清理', () async {
    final InMemoryCacheStore cache = InMemoryCacheStore();
    final LocalZhishuRepository repository = LocalZhishuRepository(cache);
    final ZhishuFeedItem item = demoZhishuItems().first;
    await repository.write(ZhishuWorkspace(
      items: <ZhishuFeedItem>[item],
      focusTopics: const <String>['学术'],
    ));

    final ZhishuWorkspace restored = repository.read();
    expect(restored.items.single.id, item.id);
    expect(restored.items.single.url, isNot(contains('token=')));
    expect(restored.focusTopics, <String>['学术']);
  });

  test('损坏缓存回退为空工作区', () async {
    final InMemoryCacheStore cache = InMemoryCacheStore();
    await cache.writeJson(zhishuWorkspaceStorageKey, 'not-a-map');
    final LocalZhishuRepository repository = LocalZhishuRepository(cache);
    expect(repository.read().items, isEmpty);
    expect(repository.read().materials, isEmpty);
  });
}
