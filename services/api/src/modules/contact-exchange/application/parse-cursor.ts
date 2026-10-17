/**
 * 游标解析：把领域层的 `InvalidCursorError` 翻译成契约的 `VALIDATION_FAILED`。
 */

import { ValidationError } from '../../../common/errors/app-error';
import { decodeTimeCursor, InvalidCursorError, type TimeCursor } from '../domain/contact-exchange.domain';

export function parseTimeCursor(raw: string | undefined): TimeCursor | undefined {
  try {
    return decodeTimeCursor(raw);
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      throw new ValidationError(error.message);
    }
    throw error;
  }
}
