/**
 * 找搭子 · 问卷答案 → `BuddyProfile` 的**白名单同步**（规格 §2.6）
 *
 * 移植 STUMatch 的 `_sync_profile_from_answers`
 * （`/tmp/stumatch-ref/services/backend/unimatch/routers/questionnaires.py:117-169`），
 * 但只同步**白名单键**：`interestTags` / `activityTags` / `availability` /
 * `skillLevel` / `preferredAreas` / `department`。
 * 其余键只进 `answers`，**不落到 `BuddyProfile`**。
 *
 * ## 为什么必须白名单而不是黑名单
 *
 * `answers` 是运营可改的 JSON（题型存 DB）。如果同步逻辑是"把答案都写进资料"，
 * 运营加一道"你的理想型是什么"的题，答案就会静默进入匹配资料表 ——
 * 那是**没有经过数据最小化评审的新用途**（规格 §6.3）。
 * 白名单保证：新增题目默认**不**影响资料表，要同步必须显式改本文件（走 code review）。
 *
 * ## 校验策略
 *
 * 非法值**丢弃并记录**，不抛异常：问卷答案里混进一个已下架的标签，
 * 不该让整个提交失败（用户无法修正一个他看不到的运营改动）。
 * 丢弃的键会出现在响应的 `ignored` 里，运营可据此排查。
 */

import {
  CAMPUS_LOCATIONS,
  MAX_ACTIVITY_TAGS,
  MAX_INTEREST_TAGS,
  MAX_PREFERRED_AREAS,
  isKnownTag,
  isSkillLevel,
  unknownTags,
} from './tags';
import type { AvailabilitySlot } from '@kedaya/shared';

/** 允许同步进 `BuddyProfile` 的键（**唯一**的白名单） */
export const SYNCABLE_PROFILE_KEYS: readonly string[] = [
  'interestTags',
  'activityTags',
  'availability',
  'skillLevel',
  'preferredAreas',
  'department',
];

export interface ProfilePatch {
  interestTags?: string[];
  activityTags?: string[];
  availability?: AvailabilitySlot[];
  skillLevel?: string;
  preferredAreas?: string[];
  department?: string;
}

export interface SyncResult {
  patch: ProfilePatch;
  /** 被丢弃的键 → 原因（中文，可直接进日志） */
  ignored: Array<{ key: string; reason: string }>;
}

const DEPARTMENT_MAX_LEN = 64;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === 'string')) return null;
  return value as string[];
}

/** 可用时段：dow 0–6，0 ≤ startMin < endMin ≤ 1439（规格 §2.2） */
function asAvailability(value: unknown): AvailabilitySlot[] | null {
  if (!Array.isArray(value)) return null;
  const out: AvailabilitySlot[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) return null;
    const { dow, startMin, endMin } = item as Record<string, unknown>;
    if (
      typeof dow !== 'number' ||
      typeof startMin !== 'number' ||
      typeof endMin !== 'number' ||
      !Number.isInteger(dow) ||
      !Number.isInteger(startMin) ||
      !Number.isInteger(endMin) ||
      dow < 0 ||
      dow > 6 ||
      startMin < 0 ||
      endMin > 1439 ||
      endMin <= startMin
    ) {
      return null;
    }
    out.push({ dow, startMin, endMin });
  }
  return out;
}

/**
 * 从问卷答案里抽出可同步的资料补丁。
 *
 * @param answers `{ [questionId]: value }` —— 可同步题目的 id **就是**资料键名
 */
export function syncProfileFromAnswers(answers: unknown): SyncResult {
  const patch: ProfilePatch = {};
  const ignored: Array<{ key: string; reason: string }> = [];

  if (!isPlainObject(answers)) {
    return { patch, ignored: [{ key: '*', reason: '答案不是对象' }] };
  }

  for (const [key, value] of Object.entries(answers)) {
    if (!SYNCABLE_PROFILE_KEYS.includes(key)) {
      // 非白名单键：**正常**，只进 answers（规格 §2.6）。不记为 ignored，避免噪音。
      continue;
    }

    switch (key) {
      case 'interestTags': {
        const tags = asStringArray(value);
        if (!tags) {
          ignored.push({ key, reason: '不是字符串数组' });
          break;
        }
        if (tags.length > MAX_INTEREST_TAGS) {
          ignored.push({ key, reason: `超过 ${MAX_INTEREST_TAGS} 项上限` });
          break;
        }
        const bad = unknownTags(tags);
        if (bad.length > 0) {
          ignored.push({ key, reason: `未登记标签：${bad.join(',')}` });
          break;
        }
        patch.interestTags = [...new Set(tags)];
        break;
      }

      case 'activityTags': {
        const tags = asStringArray(value);
        if (!tags) {
          ignored.push({ key, reason: '不是字符串数组' });
          break;
        }
        if (tags.length > MAX_ACTIVITY_TAGS) {
          ignored.push({ key, reason: `超过 ${MAX_ACTIVITY_TAGS} 项上限` });
          break;
        }
        const bad = unknownTags(tags);
        if (bad.length > 0) {
          ignored.push({ key, reason: `未登记标签：${bad.join(',')}` });
          break;
        }
        patch.activityTags = [...new Set(tags)];
        break;
      }

      case 'availability': {
        const slots = asAvailability(value);
        if (!slots) {
          ignored.push({ key, reason: '时段格式不合法（dow 0–6、endMin > startMin、≤1439）' });
          break;
        }
        patch.availability = slots;
        break;
      }

      case 'skillLevel': {
        if (!isSkillLevel(value)) {
          ignored.push({ key, reason: '不是合法运动水平' });
          break;
        }
        patch.skillLevel = value;
        break;
      }

      case 'preferredAreas': {
        const areas = asStringArray(value);
        if (!areas) {
          ignored.push({ key, reason: '不是字符串数组' });
          break;
        }
        if (areas.length > MAX_PREFERRED_AREAS) {
          ignored.push({ key, reason: `超过 ${MAX_PREFERRED_AREAS} 项上限` });
          break;
        }
        const bad = areas.filter((area) => !(CAMPUS_LOCATIONS as readonly string[]).includes(area));
        if (bad.length > 0) {
          ignored.push({ key, reason: `不在校园地点白名单：${bad.join(',')}` });
          break;
        }
        patch.preferredAreas = [...new Set(areas)];
        break;
      }

      case 'department': {
        if (typeof value !== 'string' || value.length === 0 || value.length > DEPARTMENT_MAX_LEN) {
          ignored.push({ key, reason: `必须是 1–${DEPARTMENT_MAX_LEN} 字的字符串` });
          break;
        }
        patch.department = value;
        break;
      }

      default:
        ignored.push({ key, reason: '未知的可同步键' });
    }
  }

  return { patch, ignored };
}

/** 便于测试/运营排查：某个 tag key 是否在白名单里（转导出，避免调用方 import 两个模块） */
export { isKnownTag };
