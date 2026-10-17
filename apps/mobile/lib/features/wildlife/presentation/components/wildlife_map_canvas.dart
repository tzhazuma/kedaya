import 'package:flutter/material.dart';

import '../../../../domain/models/geo.dart';
import '../../../../domain/models/wildlife.dart';
import '../../../../domain/models/wildlife_track.dart';
import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';
import 'campus_sketch.dart';

/// 静态校园底图 + 叠加层（规格 §1.2 的**方案 B**）。
///
/// ## 为什么不用 `flutter_map` + 瓦片 / 高德腾讯地图
///
/// | 维度 | 瓦片地图 | **本组件（方案 B）** |
/// | --- | --- | --- |
/// | 坐标系 | OSM 是 WGS84，高德/腾讯是 **GCJ-02**（偏移 300–700 m） | **图像像素空间**，经仿射标定，**完全不经过 GCJ-02** |
/// | 校园尺度信息 | 街道图在 1 km² 上渲染的是"与校园无关的路" | 示意图能表达草坪、湖面、楼间小径 |
/// | 依赖 | 需要地图 key / 瓦片服务 / 域名白名单 | **零依赖、可离线** |
///
/// 规格 §3.2 规则 4 的原话：静态底图方案**不经过 GCJ-02**，
/// "这直接绕开了本模块最大的技术陷阱"。因此本端**没有**任何坐标转换函数
/// （见 `lib/domain/models/geo.dart` 的文件头注释）。
///
/// ## 叠加层只画**聚合**结果（规格 §8.1 E10）
///
/// ⚠️ 本组件**没有** `sightings` 参数，且**刻意不提供**：
/// 地图**不得**渲染单条观测的点位（那会让平台变成"围观召集工具"）。
/// 能画的只有：管理区域（圈）、聚合热点（延迟 ≥24h）、**推断**轨迹（折线）。
///
/// ## 敏感区不画圈（规格 §9.3 ①）
///
/// `isSensitive` 的区域（宿舍 / 保育区）**不绘制圆形范围** —— 一个精确的圆心 +
/// 半径本身就是坐标信息。它们只画一个"不公开坐标"的标记，文字说明放在页面里。
class WildlifeMapCanvas extends StatelessWidget {
  const WildlifeMapCanvas({
    required this.basemap,
    this.zones = const <WildlifeZone>[],
    this.spots = const <WildlifeSpot>[],
    this.tracks = const <WildlifeTrack>[],
    this.selection,
    this.onPickPoint,
    this.highlightZoneId,
    this.projection = CampusProjection.campus,
    super.key,
  });

  final CampusBasemap basemap;
  final List<WildlifeZone> zones;
  final List<WildlifeSpot> spots;
  final List<WildlifeTrack> tracks;

  /// 上报页点选的位置（十字准星）。
  final Wgs84Point? selection;

  /// 非空 = 可点选模式（点击处经仿射反算成 WGS84）。
  final ValueChanged<Wgs84Point>? onPickPoint;

  final String? highlightZoneId;
  final CampusProjection projection;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    final double width =
        basemap.widthPx <= 0 ? 1000 : basemap.widthPx.toDouble();
    final double height =
        basemap.heightPx <= 0 ? 700 : basemap.heightPx.toDouble();

