import '../../domain/ports/webview_port.dart';

/// [WebViewPort] 的内存实现（mock 运行时）。
///
/// 它**不打开任何真实页面**：只记录"被要求打开的一次性中转 URL"，
/// 供测试断言票据流程真的走完了（创建 → 兑换 → 交给宿主）。
///
/// ⚠️ 记录里含票据引用 —— 这是**故意的**：mock 扮演的是 WebView **宿主**，
/// 它当然要看得到要打开的 URL。契约要求的是"**我们的应用状态**不缓存票据"，
/// 因此 `WebViewLaunchOutcome` 刻意不含 URL 字段，而本类只存在于 mock 运行时。
final class InMemoryWebViewPort implements WebViewPort {
  InMemoryWebViewPort({this.available = true});

  /// 宿主是否可用。设为 false 可模拟"原生侧未实现"的降级路径。
  bool available;

  final List<String> _opened = <String>[];

  int get openCount => _opened.length;

  /// 被要求打开过的 URL（按顺序）。
  List<String> get openedUrls => List<String>.unmodifiable(_opened);

  @override
  Future<bool> openOneTimeUrl(String url) async {
    if (!available) return false;
    _opened.add(url);
    return true;
  }
}
