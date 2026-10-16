import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_providers.dart';
import '../../../../data/mock/mock_controls.dart';
import '../../../../domain/models/faq.dart';
import '../../../../presentation/components/async_state_view.dart';
import '../../../../presentation/components/mock_state_menu.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/faq_providers.dart';
import '../components/faq_article_tile.dart';

/// 常见问题首页：**分类导航 + 搜索 + 手风琴展开**。
///
/// 检索无需登录（契约 §2.8 `SearchFaq`），三态由 [AsyncStateView] 统一渲染。
class FaqHomePage extends ConsumerStatefulWidget {
  const FaqHomePage({super.key});

  @override
  ConsumerState<FaqHomePage> createState() => _FaqHomePageState();
}

class _FaqHomePageState extends ConsumerState<FaqHomePage> {
  final TextEditingController _keyword = TextEditingController();

  /// 输入防抖：每敲一个字都发一次请求没有意义（也浪费后端配额）。
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _keyword.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<FaqListState> value = ref.watch(faqListControllerProvider);
    final FaqFilter filter = ref.watch(faqFilterProvider);
    final MockControls? mockControls = ref.watch(mockControlsProvider);
    final FaqListController controller = ref.read(faqListControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: const Text('常见问题'),
        actions: <Widget>[
          if (mockControls != null)
            MockStateMenu(
              controls: mockControls,
              onChanged: () => ref.invalidate(faqListControllerProvider),
            ),
          IconButton(
            tooltip: '我的工单',
            onPressed: () => context.push('/faq/tickets'),
            icon: const Icon(Icons.confirmation_number_outlined),
          ),
          IconButton(
            tooltip: '刷新',
            onPressed: () => controller.refresh(),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: Column(
        children: <Widget>[
          _SearchField(
            controller: _keyword,
            onChanged: _onKeywordChanged,
            onClear: () {
              _keyword.clear();
              _onKeywordChanged('');
            },
          ),
          const _CategoryBar(),
          const Divider(height: 1),
          Expanded(
            child: RefreshIndicator(
              onRefresh: controller.refresh,
              child: AsyncStateView<FaqListState>(
                value: value,
                isEmpty: (FaqListState state) => state.isEmpty,
                emptyTitle: filter.isSearching ? '没有找到相关问题' : '这个分类还没有内容',
                emptyDescription: filter.isSearching
                    ? '换个更短的关键词试试，或者去「我的工单」里直接提问。'
                    : '换个分类看看，或者去「我的工单」里直接提问。',
                loadingMessage: '正在加载常见问题…',
                onRetry: controller.refresh,
                builder: (BuildContext context, FaqListState state) => ListView.separated(
                  padding: const EdgeInsets.all(KedaYaTokens.space4),
                  itemCount: state.articles.length + 1,
                  separatorBuilder: (BuildContext context, int index) =>
                      const SizedBox(height: KedaYaTokens.space2),
                  itemBuilder: (BuildContext context, int index) {
                    if (index == state.articles.length) {
                      return _ListFooter(state: state, controller: controller);
                    }
                    return FaqArticleTile(article: state.articles[index]);
                  },
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _onKeywordChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (!mounted) return;
      ref.read(faqFilterProvider.notifier).setKeyword(value);
    });
  }
}

class _SearchField extends StatelessWidget {
  const _SearchField({
    required this.controller,
    required this.onChanged,
    required this.onClear,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        KedaYaTokens.space4,
        KedaYaTokens.space3,
        KedaYaTokens.space4,
        KedaYaTokens.space2,
      ),
      child: TextField(
        controller: controller,
        textInputAction: TextInputAction.search,
        onChanged: onChanged,
        onSubmitted: onChanged,
        style: TextStyle(fontSize: KedaYaTokens.fontSizeSm, color: colors.text),
        decoration: InputDecoration(
          hintText: '搜索问题关键词，例如「登录」「匿名」',
          hintStyle: TextStyle(color: colors.textMuted, fontSize: KedaYaTokens.fontSizeSm),
          prefixIcon: Icon(Icons.search, color: colors.textMuted),
          suffixIcon: IconButton(
            tooltip: '清空',
            onPressed: onClear,
            icon: Icon(Icons.close, color: colors.textMuted),
          ),
          isDense: true,
          filled: true,
          fillColor: colors.surfaceAlt,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
            borderSide: BorderSide(color: colors.border),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
            borderSide: BorderSide(color: colors.border),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(KedaYaTokens.radiusMd),
            borderSide: BorderSide(color: colors.brandStrong),
          ),
        ),
      ),
    );
  }
}

/// 分类导航条。
class _CategoryBar extends ConsumerWidget {
  const _CategoryBar();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final AsyncValue<List<FaqCategory>> categories = ref.watch(faqCategoriesProvider);
    final String? selected = ref.watch(faqFilterProvider).category;
    final FaqFilterNotifier filter = ref.read(faqFilterProvider.notifier);
    final List<FaqCategory> list = categories.valueOrNull ?? const <FaqCategory>[];

    if (categories.hasError && list.isEmpty) {
      // 分类拉取失败不挡住文章列表。
      return SizedBox(
        height: 48,
        child: Row(
          children: <Widget>[
            const SizedBox(width: KedaYaTokens.space4),
            Text(
              '分类加载失败',
              style: TextStyle(fontSize: KedaYaTokens.fontSizeXs, color: colors.danger),
            ),
            TextButton(
              onPressed: () => ref.invalidate(faqCategoriesProvider),
              child: const Text('重试'),
            ),
          ],
        ),
      );
    }

    return SizedBox(
      height: 52,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
          horizontal: KedaYaTokens.space4,
          vertical: KedaYaTokens.space2,
        ),
        children: <Widget>[
          _CategoryChip(
            label: '全部',
            selected: selected == null,
            onSelected: () => filter.selectCategory(null),
          ),
          for (final FaqCategory category in list) ...<Widget>[
            const SizedBox(width: KedaYaTokens.space2),
            _CategoryChip(
              label: category.name,
              selected: selected == category.id,
              onSelected: () => filter.selectCategory(category.id),
            ),
          ],
        ],
      ),
    );
  }
}

class _CategoryChip extends StatelessWidget {
  const _CategoryChip({
    required this.label,
    required this.selected,
    required this.onSelected,
  });

