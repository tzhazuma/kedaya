import { describe, expect, it } from 'vitest';
import {
  BUDDY_ACTIVITIES,
  BUDDY_SECTIONS,
  SECTION_ACTIVITIES,
  activitiesOf,
  activityBelongsToSection,
  isBuddyActivity,
  isBuddySection,
  sectionOf,
} from './section';

/**
 * 验收 T2（规格 §2.3 / §8.1）：
 * `sectionOf(activity)` 映射正确 —— `study→academic`；`meal/travel/other→daily`；
 * `sport/game→sport`，6 个 `activity` 全覆盖。
 *
 * 板块由 `activity` **派生**（不落库），所以这个纯函数是"板块"概念的唯一真相。
 * 它错了，硬过滤、规则分、反馈隔离会**同时**错，且都不会报错。
 */
describe('sectionOf（规格 §2.3，验收 T2）', () => {
  it('6 个 activity 全部映射到正确板块（表驱动，逐个覆盖）', () => {
    const expected: Record<string, string> = {
      study: 'academic',
      meal: 'daily',
      travel: 'daily',
      other: 'daily',
      sport: 'sport',
      game: 'sport',
    };

    expect(Object.keys(expected).sort()).toEqual([...BUDDY_ACTIVITIES].sort());
    for (const [activity, section] of Object.entries(expected)) {
      expect(sectionOf(activity), `${activity} → ${section}`).toBe(section);
    }
  });

  it('未知 activity 返回 null（不抛异常：历史脏数据不该让列表 500）', () => {
    expect(sectionOf('dating')).toBeNull(); // ← 明确不做的板块（规格 §1.3）
    expect(sectionOf('')).toBeNull();
    expect(sectionOf('SPORT')).toBeNull(); // 大小写敏感：枚举值不做宽松匹配
  });

  it('反函数自洽：SECTION_ACTIVITIES 的每个活动都映射回该板块', () => {
    for (const section of BUDDY_SECTIONS) {
      for (const activity of SECTION_ACTIVITIES[section]) {
        expect(sectionOf(activity)).toBe(section);
        expect(activityBelongsToSection(activity, section)).toBe(true);
      }
    }
  });

  it('板块互斥：一个活动只能属于一个板块', () => {
    const seen = new Map<string, string>();
    for (const section of BUDDY_SECTIONS) {
      for (const activity of SECTION_ACTIVITIES[section]) {
        expect(seen.has(activity), `${activity} 重复出现在 ${seen.get(activity)} 与 ${section}`).toBe(false);
        seen.set(activity, section);
      }
    }
    expect(seen.size).toBe(BUDDY_ACTIVITIES.length);
  });

  it('三个板块里**没有** dating（规格 §1.3 / D1：明确不做交友板块）', () => {
    expect(BUDDY_SECTIONS).toEqual(['academic', 'daily', 'sport']);
    expect(BUDDY_SECTIONS).not.toContain('dating');
  });

  it('activitiesOf 返回副本，改它不会污染常量', () => {
    const list = activitiesOf('daily');
    list.push('sport');
    expect(activitiesOf('daily')).toEqual(['meal', 'travel', 'other']);
  });

  it('类型守卫只接受枚举值', () => {
    expect(isBuddySection('sport')).toBe(true);
    expect(isBuddySection('dating')).toBe(false);
    expect(isBuddySection(1)).toBe(false);
    expect(isBuddyActivity('game')).toBe(true);
    expect(isBuddyActivity('study')).toBe(true);
    expect(isBuddyActivity('dating')).toBe(false);
  });
});
