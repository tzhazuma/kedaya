/**
 * 金额 —— 契约冻结：全链路使用**整数分**，只在展示层转元。
 * 浮点绝不参与金额运算。
 */

/** 分 -> 元字符串，例: 12345 -> "123.45" */
export function fenToYuan(fen: number): string {
  if (!Number.isFinite(fen)) {
    throw new TypeError(`fenToYuan: 非法金额 ${fen}`);
  }
  const rounded = Math.round(fen);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const yuan = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${negative ? '-' : ''}${yuan}.${String(cents).padStart(2, '0')}`;
}

/** 元字符串 -> 分，例: "123.45" -> 12345。非法输入抛 TypeError。 */
export function yuanToFen(yuan: string): number {
  const trimmed = yuan.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new TypeError(`yuanToFen: 非法金额字符串 "${yuan}"`);
  }
  const negative = trimmed.startsWith('-');
  const body = negative ? trimmed.slice(1) : trimmed;
  const [intPart = '0', decPart = ''] = body.split('.');
  const cents = Number(decPart.padEnd(2, '0').slice(0, 2));
  const fen = Number(intPart) * 100 + cents;
  return negative ? -fen : fen;
}

/** 带符号展示，例: 12345 -> "+123.45" / -12345 -> "-123.45" */
export function fenToSignedYuan(fen: number): string {
  return `${fen >= 0 ? '+' : ''}${fenToYuan(fen)}`;
}

/** 校验是否是可接受的金额分值 */
export function isValidFen(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}
