import 'package:flutter/material.dart';

import '../../domain/models/money.dart';

/// 金额展示组件。
///
/// 契约 §6.1：金额全链路是**整数分**，只有展示层才转元 ——
/// 这个组件是"转元"的唯一 UI 入口，禁止在别处手写 `/100`。
class MoneyText extends StatelessWidget {
  const MoneyText(this.fen,
      {this.style, this.signed = false, this.showSymbol = true, super.key});

  final int fen;
  final TextStyle? style;

  /// 是否显示正负号（流水场景）。
  final bool signed;

  /// 是否加 `¥` 前缀（结算/合计场景）。
  final bool showSymbol;

  @override
  Widget build(BuildContext context) {
    final String amount =
        signed ? Money.fenToSignedYuan(fen) : Money.fenToYuan(fen);
    return Text(showSymbol ? '¥$amount' : amount, style: style);
  }
}
