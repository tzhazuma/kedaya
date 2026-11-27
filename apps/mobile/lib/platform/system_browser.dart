import 'dart:io';

import 'package:flutter/foundation.dart';

/// 桌面端用**系统浏览器**打开地址。
///
/// 原生 WebView 的 MethodChannel 宿主（`kedaya/webview`）在桌面端没有实现，
/// 因此此前登录按钮只能退化成「复制链接」。这里直接交给操作系统：
/// Windows 走 `cmd /c start`，macOS 走 `open`，Linux 走 `xdg-open`，
/// 不引入任何新插件，也不接触页面里的任何凭据。
///
/// 返回是否真的拉起了一个浏览器进程；失败时调用方负责降级为复制链接。
Future<bool> openInSystemBrowser(String url) async {
  if (kIsWeb) return false;
  final Uri? uri = Uri.tryParse(url);
  // 只放行 http(s)：避免把任意 scheme 交给 shell。
  if (uri == null || !(uri.isScheme('https') || uri.isScheme('http'))) {
    return false;
  }
  try {
    if (Platform.isWindows) {
      // 空字符串是 start 的窗口标题占位；url 作为独立参数传递，不做字符串拼接。
      final ProcessResult result =
          await Process.run('cmd', <String>['/c', 'start', '', url]);
      return result.exitCode == 0;
    }
    if (Platform.isMacOS) {
      final ProcessResult result =
          await Process.run('open', <String>[url]);
      return result.exitCode == 0;
    }
    if (Platform.isLinux) {
      final ProcessResult result =
          await Process.run('xdg-open', <String>[url]);
      return result.exitCode == 0;
    }
  } on Object {
    return false;
  }
  return false;
}

/// 当前平台是否可以用系统浏览器打开登录页。
bool get systemBrowserSupported {
  if (kIsWeb) return false;
  return Platform.isWindows || Platform.isMacOS || Platform.isLinux;
}
