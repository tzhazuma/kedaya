import type { ZodError } from 'zod';

/** Zod issue → 稳定的字段级错误结构（契约 §6.1 `ApiError.details`） */
export function zodIssuesToDetails(
  error: ZodError,
): Array<{ path: string; code: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
    message: issue.message,
  }));
}
