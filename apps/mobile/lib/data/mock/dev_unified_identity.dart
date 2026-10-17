import '../../domain/ports/platform_ports.dart';

/// 开发/演示用的统一身份认证入口：直接返回一个固定授权码。
///
/// **不是占位符**：在 mock 运行时下它是一个完整可用的实现（登录流程能跑通），
/// 且只在 `AppEnvironment.mock` 下装配。生产环境装配的是
/// `platform/MethodChannelUnifiedIdentity`（原生宿主拉起认证页）。
final class DevUnifiedIdentity implements UnifiedIdentityPort {
  const DevUnifiedIdentity({this.code = 'dev-authorization-code'});

  final String code;

  @override
  Future<String?> requestAuthorizationCode() async => code;
}
