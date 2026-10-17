/// 平台 WebView 宿主端口（契约 §7：`platform/` 承载平台差异适配）。
///
/// ⚠️ **只接受一个 URL，别的一概不接受**。这是刻意的：
/// 端口在**类型上**就无法接收校园会话串 / cookie / 自定义请求头，
/// 因此 ADR §4 明确否决的"客户端把校园 cookie 注入 WebView 直连校园系统"
/// 这条路径在这里**根本写不出来**（契约 §11.4 I3 的客户端侧镜像）。
///
/// 传入的 URL 必须是服务端签发的**一次性中转 URL**（`WebViewHandoff.url`）：
/// 它自带票据引用、用后即焚，客户端从未持有任何校园会话。
///
/// 实现见 `lib/platform/method_channel_webview.dart`（原生宿主通过 MethodChannel
/// 提供真正的 WebView）。mock 运行时是内存实现，因此无后端、无原生侧也能跑通。
abstract interface class WebViewPort {
  /// 打开一次性中转 URL。
  ///
  /// 返回是否成功打开。宿主不可用（例如原生侧尚未实现）时返回 `false`，
  /// **不抛异常** —— 调用方据此展示"本机暂不支持"的降级文案，而不是崩溃。
  Future<bool> openOneTimeUrl(String url);
}
