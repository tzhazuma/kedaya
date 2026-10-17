import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../../domain/models/api_error.dart';
import '../../../../domain/models/wildlife.dart';
import '../../../../domain/models/wildlife_track.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/wildlife_providers.dart';
import '../components/wildlife_badges.dart';
import '../components/wildlife_map_canvas.dart';

/// 轨迹详情：小地图（只画这一条折线）+ **显著**的"推断，非实测路径"标注。
class WildlifeTrackDetailPage extends ConsumerWidget {
  const WildlifeTrackDetailPage({required this.trackId, super.key});

  final String trackId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<WildlifeTrack> value =
        ref.watch(wildlifeTrackDetailProvider(trackId));
    return KedaYaPageScaffold(
      title: '推断轨迹',
      padding: EdgeInsets.zero,
      child: value.when(
        data: (WildlifeTrack track) => _TrackBody(track: track),
        loading: () => const KedaYaLoadingState(message: '正在加载轨迹…'),
        error: (Object error, StackTrace stackTrace) =>
            _buildError(context, ref, error),
      ),
    );
  }

  Widget _buildError(BuildContext context, WidgetRef ref, Object error) {
    if (error is ApiException && error.code == ApiErrorCode.notFound) {
      return const KedaYaEmptyState(
        title: '该轨迹不存在',
        description: '服务端每次重算都会覆盖旧结果，它可能已经被新的窗口取代。',
        icon: Icons.timeline,
      );
    }
    return KedaYaErrorState(
      error: error,
      onRetry: () => ref.invalidate(wildlifeTrackDetailProvider(trackId)),
    );
  }
}

class _TrackBody extends ConsumerWidget {
  const _TrackBody({required this.track});

  final WildlifeTrack track;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final DateFormat dateFormat = DateFormat('yyyy-MM-dd HH:mm');
    final AsyncValue<CampusBasemap> basemap =
        ref.watch(wildlifeBasemapProvider);

    return ListView(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      children: <Widget>[
        // ① 最重要的东西放在最上面：这不是实测路径。
        WildlifeInferredTrackBanner(
          disclaimer: track.inferredDisclaimer,
          sightingCount: track.sightingCount,
          margin: EdgeInsets.zero,
        ),
        const SizedBox(height: KedaYaTokens.space4),

        Text(
          track.displayName,
          style: TextStyle(
            fontSize: KedaYaTokens.fontSizeXl,
            fontWeight: KedaYaTokens.fontWeightBold,
            color: colors.text,
          ),
        ),
        const SizedBox(height: KedaYaTokens.space2),
        Wrap(
          spacing: KedaYaTokens.space2,
          runSpacing: KedaYaTokens.space1,
          children: <Widget>[
            WildlifePill(
                text: '方法：${track.methodLabel}', icon: Icons.hub_outlined),
            WildlifePill(
                text: '可信度：${track.confidenceLabel}', icon: Icons.insights),
            WildlifePill(
                text: '${track.path.length} 个途经点', icon: Icons.timeline),
            WildlifePill(
                text: '约 ${track.totalDistanceM} m', icon: Icons.straighten),
            if (track.hasNamedIndividual)
              WildlifePill(
                text: '个体：${track.individualName!}',
                icon: Icons.pets,
                tone: colors.brandStrong,
              ),
          ],
        ),
        const SizedBox(height: KedaYaTokens.space4),

        if (basemap.hasValue && track.isDrawable)
          ClipRRect(
            borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
            child: AspectRatio(
              aspectRatio: basemap.requireValue.heightPx <= 0
                  ? 10 / 7
                  : basemap.requireValue.widthPx /
                      basemap.requireValue.heightPx,
              child: WildlifeMapCanvas(
                basemap: basemap.requireValue,
                tracks: <WildlifeTrack>[track],
              ),
            ),
          )
        else if (!track.isDrawable)
          Container(
            padding: const EdgeInsets.all(KedaYaTokens.space4),
            decoration: BoxDecoration(
              color: colors.surfaceAlt,
              borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
            ),
            child: Text(
              '这条轨迹的点太少，画不出折线（我们不会为了好看而补点）。',
              style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm, color: colors.textMuted),
            ),
          ),
        const SizedBox(height: KedaYaTokens.space4),

        Container(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          decoration: BoxDecoration(
            color: colors.surface,
            borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
            border: Border.all(color: colors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                '这条线是怎么来的',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  fontWeight: KedaYaTokens.fontWeightSemibold,
                  color: colors.text,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space2),
              Text(
                '① 取 ${track.sightingCount} 次已发布的上报；'
                '② 按 7 天窗口切分并做 DBSCAN 空间聚类（同一人重复上报只计一次）；'
                '③ 算出停留点的质心与 95 分位半径；'
                '④ 只有「距离 ≤ 300 m 且时间间隔 ≤ 6 h」的相邻簇才连成直线。',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  height: KedaYaTokens.lineHeightLoose,
                  color: colors.text,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space3),
              Text(
                '明确不做：路径插值、样条平滑、速度推断、地图匹配到步道。'
                '这些都会让「推断」看起来像「实测」。',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.warning,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space3),
              Text(
                '时间跨度：${dateFormat.format(track.spanStartAt.toLocal())} → '
                '${dateFormat.format(track.spanEndAt.toLocal())}',
                style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs, color: colors.textMuted),
              ),
              const SizedBox(height: KedaYaTokens.space1),
              Text(
                '算法版本：${track.method.wire} · 计算结果时间 '
                '${dateFormat.format(track.computedAt.toLocal())}',
                style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs, color: colors.textMuted),
              ),
            ],
          ),
        ),
        const SizedBox(height: KedaYaTokens.space3),
        const WildlifeAggregationNotice(),
      ],
    );
  }
}
