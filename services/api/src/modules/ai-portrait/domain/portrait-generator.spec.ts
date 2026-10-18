import { describe, expect, it } from 'vitest';

import {
  PORTRAIT_THRESHOLDS,
  assertAllowedSources,
  generatePortrait,
  shouldExposePortrait,
} from './portrait-generator';

/**
 * 画像生成器。
 *
 * 这组测试的重心是**合规护栏**，不是"能生成标签"：
 *   · 禁止来源（心理支持 / 宿舍矛盾）必须抛错，不是静默忽略；
 *   · 没有数据必须返回 null，而不是给一份"通用画像"；
 *   · 每条标签都必须能溯源，否则不该展示。
 */

const NOW = new Date('2026-10-18T12:00:00Z');

function counts(source: string, actions: number, since = '2026-09-01T00:00:00Z') {
  return { source, actions, since };
}

describe('assertAllowedSources（合规护栏）', () => {
  it('允许清单内的来源通过', () => {
    expect(() =>
      assertAllowedSources([counts('groupbuy', 3), counts('forum', 5)]),
    ).not.toThrow();
  });

  it('⚠️ 心理支持必须抛错（契约 §9 硬约束）', () => {
    expect(() => assertAllowedSources([counts('wellbeing', 2)])).toThrow(/禁止集合|wellbeing/);
  });

  it('⚠️ 宿舍矛盾必须抛错', () => {
    expect(() => assertAllowedSources([counts('dorm-harmony', 1)])).toThrow(/禁止集合|dorm-harmony/);
  });

  it('⚠️ 未登记的新模块被拒绝（默认拒绝，不是默认允许）', () => {
    expect(() => assertAllowedSources([counts('brand-new-module', 5)])).toThrow(/不在允许清单/);
  });

  it('空数组通过', () => {
    expect(() => assertAllowedSources([])).not.toThrow();
  });
});

describe('generatePortrait', () => {
  it('有数据时生成标签与溯源', () => {
    const result = generatePortrait({ counts: [counts('groupbuy', 7)], now: NOW });
    expect(result).not.toBeNull();
    expect(result?.traits).toHaveLength(1);

    const trait = result?.traits[0];
    expect(trait?.key).toBe('groupbuy_activity');
    expect(trait?.value).toBe(7);
    expect(trait?.level).toBe('medium');
    // 标签是**事实陈述**，不含性格形容词
    expect(trait?.label).toContain('7 次');
    expect(trait?.label).not.toMatch(/外向|内向|热爱|性格|社交达人/);
  });

  it('⚠️ 没有数据返回 null（不编造通用画像）', () => {
    expect(generatePortrait({ counts: [], now: NOW })).toBeNull();
    expect(generatePortrait({ counts: [counts('groupbuy', 0)], now: NOW })).toBeNull();
  });

  it('⚠️ 禁止来源在生成阶段就被拦下（不是"读了再删"）', () => {
    expect(() =>
      generatePortrait({ counts: [counts('wellbeing', 5)], now: NOW }),
    ).toThrow();
  });

  it('档位阈值生效', () => {
    const low = generatePortrait({ counts: [counts('groupbuy', 1)], now: NOW });
    expect(low?.traits[0]?.level).toBe('low');

    const med = generatePortrait({
      counts: [counts('groupbuy', PORTRAIT_THRESHOLDS.medium)],
      now: NOW,
    });
    expect(med?.traits[0]?.level).toBe('medium');

    const high = generatePortrait({
      counts: [counts('groupbuy', PORTRAIT_THRESHOLDS.high)],
      now: NOW,
    });
    expect(high?.traits[0]?.level).toBe('high');
  });

  it('多来源各自成标签', () => {
    const result = generatePortrait({
      counts: [counts('groupbuy', 2), counts('errand', 12)],
      now: NOW,
    });
    expect(result?.traits.map((t) => t.key).sort()).toEqual([
      'errand_activity',
      'groupbuy_activity',
    ]);
  });

  it('⚠️ 每条标签都有对应的 explain item', () => {
    const result = generatePortrait({
      counts: [counts('groupbuy', 3), counts('forum', 20)],
      now: NOW,
    });
    const explained = new Set(result?.explain.items.map((item) => item.key));
    for (const trait of result?.traits ?? []) {
      expect(explained.has(trait.key), `${trait.key} 缺溯源`).toBe(true);
    }
  });

  it('explain.sources 与实际用到的来源一致', () => {
    const result = generatePortrait({ counts: [counts('forum', 4)], now: NOW });
    expect(result?.explain.sources).toEqual(['forum']);
    expect(result?.explain.items[0]?.contributions).toEqual([
      { source: 'forum', actions: 4 },
    ]);
  });

  it('窗口起点取最早的 since', () => {
    const result = generatePortrait({
      counts: [counts('forum', 1, '2026-10-01T00:00:00Z'), counts('groupbuy', 1, '2026-09-01T00:00:00Z')],
      now: NOW,
    });
    expect(result?.explain.windowStart).toBe('2026-09-01T00:00:00Z');
  });

  it('生成的 explain 里说明了档位阈值（可反驳）', () => {
    const result = generatePortrait({ counts: [counts('groupbuy', 5)], now: NOW });
    expect(result?.explain.items[0]?.reason).toContain('计数分档');
  });
});

describe('shouldExposePortrait', () => {
  const valid = {
    profile: {
      enabled: true,
      traits: [{ key: 'groupbuy_activity', label: 'x', level: 'medium', value: 3 }],
      explain: { items: [{ key: 'groupbuy_activity', sources: ['groupbuy'] }] },
    },
  };

  it('齐全时展示', () => {
    expect(shouldExposePortrait(valid)).toBe(true);
  });

  it('⚠️ 用户关闭后不展示', () => {
    expect(shouldExposePortrait({ profile: { ...valid.profile, enabled: false } })).toBe(false);
  });

  it('null 画像不展示', () => {
    expect(shouldExposePortrait({ profile: null })).toBe(false);
  });

  it('无标签不展示', () => {
    expect(shouldExposePortrait({ profile: { ...valid.profile, traits: [] } })).toBe(false);
  });

  it('⚠️ 有标签但没有溯源 → 不展示', () => {
    expect(
      shouldExposePortrait({ profile: { ...valid.profile, explain: { items: [] } } }),
    ).toBe(false);
  });

  it('⚠️ 某个标签缺溯源 → 整体不展示', () => {
    expect(
      shouldExposePortrait({
        profile: {
          ...valid.profile,
          traits: [
            ...valid.profile.traits,
            { key: 'mystery_trait', label: '说不清来源', level: 'high', value: 99 },
          ],
        },
      }),
    ).toBe(false);
  });
});
