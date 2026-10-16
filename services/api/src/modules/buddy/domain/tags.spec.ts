import { describe, expect, it } from 'vitest';
import {
  BUDDY_TAGS,
  CAMPUS_LOCATIONS,
  MAX_ACTIVITY_TAGS,
  MAX_INTEREST_TAGS,
  MAX_POST_TAGS,
  MAX_PREFERRED_AREAS,
  SKILL_LEVELS,
  TAG_KEYS,
  isKnownLocation,
  isKnownTag,
  isSkillLevel,
  normalizeLocation,
  skillRank,
  tagLabel,
  tagLabels,
  unknownTags,
} from './tags';

/**
 * 规格 §3.2：`interestTags` / `activityTags` / `BuddyPost.tags` 一律取自
 * **服务端维护的封闭标签表**，不允许自由文本进入匹配特征。
 *
 * 这是对 STUMatch 最关键的适配（规格 D5）：它的自由文本 `interests` 靠
 * 字符串精确相等匹配，`"羽毛球"` / `"打羽毛球"` / `"badminton"` 互不匹配。
 */
describe('封闭标签表（规格 §3.2）', () => {
  it('key 唯一（重复 key 会让 tagLabel 静默取到其中一个）', () => {
    expect(new Set(TAG_KEYS).size).toBe(TAG_KEYS.length);
  });

  it('key 是机器值（小写 ASCII，可安全放进 URL 与 JSON）', () => {
    for (const key of TAG_KEYS) {
      expect(key, key).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('label 是中文显示名', () => {
    for (const tag of BUDDY_TAGS) {
      expect(tag.label.length, tag.key).toBeGreaterThan(0);
      expect(tag.label).not.toBe(tag.key);
    }
  });

  it('分组只能是 5 个合法值（供 UI 分栏）', () => {
    for (const tag of BUDDY_TAGS) {
      expect(['sport', 'study', 'meal', 'travel', 'interest'], tag.key).toContain(tag.group);
    }
  });

  it('三个板块相关的分组都有标签（否则板块无法被填满）', () => {
    const groups = new Set(BUDDY_TAGS.map((tag) => tag.group));
    for (const group of ['sport', 'study', 'meal', 'travel']) {
      expect(groups.has(group as never), group).toBe(true);
    }
  });

  it('tagLabel：已知 key → 中文；未知 key **原样返回**（历史数据仍能渲染）', () => {
    expect(tagLabel('badminton')).toBe('羽毛球');
    expect(tagLabel('legacy-tag-from-2024')).toBe('legacy-tag-from-2024');
  });

  it('tagLabels 批量转换', () => {
    expect(tagLabels(['badminton', 'library'])).toEqual(['羽毛球', '图书馆']);
  });

  it('isKnownTag / unknownTags', () => {
    expect(isKnownTag('badminton')).toBe(true);
    expect(isKnownTag('not-a-tag')).toBe(false);
    expect(unknownTags(['badminton', 'x', 'y'])).toEqual(['x', 'y']);
  });

  it('aliases 只用于搜索（不参与匹配）：别名不是合法 key', () => {
    const withAliases = BUDDY_TAGS.filter((tag) => (tag.aliases ?? []).length > 0);
    expect(withAliases.length).toBeGreaterThan(0);
    for (const tag of withAliases) {
      for (const alias of tag.aliases ?? []) {
        expect(isKnownTag(alias), `${alias} 不应是合法 key`).toBe(false);
      }
    }
  });

  it('数量上限与规格 §2.2 / §2.3 一致', () => {
    expect(MAX_INTEREST_TAGS).toBe(20);
    expect(MAX_ACTIVITY_TAGS).toBe(10);
    expect(MAX_POST_TAGS).toBe(8);
    expect(MAX_PREFERRED_AREAS).toBe(5);
  });
});

describe('运动水平（规格 §2.2 / §3.3 F6）', () => {
  it('4 个等级，序为 beginner < casual < regular < competitive', () => {
    expect(SKILL_LEVELS).toEqual(['beginner', 'casual', 'regular', 'competitive']);
    expect(skillRank('beginner')).toBeLessThan(skillRank('casual'));
    expect(skillRank('casual')).toBeLessThan(skillRank('regular'));
    expect(skillRank('regular')).toBeLessThan(skillRank('competitive'));
  });

  it('未知等级按最低处理（fail closed：不因为脏数据把不合格的人放进来）', () => {
    expect(skillRank('olympic')).toBe(-1);
    expect(skillRank('')).toBe(-1);
  });

  it('isSkillLevel 只接受枚举值', () => {
    expect(isSkillLevel('regular')).toBe(true);
    expect(isSkillLevel('Regular')).toBe(false);
    expect(isSkillLevel(1)).toBe(false);
  });
});

describe('校园地点白名单（规格 U10 —— 临时占位，必须记录）', () => {
  it('清单非空且无重复', () => {
    expect(CAMPUS_LOCATIONS.length).toBeGreaterThan(0);
    expect(new Set(CAMPUS_LOCATIONS).size).toBe(CAMPUS_LOCATIONS.length);
  });

  it('isKnownLocation 去首尾空白后判定（地点是人工输入的）', () => {
    expect(isKnownLocation('图书馆')).toBe(true);
    expect(isKnownLocation('  图书馆  ')).toBe(true);
    expect(isKnownLocation('校外某小区')).toBe(false);
  });

  it('normalizeLocation 只去空白，不做其他改写（不改写才不会误判）', () => {
    expect(normalizeLocation(' 体育馆 ')).toBe('体育馆');
    expect(normalizeLocation('体育馆3号场')).toBe('体育馆3号场');
  });

  it('⚠️ U10：清单是**临时占位**，真实清单需产品+运营确认（规格 §9）', () => {
    // 这条测试的作用是把这个未决问题钉在代码里，而不是只写在文档里。
    // 一旦拿到正式清单，替换 CAMPUS_LOCATIONS 即可，本测试仍然成立。
    expect(CAMPUS_LOCATIONS).toContain('图书馆');
    expect(CAMPUS_LOCATIONS.length).toBeLessThan(200);
  });
});
