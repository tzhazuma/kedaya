import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/zhishu_workspace.dart';

void main() {
  test('QQ 导出解析发送人、多行消息与损坏行', () {
    final QqChatImport result = parseQqChatExport(
      '2026-11-23 09:30:00 张三(10001)\n明天有讲座\n第二行\n'
      '2026-11-23 09:31:00 李四\n欢迎\n坏行\u0000',
    );
    expect(result.messages, hasLength(2));
    expect(result.messages.first.sender, '张三');
    expect(result.messages.first.text, '明天有讲座\n第二行');
    expect(result.messages.first.sentAt, '2026-11-23T01:30:00.000Z');
    expect(result.rejected, hasLength(1));
  });

  test('日报排除忽略项、提升关注话题并限制来源数量', () {
    final List<ZhishuFeedItem> daily = buildZhishuDaily(<ZhishuFeedItem>[
      demoZhishuItems().first,
      demoZhishuItems().first.copyWith(id: 'focus', topic: '学术'),
      demoZhishuItems().first.copyWith(id: 'ignored', ignored: true),
      demoZhishuItems().first.copyWith(id: 'qq', source: ZhishuSource.qq),
    ], focusTopics: const <String>[
      '学术'
    ], perSource: 1);
    expect(daily.map((ZhishuFeedItem item) => item.id), contains('focus'));
    expect(daily.map((ZhishuFeedItem item) => item.id),
        isNot(contains('ignored')));
    expect(
        daily.where((ZhishuFeedItem item) => item.source == ZhishuSource.zhihu),
        hasLength(1));
  });

  test('JARVIS 回答只引用本地搜索结果', () {
    final ZhishuAnswer answer = answerFromWorkspace(
      ZhishuWorkspace(items: demoZhishuItems()),
      '信息论',
    );
    expect(answer.references.map((ZhishuFeedItem item) => item.id),
        contains('demo-zhihu-1'));
    expect(answer.answer, contains('本地检索'));
  });

  test('保存知乎资料去重并清洗链接', () {
    final ZhishuFeedItem item = demoZhishuItems().first;
    final ZhishuWorkspace once = saveFeedItemToMaterials(
        ZhishuWorkspace(items: <ZhishuFeedItem>[item]), item);
    final ZhishuWorkspace twice = saveFeedItemToMaterials(once, item);
    expect(twice.materials, hasLength(1));
    expect(twice.materials.first.sourceUrl, isNot(contains('token=')));
  });

  test('内置条目全部带演示标记', () {
    for (final ZhishuFeedItem item in demoZhishuItems()) {
      expect(item.title, contains('【演示】'));
    }
  });
}
