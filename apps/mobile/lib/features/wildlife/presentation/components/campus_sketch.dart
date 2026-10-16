import 'package:flutter/material.dart';

import '../../../../presentation/theme/kedaya_theme_extension.dart';
import '../../../../presentation/theme/kedaya_tokens.dart';

/// P1 自绘校园示意图（规格 §1.3）。
///
/// **为什么底图是画出来的而不是一张图片**：
///   1. 规格 §1.3 的 P1 路径（自绘示意图）**零授权风险**，可以立刻开工；
///      而 P3（学校官方平面图）的授权状态**完全未知**（未决问题 U1），
///      「在拿到书面授权前，禁止把学校官方平面图放进仓库或对象存储」。
///   2. 画出来的底图**离线可用**、**暗色主题自动跟随**（颜色全部来自设计令牌）、
///      且没有二进制资源要提交。
///   3. 它**只是示意图**，不承担测绘精度 —— 精度由 §3.4 的仿射标定保证
///      （"图是示意性的，但坐标映射是精确标定的"）。
///
/// 当 `CampusBasemap.imageUrl` 非空时（拿到授权后），地图页会在这张示意图
/// **之上**覆盖真实底图图片，叠加层与标定逻辑完全不变。
class CampusSketch extends StatelessWidget {
  const CampusSketch({
    this.widthPx = 1000.0,
    this.heightPx = 700.0,
    this.showLabels = true,
    super.key,
  });

  final double widthPx;
  final double heightPx;

  /// 底图图片已就位时不需要再画文字标注（避免与真实底图重叠）。
  final bool showLabels;

  @override
  Widget build(BuildContext context) => CustomPaint(
    size: Size(widthPx, heightPx),
    painter: _CampusSketchPainter(
      colors: context.kedayaColors,
      showLabels: showLabels,
    ),
  );
}

/// 一栋建筑（示意位置，**非测绘精度**）。
class _SketchBuilding {
  const _SketchBuilding(this.name, this.rect);

  final String name;
  final Rect rect;
}

/// 一段步道。
class _SketchPath {
  const _SketchPath(this.from, this.to);

  final Offset from;
  final Offset to;
}

/// 建筑轮廓：位置与 `mockCampusBasemap` 的仿射（1 m ≈ 1 px，原点在 500,400）
/// **大致对应**，因此叠加层里的区域圈会落在合理的建筑旁。
const List<_SketchBuilding> _buildings = <_SketchBuilding>[
  _SketchBuilding('图书馆', Rect.fromLTWH(470, 250, 140, 80)),
  _SketchBuilding('体育馆', Rect.fromLTWH(700, 200, 130, 90)),
  _SketchBuilding('教学楼 A', Rect.fromLTWH(200, 420, 130, 80)),
  _SketchBuilding('一食堂', Rect.fromLTWH(350, 380, 100, 60)),
  _SketchBuilding('实验楼', Rect.fromLTWH(620, 120, 110, 70)),
  _SketchBuilding('宿舍 1 号', Rect.fromLTWH(300, 200, 70, 40)),
  _SketchBuilding('宿舍 2 号', Rect.fromLTWH(300, 250, 70, 40)),
  _SketchBuilding('宿舍 3 号', Rect.fromLTWH(380, 200, 70, 40)),
  _SketchBuilding('宿舍 4 号', Rect.fromLTWH(380, 250, 70, 40)),
];

/// 草坪色块（图书馆后草坪 / 东区草坪 / 湖边绿地）。
const List<Rect> _lawns = <Rect>[
  Rect.fromLTWH(440, 340, 210, 90),
  Rect.fromLTWH(120, 200, 150, 120),
  Rect.fromLTWH(520, 520, 220, 90),
];

/// 人工湖（黑天鹅水域）。
const Rect _lake = Rect.fromLTWH(510, 430, 220, 120);

/// 主要步道。
const List<_SketchPath> _paths = <_SketchPath>[
  _SketchPath(Offset(120, 400), Offset(880, 400)),
  _SketchPath(Offset(500, 110), Offset(500, 620)),
  _SketchPath(Offset(200, 560), Offset(880, 560)),
  _SketchPath(Offset(500, 400), Offset(620, 480)),
];

class _CampusSketchPainter extends CustomPainter {
  const _CampusSketchPainter({required this.colors, required this.showLabels});

  final KedaYaColors colors;
  final bool showLabels;

  @override
  void paint(Canvas canvas, Size size) {
    final Paint background = Paint()..color = colors.surfaceAlt;
    canvas.drawRect(Offset.zero & size, background);

    // 校园边界
    final RRect boundary = RRect.fromRectAndRadius(
      Rect.fromLTWH(24, 24, size.width - 48, size.height - 48),
      const Radius.circular(24),
    );
    canvas.drawRRect(
      boundary,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = colors.border,
    );

    // 草坪
    final Paint lawn = Paint()..color = colors.success.withValues(alpha: 0.16);
    for (final Rect rect in _lawns) {
      canvas.drawRRect(
        RRect.fromRectAndRadius(rect, const Radius.circular(18)),
        lawn,
      );
    }

    // 水面
    canvas.drawOval(_lake, Paint()..color = colors.info.withValues(alpha: 0.22));

    // 步道
    final Paint path = Paint()
      ..color = colors.border
      ..strokeWidth = 8
      ..strokeCap = StrokeCap.round;
    for (final _SketchPath segment in _paths) {
      canvas.drawLine(segment.from, segment.to, path);
    }

    // 建筑
    final Paint buildingFill = Paint()..color = colors.surface;
    final Paint buildingStroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5
      ..color = colors.border;
    for (final _SketchBuilding building in _buildings) {
      final RRect shape = RRect.fromRectAndRadius(
        building.rect,
        const Radius.circular(KedaYaTokens.radiusSm),
      );
      canvas.drawRRect(shape, buildingFill);
      canvas.drawRRect(shape, buildingStroke);
      if (showLabels) {
        _paintLabel(canvas, building.name, building.rect.center);
      }
    }
  }

  void _paintLabel(Canvas canvas, String text, Offset center) {
    final TextPainter painter = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          fontSize: KedaYaTokens.fontSizeXs,
          fontWeight: KedaYaTokens.fontWeightMedium,
          color: colors.textMuted,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    painter.paint(canvas, center - Offset(painter.width / 2, painter.height / 2));
  }

  @override
  bool shouldRepaint(_CampusSketchPainter oldDelegate) =>
      oldDelegate.colors != colors || oldDelegate.showLabels != showLabels;
}
