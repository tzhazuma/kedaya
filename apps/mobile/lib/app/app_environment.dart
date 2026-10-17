/// 运行环境（构建期可用 `--dart-define` 覆盖）。
///
/// 默认 **mock**：`git clone` 后直接 `flutter run` 就能看到完整 UI（契约 §7 硬规则 4）。
/// 接后端时：
/// ```
/// flutter run --dart-define=KEDAYA_FLAVOR=dev \
///             --dart-define=KEDAYA_API_BASE_URL=https://your-api.example.com
/// ```
enum AppFlavor {
  mock('mock'),
  dev('dev'),
  prod('prod');

  const AppFlavor(this.wire);

  final String wire;
}

final class AppEnvironment {
  const AppEnvironment({
    required this.flavor,
    required this.apiBaseUrl,
    this.enableTraceLogging = true,
  });

  const AppEnvironment.mock()
      : flavor = AppFlavor.mock,
        apiBaseUrl = mockBaseUrl,
        enableTraceLogging = true;

  const AppEnvironment.dev()
      : flavor = AppFlavor.dev,
        apiBaseUrl = devBaseUrl,
        enableTraceLogging = true;

  const AppEnvironment.prod()
      : flavor = AppFlavor.prod,
        apiBaseUrl = prodBaseUrl,
        enableTraceLogging = false;

  static const String mockBaseUrl = 'https://mock.kedaya.local';
  static const String devBaseUrl = 'https://dev-api.kedaya.local';
  static const String prodBaseUrl = 'https://api.kedaya.local';

  static const String _baseUrlOverride =
      String.fromEnvironment('KEDAYA_API_BASE_URL');
  static const String _flavorOverride = String.fromEnvironment('KEDAYA_FLAVOR');

  final AppFlavor flavor;

  /// host（不含 `/api/v1`；`KedaYaDioClient` 会补上，契约 §6.1）。
  final String apiBaseUrl;

  /// 是否把 `X-KedaYa-Trace` 打到日志（生产关闭）。
  final bool enableTraceLogging;

  /// 是否使用内存 mock 适配器。
  bool get usesMockAdapters => flavor == AppFlavor.mock;

  static String defaultBaseUrlFor(AppFlavor flavor) => switch (flavor) {
        AppFlavor.mock => mockBaseUrl,
        AppFlavor.dev => devBaseUrl,
        AppFlavor.prod => prodBaseUrl,
      };

  /// 从 `--dart-define` 读取；未提供时默认 mock。
  static AppEnvironment fromDartDefine() {
    final AppFlavor flavor = switch (_flavorOverride) {
      'prod' => AppFlavor.prod,
      'dev' => AppFlavor.dev,
      'mock' => AppFlavor.mock,
      _ => AppFlavor.mock,
    };
    final String baseUrl =
        _baseUrlOverride.isEmpty ? defaultBaseUrlFor(flavor) : _baseUrlOverride;
    return AppEnvironment(
      flavor: flavor,
      apiBaseUrl: baseUrl,
      enableTraceLogging: flavor != AppFlavor.prod,
    );
  }

  @override
  String toString() => 'AppEnvironment(${flavor.wire}, $apiBaseUrl)';
}
