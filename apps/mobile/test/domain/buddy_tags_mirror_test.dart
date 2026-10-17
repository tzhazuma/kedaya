import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/buddy_tags.dart';

/// 防漂移：Dart 镜像必须与唯一真相 `packages/contracts/src/buddy-tags.ts` 一致。
///
/// 生成器本身有 `--check`；这条测试是**第二道门** —— 它从 TS 源重新解析一遍，
/// 而不是复用生成器的输出，因此能抓住「生成器解析漏项但文件头仍写着 62」的情况。
void main() {
  final File source = File('../../packages/contracts/src/buddy-tags.ts');
  final String text = source.readAsStringSync();

  String sliceArray(String exportName) {
    final int marker = text.indexOf('export const $exportName');
    expect(marker, greaterThanOrEqualTo(0), reason: '源里必须有 $exportName');
    final int equals = text.indexOf('=', marker);
    final int open = text.indexOf('[', equals);
    int depth = 0;
    for (int i = open; i < text.length; i++) {
      if (text[i] == '[') depth++;
      if (text[i] == ']') {
        depth--;
        if (depth == 0) return text.substring(open + 1, i);
      }
    }
    fail('$exportName 数组没有闭合');
  }

  List<Map<String, String>> objects(String body) => RegExp(r'\{([^{}]*)\}')
          .allMatches(body)
          .map((RegExpMatch match) => match.group(1)!)
          .map((String item) {
        String? field(String name) =>
            RegExp("$name:\\s*'([^']*)'").firstMatch(item)?.group(1);
        final RegExpMatch? aliases = RegExp(
          r'aliases:\s*\[([^\]]*)\]',
        ).firstMatch(item);
        return <String, String>{
          'key': field('key') ?? '',
          'label': field('label') ?? '',
          'group': field('group') ?? '',
          'aliases': aliases == null
              ? ''
              : RegExp("'([^']*)'")
                  .allMatches(aliases.group(1)!)
                  .map((RegExpMatch m) => m.group(1)!)
                  .join('\u0001'),
          'isActive': item.contains('isActive: false') ? 'false' : 'true',
        };
      }).toList(growable: false);

  test('标签表：62 条，key / label / group / aliases / isActive 逐条一致', () {
    final List<Map<String, String>> tags = objects(sliceArray('BUDDY_TAGS'));
    expect(tags, hasLength(62), reason: 'BUDDY_TAGS 的唯一真相是 62 条');
    expect(buddyTagCatalog, hasLength(tags.length));

    for (final Map<String, String> expected in tags) {
      final BuddyTag? actual = buddyTagByKey[expected['key']];
      expect(actual, isNotNull, reason: '缺少标签 ${expected['key']}');
      expect(actual!.label, expected['label']);
      expect(actual.group.wire, expected['group']);
      expect(actual.aliases.join('\u0001'), expected['aliases']);
      expect(actual.isActive, expected['isActive'] == 'true');
    }
    expect(
      buddyTagCatalog.map((BuddyTag tag) => tag.key).toList(growable: false),
      tags.map((Map<String, String> tag) => tag['key']).toList(growable: false),
      reason: '顺序 = UI 展示顺序，必须与源一致',
    );
  });

  test('校园地点：25 条，label（wire value）逐条一致', () {
    final List<Map<String, String>> locations = objects(
      sliceArray('CAMPUS_LOCATION_DEFS'),
    );
    expect(locations, hasLength(25),
        reason: 'CAMPUS_LOCATION_DEFS 的唯一真相是 25 条');
    expect(buddyCampusLocationDefs, hasLength(locations.length));
    expect(buddyCampusLocations, hasLength(locations.length));
    for (int i = 0; i < locations.length; i++) {
      expect(buddyCampusLocationDefs[i].key, locations[i]['key']);
      expect(buddyCampusLocationDefs[i].label, locations[i]['label']);
      expect(buddyCampusLocations[i], locations[i]['label']);
    }
  });

  test('数量上限直接来自契约常量', () {
    int limit(String name) {
      final RegExpMatch? match = RegExp(
        'export const $name\\s*=\\s*(\\d+)\\s*;',
      ).firstMatch(text);
      expect(match, isNotNull, reason: '源里必须有 $name');
      return int.parse(match!.group(1)!);
    }

    expect(buddyInterestTagMaxCount, limit('MAX_INTEREST_TAGS'));
    expect(buddyActivityTagMaxCount, limit('MAX_ACTIVITY_TAGS'));
    expect(buddyPostTagMaxCount, limit('MAX_POST_TAGS'));
    expect(buddyPreferredAreaMaxCount, limit('MAX_PREFERRED_AREAS'));
  });

  test('生成文件头记录了正确的 source blob hash', () {
    final String generated = File(
      'lib/domain/models/buddy_tags.g.dart',
    ).readAsStringSync();
    expect(generated, contains('DO NOT EDIT'));
    expect(generated, contains('source-blob-sha1: '));

    final ProcessResult result = Process.runSync(
        'git',
        <String>[
          'hash-object',
          'packages/contracts/src/buddy-tags.ts',
        ],
        workingDirectory: '../..');
    if (result.exitCode != 0) return; // 无 git 的环境由脚本 --check 负责
    final String hash = (result.stdout as String).trim();
    expect(generated, contains('source-blob-sha1: $hash'));
  });
}
