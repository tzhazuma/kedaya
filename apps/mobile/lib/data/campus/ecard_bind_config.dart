/// 校园卡绑定码交换的构建期配置。
///
/// 共享密钥**不进仓库**：通过 `--dart-define` 注入，CI 里从 Secrets 读。
/// ```
/// flutter build apk --dart-define=KEDAYA_ECARD_BIND_TOKEN=... \
///                  --dart-define=KEDAYA_ECARD_BIND_BASE_URL=https://ecard.shanghaitech.edu.cn
/// ```
/// 未配置 token 时 [isConfigured] 为 false，调用方应把绑定入口显示成
/// 「本构建未启用」而不是让用户点进去看到超时。
final class EcardBindConfig {
  const EcardBindConfig({required this.bindToken, required this.baseUrl});

  static const String _tokenOverride =
      String.fromEnvironment('KEDAYA_ECARD_BIND_TOKEN');
  static const String _baseUrlOverride =
      String.fromEnvironment('KEDAYA_ECARD_BIND_BASE_URL');

  /// 默认就是校园卡站点：绑定端点是它下面的 `/__ecard_bind`。
  static const String defaultBaseUrl = 'https://ecard.shanghaitech.edu.cn';

  final String bindToken;
  final String baseUrl;

  bool get isConfigured => bindToken.trim().isNotEmpty;

  static EcardBindConfig fromDartDefine() => EcardBindConfig(
        bindToken: _tokenOverride,
        baseUrl:
            _baseUrlOverride.isEmpty ? defaultBaseUrl : _baseUrlOverride,
      );

  /// 刻意不打印密钥。
  @override
  String toString() =>
      'EcardBindConfig($baseUrl, ${isConfigured ? '已配置' : '未配置'})';
}
