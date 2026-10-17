import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_providers.dart';
import '../../../../data/mock/mock_controls.dart';
import '../../../../domain/models/wildlife.dart';
import '../../../../domain/models/wildlife_track.dart';
import '../../../../presentation/components/async_state_view.dart';
import '../../../../presentation/components/mock_state_menu.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/wildlife_providers.dart';
import '../components/wildlife_badges.dart';
import '../components/wildlife_cards.dart';
import '../components/wildlife_species_filter.dart';

/// 推断轨迹列表（规格 §6）。
///
/// ⚠️ 页面**顶部固定**显示"推断轨迹 · 非实测路径"，且每张卡片再带一次免责说明 ——
/// 规格 §6.1 明确要求「**所有面向用户的文案必须写"推断"**」，
/// 这条约束不能只靠"记得加"（§11.3 T18 是响应 schema 级断言）。
class WildlifeTracksPage extends ConsumerWidget {
  const WildlifeTracksPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<WildlifeTrack>> value =
        ref.watch(wildlifeTracksProvider);
    final String? speciesId = ref.watch(wildlifeSpeciesFilterProvider);
    final List<WildlifeSpecies> species =
        ref.watch(wildlifeSpeciesProvider).valueOrNull ??
            const <WildlifeSpecies>[];
    final MockControls? mockControls = ref.watch(mockControlsProvider);
    final KedaYaColors colors = context.kedayaColors;

    return Scaffold(
      appBar: AppBar(
        title: const Text('推断轨迹'),
        actions: <Widget>[
          if (mockControls != null)
            MockStateMenu(
              controls: mockControls,
              onChanged: () => ref.invalidate(wildlifeTracksProvider),
            ),
          IconButton(
            tooltip: '刷新',
            onPressed: () => ref.invalidate(wildlifeTracksProvider),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(
              KedaYaTokens.space4,
              KedaYaTokens.space3,
              KedaYaTokens.space4,
              0,
            ),
            child: const WildlifeInferredTrackBanner(
              disclaimer: '这些线是「同学在哪见过」连起来的走廊，不是动物走过的路线。',
              margin: EdgeInsets.zero,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          WildlifeSpeciesFilterBar(
            species: species,
            selectedSpeciesId: speciesId,
            onSelected: (String? id) =>
                ref.read(wildlifeSpeciesFilterProvider.notifier).select(id),
          ),
          Expanded(
            child: AsyncStateView<List<WildlifeTrack>>(
              value: value,
              isEmpty: (List<WildlifeTrack> tracks) => tracks.isEmpty,
              emptyTitle: '还没有可推断的轨迹',
              emptyDescription: '轨迹需要同一物种在 7 天窗口内至少 5 个上报点，'
                  '点太少时我们不会连出一条线（宁可没有，也不编造）。',
              loadingMessage: '正在加载轨迹…',
              onRetry: () => ref.invalidate(wildlifeTracksProvider),
              builder: (BuildContext context, List<WildlifeTrack> tracks) =>
                  ListView.separated(
                padding: const EdgeInsets.all(KedaYaTokens.space4),
                itemCount: tracks.length + 1,
                separatorBuilder: (BuildContext context, int index) =>
                    const SizedBox(height: KedaYaTokens.space3),
                itemBuilder: (BuildContext context, int index) {
                  if (index == tracks.length) {
                    return Padding(
                      padding: const EdgeInsets.only(top: KedaYaTokens.space2),
                      child: Text(
                        '轨迹由服务端每日重算（DBSCAN 聚类 → 停留点 → 走廊连接）。'
                        '间隔超过 6 小时或距离超过 300 m 的簇不会连接：'
                        '轨迹断裂是可接受的，编造不可接受。',
                        style: TextStyle(
                          fontSize: KedaYaTokens.fontSizeXs,
                          height: KedaYaTokens.lineHeightNormal,
                          color: colors.textMuted,
                        ),
                      ),
                    );
                  }
                  final WildlifeTrack track = tracks[index];
                  return WildlifeTrackCard(
                    track: track,
                    onTap: () => context.push('/wildlife/tracks/${track.id}'),
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}
