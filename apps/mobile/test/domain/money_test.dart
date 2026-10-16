import 'package:flutter_test/flutter_test.dart';
import 'package:kedaya/domain/models/money.dart';

/// 金额是契约冻结项（整数分），因此这里逐条对齐 `packages/shared/src/money.ts` 的语义。
void main() {
  group('Money.fenToYuan', () {
    test('整数分转元，恒为两位小数', () {
      expect(Money.fenToYuan(12345), '123.45');
      expect(Money.fenToYuan(0), '0.00');
      expect(Money.fenToYuan(5), '0.05');
      expect(Money.fenToYuan(100), '1.00');
      expect(Money.fenToYuan(101), '1.01');
      expect(Money.fenToYuan(-12345), '-123.45');
    });
  });

  group('Money.yuanToFen', () {
    test('合法输入', () {
      expect(Money.yuanToFen('123.45'), 12345);
      expect(Money.yuanToFen('123.4'), 12340);
      expect(Money.yuanToFen('0.05'), 5);
      expect(Money.yuanToFen(' 12 '), 1200);
      expect(Money.yuanToFen('-1.5'), -150);
    });

    test('非法输入抛 FormatException', () {
      for (final String bad in <String>[
        '',
        'abc',
        '1.234',
        '1.',
        '.5',
        '1,5',
        '１２３',
        '1.2.3',
      ]) {
        expect(() => Money.yuanToFen(bad), throwsFormatException, reason: '应拒绝 "$bad"');
      }
    });
  });

  test('分 <-> 元 往返一致', () {
    for (final int fen in <int>[0, 1, 99, 100, 101, 12345, 999999, -7, -12345]) {
      expect(Money.yuanToFen(Money.fenToYuan(fen)), fen, reason: 'fen=$fen');
    }
  });

  test('带符号展示', () {
    expect(Money.fenToSignedYuan(12345), '+123.45');
    expect(Money.fenToSignedYuan(-12345), '-123.45');
    expect(Money.fenToSignedYuan(0), '+0.00');
  });

  test('isValidFen 只接受整数（浮点绝不参与金额运算）', () {
    expect(Money.isValidFen(100), isTrue);
    expect(Money.isValidFen(100.5), isFalse);
    expect(Money.isValidFen('100'), isFalse);
    expect(Money.isValidFen(null), isFalse);
  });
}
