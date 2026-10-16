import 'package:flutter/material.dart';

import '../../../../domain/models/time_text.dart';
import '../../../../domain/models/wildlife.dart';
import '../../../../domain/models/wildlife_sighting.dart';
import '../../../../domain/models/wildlife_track.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import 'wildlife_badges.dart';

/// 区域卡片（区域列表 / 地图下方的告示位）。
class WildlifeZoneCard extends StatelessWidget {
  const WildlifeZoneCard({
    required this.zone,
    this.onTap,
    this.showFullNotice = false,
    super.key,
  });

  final WildlifeZone zone;
  final VoidCallback? onTap;
  final bool showFullNotice;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final String notice = showFullNotice
        ? (zone.noticeText ?? '').trim()
        : zone.noticeSummary;
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        child: Padding(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      zone.name,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeMd,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: colors.text,
                      ),
                    ),
                  ),
                  WildlifeFeedingBadge(policy: zone.feedingPolicy),
                ],
              ),
              const SizedBox(height: KedaYaTokens.space2),
              Wrap(
                spacing: KedaYaTokens.space2,
                runSpacing: KedaYaTokens.space1,
                children: <Widget>[
                  WildlifePill(
                    text: '半径 ${zone.radiusM} m',
                    icon: Icons.radio_button_unchecked,
                  ),
                  WildlifePill(
                    text: '模糊 ${zone.fuzzRadiusM} m',
                    icon: Icons.blur_on,
                  ),
                  if (zone.isSensitive)
                    WildlifePill(
                      text: '敏感区 · 不公开坐标',
                      icon: Icons.lock_outline,
                      tone: colors.danger,
                    ),
                ],
              ),
              if (notice.isNotEmpty) ...<Widget>[
                const SizedBox(height: KedaYaTokens.space3),
                Text(
                  notice,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.text,
                  ),
                ),
              ],
              if (zone.note != null && zone.note!.trim().isNotEmpty) ...<Widget>[
                const SizedBox(height: KedaYaTokens.space2),
                Text(
                  zone.note!,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeXs,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.textMuted,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// 观测卡片。
class WildlifeSightingCard extends StatelessWidget {
  const WildlifeSightingCard({
    required this.sighting,
    this.onTap,
    this.now,
    super.key,
  });

  final WildlifeSighting sighting;
  final VoidCallback? onTap;

  /// 注入"现在"，让相对时间文案在测试里可复现。
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        child: Padding(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      sighting.speciesNameZh ?? sighting.speciesId,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeMd,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: colors.text,
                      ),
                    ),
                  ),
                  if (sighting.status != WildlifeModerationStatus.published)
                    WildlifeStatusBadge(status: sighting.status),
                ],
              ),
              const SizedBox(height: KedaYaTokens.space2),
              Wrap(
                spacing: KedaYaTokens.space2,
                runSpacing: KedaYaTokens.space1,
                children: <Widget>[
                  WildlifePill(
                    text: formatRelativeTime(sighting.observedAt, now: now),
                    icon: Icons.schedule,
                  ),
                  if (sighting.zoneName != null)
                    WildlifePill(text: sighting.zoneName!, icon: Icons.place_outlined),
                  if (sighting.individualName != null)
                    WildlifePill(
                      text: sighting.individualName!,
                      icon: Icons.pets,
                      tone: colors.brandStrong,
                    ),
                  if (sighting.healthConcern)
                    WildlifePill(
                      text: '疑似受伤',
                      icon: Icons.health_and_safety_outlined,
                      tone: colors.danger,
                    ),
                  if (sighting.isAutoClassified)
                    WildlifePill(
                      text: '自动识别',
                      icon: Icons.auto_awesome,
                      tone: colors.info,
                    ),
                  if (sighting.isAnonymous)
                    WildlifePill(text: '匿名', icon: Icons.visibility_off_outlined),
                ],
              ),
              if (sighting.note != null && sighting.note!.trim().isNotEmpty) ...<Widget>[
                const SizedBox(height: KedaYaTokens.space3),
                Text(
                  sighting.note!,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: KedaYaTokens.fontSizeSm,
                    height: KedaYaTokens.lineHeightNormal,
                    color: colors.text,
                  ),
                ),
              ],
              const SizedBox(height: KedaYaTokens.space2),
              Text(
                sighting.hasGeo ? '位置已模糊化到片区级' : '敏感区 · 不公开坐标',
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

/// 推断轨迹卡片（**必须**带"推断"标注）。
class WildlifeTrackCard extends StatelessWidget {
  const WildlifeTrackCard({required this.track, this.onTap, super.key});

  final WildlifeTrack track;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        child: Padding(
          padding: const EdgeInsets.all(KedaYaTokens.space4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      track.displayName,
                      style: TextStyle(
                        fontSize: KedaYaTokens.fontSizeMd,
                        fontWeight: KedaYaTokens.fontWeightSemibold,
                        color: colors.text,
                      ),
                    ),
                  ),
                  WildlifePill(
                    text: track.confidenceLabel,
                    icon: Icons.insights,
                    tone: colors.info,
                  ),
                ],
              ),
              const SizedBox(height: KedaYaTokens.space2),
              Wrap(
                spacing: KedaYaTokens.space2,
                runSpacing: KedaYaTokens.space1,
                children: <Widget>[
                  WildlifePill(
                    text: '${track.path.length} 个途经点',
                    icon: Icons.timeline,
                  ),
                  WildlifePill(
                    text: '约 ${track.totalDistanceM} m',
                    icon: Icons.straighten,
                  ),
                  WildlifePill(
                    text: '${track.sightingCount} 次上报',
                    icon: Icons.upload_outlined,
                  ),
                  WildlifePill(text: track.methodLabel, icon: Icons.hub_outlined),
                ],
              ),
              const SizedBox(height: KedaYaTokens.space3),
              Text(
                track.inferredDisclaimer,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  height: KedaYaTokens.lineHeightNormal,
                  color: colors.warning,
                  fontWeight: KedaYaTokens.fontWeightMedium,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
