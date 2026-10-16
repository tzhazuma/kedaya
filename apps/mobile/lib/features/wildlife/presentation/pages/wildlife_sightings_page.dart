import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_providers.dart';
import '../../../../data/mock/mock_controls.dart';
import '../../../../domain/models/wildlife.dart';
import '../../../../domain/models/wildlife_sighting.dart';
import '../../../../presentation/components/async_state_view.dart';
import '../../../../presentation/components/mock_state_menu.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/wildlife_providers.dart';
import '../components/wildlife_cards.dart';
import '../components/wildlife_species_filter.dart';

/// 观测记录列表（`GET /items`，**只含已发布**）。
///
/// 三态：loading / error / empty 由 [AsyncStateView] 统一渲染；
/// 翻页失败**不打死整页**（与 `groupbuy` / `forum` 同构）。
class WildlifeSightingsPage extends ConsumerWidget {
  const WildlifeSightingsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<WildlifeSightingListState> value = ref.watch(
      wildlifeSightingListControllerProvider,
    );
    final WildlifeSightingListController controller = ref.read(
      wildlifeSightingListControllerProvider.notifier,
    );
    final String? speciesId = ref.watch(wildlifeSpeciesFilterProvider);
    final List<WildlifeSpecies> species =
        ref.watch(wildlifeSpeciesProvider).valueOrNull ?? const <WildlifeSpecies>[];
    final MockControls? mockControls = ref.watch(mockControlsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('观测记录'),
        actions: <Widget>[
          if (mockControls != null)
            MockStateMenu(
              controls: mockControls,
              onChanged: () => ref.invalidate(wildlifeSightingListControllerProvider),
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
          const SizedBox(height: KedaYaTokens.space2),
          WildlifeSpeciesFilterBar(
            species: species,
            selectedSpeciesId: speciesId,
            onSelected: (String? id) =>
                ref.read(wildlifeSpeciesFilterProvider.notifier).select(id),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: controller.refresh,
              child: AsyncStateView<WildlifeSightingListState>(
                value: value,
                isEmpty: (WildlifeSightingListState state) => state.isEmpty,
                emptyTitle: '还没有观测记录',
                emptyDescription: '换个物种筛选，或者成为第一个上报的人。',
                loadingMessage: '正在加载观测记录…',
                onRetry: controller.refresh,
                builder: (BuildContext context, WildlifeSightingListState state) =>
                    ListView.separated(
                      padding: const EdgeInsets.all(KedaYaTokens.space4),
                      itemCount: state.sightings.length + 1,
                      separatorBuilder: (BuildContext context, int index) =>
                          const SizedBox(height: KedaYaTokens.space3),
                      itemBuilder: (BuildContext context, int index) {
                        if (index == state.sightings.length) {
                          return _ListFooter(state: state, controller: controller);
                        }
                        final WildlifeSighting sighting = state.sightings[index];
                        return WildlifeSightingCard(
                          sighting: sighting,
                          onTap: () => context.push('/wildlife/sightings/${sighting.id}'),
                        );
                      },
                    ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ListFooter extends StatelessWidget {
  const _ListFooter({required this.state, required this.controller});

  final WildlifeSightingListState state;
  final WildlifeSightingListController controller;

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
              onPressed: () => unawaited(controller.loadMore()),
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
            onPressed: () => unawaited(controller.loadMore()),
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