  final String label;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: (bool _) => onSelected(),
      showCheckmark: false,
      backgroundColor: colors.surfaceAlt,
      selectedColor: colors.brandSoft,
      side: BorderSide(color: colors.border),
      labelStyle: TextStyle(
        fontSize: KedaYaTokens.fontSizeSm,
        fontWeight: selected ? KedaYaTokens.fontWeightSemibold : KedaYaTokens.fontWeightRegular,
        color: selected ? colors.brandStrong : colors.textMuted,
      ),
    );
  }
}

class _ListFooter extends StatelessWidget {
  const _ListFooter({required this.state, required this.controller});

  final FaqListState state;
  final FaqListController controller;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    if (state.loadMoreError != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: KedaYaTokens.space3),
        child: Column(
          children: <Widget>[
            Text(
              '加载更多失败：${state.loadMoreError}',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: KedaYaTokens.fontSizeSm, color: colors.danger),
            ),
            const SizedBox(height: KedaYaTokens.space2),
            OutlinedButton(
              onPressed: () => controller.loadMore(),
              child: const Text('重试'),
            ),
          ],
        ),
      );
    }
    if (state.isLoadingMore) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: KedaYaTokens.space3),
        child: KedaYaLoadingState(),
      );
    }
    if (state.hasMore) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: KedaYaTokens.space3),
        child: Center(
          child: OutlinedButton(
            onPressed: () => controller.loadMore(),
            child: const Text('加载更多'),
          ),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: KedaYaTokens.space3),
      child: Center(
        child: Text(
          state.total == null ? '没有更多了' : '共 ${state.total} 条 · 没有更多了',
          style: TextStyle(fontSize: KedaYaTokens.fontSizeXs, color: colors.textMuted),
        ),
      ),
    );
  }
}
