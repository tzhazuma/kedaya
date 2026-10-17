/// 金额 —— 冻结契约：全链路使用**整数分**，只在展示层转元。
///
/// 与 `packages/shared/src/money.ts` 逐条对齐：
///   - 浮点绝不参与金额运算；
///   - 非法输入抛 [FormatException]（TS 侧抛 `TypeError`，语义等价）。
abstract final class Money {
  const Money._();

  static final RegExp _yuanPattern = RegExp(r'^-?\d+(\.\d{1,2})?$');

  /// 分 -> 元字符串，例: `12345 -> '123.45'`。
  static String fenToYuan(int fen) {
    final bool negative = fen < 0;
    final int abs = fen.abs();
    final int yuan = abs ~/ 100;
    final int cents = abs % 100;
    return '${negative ? '-' : ''}$yuan.${cents.toString().padLeft(2, '0')}';
  }

  /// 元字符串 -> 分，例: `'123.45' -> 12345`。非法输入抛 [FormatException]。
  static int yuanToFen(String yuan) {
    final String trimmed = yuan.trim();
    if (!_yuanPattern.hasMatch(trimmed)) {
      throw FormatException('yuanToFen: 非法金额字符串 "$yuan"');
    }
    final bool negative = trimmed.startsWith('-');
    final String body = negative ? trimmed.substring(1) : trimmed;
    final int dot = body.indexOf('.');
    final String intPart = dot == -1 ? body : body.substring(0, dot);
    final String decPart = dot == -1 ? '' : body.substring(dot + 1);
    final int cents = int.parse(decPart.padRight(2, '0').substring(0, 2));
    final int fen = int.parse(intPart) * 100 + cents;
    return negative ? -fen : fen;
  }

  /// 带符号展示，例: `12345 -> '+123.45'` / `-12345 -> '-123.45'`。
  static String fenToSignedYuan(int fen) =>
      '${fen >= 0 ? '+' : ''}${fenToYuan(fen)}';

  /// 校验是否是可接受的金额分值（整数）。
  static bool isValidFen(Object? value) => value is int;
}
