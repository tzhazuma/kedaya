import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/app/app_runtime.dart';
import 'package:kedaya/data/campus/campus_http_client.dart';
import 'package:kedaya/data/campus/ecard_api_client.dart';
import 'package:kedaya/data/campus/ecard_bind_client.dart';
import 'package:kedaya/data/campus/ecard_bind_config.dart';
import 'package:kedaya/data/campus/ecard_link_store.dart';
import 'package:kedaya/data/repositories/ecard_direct_campus_card_repository.dart';
import 'package:kedaya/features/techpie/presentation/components/ecard_bind_dialog.dart';
import 'package:kedaya/presentation/theme/kedaya_theme.dart';

/// 绑定码对话框 → 换码 → 端口落盘的整条接线。
///
/// 这一层专门补「配置了密钥的构建」这个场景：`String.fromEnvironment`
/// 在测试里永远是空，所以必须能注入 [EcardBindConfig] 才测得到。
void main() {
  const EcardBindConfig configured = EcardBindConfig(
    bindToken: 'test-bind-token',
    baseUrl: 'https://ecard.shanghaitech.edu.cn',
  );

  /// 换码端点：返回 ok + openid。
  EcardBindTransport bindTransport({int status = 200, String? payload}) {
    return ({
      required String method,
      required Uri uri,
      required String body,
      required Map<String, String> headers,
    }) async {
      return EcardBindHttpResponse(
        statusCode: status,
        body: payload ?? '{"ok":true,"openid":"oid-abc","usertype":"wechat"}',
      );
    };
  }

  /// 校园卡业务端点：账户 / 流水 / 付款码。
  Future<CampusHttpResponse> campusTransport({
    required String method,
    required Uri uri,
    required String body,
    required Map<String, String> headers,
  }) async {
    switch (uri.path) {
      case '/myaccount/openMyAccountApp':
        return const CampusHttpResponse(
          statusCode: 200,
          body: '{"data":{"cardinfo":{"idserial":"2026233153","username":"唐志昊","cardbal":"12.34"}}}',
          headers: <String, List<String>>{},
        );
      default:
        return const CampusHttpResponse(
          statusCode: 200,
          body: '{"data":{"resultData":{"rows":[],"currentPage":0,"totalPage":1}}}',
          headers: <String, List<String>>{},
        );
    }
  }

  Future<({InMemoryEcardLinkStore store, ProviderContainer container})> pumpHarness(
    WidgetTester tester, {
    EcardBindTransport? bind,
    bool openDialog = true,
  }) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final InMemoryEcardLinkStore store = InMemoryEcardLinkStore();
    final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
    addTearDown(runtime.dispose);

    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[
        appRuntimeProvider.overrideWithValue(runtime),
        ecardBindConfigProvider.overrideWithValue(configured),
        ecardBindClientProvider.overrideWithValue(
          EcardBindClient(
            bindToken: configured.bindToken,
            baseUrl: configured.baseUrl,
            transport: bind ?? bindTransport(),
          ),
        ),
        campusCardRepositoryProvider.overrideWithValue(
          EcardDirectCampusCardRepository(
            clientFactory: (String openId, String? cookie) => EcardApiClient(
              transport: campusTransport,
              openId: openId,
            ),
            linkStore: store,
            cookieReader: (String host) async => null,
            host: 'ecard.shanghaitech.edu.cn',
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          theme: KedaYaTheme.light(),
          home: Scaffold(
            body: Builder(
              builder: (BuildContext context) => TextButton(
                onPressed: () => showEcardBindDialog(context),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    if (openDialog) {
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
    }
    return (store: store, container: container);
  }

  testWidgets('配置了密钥时对话框可用：换码后写入 OPENID 且不显示明文', (WidgetTester tester) async {
    final harness = await pumpHarness(tester);

    expect(find.text('输入绑定码'), findsOneWidget);
    await tester.enterText(find.byType(TextField), ' ab12cd ');
    await tester.tap(find.text('绑定'));
    await tester.pumpAndSettle();

    final EcardLink? link = await harness.store.read();
    expect(link, isNotNull);
    expect(link!.openId, 'oid-abc');
    expect(link.channel, 'wechat');
    expect(link.toString(), isNot(contains('oid-abc')));

    // 对话框已关闭，且界面上从未出现过 openid。
    expect(find.text('输入绑定码'), findsNothing);
    expect(find.textContaining('oid-abc'), findsNothing);
  });

  testWidgets('绑定码过期时给出可在小程序重取的提示，且不写入存储', (WidgetTester tester) async {
    final harness = await pumpHarness(
      tester,
      bind: bindTransport(status: 404, payload: '{}'),
    );

    await tester.enterText(find.byType(TextField), 'ZZ99ZZ');
    await tester.tap(find.text('绑定'));
    await tester.pumpAndSettle();

    expect(find.textContaining('无效或已过期'), findsOneWidget);
    expect(await harness.store.read(), isNull);
    // 失败时对话框不关闭，用户可以重试。
    expect(find.text('输入绑定码'), findsOneWidget);
  });

  testWidgets('空码不发请求', (WidgetTester tester) async {
    int calls = 0;
    final harness = await pumpHarness(
      tester,
      bind: ({
        required String method,
        required Uri uri,
        required String body,
        required Map<String, String> headers,
      }) async {
        calls++;
        return const EcardBindHttpResponse(statusCode: 200, body: '{"ok":true}');
      },
    );

    await tester.tap(find.text('绑定'));
    await tester.pumpAndSettle();

    expect(calls, 0);
    expect(find.textContaining('请输入'), findsWidgets);
    expect(await harness.store.read(), isNull);
  });
}
