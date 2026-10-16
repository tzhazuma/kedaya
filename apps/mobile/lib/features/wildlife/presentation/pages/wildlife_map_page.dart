import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_providers.dart';
import '../../../../data/mock/mock_controls.dart';
import '../../../../domain/models/geo.dart';
import '../../../../domain/models/wildlife.dart';
import '../../../../presentation/components/async_state_view.dart';
import '../../../../presentation/components/mock_state_menu.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/wildlife_providers.dart';
import '../components/wildlife_badges.dart';
import '../components/wildlife_cards.dart';
import '../components/wildlife_map_canvas.dart';
import '../components/wildlife_species_filter.dart';

/// 动物地图页（规格 §1.2 的**方案 B**：静态底图 + 叠加层）。
///
/// 三态由 [AsyncStateView] 统一渲染；数据来自 `WildlifePort`，
/// 默认装配内存 mock，因此**无后端也能跑通**（契约 §7 硬规则 4）。
///
/// ⚠️ 地图上**只画聚合结果**（区域 / 聚合热点 / 推断轨迹）：
/// 单条观测的坐标**不在地图上渲染**（规格 §8.1 E10：防止平台变成围观召集工具）。
class WildlifeMapPage extends ConsumerWidget {
  const WildlifeMapPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<WildlifeMapState> value = ref.watch(wildlifeMapControllerProvider);
    final WildlifeMapController controller = ref.read(
      wildlifeMapControllerProvider.notifier,
    );
    final String? speciesId = ref.watch(wildlifeSpeciesFilterProvider);
    final MockControls? mockControls = ref.watch(mockControlsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('校园动物'),
        actions: <Widget>[
          if (mockControls != null)
            MockStateMenu(
              controls: mockControls,
              onChanged: () {
                ref.invalidate(wildlifeMapControllerProvider);
                ref.invalidate(wildlifeSightingListControllerProvider);
                ref.invalidate(wildlifeTracksProvider);
                ref.invalidate(wildlifeZonesProvider);
              },
            ),
          IconButton(
            tooltip: '刷新',
            onPressed: () => controller.refresh(),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/wildlife/report'),
        icon: const Icon(Icons.add_a_photo_outlined),
        label: const Text('上报'),
      ),
      body: AsyncStateView<WildlifeMapState>(
        value: value,
        isEmpty: (WildlifeMapState state) => state.isEmpty,
        emptyTitle: '还没有公开的动物数据',
        emptyDescription: '等第一条审核通过的观测出现，这里就会显示活动区域与聚合热点。',
        loadingMessage: '正在加载校园地图…',
        onRetry: controller.refresh,
        builder: (BuildContext context, WildlifeMapState state) => ListView(
          padding: const EdgeInsets.only(bottom: KedaYaTokens.space16),
          children: <Widget>[
            WildlifeSpeciesFilterBar(
              species: state.species,
              selectedSpeciesId: speciesId,
              onSelected: (String? id) =>
                  ref.read(wildlifeSpeciesFilterProvider.notifier).select(id),
            ),
            const SizedBox(height: KedaYaTokens.space2),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: KedaYaTokens.space4),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
                child: AspectRatio(
                  aspectRatio: state.basemap.widthPx <= 0 || state.basemap.heightPx <= 0
                      ? 10 / 7
                      : state.basemap.widthPx / state.basemap.heightPx,
                  child: WildlifeMapCanvas(
                    basemap: state.basemap,
                    zones: state.publicZones,
                    spots: state.spots,
                    tracks: state.tracks,
                    onPickPoint: (Wgs84Point point) => _onTapMap(context, state, point),
                  ),
                ),
              ),
            ),
            const SizedBox(height: KedaYaTokens.space3),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: KedaYaTokens.space4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const WildlifeMapLegend(),
                  const SizedBox(height: KedaYaTokens.space3),
                  const WildlifeAggregationNotice(),
                  const SizedBox(height: KedaYaTokens.space1),
                  Text(
                    '底图：${state.basemapAttribution}',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeXs,
                      color: context.kedayaColors.textMuted,
                    ),
                  ),
                  const SizedBox(height: KedaYaTokens.space4),
                  _QuickLinks(
                    zoneCount: state.zones.length,
                    trackCount: state.tracks.length,
                    onZones: () => context.push('/wildlife/zones'),
                    onSightings: () => context.push('/wildlife/sightings'),
                    onTracks: () => context.push('/wildlife/tracks'),
                  ),
                  if (state.sensitiveZones.isNotEmpty) ...<Widget>[
                    const SizedBox(height: KedaYaTokens.space4),
                    const WildlifePrivacyNotice(hasGeo: false),
                  ],
                  const SizedBox(height: KedaYaTokens.space4),
                  Text(
                    '投喂规范与告示位',
                    style: TextStyle(
                      fontSize: KedaYaTokens.fontSizeMd,
                      fontWeight: KedaYaTokens.fontWeightSemibold,
                      color: context.kedayaColors.text,
                    ),
                  ),
                  const SizedBox(height: KedaYaTokens.space2),
                ],
              ),
            ),
            for (final WildlifeZone zone in state.zones)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  KedaYaTokens.space4,
                  0,
                  KedaYaTokens.space4,
                  KedaYaTokens.space3,
                ),
                child: WildlifeZoneCard(
                  zone: zone,
                  onTap: () => context.push('/wildlife/zones/${zone.id}'),
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// 点击地图：命中区域 → 弹出告示位摘要（规格 §8.3：气泡内显示前 40 字）。
  void _onTapMap(BuildContext context, WildlifeMapState state, Wgs84Point point) {
    final WildlifeZone? zone = zoneContaining(point, state.zones);
    if (zone == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('这里没有已定义的活动区域')),
      );
      return;
    }
    unawaited(showWildlifeZoneSheet(context, zone));
  }
}

