import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/app/app_runtime.dart';

/// 启动烟测：真实根组件 + mock 运行时（零网络、零平台插件）。
///
/// 这条测试的价值是**编译并运行真实的 app 装配**（ProviderScope → AppRouter →
/// KedaYaShell → HomePage），而不是渲染一个与产品无关的计数器。
void main() {
  testWidgets('App 以 mock 运行时启动并渲染首页', (WidgetTester tester) async {
    final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
    addTearDown(runtime.dispose);

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[appRuntimeProvider.overrideWithValue(runtime)],
        child: const KedaYaApp(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('可达鸭'), findsWidgets);
    expect(find.text('已跑通的垂直切片'), findsOneWidget);
  });
}
