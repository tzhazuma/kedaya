/**
 * 找搭子 · 板块派生（规格 §2.3 / §3.3，验收 T2）
 *
 * **板块不落库**：`BuddyPost` 没有 `section` 字段，板块由 `activity` 派生。
 * 理由（规格 §2.3）：同一信息两处存储必然不一致。
 *
 * | 板块 | 来源 `activity` |
 * | --- | --- |
 * | `academic` | `study` |
 * | `daily` | `meal`, `travel`, `other` |
 * | `sport` | `sport`, `game` |
 *
 * ⚠️ 三个板块是**刻意替换** STUMatch 的 `academic/daily/dating`（规格 §1.3 / D1）：
 * `dating`（交友/约会）在本项目明确不做 —— 实名身份 + 婚恋倾向资料在 PIPL 下
 * 接近敏感个人信息，且需要一套完全不同的审核与举报资源。见规格 §1.3。
 */
import type { BuddySection } from '@kedaya/shared';

export type { BuddySection };

/** 冻结的活动枚举（契约 `02-domain-model.md:518-527`） */
export type BuddyActivity = 'sport' | 'study' | 'meal' | 'travel' | 'game' | 'other';

export const BUDDY_SECTIONS: readonly BuddySection[] = ['academic', 'daily', 'sport'];

export const BUDDY_ACTIVITIES: readonly BuddyActivity[] = [
  'sport',
  'study',
  'meal',
  'travel',
  'game',
  'other',
];

/**
 * 板块 → 活动。`sectionOf` 的反函数，供"按板块查候选"时构造
 * `activity IN (...)` 用（规格 §4.4 的 `sectionActivities`）。
 */
export const SECTION_ACTIVITIES: Readonly<Record<BuddySection, readonly BuddyActivity[]>> = {
  academic: ['study'],
  daily: ['meal', 'travel', 'other'],
  sport: ['sport', 'game'],
};

export function isBuddySection(value: unknown): value is BuddySection {
  return typeof value === 'string' && (BUDDY_SECTIONS as readonly string[]).includes(value);
}

export function isBuddyActivity(value: unknown): value is BuddyActivity {
  return typeof value === 'string' && (BUDDY_ACTIVITIES as readonly string[]).includes(value);
}

/**
 * `activity` → 板块。
 *
 * 未知活动返回 `null`（**不抛异常**）：调用方多为视图/日志路径，
 * 一条历史脏数据不该让整个列表 500。写入路径由 Zod 枚举在入口拦掉。
 */
export function sectionOf(activity: string): BuddySection | null {
  for (const section of BUDDY_SECTIONS) {
    if ((SECTION_ACTIVITIES[section] as readonly string[]).includes(activity)) return section;
  }
  return null;
}

/** 板块 → 活动数组（返回可变副本，避免调用方误改常量） */
export function activitiesOf(section: BuddySection): BuddyActivity[] {
  return [...SECTION_ACTIVITIES[section]];
}

/** 校验：板块与活动是否自洽（写入路径用） */
export function activityBelongsToSection(activity: string, section: BuddySection): boolean {
  return (SECTION_ACTIVITIES[section] as readonly string[]).includes(activity);
}