    return InteractiveViewer(
      minScale: 1,
      maxScale: 4,
      // 示意图不需要无限缩放（规格 §1.2：只支持 1×–4×）。
      boundaryMargin: const EdgeInsets.all(64),
      constrained: false,
      child: SizedBox(
        width: width,
        height: height,
        child: Stack(
          children: <Widget>[
            // ① 底图：内置示意图；有 imageUrl 时叠加真实底图（拿到授权后启用）。
            Positioned.fill(
              child: CampusSketch(
                widthPx: width,
                heightPx: height,
                showLabels: !basemap.hasImage,
              ),
            ),
            if (basemap.hasImage)
              Positioned.fill(
                child: Image.network(
                  basemap.imageUrl,
                  fit: BoxFit.fill,
                  // 加载失败（含 mock 运行时的离线环境）退回示意图，**不报错**。
                  errorBuilder: (BuildContext context, Object error,
                          StackTrace? stackTrace) =>
                      const SizedBox.shrink(),
                  loadingBuilder: (
                    BuildContext context,
                    Widget child,
                    ImageChunkEvent? progress,
                  ) =>
                      progress == null ? child : const SizedBox.shrink(),
                ),
              ),
            // ② 叠加层（区域圈 / 聚合热点 / 推断轨迹）。
            Positioned.fill(
              child: CustomPaint(
                painter: WildlifeOverlayPainter(
                  colors: colors,
                  affine: basemap.affine,
                  projection: projection,
                  zones: zones,
                  spots: spots,
                  tracks: tracks,
                  selection: selection,
                  highlightZoneId: highlightZoneId,
                ),
              ),
            ),
            // ③ 点选：手势放在 InteractiveViewer **内部**，
            //    因此 localPosition 已经是底图像素坐标（不用自己反解缩放/平移）。
            if (onPickPoint != null)
              Positioned.fill(
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTapUp: (TapUpDetails details) {
                    final LocalPixel pixel = LocalPixel(
                      u: details.localPosition.dx,
                      v: details.localPosition.dy,
                    );
                    onPickPoint!(
                        basemap.affine.pointFor(pixel, projection: projection));
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// 叠加层画笔：区域圈 / 聚合热点 / 推断轨迹 / 点选准星。
///
/// 颜色全部来自 [KedaYaColors]（亮暗两套自动跟随），**没有任何硬编码色值**。
class WildlifeOverlayPainter extends CustomPainter {
  const WildlifeOverlayPainter({
    required this.colors,
    required this.affine,
    required this.zones,
    required this.spots,
    required this.tracks,
    this.projection = CampusProjection.campus,
    this.selection,
    this.highlightZoneId,
  });

  final KedaYaColors colors;
  final BasemapAffine affine;
  final CampusProjection projection;
  final List<WildlifeZone> zones;
  final List<WildlifeSpot> spots;
  final List<WildlifeTrack> tracks;
  final Wgs84Point? selection;
  final String? highlightZoneId;

  @override
  void paint(Canvas canvas, Size size) {
    _paintZones(canvas);
    _paintSpots(canvas);
    _paintTracks(canvas);
    _paintSelection(canvas);
  }

  /// 区域：圆形（契约 `geo: { lat, lng, radiusM }`）。
  ///
  /// 半径从**米**换算成像素时不做 `radiusM * scale` 这种近似，
  /// 而是把"圆心"和"圆心 + radiusM 米"两个点都过一遍仿射再量距离 ——
  /// 这样即使仿射带旋转/非等比缩放也是对的。
  void _paintZones(Canvas canvas) {
    for (final WildlifeZone zone in zones) {
      final LocalMeters meters = projection.toLocalMeters(zone.center);
      final LocalPixel center = affine.pixelForMeters(meters);
      final Offset offset = Offset(center.u, center.v);

      if (zone.isSensitive) {
        // 敏感区：**不画范围**，只画一个不透明标记（规格 §9.3 ①）。
        final Paint marker = Paint()..color = colors.textMuted;
        canvas.drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromCenter(center: offset, width: 18, height: 18),
            const Radius.circular(KedaYaTokens.radiusSm),
          ),
          marker,
        );
        continue;
      }

      final LocalPixel edge = affine.pixelForMeters(
        LocalMeters(x: meters.x + zone.radiusM, y: meters.y),
      );
      final double radiusPx = center.distanceTo(edge);
      if (radiusPx <= 0) continue;

      final Color tone = _feedingTone(zone.feedingPolicy);
      final bool highlighted =
          highlightZoneId != null && highlightZoneId == zone.id;
      canvas.drawCircle(
          offset, radiusPx, Paint()..color = tone.withValues(alpha: 0.10));
      canvas.drawCircle(
        offset,
        radiusPx,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = highlighted ? 3 : 1.5
          ..color = tone.withValues(alpha: highlighted ? 0.95 : 0.6),
      );
    }
  }

  /// 聚合热点（**已模糊化**的质心 + 95 分位半径）。
  void _paintSpots(Canvas canvas) {
    for (final WildlifeSpot spot in spots) {
      final LocalMeters meters = projection.toLocalMeters(spot.centroid);
      final LocalPixel center = affine.pixelForMeters(meters);
      final Offset offset = Offset(center.u, center.v);
      final LocalPixel edge = affine.pixelForMeters(
        LocalMeters(x: meters.x + spot.radiusM, y: meters.y),
      );
      final double radiusPx = center.distanceTo(edge);
      if (radiusPx > 0) {
        canvas.drawCircle(
          offset,
          radiusPx,
          Paint()..color = colors.brand.withValues(alpha: 0.28),
        );
      }
      canvas.drawCircle(offset, 4, Paint()..color = colors.brandStrong);
      canvas.drawCircle(
        offset,
        4,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1
          ..color = colors.surface,
      );
    }
  }

  /// **推断**轨迹：只连直线，**不做插值 / 平滑**（规格 §6.2 ④）。
  void _paintTracks(Canvas canvas) {
    for (final WildlifeTrack track in tracks) {
      if (!track.isDrawable) continue;
      final Path path = Path();
      for (int index = 0; index < track.path.length; index++) {
        final LocalPixel pixel =
            affine.pixelFor(track.path[index], projection: projection);
        if (index == 0) {
          path.moveTo(pixel.u, pixel.v);
        } else {
          path.lineTo(pixel.u, pixel.v);
        }
      }
      canvas.drawPath(
        path,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2.5
          ..strokeCap = StrokeCap.round
          ..color = colors.info.withValues(alpha: 0.85),
      );
      final Paint vertex = Paint()..color = colors.info;
      for (final Wgs84Point point in track.path) {
        final LocalPixel pixel = affine.pixelFor(point, projection: projection);
        canvas.drawCircle(Offset(pixel.u, pixel.v), 3, vertex);
      }
    }
  }

  /// 点选位置（上报页）。
  void _paintSelection(Canvas canvas) {
    final Wgs84Point? point = selection;
    if (point == null) return;
    final LocalPixel pixel = affine.pixelFor(point, projection: projection);
    final Offset offset = Offset(pixel.u, pixel.v);
    final Paint stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = colors.danger;
    canvas.drawCircle(offset, 10, stroke);
    canvas.drawLine(
        offset - const Offset(18, 0), offset + const Offset(18, 0), stroke);
    canvas.drawLine(
        offset - const Offset(0, 18), offset + const Offset(0, 18), stroke);
  }

  Color _feedingTone(FeedingPolicy policy) => switch (policy.tone) {
        FeedingBadgeTone.success => colors.success,
        FeedingBadgeTone.warning => colors.warning,
        FeedingBadgeTone.danger => colors.danger,
        FeedingBadgeTone.muted => colors.textMuted,
      };

  @override
  bool shouldRepaint(WildlifeOverlayPainter oldDelegate) =>
      oldDelegate.colors != colors ||
      oldDelegate.affine != affine ||
      oldDelegate.zones != zones ||
      oldDelegate.spots != spots ||
      oldDelegate.tracks != tracks ||
      oldDelegate.selection != selection ||
      oldDelegate.highlightZoneId != highlightZoneId;
}

/// 叠加层图例（说明每种图形代表什么，以及"热点不是实时位置"）。
class WildlifeMapLegend extends StatelessWidget {
  const WildlifeMapLegend({super.key});

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Wrap(
      spacing: KedaYaTokens.space3,
      runSpacing: KedaYaTokens.space2,
      children: <Widget>[
        _LegendItem(color: colors.success, label: '管理区域（可投喂）'),
        _LegendItem(color: colors.warning, label: '管理区域（不建议投喂）'),
        _LegendItem(color: colors.danger, label: '管理区域（禁止投喂）'),
        _LegendItem(color: colors.brandStrong, label: '聚合热点'),
        _LegendItem(color: colors.info, label: '推断轨迹（非实测）'),
        _LegendItem(color: colors.textMuted, label: '敏感区（不公开坐标）'),
      ],
    );
  }
}

class _LegendItem extends StatelessWidget {
  const _LegendItem({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    final KedaYaColors colors = context.kedayaColors;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Container(
          width: 12,
          height: 12,
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.35),
            border: Border.all(color: color),
            borderRadius: BorderRadius.circular(KedaYaTokens.radiusSm),
          ),
        ),
        const SizedBox(width: KedaYaTokens.space1),
        Text(
          label,
          style: TextStyle(
              fontSize: KedaYaTokens.fontSizeXs, color: colors.textMuted),
        ),
      ],
    );
  }
}
