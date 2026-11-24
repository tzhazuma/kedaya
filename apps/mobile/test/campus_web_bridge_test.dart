import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/features/campus_web/presentation/campus_web_page.dart';

void main() {
  group('平台支持矩阵', () {
    test('Android / iOS 支持内嵌浏览器', () {
      expect(campusWebSupported(TargetPlatform.android), isTrue);
      expect(campusWebSupported(TargetPlatform.iOS), isTrue);
    });

    test('桌面与鸿蒙走降级路径', () {
      expect(campusWebSupported(TargetPlatform.windows), isFalse);
      expect(campusWebSupported(TargetPlatform.linux), isFalse);
      expect(campusWebSupported(TargetPlatform.macOS), isFalse);
      expect(campusWebSupported(TargetPlatform.fuchsia), isFalse);
    });
  });

  group('注入脚本', () {
    test('同源 fetch 自动带 cookie，且不读取 document.cookie', () {
      expect(campusWebBridgeScript, contains("credentials: 'include'"));
      expect(campusWebBridgeScript, contains('window.KedayaBridge.postMessage'));
      expect(campusWebBridgeScript, contains('__kedayaBridgeInstalled'));
      // 关键边界：脚本**不**去读 cookie，只依赖浏览器自动携带。
      expect(campusWebBridgeScript, isNot(contains('document.cookie')));
    });

    test('失败也会回传，不会静默吞掉', () {
      expect(campusWebBridgeScript, contains('status: 0'));
    });
  });
}