/// 区域气泡（地图点击区域）。
Future<void> showWildlifeZoneSheet(BuildContext context, WildlifeZone zone) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      zone.name,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeLg,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: context.kedayaColors.text,
                      ),
                    ),
                  ),
                  WildlifeFeedingBadge(policy: zone.feedingPolicy),
                ],
              ),
              if (zone.noticeSummary.isNotEmpty) ...<Widget>[
                const SizedBox(height: KedaYaTokens.space3),
                Text(
                  zone.noticeSummary,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    height: KedaYaTokens.lineHeightNormal,
                    color: context.kedayaColors.text,
                  ),
                ),
              ],
              const SizedBox(height: KedaYaTokens.space4),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () {
                    Navigator.of(context).pop();
                    context.push('/wildlife/zones/${zone.id}');
                  },
                  child: const Text('查看区域详情'),
                ),
              ),
            ],
          ),
        ),
      ),
    );

/// 三个快捷入口（区域 / 观测 / 推断轨迹）。
class _QuickLinks extends StatelessWidget {
  const _QuickLinks({
    required this.zoneCount,
    required this.trackCount,
    required this.onZones,
    required this.onSightings,
    required this.onTracks,
  });

  final int zoneCount;
  final int trackCount;
  final VoidCallback onZones;
  final VoidCallback onSightings;
  final VoidCallback onTracks;

  @override
  Widget build(BuildContext context) => Row(
    children: <Widget>[
      Expanded(
        child: OutlinedButton.icon(
          onPressed: onZones,
          icon: const Icon(Icons.map_outlined, size: 16),
          label: Text('区域 $zoneCount'),
        ),
      ),
      const SizedBox(width: KedaYaTokens.space2),
      Expanded(
        child: OutlinedButton.icon(
          onPressed: onSightings,
          icon: const Icon(Icons.list_alt_outlined, size: 16),
          label: const Text('观测记录'),
        ),
      ),
      const SizedBox(width: KedaYaTokens.space2),
      Expanded(
        child: OutlinedButton.icon(
          onPressed: onTracks,
          icon: const Icon(Icons.timeline, size: 16),
          label: Text('轨迹 $trackCount'),
        ),
      ),
    ],
  );
}
