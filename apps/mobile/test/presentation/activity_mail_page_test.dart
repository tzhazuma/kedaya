import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/app/app_providers.dart';
import 'package:kedaya/app/app_runtime.dart';
import 'package:kedaya/data/mock/mock_activities_repository.dart';
import 'package:kedaya/data/mock/mock_controls.dart';
import 'package:kedaya/domain/models/api_error.dart';
import 'package:kedaya/domain/models/mail_activity.dart';
import 'package:kedaya/domain/models/result.dart';
import 'package:kedaya/domain/ports/mail_port.dart';
import 'package:kedaya/features/activities/application/activities_providers.dart';
import 'package:kedaya/features/activities/presentation/pages/activity_mail_page.dart';
import 'package:kedaya/presentation/theme/kedaya_theme.dart';

/// 校园邮箱页。
///
/// 三条判据：未绑定给表单、错域当场拒绝、绑定后密码被清掉且能看到事件。
/// 真实 IMAP 行为在服务端，这里不假装验证它。
void main() {
  final DateTime now = DateTime.utc(2026, 11, 24);

  Future<_SpyMail> pump(
    WidgetTester tester, {
    List<MailEventItem> events = const <MailEventItem>[],
  }) async {
    tester.view.physicalSize = const Size(1200, 3000);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final _SpyMail mail = _SpyMail(items: events);
    final AppRuntime runtime = AppRuntime.mock(latency: Duration.zero);
    addTearDown(runtime.dispose);

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          appRuntimeProvider.overrideWithValue(runtime),
          mailRepositoryProvider.overrideWithValue(mail),
          activitiesRepositoryProvider.overrideWithValue(
            MockActivitiesRepository(
              controls: MockControls(latency: Duration.zero),
              clock: () => now,
            ),
          ),
        ],
        child: MaterialApp(
          theme: KedaYaTheme.light(),
          home: const ActivityMailPage(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return mail;
  }

  testWidgets('未绑定时给表单，且说明只读与不存正文', (WidgetTester tester) async {
    await pump(tester);

    expect(find.byKey(const Key('mail-email')), findsOneWidget);
    expect(find.byKey(const Key('mail-password')), findsOneWidget);
    expect(find.textContaining('只读'), findsWidgets);
    expect(find.textContaining('不保存邮件正文'), findsWidgets);
  });

  testWidgets('非学校域当场拒绝，不发请求', (WidgetTester tester) async {
    final _SpyMail mail = await pump(tester);

    await tester.enterText(find.byKey(const Key('mail-email')), 'a@gmail.com');
    await tester.enterText(find.byKey(const Key('mail-password')), 'x');
    await tester.tap(find.text('绑定并同步'));
    await tester.pumpAndSettle();

    expect(find.textContaining('只支持'), findsWidgets);
    expect(mail.links, isEmpty);
  });

  testWidgets('绑定成功后清空密码输入框，并展示同步到的事件', (WidgetTester tester) async {
    final _SpyMail mail = await pump(
      tester,
      events: <MailEventItem>[
        MailEventItem(
          id: 'mail-1001',
          title: '校园马拉松志愿者招募',
          startsAt: DateTime.utc(2026, 11, 30, 0),
          matchedText: '11 月 30 日 08:00 东区体育场',
          stale: false,
          location: '东区体育场',
        ),
      ],
    );

    await tester.enterText(
      find.byKey(const Key('mail-email')),
      'student@shanghaitech.edu.cn',
    );
    await tester.enterText(find.byKey(const Key('mail-password')), 'secret');
    // 绑定成功会换掉整个表单，所以先抓住 controller 再点。
    final TextEditingController passwordController =
        tester.widget<TextField>(find.byKey(const Key('mail-password'))).controller!;

    await tester.tap(find.text('绑定并同步'));
    await tester.pumpAndSettle();

    expect(mail.links, hasLength(1));
    expect(mail.links.single.imapHost, MailLinkRequest.campusImapHost);

    // 密码已被清掉：controller 里不再有明文，表单也已经被「已绑定」区替换。
    expect(passwordController.text, isEmpty);
    expect(find.byKey(const Key('mail-password')), findsNothing);

    expect(find.text('校园马拉松志愿者招募'), findsOneWidget);
    expect(find.textContaining('08:00'), findsWidgets);
  });
}

final class _SpyMail implements MailPort {
  _SpyMail({this.items = const <MailEventItem>[]});

  final List<MailLinkRequest> links = <MailLinkRequest>[];
  final List<String> calls = <String>[];
  List<MailEventItem> items;
  bool bound = false;
  String? lastPasswordSeen;

  @override
  Future<Result<Unit>> link(MailLinkRequest request) async {
    calls.add('link');
    links.add(request);
    lastPasswordSeen = request.password;
    bound = true;
    return const Ok<Unit>(Unit.instance);
  }

  @override
  Future<Result<Unit>> unlink() async {
    calls.add('unlink');
    bound = false;
    return const Ok<Unit>(Unit.instance);
  }

  @override
  Future<Result<MailEventsSnapshot>> sync() async {
    calls.add('sync');
    return Ok<MailEventsSnapshot>(MailEventsSnapshot(items: items, stale: false));
  }

  @override
  Future<Result<MailEventsSnapshot>> events() async {
    calls.add('events');
    if (!bound) {
      return const Err<MailEventsSnapshot>(
        ApiError(
          code: ApiErrorCode.campusBindingRequired,
          message: '还没有绑定校园邮箱',
        ),
      );
    }
    return Ok<MailEventsSnapshot>(MailEventsSnapshot(items: items, stale: false));
  }
}
