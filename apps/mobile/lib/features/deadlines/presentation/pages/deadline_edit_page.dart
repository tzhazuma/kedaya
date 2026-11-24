import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../domain/models/deadline_item.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/deadlines_providers.dart';
import 'deadline_compose_page.dart';

/// 编辑既有 DDL：先按 id 从当前列表取数据，再复用新增表单。
///
/// 列表里找不到（已删除 / 被筛掉）时给出明确空态，而不是渲染一个空表单
/// 让用户以为自己在新建。
class DeadlineEditPage extends ConsumerWidget {
  const DeadlineEditPage({required this.itemId, super.key});

  final String itemId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final List<DeadlineItem>? items =
        ref.watch(deadlinesControllerProvider).valueOrNull;
    DeadlineItem? found;
    for (final DeadlineItem item in items ?? const <DeadlineItem>[]) {
      if (item.id == itemId) {
        found = item;
        break;
      }
    }
    if (found == null) {
      return KedaYaPageScaffold(
        title: '编辑 DDL',
        child: Center(
          child: Text(
            '找不到这条 DDL（可能已经被删除）',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              color: context.kedayaColors.textMuted,
            ),
          ),
        ),
      );
    }
    return DeadlineComposePage(initial: found);
  }
}
