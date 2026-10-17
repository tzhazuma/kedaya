import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/app/app_runtime.dart';
import 'package:kedaya/domain/models/buddy.dart';
import 'package:kedaya/domain/models/buddy_matching.dart';
import 'package:kedaya/domain/models/buddy_profile.dart';
import 'package:kedaya/features/buddy/presentation/components/buddy_availability_editor.dart';
import 'package:kedaya/features/buddy/presentation/components/buddy_cards.dart';
import 'package:kedaya/features/buddy/presentation/pages/buddy_board_page.dart';
import 'package:kedaya/features/buddy/presentation/pages/buddy_privacy_page.dart';
import 'package:kedaya/features/buddy/presentation/pages/buddy_recommend_page.dart';
import 'package:kedaya/presentation/theme/kedaya_theme.dart';

/// `buddy` 组件级测试：**文案约束**与亮/暗两套主题下的渲染。
///
/// 最重要的不是"能画出来"，而是：
///   - 推荐卡**必须**展示「推荐理由」（§1.1 G3），不是只给分数；
///   - 降级档**必须**诚实（不得出现「为你智能推荐」）；
///   - 分栏里**必须**只有三个板块，没有 dating（契约 §11.10-G）；
///   - 暗色主题下不能抛异常（颜色全部来自设计令牌）。
void main() {
  Widget wrap(Widget child, {ThemeData? theme}) => MaterialApp(
        theme: theme ?? KedaYaTheme.light(),
        home: Scaffold(body: SingleChildScrollView(child: child)),
      );

  Future<void> pumpPage(
      WidgetTester tester, Widget page, ThemeData theme) async {
    final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
    addTearDown(runtime.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[appRuntimeProvider.overrideWithValue(runtime)],
        child: MaterialApp(theme: theme, home: page),
      ),
    );
    await tester.pumpAndSettle();
  }

  BuddyPost samplePost() => BuddyPost(
        id: 'bp-widget',
        activity: BuddyActivity.sport,
        title: '周六下午羽毛球，缺 2 人',
        description: '体育馆 3 号场，打两小时，新手也行。',
        location: '体育馆 3 号场',
        // 上海 2026-10-19（周一）14:00
        startsAt: DateTime.utc(2026, 10, 19, 6),
        durationMin: 120,
        capacity: 4,
        joinedCount: 2,
        tags: const <String>['badminton', 'indoor'],
        minSkillLevel: BuddySkillLevel.beginner,
        creator: const BuddyCreator(id: 'u-2001', nickname: '鸭鸭一号'),
      );

  group('BuddyPostCard', () {
    testWidgets('展示标题 / 时间 / 地点 / 名额 / 标签 / 发起人', (WidgetTester tester) async {
      await tester.pumpWidget(wrap(BuddyPostCard(post: samplePost())));

      expect(find.text('周六下午羽毛球，缺 2 人'), findsOneWidget);
      expect(find.text('10月19日 周一 14:00 · 120 分钟'), findsOneWidget);
      expect(find.text('体育馆 3 号场'), findsOneWidget);
      expect(find.text('2/4 人 · 还缺 2 人'), findsOneWidget);
      expect(find.text('羽毛球'), findsOneWidget);
      expect(find.text('室内'), findsOneWidget);
      expect(find.text('要求至少「入门」水平'), findsOneWidget);
      expect(find.text('发起人：鸭鸭一号'), findsOneWidget);
      expect(find.textContaining('体育馆 3 号场，打两小时'), findsNothing,
          reason: '列表卡默认不展示 description 全文');
    });

    testWidgets('showDescription=true 时展示说明全文', (WidgetTester tester) async {
      await tester.pumpWidget(
        wrap(BuddyPostCard(post: samplePost(), showDescription: true)),
      );
      expect(find.textContaining('体育馆 3 号场，打两小时'), findsOneWidget);
    });

    testWidgets('满员帖显示「已满员」徽标', (WidgetTester tester) async {
      await tester.pumpWidget(
        wrap(BuddyPostCard(
            post: samplePost().copyWith(status: BuddyPostStatus.full))),
      );
      expect(find.text('已满员'), findsWidgets);
    });
  });

  group('BuddySectionChipBar（契约 §11.10-G：只有三个板块）', () {
    testWidgets('只有学术自习 / 日常搭子 / 运动组队', (WidgetTester tester) async {
      BuddySection? selected;
      await tester.pumpWidget(
        wrap(
          BuddySectionChipBar(
            selected: BuddySection.sport,
            onSelected: (BuddySection next) => selected = next,
          ),
        ),
      );

      for (final BuddySection section in buddyMatchableSections) {
        expect(find.text(section.label), findsOneWidget);
      }
      expect(find.text('学术自习'), findsOneWidget);
      expect(find.text('日常搭子'), findsOneWidget);
      expect(find.text('运动组队'), findsOneWidget);
      // 不存在交友 / 约会板块。
      expect(find.textContaining('交友'), findsNothing);
      expect(find.textContaining('约会'), findsNothing);
      expect(find.textContaining('dating'), findsNothing);

      await tester.tap(find.text('学术自习'));
      await tester.pump();
      expect(selected, BuddySection.academic);
    });
  });

  group('BuddyRecommendationCard（§1.1 G3：展示理由）', () {
    Widget card(
            {BuddyMatchMode mode = BuddyMatchMode.rule,
            bool withFeedback = true}) =>
        BuddyRecommendationCard(
          recommendation: BuddyRecommendation(
            post: samplePost(),
            score: 0.75,
            reason: '运动水平相同、共同活动：羽毛球',
          ),
          matchMode: mode,
          onFeedback:
              withFeedback ? (BuddyMatchFeedbackAction action) {} : null,
        );

    testWidgets('理由区块必须出现，且不是只给分数', (WidgetTester tester) async {
      await tester.pumpWidget(wrap(card()));

      expect(find.text('推荐理由'), findsOneWidget);
      expect(find.text('运动水平相同、共同活动：羽毛球'), findsOneWidget);
      // 降级档下分数不能叫「匹配度」。
      expect(find.text('规则分'), findsOneWidget);
      expect(find.text('75'), findsOneWidget);
      expect(find.text('匹配度'), findsNothing);
    });

    testWidgets('rule 模式下不出现「为你智能推荐」，而是诚实的降级说明', (WidgetTester tester) async {
      await tester.pumpWidget(wrap(card()));

      expect(find.textContaining('为你智能推荐'), findsNothing);
      expect(find.textContaining('不是智能推荐'), findsOneWidget);
    });

    testWidgets('vector 模式才显示「为你智能推荐」与「匹配度」', (WidgetTester tester) async {
      await tester.pumpWidget(wrap(card(mode: BuddyMatchMode.vector)));

      expect(find.textContaining('为你智能推荐'), findsOneWidget);
      expect(find.text('匹配度'), findsOneWidget);
    });

    testWidgets('三个反馈按钮都在（like / dislike / skip）', (WidgetTester tester) async {
      await tester.pumpWidget(wrap(card()));

      expect(find.text('感兴趣'), findsOneWidget);
      expect(find.text('不感兴趣'), findsOneWidget);
      expect(find.text('跳过'), findsOneWidget);
    });
  });

  group('BuddyAvailabilityEditor（含跨零点）', () {
    testWidgets('展示已有时段，含拆出来的 24:00 段', (WidgetTester tester) async {
      await tester.pumpWidget(
        wrap(
          BuddyAvailabilityEditor(
            value: const <AvailabilitySlot>[
              AvailabilitySlot(dow: 1, startMin: 19 * 60, endMin: 22 * 60),
              AvailabilitySlot(dow: 5, startMin: 23 * 60, endMin: 24 * 60),
            ],
            onChanged: (List<AvailabilitySlot> next) {},
          ),
        ),
      );

      expect(find.text('每周可用时段'), findsOneWidget);
      expect(find.text('周一 19:00–22:00'), findsOneWidget);
      expect(find.text('周五 23:00–24:00'), findsOneWidget);
      expect(find.textContaining('时间能不能碰上'), findsOneWidget);
    });

    testWidgets('空时段时给出「不填也能用」的说明', (WidgetTester tester) async {
      await tester.pumpWidget(
        wrap(
          BuddyAvailabilityEditor(
            value: const <AvailabilitySlot>[],
            onChanged: (List<AvailabilitySlot> next) {},
          ),
        ),
      );
      expect(find.textContaining('不填也能用'), findsOneWidget);
    });

    testWidgets('添加时段对话框会预览实际保存的时段（跨零点会被拆开）', (WidgetTester tester) async {
      await tester.pumpWidget(
        wrap(
          BuddyAvailabilityEditor(
            value: const <AvailabilitySlot>[],
            onChanged: (List<AvailabilitySlot> next) {},
          ),
        ),
      );

      await tester.tap(find.text('添加时段'));
      await tester.pumpAndSettle();

      expect(find.text('添加可用时段'), findsOneWidget);
      expect(find.textContaining('实际保存为：周一 19:00–22:00'), findsOneWidget);
      // 默认不跨零点，因此没有跨零点提示。
      expect(find.textContaining('跨零点'), findsNothing);
      // 星期选择器用的是 domain 的 dow 文案。
      expect(find.text('周日'), findsOneWidget);
      expect(find.text('周一'), findsOneWidget);
    });
  });

  group('BuddyPrivacyPage：承诺逐条可读', () {
    testWidgets('九个承诺标题都在，且明确写了不做 dating', (WidgetTester tester) async {
      // 9 条承诺超过默认 600px 视口；给足高度，否则 ListView 不会构建底部条目。
      await tester.binding.setSurfaceSize(const Size(900, 2400));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(theme: KedaYaTheme.light(), home: const BuddyPrivacyPage()),
      );
      await tester.pumpAndSettle();

      expect(find.text('找搭子 · 隐私说明'), findsOneWidget);
      for (final String title in <String>[
        '默认不参与匹配',
        '可随时撤回',
        '匹配资料对任何人不可见',
        '不采集敏感属性',
        '不进通用画像',
        '反馈针对活动，不针对人',
        '联系方式不落在活动上',
        '不做交友 / 约会板块',
        '保留期与审计',
      ]) {
        expect(find.text(title), findsOneWidget, reason: title);
      }
      expect(find.textContaining('非官方'), findsOneWidget);
    });
  });

  group('页面级：亮 / 暗主题', () {
    testWidgets('列表页在亮色下渲染 mock 活动（FULL 不在列表里）', (WidgetTester tester) async {
      await pumpPage(tester, const BuddyBoardPage(), KedaYaTheme.light());

      expect(find.text('找搭子'), findsOneWidget);
      expect(find.text('周六下午羽毛球，缺 2 人'), findsOneWidget);
      expect(find.text('篮球 3v3（已满员）'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('列表页在暗色下同样可用（颜色全部来自设计令牌）', (WidgetTester tester) async {
      await pumpPage(tester, const BuddyBoardPage(), KedaYaTheme.dark());

      expect(find.text('找搭子'), findsOneWidget);
      expect(find.text('周六下午羽毛球，缺 2 人'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('推荐页：未开启匹配时诚实降级，且理由非空', (WidgetTester tester) async {
      await pumpPage(tester, const BuddyRecommendPage(), KedaYaTheme.light());

      expect(find.text('为你推荐'), findsOneWidget);
      expect(find.textContaining('不是智能推荐'), findsWidgets);
      expect(find.text('推荐理由'), findsWidgets);
      expect(find.textContaining('按时间排序'), findsWidgets);
      expect(tester.takeException(), isNull);
    });

    testWidgets('推荐页在暗色下同样可用', (WidgetTester tester) async {
      await pumpPage(tester, const BuddyRecommendPage(), KedaYaTheme.dark());

      expect(find.text('为你推荐'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
