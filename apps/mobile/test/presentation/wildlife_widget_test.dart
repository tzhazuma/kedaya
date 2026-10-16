import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/app/app_runtime.dart';
import 'package:kedaya/data/mock/wildlife_fixtures.dart';
import 'package:kedaya/domain/models/geo.dart';
import 'package:kedaya/domain/models/wildlife.dart';
import 'package:kedaya/features/wildlife/presentation/components/wildlife_badges.dart';
import 'package:kedaya/features/wildlife/presentation/components/wildlife_ethics_notice.dart';
import 'package:kedaya/features/wildlife/presentation/components/wildlife_map_canvas.dart';
import 'package:kedaya/features/wildlife/presentation/pages/wildlife_sightings_page.dart';
import 'package:kedaya/presentation/theme/kedaya_theme.dart';

/// 组件级测试：**文案约束**与亮/暗两套主题下的渲染。
///
/// 这里最重要的不是"能画出来"，而是：
///   - 轨迹页面**必须**出现"推断轨迹 · 非实测路径"；
///   - 伦理提示**必须**说清"这不是授权"；
///   - 敏感区**必须**说"不公开坐标"；
///   - 暗色主题下不能抛异常（颜色全部来自设计令牌）。
void main() {
  Widget wrap(Widget child, {ThemeData? theme}) => MaterialApp(
    theme: theme ?? KedaYaTheme.light(),
    home: Scaffold(body: SingleChildScrollView(child: child)),
  );

  group('伦理提示（规格 §8.2）', () {
    testWidgets('展示全部规则 + 勾选项 + "不是授权"的说明', (WidgetTester tester) async {
      bool? changed;
      await tester.pumpWidget(
        wrap(
          WildlifeEthicsNotice(
            acknowledged: false,
            onChanged: (bool value) => changed = value,
          ),
        ),
      );

      for (final String rule in wildlifeEthicsRules) {
        expect(find.text(rule), findsOneWidget, reason: rule);
      }
      expect(find.text(wildlifeEthicsAckLabel), findsOneWidget);
      expect(find.textContaining('不是授权'), findsOneWidget);
      expect(find.textContaining('浏览地图'), findsOneWidget);

      await tester.tap(find.text(wildlifeEthicsAckLabel));
      await tester.pump();
      expect(changed, isTrue);
    });

    testWidgets('选中 forbidden 区域时出红色警告条', (WidgetTester tester) async {
      await tester.pumpWidget(
        wrap(
          const WildlifeEthicsNotice(
            acknowledged: false,
            onChanged: _ignore,
            forbiddenZoneName: '人工湖（黑天鹅水域）',
          ),
        ),
      );
      expect(find.textContaining('禁止投喂'), findsWidgets);
      expect(find.textContaining('人工湖'), findsOneWidget);
    });
  });

  group('推断轨迹标注（规格 §6.1 / §11.3 T18）', () {
    testWidgets('横幅里有"推断轨迹"与"非实测路径"，且带上上报次数', (WidgetTester tester) async {
      await tester.pumpWidget(
        wrap(
          const WildlifeInferredTrackBanner(
            disclaimer: '本轨迹由同学上报推断得出，并非实测运动路径。',
            sightingCount: 31,
          ),
        ),
      );
      expect(find.text('推断轨迹 · 非实测路径'), findsOneWidget);
      expect(find.textContaining('并非实测运动路径'), findsOneWidget);
      expect(find.textContaining('31 次上报'), findsOneWidget);
      expect(find.textContaining('不是 GPS 项圈'), findsOneWidget);
    });

    testWidgets('位置隐私说明区分"已模糊化"与"敏感区不公开坐标"', (WidgetTester tester) async {
      await tester.pumpWidget(wrap(const WildlifePrivacyNotice(hasGeo: true)));
      expect(find.textContaining('模糊化到片区级'), findsOneWidget);

      await tester.pumpWidget(wrap(const WildlifePrivacyNotice(hasGeo: false)));
      expect(find.textContaining('不公开任何坐标'), findsOneWidget);
    });

    testWidgets('聚合延迟说明（不显示实时位置）', (WidgetTester tester) async {
      await tester.pumpWidget(wrap(const WildlifeAggregationNotice()));
      expect(find.textContaining('历史聚合'), findsOneWidget);
      expect(find.textContaining('实时位置'), findsOneWidget);
    });

    testWidgets('投喂政策徽章文案来自枚举', (WidgetTester tester) async {
      await tester.pumpWidget(
        wrap(
          const Column(
            children: <Widget>[
              WildlifeFeedingBadge(policy: FeedingPolicy.allowed),
              WildlifeFeedingBadge(policy: FeedingPolicy.forbidden),
              WildlifeStatusBadge(status: WildlifeModerationStatus.pending),
            ],
          ),
        ),
      );
      expect(find.text('可投喂'), findsOneWidget);
      expect(find.text('禁止投喂'), findsOneWidget);
      expect(find.text('待审核'), findsOneWidget);
    });
  });

  group('静态底图 + 叠加层（方案 B）', () {
    testWidgets('能画出区域 / 热点 / 轨迹，并支持缩放', (WidgetTester tester) async {
      await tester.pumpWidget(
        wrap(
          SizedBox(
            width: 400,
            height: 280,
            child: WildlifeMapCanvas(
              basemap: mockCampusBasemap,
              zones: mockWildlifeZones,
              spots: mockWildlifeSpots,
              tracks: mockWildlifeTracks,
            ),
          ),
        ),
      );
      expect(find.byType(InteractiveViewer), findsOneWidget);
      expect(find.byType(CustomPaint), findsWidgets);
    });

    testWidgets('可点选模式下，点击会反算出校园内的坐标', (WidgetTester tester) async {
      Wgs84Point? picked;
      await tester.pumpWidget(
        wrap(
          SizedBox(
            width: 400,
            height: 280,
            child: WildlifeMapCanvas(
              basemap: mockCampusBasemap,
              zones: mockWildlifeZones,
              onPickPoint: (Wgs84Point point) => picked = point,
            ),
          ),
        ),
      );
      await tester.tapAt(tester.getCenter(find.byType(WildlifeMapCanvas)));
      await tester.pump();
      expect(picked, isNotNull);
      expect(picked!.isWithin(CampusBounds.campus), isTrue);
      expect(picked!.lat, closeTo(31.1780, 0.01));
    });
  });

  group('观测列表页：三态 + 亮/暗主题', () {
    Future<void> pumpPage(WidgetTester tester, ThemeData theme) async {
      final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
      addTearDown(runtime.dispose);
      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[appRuntimeProvider.overrideWithValue(runtime)],
          child: MaterialApp(theme: theme, home: const WildlifeSightingsPage()),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('亮色下渲染 mock 观测，且不显示未发布的记录', (WidgetTester tester) async {
      await pumpPage(tester, KedaYaTheme.light());
      expect(find.text('观测记录'), findsOneWidget);
      expect(find.text('猫'), findsWidgets);
      expect(find.textContaining('位置已模糊化'), findsWidgets);
      // 待审核 / 未通过的记录不该出现。
      expect(find.text('小黑'), findsNothing);
    });

    testWidgets('暗色主题下同样可用（颜色全部来自设计令牌）', (WidgetTester tester) async {
      await pumpPage(tester, KedaYaTheme.dark());
      expect(find.text('观测记录'), findsOneWidget);
      expect(find.text('猫'), findsWidgets);
      expect(tester.takeException(), isNull);
    });
  });
}

/// 用于 const 构造的 no-op 回调。
void _ignore(bool value) {}
