import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/flea_listing.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/flea_market_providers.dart';
import '../components/flea_listing_card.dart';

/// 跳蚤市场列表（`/flea-market`）。
///
/// 顶部三件事：范围（全部 / 我的）、搜索、分类；排序在 AppBar 上。
/// 「全部」只显示在架条目，「我的」显示自己的全部条目（含已下架）并可下架 / 重新上架。
/// 所有规则都在 [visibleFleaListings] 里，页面不复制一份。
class FleaMarketPage extends ConsumerStatefulWidget {
  const FleaMarketPage({super.key});

  @override
  ConsumerState<FleaMarketPage> createState() => _FleaMarketPageState();
}

class _FleaMarketPageState extends ConsumerState<FleaMarketPage> {
  final TextEditingController _search = TextEditingController();

  FleaScope _scope = FleaScope.browse;
  FleaCategory? _category;
  FleaSort _sort = FleaSort.newest;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _snack(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  void _toggleListing(FleaListing listing) {
    final bool next = !listing.active;
    try {
      ref.read(fleaMarketListingsProvider.notifier).setActive(listing.id, next);
      _snack(next ? '已重新上架' : '已下架，别人在「全部」里看不到这条了');
    } on Object catch (error) {
      _snack('$error');
    }
  }

  @override
  Widget build(BuildContext context) {
    final List<FleaListing> all = ref.watch(fleaMarketListingsProvider);
    final DateTime now = ref.watch(fleaMarketClockProvider)();
    final List<FleaListing> visible = visibleFleaListings(
      all,
      scope: _scope,
      category: _category,
      query: _search.text,
      sort: _sort,
    );
    final bool hasMine = all.any((FleaListing it) => it.isMine);

    return Scaffold(
      appBar: AppBar(
        title: const Text('跳蚤市场'),
        actions: <Widget>[
          _SortMenu(
            sort: _sort,
            onSelected: (FleaSort next) => setState(() => _sort = next),
          ),
          const SizedBox(width: KedaYaTokens.space1),
        ],
      ),
      body: SafeArea(
        top: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(
                KedaYaTokens.space4,
                KedaYaTokens.space3,
                KedaYaTokens.space4,
                0,
              ),
              child: Text(
                '校内二手 · 当面验货再付款',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  color: context.kedayaColors.textMuted,
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
              child: SegmentedButton<FleaScope>(
                segments: <ButtonSegment<FleaScope>>[
                  for (final FleaScope scope in FleaScope.values)
                    ButtonSegment<FleaScope>(
                      value: scope,
                      label: Text(scope.label),
                    ),
                ],
                selected: <FleaScope>{_scope},
                showSelectedIcon: false,
                style: const ButtonStyle(
                  visualDensity: VisualDensity.compact,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                onSelectionChanged: (Set<FleaScope> selection) =>
                    setState(() => _scope = selection.first),
              ),
            ),
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
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  isDense: true,
                  hintText: '搜标题、描述或地点',
                  prefixIcon: const Icon(Icons.search, size: 20),
                  suffixIcon: _search.text.isEmpty
                      ? null
                      : IconButton(
                          tooltip: '清空搜索',
                          icon: const Icon(Icons.close, size: 18),
                          onPressed: () {
                            _search.clear();
                            setState(() {});
                          },
                        ),
                  border: OutlineInputBorder(
                    borderRadius:
                        BorderRadius.circular(KedaYaTokens.radiusPill),
                  ),
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
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: <Widget>[
                          _categoryChip(null, '全部'),
                          for (final FleaCategory category
                              in FleaCategory.values) ...<Widget>[
                            const SizedBox(width: KedaYaTokens.space2),
                            _categoryChip(category, category.label),
                          ],
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: KedaYaTokens.space2),
                  Text(
                    '${visible.length} 件',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: context.kedayaColors.textMuted,
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: visible.isEmpty
                  ? KedaYaEmptyState(
                      title: _emptyTitle(hasMine),
                      description: _emptyDescription(hasMine),
                      icon: Icons.storefront_outlined,
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(
                        KedaYaTokens.space4,
                        KedaYaTokens.space3,
                        KedaYaTokens.space4,
                        KedaYaTokens.space8,
                      ),
                      itemCount: visible.length,
                      separatorBuilder: (BuildContext context, int index) =>
                          const SizedBox(height: KedaYaTokens.space3),
                      itemBuilder: (BuildContext context, int index) {
                        final FleaListing listing = visible[index];
                        return FleaListingCard(
                          listing: listing,
                          now: now,
                          onTap: () =>
                              context.push('/flea-market/${listing.id}'),
                          action: _scope == FleaScope.mine
                              ? OutlinedButton.icon(
                                  onPressed: () => _toggleListing(listing),
                                  icon: Icon(
                                    listing.active
                                        ? Icons.visibility_off_outlined
                                        : Icons.refresh,
                                    size: 16,
                                  ),
                                  label: Text(
                                    listing.active ? '下架' : '重新上架',
                                  ),
                                )
                              : null,
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: const _DemoFooter(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/flea-market/new'),
        icon: const Icon(Icons.add),
        label: const Text('发布闲置'),
      ),
    );
  }

  Widget _categoryChip(FleaCategory? category, String label) => ChoiceChip(
        label: Text(label),
        selected: _category == category,
        showCheckmark: false,
        visualDensity: VisualDensity.compact,
        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        onSelected: (bool _) => setState(() => _category = category),
      );

  String _emptyTitle(bool hasMine) {
    if (_scope == FleaScope.mine && !hasMine) return '你还没有发布闲置';
    return '没有符合条件的闲置';
  }

  String _emptyDescription(bool hasMine) {
    if (_scope == FleaScope.mine && !hasMine) {
      return '点右下角「发布闲置」，把宿舍里用不上的东西挂出来。';
    }
    return '换个分类或关键词试试；也可以点右下角发布一条。';
  }
}

/// 排序菜单：标题旁始终显示当前排序，避免"我到底按什么排的"。
class _SortMenu extends StatelessWidget {
  const _SortMenu({required this.sort, required this.onSelected});

  final FleaSort sort;
  final ValueChanged<FleaSort> onSelected;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return PopupMenuButton<FleaSort>(
      tooltip: '排序方式',
      initialValue: sort,
      onSelected: onSelected,
      itemBuilder: (BuildContext context) => <PopupMenuEntry<FleaSort>>[
        for (final FleaSort option in FleaSort.values)
          PopupMenuItem<FleaSort>(
            value: option,
            child: Row(
              children: <Widget>[
                SizedBox(
                  width: 20,
                  child: option == sort
                      ? Icon(Icons.check, size: 16, color: colors.brandStrong)
                      : null,
                ),
                Text(option.label),
              ],
            ),
          ),
      ],
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: KedaYaTokens.space2),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(Icons.swap_vert, size: 18, color: colors.textMuted),
            const SizedBox(width: 2),
            Text(
              sort.label,
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeSm,
                color: colors.text,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 页面底部的诚实标注：这不是线上数据。固定底栏，永远可见。
class _DemoFooter extends StatelessWidget {
  const _DemoFooter();

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        border: Border(top: BorderSide(color: colors.border)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: KedaYaTokens.space4,
            vertical: KedaYaTokens.space2,
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Icon(Icons.science_outlined, size: 14, color: colors.textMuted),
              const SizedBox(width: KedaYaTokens.space1),
              Text(
                '演示数据 · 仅本机保存',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  color: colors.textMuted,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
