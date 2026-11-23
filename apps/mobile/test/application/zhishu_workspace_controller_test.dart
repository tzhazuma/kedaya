import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/app/app_runtime.dart';
import 'package:kedaya/features/zhishu/application/zhishu_providers.dart';

void main() {
  test('控制器提供演示工作区，导入 QQ 后持久化到本地缓存', () async {
    final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
    final ProviderContainer container = ProviderContainer(overrides: <Override>[
      appRuntimeProvider.overrideWithValue(runtime),
    ]);
    addTearDown(container.dispose);
    addTearDown(runtime.dispose);

    expect(container.read(zhishuWorkspaceProvider).items, isNotEmpty);
    container.read(zhishuWorkspaceProvider.notifier).importQq(
          '2026-11-23 09:30:00 张三\n明天有讲座',
        );
    await Future<void>.delayed(Duration.zero);

    expect(container.read(zhishuWorkspaceProvider).qqMessages, hasLength(1));
    expect(
        container.read(zhishuWorkspaceProvider).items.first.source.label, 'QQ');
    final ProviderContainer restored = ProviderContainer(overrides: <Override>[
      appRuntimeProvider.overrideWithValue(runtime),
    ]);
    addTearDown(restored.dispose);
    expect(restored.read(zhishuWorkspaceProvider).qqMessages, hasLength(1));
  });
}
