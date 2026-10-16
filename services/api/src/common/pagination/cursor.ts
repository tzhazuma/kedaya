import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@kedaya/contracts';
import { ValidationError } from '../errors/app-error';

/**
 * 游标分页（契约 §6.1：**不用 offset 分页**）。
 *
 * 游标 = base64url(记录 id)。这样：
 *   · 对客户端不透明，避免被当成"页码"误用；
 *   · 解码时可以用「重新编码后是否与原文一致」做严格校验，
 *     因为 base64url 解码对垃圾输入是宽容的，不校验就会把噪声喂给数据库。
 */

export function normalizeLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_PAGE_SIZE;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ValidationError('limit 必须是正整数', { limit: raw });
  }
  return Math.min(parsed, MAX_PAGE_SIZE);
}

export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

export function decodeCursor(cursor?: string | null): string | undefined {
  if (cursor === undefined || cursor === null || cursor === '') return undefined;

  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new ValidationError('cursor 不是合法的分页游标');
  }

  // 严格性检查：必须能被原样重编码回去
  if (decoded.length === 0 || encodeCursor(decoded) !== cursor) {
    throw new ValidationError('cursor 不是合法的分页游标');
  }
  return decoded;
}

/** 从任意 query 对象里安全取出 cursor 字符串 */
export function readCursor(query: Record<string, unknown>): string | undefined {
  const raw = query.cursor;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}
