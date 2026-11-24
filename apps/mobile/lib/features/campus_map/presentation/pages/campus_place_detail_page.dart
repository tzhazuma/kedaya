import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/app_providers.dart';
import '../../../../domain/models/campus_place.dart';
import '../../../../presentation/components/kedaya_shell.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import '../../application/campus_map_providers.dart';
import '../../campus_map_routes.dart';
import '../components/campus_place_widgets.dart';

/// 地点详情（`/campus-map/:id`）。
///
/// 两个按钮都**只写剪贴板**，不跳转真实地图：
///   - 「复制位置描述」→ 名称 + 楼栋 + 楼层，可直接粘给同学；
///   - 「在地图中打开」→ 复制 `纬度, 经度`，由用户自己粘贴到地图 App。
///
/// 第二条是 `url_launcher` 缺失时的降级路径，按钮下方的说明必须如实写明，
/// 不能让用户以为点了会打开地图。
class CampusPlaceDetailPage extends ConsumerWidget {
  const CampusPlaceDetailPage({required this.placeId, super.key});

  final String placeId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final KedaYaColors colors = context.kedayaColors;
    final CampusPlace? place = ref.watch(campusPlaceByIdProvider(placeId));

    if (place == null) {
      return KedaYaPageScaffold(
        title: '地点详情',
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                Icons.location_off_outlined,
                size: 40,
                color: colors.textMuted,
              ),
              const SizedBox(height: KedaYaTokens.space3),
              Text(
                '没有找到这个地点',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeMd,
                  fontWeight: KedaYaTokens.fontWeightSemibold,
                  color: colors.text,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space1),
              Text(
                '它可能已从演示目录中移除，或链接里的 id 不正确。',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeSm,
                  color: colors.textMuted,
                ),
              ),
              const SizedBox(height: KedaYaTokens.space4),
              OutlinedButton.icon(
                onPressed: () => context.canPop()
                    ? context.pop()
                    : context.go(CampusMapRoutes.list),
                icon: const Icon(Icons.arrow_back),
                label: const Text('返回地点列表'),
              ),
            ],
          ),
        ),
      );
    }

    return KedaYaPageScaffold(
      title: '地点详情',
      child: ListView(
        children: <Widget>[
          _PlaceHeader(place: place),
          const SizedBox(height: KedaYaTokens.space4),
          const CampusPlaceMapNotice(),
          const SizedBox(height: KedaYaTokens.space4),
          _InfoCard(place: place),
          const SizedBox(height: KedaYaTokens.space4),
          _DescriptionCard(place: place),
          const SizedBox(height: KedaYaTokens.space4),
          _CoordinateCard(place: place),
          const SizedBox(height: KedaYaTokens.space6),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: () => unawaited(
                _copy(
                  context,
                  ref,
                  text: place.locationCopyText,
                  message: '已复制位置描述，可粘贴给同学',
                ),
              ),
              icon: const Icon(Icons.content_copy, size: 18),
              label: const Text('复制位置描述'),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => unawaited(
                _copy(
                  context,
                  ref,
                  text: place.coordinatesCopyText,
                  message: '已复制坐标，可粘贴到地图 App',
                ),
              ),
              icon: const Icon(Icons.map_outlined, size: 18),
              label: const Text('在地图中打开'),
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            '说明：App 未引入 url_launcher，两个按钮都只写入剪贴板，'
            '不会在 App 内打开地图，也不会发起导航。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.textMuted,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space6),
        ],
      ),
    );
  }

  Future<void> _copy(
    BuildContext context,
    WidgetRef ref, {
    required String text,
    required String message,
  }) async {
    await ref.read(shareProvider).copyToClipboard(text);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }
}

class _PlaceHeader extends StatelessWidget {
  const _PlaceHeader({required this.place});

  final CampusPlace place;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          CampusPlaceCategoryBadge(category: place.category),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            place.name,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXxl,
              fontWeight: KedaYaTokens.fontWeightBold,
              height: KedaYaTokens.lineHeightTight,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            place.buildingAndFloor,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              color: colors.textMuted,
            ),
          ),
          if (place.aliases.isNotEmpty) ...<Widget>[
            const SizedBox(height: KedaYaTokens.space1),
            Text(
              '也叫：${place.aliases.join(' / ')}',
              style: TextStyle(
                fontSize: KedaYaTokens.fontSizeXs,
                color: colors.textMuted,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.place});

  final CampusPlace place;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _Field(
            icon: Icons.schedule,
            label: '开放时间',
            value: place.openingHours,
          ),
          const Divider(height: KedaYaTokens.space5),
          _Field(
            icon: Icons.directions_walk,
            label: '最近校门',
            value: '${place.walkSummary}（演示值）',
          ),
          const Divider(height: KedaYaTokens.space5),
          _Field(
            icon: Icons.category_outlined,
            label: '分类',
            value: place.category.label,
          ),
        ],
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Icon(icon, size: 18, color: colors.brandStrong),
        const SizedBox(width: KedaYaTokens.space2),
        SizedBox(
          width: KedaYaTokens.space16,
          child: Text(
            label,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              color: colors.textMuted,
            ),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.text,
            ),
          ),
        ),
      ],
    );
  }
}

class _DescriptionCard extends StatelessWidget {
  const _DescriptionCard({required this.place});

  final CampusPlace place;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
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
            '简介',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeMd,
              fontWeight: KedaYaTokens.fontWeightSemibold,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            place.description,
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeSm,
              height: KedaYaTokens.lineHeightLoose,
              color: colors.text,
            ),
          ),
        ],
      ),
    );
  }
}

class _CoordinateCard extends StatelessWidget {
  const _CoordinateCard({required this.place});

  final CampusPlace place;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Container(
      padding: const EdgeInsets.all(KedaYaTokens.space4),
      decoration: BoxDecoration(
        color: colors.surfaceAlt,
        borderRadius: BorderRadius.circular(KedaYaTokens.radiusLg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                Icons.my_location_outlined,
                size: 16,
                color: colors.textMuted,
              ),
              const SizedBox(width: KedaYaTokens.space2),
              Text(
                '演示坐标（WGS84 量级）',
                style: TextStyle(
                  fontSize: KedaYaTokens.fontSizeXs,
                  fontWeight: KedaYaTokens.fontWeightSemibold,
                  color: colors.textMuted,
                ),
              ),
            ],
          ),
          const SizedBox(height: KedaYaTokens.space2),
          Text(
            place.coordinatesCopyText,
            style: TextStyle(
              fontFamily: KedaYaTokens.fontFamilyMono,
              fontSize: KedaYaTokens.fontSizeSm,
              color: colors.text,
            ),
          ),
          const SizedBox(height: KedaYaTokens.space1),
          Text(
            '坐标仅用于「复制到地图 App」，不是实测位置；'
            '接入校方授权数据前请勿用于导航。',
            style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs,
              height: KedaYaTokens.lineHeightNormal,
              color: colors.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}
