import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/lost_found_item.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/lost_found_providers.dart';
import '../components/lost_found_card.dart';
import '../components/lost_found_empty.dart';

/// 失物招领列表：全部 / 寻物 / 招领 + 搜索 + 状态筛选。
class LostFoundPage extends ConsumerStatefulWidget {
  const LostFoundPage({super.key});

  @override
  ConsumerState<LostFoundPage> createState() => _LostFoundPageState();
}

class _LostFoundPageState extends ConsumerState<LostFoundPage> {
  final TextEditingController _search = TextEditingController();

  @override
  void initState() {
    super.initState();
    // 页面被重新创建时，搜索框与 provider 里保留的关键词保持一致。
    _search.text = ref.read(lostFoundFilterProvider).query;
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _resetFilters() {
    _search.clear();
    ref.read(lostFoundFilterProvider.notifier).reset();
  }

  @override
  Widget build(BuildContext context) {
    final LostFoundFilter filter = ref.watch(lostFoundFilterProvider);
    final List<LostFoundItem> visible = ref.watch(visibleLostFoundProvider);
    final DateTime now = ref.watch(lostFoundClockProvider)();

    return KedaYaPageScaffold(
      title: '失物招领',
      padding: EdgeInsets.zero,
      child: Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(
              KedaYaTokens.space4,
              KedaYaTokens.space3,
              KedaYaTokens.space4,
              0,
            ),
            child: TextField(
              controller: _search,
              textInputAction: TextInputAction.search,
              onChanged: (String value) =>
                  ref.read(lostFoundFilterProvider.notifier).setQuery(value),
              decoration: InputDecoration(
                hintText: '搜索标题或地点',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _search.text.isEmpty
                    ? null
                    : IconButton(
                        tooltip: '清空搜索',
                        onPressed: () {
                          _search.clear();
                          ref
                              .read(lostFoundFilterProvider.notifier)
                              .setQuery('');
                        },
                        icon: const Icon(Icons.close),
                      ),
                border: const OutlineInputBorder(),
                isDense: true,
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              KedaYaTokens.space4,
              KedaYaTokens.space3,
              KedaYaTokens.space4,
              0,
            ),
            child: SizedBox(
              width: double.infinity,
              child: SegmentedButton<LostFoundKindFilter>(
                showSelectedIcon: false,
                segments: <ButtonSegment<LostFoundKindFilter>>[
                  for (final LostFoundKindFilter kind
                      in LostFoundKindFilter.values)
                    ButtonSegment<LostFoundKindFilter>(
                      value: kind,
                      label: Text(kind.label),
                    ),
                ],
                selected: <LostFoundKindFilter>{filter.kind},
                onSelectionChanged: (Set<LostFoundKindFilter> selection) {
                  if (selection.isEmpty) return;
                  ref
                      .read(lostFoundFilterProvider.notifier)
                      .selectKind(selection.first);
                },
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              KedaYaTokens.space4,
              KedaYaTokens.space2,
              KedaYaTokens.space4,
              0,
            ),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Wrap(
                spacing: KedaYaTokens.space2,
                runSpacing: KedaYaTokens.space2,
                children: <Widget>[
                  for (final LostFoundStatusFilter status
                      in LostFoundStatusFilter.values)
                    ChoiceChip(
                      label: Text(status.label),
                      selected: filter.status == status,
                      onSelected: (bool _) => ref
                          .read(lostFoundFilterProvider.notifier)
                          .selectStatus(status),
                    ),
                ],
              ),
            ),
          ),
          Expanded(
            child: visible.isEmpty
                ? LostFoundEmpty(
                    hasFilter: filter.isActive,
                    onReset: filter.isActive ? _resetFilters : null,
                  )
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(
                      KedaYaTokens.space4,
                      KedaYaTokens.space3,
                      KedaYaTokens.space4,
                      KedaYaTokens.space3,
                    ),
                    itemCount: visible.length,
                    separatorBuilder: (BuildContext context, int index) =>
                        const SizedBox(height: KedaYaTokens.space3),
                    itemBuilder: (BuildContext context, int index) {
                      final LostFoundItem item = visible[index];
                      return LostFoundCard(
                        item: item,
                        now: now,
                        onTap: () => context.push('/lost-found/${item.id}'),
                      );
                    },
                  ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              KedaYaTokens.space4,
              KedaYaTokens.space2,
              KedaYaTokens.space4,
              KedaYaTokens.space4,
            ),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: () => context.push('/lost-found/new'),
                icon: const Icon(Icons.add),
                label: const Text('发布信息'),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
