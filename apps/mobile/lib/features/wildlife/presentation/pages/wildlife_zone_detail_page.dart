import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../domain/models/api_error.dart';
import '../../../../domain/models/wildlife.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/components/state_views.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/wildlife_providers.dart';
import '../components/wildlife_badges.dart';
import '../components/wildlife_cards.dart';

/// 区域详情：完整告示位 + 投喂政策 + 管理信息（规格 §8.3）。
class WildlifeZoneDetailPage extends ConsumerWidget {
  const WildlifeZoneDetailPage({required this.zoneId, super.key});

  final String zoneId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<WildlifeZone> value =
        ref.watch(wildlifeZoneDetailProvider(zoneId));
    return KedaYaPageScaffold(
      title: '区域详情',
      padding: EdgeInsets.zero,
      child: value.when(
        data: (WildlifeZone zone) => _ZoneBody(zone: zone),
        loading: () => const KedaYaLoadingState(message: '正在加载区域…'),
        error: (Object error, StackTrace stackTrace) =>
            _buildError(context, ref, error),
      ),
    );
  }

  Widget _buildError(BuildContext context, WidgetRef ref, Object error) {
    if (error is ApiException && error.code == ApiErrorCode.notFound) {
      return const KedaYaEmptyState(
        title: '该区域不存在',
        description: '它可能已经被管理端合并或下架。',
        icon: Icons.map_outlined,
      );
    }
    return KedaYaErrorState(
      error: error,
      onRetry: () => ref.invalidate(wildlifeZoneDetailProvider(zoneId)),
    );
  }
}

class _ZoneBody extends ConsumerWidget {
  const _ZoneBody({required this.zone});

  final WildlifeZone zone;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final List<WildlifeSpecies> species =
        ref.watch(wildlifeSpeciesProvider).valueOrNull ??
            const <WildlifeSpecies>[];

    return ListView(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      children: <Widget>[
        WildlifeZoneCard(zone: zone, showFullNotice: true),
        const SizedBox(height: KedaYaTokens.space3),
        if (zone.isSensitive) ...<Widget>[
          const WildlifePrivacyNotice(hasGeo: false),
          const SizedBox(height: KedaYaTokens.space3),
        ],
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
                '管理信息',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  fontWeight: KedaYaTokens.fontWeightSemibold,
                  color: colors.text,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space2),
              Text(
                '区域半径 ${zone.radiusM} m · 位置模糊化半径 ${zone.fuzzRadiusM} m'
                '${zone.isSensitive ? '（敏感区，不公开坐标）' : ''}',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.text,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space1),
              Text(
                '投喂政策：${zone.feedingPolicy.label}',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  color: colors.text,
                ),
              ),
              if (zone.speciesIds.isNotEmpty) ...<Widget>[
                const SizedBox(height: KedaYaTokens.space3),
                Wrap(
                  spacing: KedaYaTokens.space2,
                  runSpacing: KedaYaTokens.space1,
                  children: <Widget>[
                    for (final String speciesId in zone.speciesIds)
                      WildlifePill(
                        text: _speciesName(species, speciesId),
                        icon: Icons.pets,
                        tone: colors.brandStrong,
                      ),
                  ],
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: KedaYaTokens.space4),
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            onPressed: () => context.push('/wildlife'),
            icon: const Icon(Icons.map_outlined, size: 18),
            label: const Text('在地图上查看'),
          ),
        ),
        const SizedBox(height: KedaYaTokens.space3),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: () => context.push('/wildlife/sightings'),
            icon: const Icon(Icons.list_alt_outlined, size: 18),
            label: const Text('看这个片区的观测记录'),
          ),
        ),
      ],
    );
  }

  String _speciesName(List<WildlifeSpecies> species, String speciesId) {
    for (final WildlifeSpecies item in species) {
      if (item.id == speciesId) return item.displayName;
    }
    return speciesId;
  }
}
