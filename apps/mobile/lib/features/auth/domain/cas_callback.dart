/// 从用户粘贴的内容里取出 CAS 一次性授权码。
///
/// 用户实际能复制到的东西五花八门：完整的回调地址、只有查询串、
/// 或者干脆就是 code 本身。逐个手工摘 `code=` 既麻烦又容易摘错，
/// 所以这里统一兜底；取不出来就返回 null，由界面如实提示。
String? extractCasCode(String input) {
  final String trimmed = input.trim();
  if (trimmed.isEmpty) return null;

  final Uri? uri = Uri.tryParse(trimmed);
  final String? fromQuery = uri?.queryParameters['code'];
  if (fromQuery != null && fromQuery.isNotEmpty) return fromQuery;

  // 地址可能被截断、或只是「…?code=abc&state=…」的一段文本。
  final Match? match = RegExp(r'[?&]code=([^&#\s]+)').firstMatch(trimmed);
  if (match != null) {
    return Uri.decodeComponent(match.group(1)!);
  }

  // 最后就是"只复制了 code"的情况：一段 URL-safe 字符。
  // 必须限定字符集，否则一句中文提示也会被当成授权码提交给服务端。
  if (RegExp(r'^[A-Za-z0-9._~%-]+$').hasMatch(trimmed)) return trimmed;
  return null;
}
