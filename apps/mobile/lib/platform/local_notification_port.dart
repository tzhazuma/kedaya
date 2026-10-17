import 'dart:async';

import 'package:flutter/foundation.dart';

import '../domain/ports/platform_ports.dart';

/// [NotificationPort] 的本地实现：内存队列 + 可选日志。
///
/// **为什么不是推送插件**：骨架阶段不引入 `flutter_local_notifications` /
/// 厂商推送通道。本实现是**真实可用**的：前台提示会进入 [received] 流，
/// UI 可以消费并弹 SnackBar；[history] 供调试页查看。
/// 接入真实推送时替换 [show] 的底层通道，端口语义不变。
final class LocalNotificationPort implements NotificationPort {
  LocalNotificationPort({this.logToConsole = false});

  /// 打开后会把每条通知打到控制台（用 `debugPrint`，不用 `print`）。
  final bool logToConsole;

  final StreamController<AppNotification> _received =
      StreamController<AppNotification>.broadcast();
  final List<AppNotification> _history = <AppNotification>[];

  /// 已产生的通知（调试 / 测试断言用）。
  List<AppNotification> get history =>
      List<AppNotification>.unmodifiable(_history);

  @override
  Stream<AppNotification> get received => _received.stream;

  @override
  Future<void> show(String title, {String? body, String? payload}) async {
    final AppNotification notification = AppNotification(
      title: title,
      body: body,
      payload: payload,
      receivedAt: DateTime.now(),
    );
    _history.add(notification);
    if (logToConsole) {
      debugPrint('[kedaya.notification] $notification');
    }
    if (!_received.isClosed) _received.add(notification);
  }

  /// 释放流（`AppRuntime.dispose()` 调用）。
  Future<void> dispose() => _received.close();
}
