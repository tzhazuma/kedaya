import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/app/app_runtime.dart';
import 'package:kedaya/application/consent_controller.dart';
import 'package:kedaya/data/mock/mock_consent_store.dart';
import 'package:kedaya/domain/models/campus_portrait.dart';
import 'package:kedaya/features/ai_portrait/application/ai_portrait_providers.dart';
import 'package:kedaya/features/ai_portrait/data/campus_portrait_repository.dart';
import 'package:kedaya/features/ai_portrait/presentation/components/portrait_demo_preview.dart';
import 'package:kedaya/features/ai_portrait/presentation/pages/ai_portrait_page.dart';
import 'package:kedaya/presentation/theme/kedaya_theme.dart';

void main() {
  group('画像读取', () {
    test('同意门未通过时不读取画像', () async {
      final _FakePortraitRepository repository =
          _FakePortraitRepository(_portrait());
      final ProviderContainer container = _container(repository);

      expect(await container.read(campusPortraitProvider.future), isNull);
      expect(repository.loadCalls, 0);

      // 未同意也可以删除本机画像；删除不读取数据。
      await container.read(campusPortraitProvider.notifier).delete();
      expect(repository.portrait, isNull);
      expect(repository.loadCalls, 0);
    });

    test('没有画像时返回空态（null）', () async {
      final _FakePortraitRepository repository = _FakePortraitRepository(null);
      final ProviderContainer container = _container(repository);

      await container
          .read(consentControllerProvider.notifier)
          .grant(aiPortraitModuleId);

      expect(await container.read(campusPortraitProvider.future), isNull);
      expect(repository.loadCalls, greaterThan(0));
    });

    test('删除后画像变空，并从本机仓库移除', () async {
      final _FakePortraitRepository repository =
          _FakePortraitRepository(_portrait());
      final ProviderContainer container = _container(repository);

      await container
          .read(consentControllerProvider.notifier)
          .grant(aiPortraitModuleId);
      final CampusPortrait? before =
          await container.read(campusPortraitProvider.future);
      expect(before, isNotNull);

      await container.read(campusPortraitProvider.notifier).delete();

      expect(container.read(campusPortraitProvider).valueOrNull, isNull);
      expect(repository.portrait, isNull);
    });
  });

  group('标签来源', () {
    test('标签必须带来源与更新时间（模型层拒绝空来源）', () {
      expect(
        () => PortraitTag(
          label: '作息偏晚',
          source: '   ',
          updatedAt: DateTime(2026, 11, 20),
        ),
        throwsArgumentError,
      );
      expect(
        () => PortraitTag(
          label: '',
          source: '课表',
          updatedAt: DateTime(2026, 11, 20),
        ),
        throwsArgumentError,
      );

      final PortraitTag tag = PortraitTag(
        label: '作息偏晚',
        source: '课表',
        updatedAt: DateTime(2026, 11, 20),
      );
      expect(tag.sourceLine, '来源：课表 · 2026-11-20');
    });

    test('JSON 里缺少来源的标签会被拒绝', () {
      expect(
        () => CampusPortrait.fromJson(<String, Object?>{
          'id': 'p1',
          'updatedAt': '2026-11-20T01:00:00Z',
          'tags': <Object?>[
            <String, Object?>{
              'label': '作息偏晚',
              'updatedAt': '2026-11-20T01:00:00Z',
            },
          ],
        }),
        throwsA(isA<FormatException>()),
      );
    });

    test('演示标签逐个标注来源，并整体标注演示数据', () {
      final List<PortraitTag> tags = buildDemoPortraitTags();
      expect(tags, hasLength(4));
      for (final PortraitTag tag in tags) {
        expect(tag.label, isNotEmpty);
        expect(tag.source, isNotEmpty);
        expect(tag.sourceLine, startsWith('来源：'));
      }
    });
  });

  group('页面', () {
    testWidgets('无画像时显示明确空态，且边界声明常驻', (WidgetTester tester) async {
      await _pumpPage(
        tester,
        _FakePortraitRepository(null),
      );

      expect(
        find.text('暂无画像；画像需要足够的、你授权的数据'),
        findsOneWidget,
      );
      expect(find.text('心理支持与宿舍矛盾不参与画像'), findsOneWidget);
      expect(find.text('标签示例（演示数据）'), findsOneWidget);
      expect(find.text('演示数据'), findsOneWidget);
      expect(find.textContaining('不会写入本机'), findsOneWidget);
      expect(find.text('删除我的画像'), findsOneWidget);
    });

    testWidgets('点击「删除我的画像」后回到空态', (WidgetTester tester) async {
      final _FakePortraitRepository repository =
          _FakePortraitRepository(_portrait());
      await _pumpPage(tester, repository);

      expect(find.text('删除我的画像'), findsOneWidget);
      await tester.tap(find.text('删除我的画像'));
      await tester.pumpAndSettle();
      expect(find.text('删除我的画像？'), findsOneWidget);

      await tester.tap(find.text('删除'));
      await tester.pumpAndSettle();

      expect(
        find.text('暂无画像；画像需要足够的、你授权的数据'),
        findsOneWidget,
      );
      expect(find.textContaining('已删除本机画像'), findsOneWidget);
      expect(repository.portrait, isNull);
    });
  });
}

ProviderContainer _container(CampusPortraitRepository repository) {
  final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      appRuntimeProvider.overrideWithValue(runtime),
      campusPortraitRepositoryProvider.overrideWithValue(repository),
    ],
  );
  addTearDown(container.dispose);
  addTearDown(runtime.dispose);
  return container;
}

Future<void> _pumpPage(
  WidgetTester tester,
  CampusPortraitRepository repository,
) async {
  tester.view.physicalSize = const Size(1200, 3000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  final MockConsentStore consent = MockConsentStore(
    granted: <String>{aiPortraitModuleId},
  );
  addTearDown(consent.dispose);

  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        campusPortraitRepositoryProvider.overrideWithValue(repository),
        consentProvider.overrideWithValue(consent),
      ],
      child: MaterialApp(
        theme: KedaYaTheme.light(),
        home: const AiPortraitPage(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

CampusPortrait _portrait() => CampusPortrait(
      id: 'local-portrait',
      updatedAt: DateTime(2026, 11, 20, 9),
      tags: <PortraitTag>[
        PortraitTag(
          label: '常去图书馆',
          source: '图书馆门禁',
          updatedAt: DateTime(2026, 11, 20, 9),
        ),
      ],
    );

final class _FakePortraitRepository implements CampusPortraitRepository {
  _FakePortraitRepository(this.portrait);

  CampusPortrait? portrait;
  int loadCalls = 0;

  @override
  CampusPortrait? load() {
    loadCalls++;
    return portrait;
  }

  @override
  Future<void> clear() async {
    portrait = null;
  }
}
