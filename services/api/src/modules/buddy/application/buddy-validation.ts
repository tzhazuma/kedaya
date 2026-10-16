/**
 * 找搭子 · 校验辅助（规格 §5.4 的 `details.reason` 契约）
 *
 * ## 为什么这些检查不在 Zod schema 里
 *
 * 规格 §5.4 要求错误响应带**特定的** `details.reason`：
 * `UNKNOWN_TAG:<key>` / `UNKNOWN_LOCATION` / `CONTACT_INFO_IN_DESCRIPTION`。
 * Zod 的 `refine` 只能产出"路径 + 消息"结构（`zodIssuesToDetails` 的形状），
 * 表达不了 `reason` 这个键。硬塞会把错误契约扭曲成"看起来像 Zod 错误"的东西。
 *
 * 所以分两层：
 *   - **Zod schema** 管形状与长度（类型、上限、枚举）；
 *   - **本文件** 管"值是否在服务端白名单里"，并抛出带正确 `details.reason`
 *     的 `ValidationError`。
 *
 * 这样错误响应逐字符合规格 §5.4 的表，且 Zod 那一层仍然只有一份。
 */

import { ValidationError } from '../../../common/errors/app-error';
import {
  CAMPUS_LOCATIONS,
  MAX_POST_TAGS,
  isKnownLocation,
  normalizeLocation,
  unknownTags,
} from '../domain/tags';

/** 标签必须在封闭标签表里（规格 §3.2 / §5.4） */
export function assertKnownTags(keys: readonly string[], field: string): void {
  const bad = unknownTags(keys);
  if (bad.length > 0) {
    throw new ValidationError(`含未登记的标签：${bad.join('、')}`, {
      reason: `UNKNOWN_TAG:${bad[0]}`,
      field,
      unknown: bad,
    });
  }
}

/** 帖子标签数量上限（≤8，规格 §2.3） */
export function assertPostTagCount(keys: readonly string[]): void {
  if (keys.length > MAX_POST_TAGS) {
    throw new ValidationError(`标签最多 ${MAX_POST_TAGS} 项`, {
      reason: 'TOO_MANY_TAGS',
      field: 'tags',
    });
  }
}

/** 活动地点必须在校园地点白名单里（规格 §5.4） */
export function assertKnownLocation(value: string, field = 'location'): string {
  const normalized = normalizeLocation(value);
  if (!isKnownLocation(normalized)) {
    throw new ValidationError('地点不在校园地点清单里', {
      reason: 'UNKNOWN_LOCATION',
      field,
      // 白名单本身是公开信息（就是校园地图上的地方），回显它不构成泄漏，
      // 而且能显著降低用户"填了却不通过"的挫败感。
      allowed: CAMPUS_LOCATIONS,
    });
  }
  return normalized;
}

/** 常用地区（≤5 项）也必须在同一份白名单里 */
export function assertKnownLocations(values: readonly string[], field: string): string[] {
  const normalized = values.map(normalizeLocation);
  const bad = normalized.filter((value) => !isKnownLocation(value));
  if (bad.length > 0) {
    throw new ValidationError('含不在校园地点清单里的地点', {
      reason: 'UNKNOWN_LOCATION',
      field,
      unknown: bad,
    });
  }
  return normalized;
}

/** 活动开始时间必须晚于当前（规格 §5.4） */
export function assertFutureStartsAt(startsAt: Date, now = new Date()): void {
  if (startsAt.getTime() <= now.getTime()) {
    throw new ValidationError('活动开始时间必须晚于当前时间', {
      reason: 'STARTS_AT_IN_PAST',
      field: 'startsAt',
    });
  }
}
