/// Apereo CAS 票据校验（`/authserver/serviceValidate`）。
///
/// 上科大 IDS 是标准 Apereo CAS：客户端拿到 `ticket` 后，用**服务端**（而不是
/// 浏览器）带 `service` 与 `ticket` 去校验，响应是 XML：
///
/// ```xml
/// <cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
///   <cas:authenticationSuccess>
///     <cas:user>2026xxxxxx</cas:user>
///     <cas:attributes>…</cas:attributes>
///   </cas:authenticationSuccess>
/// </cas:serviceResponse>
/// ```
///
/// 这里只解析 `cas:user` 与失败原因；不保存票据、不打印 URL（URL 里含 ticket）。
library;

final class CasValidationResult {
  const CasValidationResult._({
    required this.ok,
    this.user,
    this.failureCode,
    this.failureMessage,
  });

  final bool ok;
  final String? user;
  final String? failureCode;
  final String? failureMessage;

  static const CasValidationResult invalid =
      CasValidationResult._(ok: false, failureCode: 'INVALID_RESPONSE');
}

/// 从 CAS 的 XML 响应里提取用户名 / 失败码。
CasValidationResult parseCasServiceValidate(String xml) {
  final RegExpMatch? user =
      RegExp(r'<cas:user>\s*([^<\s]+)\s*</cas:user>').firstMatch(xml);
  if (user != null) {
    return CasValidationResult._(ok: true, user: user.group(1));
  }

  // 失败码是 `authenticationFailure` 的**属性**（code="INVALID_TICKET"），
  // 不是子元素；只找 `<cas:code>` 会漏掉绝大多数失败情况。
  final RegExpMatch? codeAttribute =
      RegExp('<cas:authenticationFailure[^>]*code="([^"]+)"')
          .firstMatch(xml);
  final RegExpMatch? codeElement =
      RegExp(r'<cas:code>\s*([^<\s]+)\s*</cas:code>').firstMatch(xml);
  final RegExpMatch? message = RegExp(
    r'<cas:authenticationFailure[^>]*>([\s\S]*?)</cas:authenticationFailure>',
  ).firstMatch(xml);

  final String? failureCode = codeAttribute?.group(1) ?? codeElement?.group(1);
  if (failureCode == null && message == null) return CasValidationResult.invalid;

  return CasValidationResult._(
    ok: false,
    failureCode: failureCode,
    failureMessage: message?.group(1)?.trim(),
  );
}

/// 拼校验 URL。**注意**：返回值含票据，禁止写日志。
Uri buildCasServiceValidateUri({
  required String casBaseUrl,
  required String service,
  required String ticket,
}) {
  final Uri base = Uri.parse(casBaseUrl);
  return base.replace(
    path: '${base.path.replaceAll(RegExp(r'/+$'), '')}/serviceValidate',
    queryParameters: <String, String>{
      'service': service,
      'ticket': ticket,
    },
  );
}
