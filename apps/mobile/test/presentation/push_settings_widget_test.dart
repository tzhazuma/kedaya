import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/ports/push_port.dart';
import 'package:kedaya/features/notifications/application/push_providers.dart';
import 'package:kedaya/features/notifications/presentation/pages/push_settings_page.dart';
import 'package:kedaya/platform/push_token_channel.dart';
import 'package:kedaya/presentation/theme/kedaya_theme.dart';

final class _FakePush implements PushPort {
  final List<(PushChannel, String)> registered = <(PushChannel, String)>[];

  @override
  Future<PushTargetView> register(PushChannel channel, String token) async {
    registered.add((channel, token));
    return PushTargetView(channel: channel, status: 'active');
  }

  @override
  Future<bool> revoke(PushChannel channel, String token) async => true;

  @override
  Future<PushStatus> status() async => const PushStatus(
        configured: <PushChannel>[PushChannel.fcm],
        targets: <PushTargetView>[],
      );
}

final class _FakeTokens implements PushTokenPort {
  @override
  Future<String> register(PushChannel channel) async => 'native-token';

  @override
  Future<void> unregister(PushChannel channel) async {}
}

void main() {
  testWidgets('用户主动启用 FCM 后才注册真实设备 token', (WidgetTester tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    final _FakePush push = _FakePush();
    await tester.pumpWidget(ProviderScope(
      overrides: <Override>[
        pushPortProvider.overrideWithValue(push),
        pushTokenPortProvider.overrideWithValue(_FakeTokens()),
      ],
      child: MaterialApp(
          theme: KedaYaTheme.light(), home: const PushSettingsPage()),
    ));
    await tester.pumpAndSettle();
    expect(push.registered, isEmpty);
    await tester.tap(find.text('启用 FCM'));
    await tester.pumpAndSettle();
    expect(push.registered,
        <(PushChannel, String)>[(PushChannel.fcm, 'native-token')]);
    expect(find.textContaining('FCM 已启用'), findsOneWidget);
    debugDefaultTargetPlatformOverride = null;
  });
}
