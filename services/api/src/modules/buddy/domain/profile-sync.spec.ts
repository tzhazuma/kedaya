import { describe, expect, it } from 'vitest';
import { syncProfileFromAnswers, SYNCABLE_PROFILE_KEYS } from './profile-sync';

/**
 * 规格 §2.6：答案 → `BuddyProfile` 的**白名单同步**。
 *
 * 核心断言：**非白名单键绝不落到资料表**。
 * 这条不是"锦上添花的校验"—— 它是数据最小化的技术落地：
 * 运营在 DB 里加一道"你的理想型是什么"的题，如果同步逻辑是"把答案都写进去"，
 * 答案就会静默进入匹配资料表，那是**没有经过评审的新用途**（规格 §6.3）。
 */
describe('syncProfileFromAnswers（规格 §2.6 白名单同步）', () => {
  it('白名单里的 6 个键可以同步', () => {
    expect(SYNCABLE_PROFILE_KEYS).toEqual([
      'interestTags',
      'activityTags',
      'availability',
      'skillLevel',
      'preferredAreas',
      'department',
    ]);

    const { patch } = syncProfileFromAnswers({
      interestTags: ['badminton'],
      activityTags: ['self-study'],
      availability: [{ dow: 6, startMin: 840, endMin: 1020 }],
      skillLevel: 'regular',
      preferredAreas: ['图书馆'],
      department: '信息学院',
    });

    expect(patch).toEqual({
      interestTags: ['badminton'],
      activityTags: ['self-study'],
      availability: [{ dow: 6, startMin: 840, endMin: 1020 }],
      skillLevel: 'regular',
      preferredAreas: ['图书馆'],
      department: '信息学院',
    });
  });

  it('**非白名单键绝不进 patch**（数据最小化的技术落地）', () => {
    const { patch, ignored } = syncProfileFromAnswers({
      interestTags: ['badminton'],
      datingPurpose: '找对象',
      familyStatus: '未婚',
      idealPerson: '温柔',
      mbti: 'INFP',
      gender: 'female',
      age: 20,
      phone: '13812345678',
    });

    expect(patch).toEqual({ interestTags: ['badminton'] });
    expect(Object.keys(patch)).not.toContain('datingPurpose');
    expect(Object.keys(patch)).not.toContain('mbti');
    expect(Object.keys(patch)).not.toContain('gender');
    // 非白名单键是**正常**情况（只进 answers），不记为 ignored，避免噪音
    expect(ignored).toEqual([]);
  });

  it('未登记的标签被丢弃并记录原因（不让下架标签悄悄进匹配特征）', () => {
    const { patch, ignored } = syncProfileFromAnswers({ interestTags: ['badminton', 'not-a-tag'] });
    expect(patch.interestTags).toBeUndefined();
    expect(ignored[0]?.key).toBe('interestTags');
    expect(ignored[0]?.reason).toContain('not-a-tag');
  });

  it('数量上限：interestTags ≤20、activityTags ≤10、preferredAreas ≤5', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
    expect(syncProfileFromAnswers({ interestTags: many(21) }).patch.interestTags).toBeUndefined();
    expect(syncProfileFromAnswers({ activityTags: many(11) }).patch.activityTags).toBeUndefined();
    expect(syncProfileFromAnswers({ preferredAreas: many(6) }).patch.preferredAreas).toBeUndefined();

    // 边界：刚好到上限可以通过
    expect(syncProfileFromAnswers({ department: 'x'.repeat(64) }).patch.department).toHaveLength(64);
    expect(syncProfileFromAnswers({ department: 'x'.repeat(65) }).patch.department).toBeUndefined();
  });

  it('时段格式校验：dow 0–6、endMin > startMin、≤1439', () => {
    const bad = [
      [{ dow: 7, startMin: 0, endMin: 60 }],
      [{ dow: -1, startMin: 0, endMin: 60 }],
      [{ dow: 1, startMin: 100, endMin: 100 }],
      [{ dow: 1, startMin: 200, endMin: 100 }],
      [{ dow: 1, startMin: 0, endMin: 1440 }],
      [{ dow: 1.5, startMin: 0, endMin: 60 }],
      'not-an-array',
    ];
    for (const availability of bad) {
      const { patch, ignored } = syncProfileFromAnswers({ availability });
      expect(patch.availability, JSON.stringify(availability)).toBeUndefined();
      expect(ignored[0]?.key).toBe('availability');
    }
  });

  it('合法时段通过', () => {
    const { patch } = syncProfileFromAnswers({ availability: [{ dow: 0, startMin: 0, endMin: 1 }] });
    expect(patch.availability).toEqual([{ dow: 0, startMin: 0, endMin: 1 }]);
  });

  it('skillLevel 必须是枚举值', () => {
    expect(syncProfileFromAnswers({ skillLevel: 'regular' }).patch.skillLevel).toBe('regular');
    expect(syncProfileFromAnswers({ skillLevel: 'pro' }).patch.skillLevel).toBeUndefined();
  });

  it('preferredAreas 必须在校园地点白名单里', () => {
    expect(syncProfileFromAnswers({ preferredAreas: ['图书馆'] }).patch.preferredAreas).toEqual(['图书馆']);
    expect(syncProfileFromAnswers({ preferredAreas: ['校外某小区'] }).patch.preferredAreas).toBeUndefined();
  });

  it('标签去重（重复项不占额度）', () => {
    const { patch } = syncProfileFromAnswers({ interestTags: ['music', 'music', 'movie'] });
    expect(patch.interestTags).toEqual(['music', 'movie']);
  });

  it('空答案 / 非对象答案安全处理', () => {
    expect(syncProfileFromAnswers({})).toEqual({ patch: {}, ignored: [] });
    expect(syncProfileFromAnswers(null).ignored[0]?.key).toBe('*');
    expect(syncProfileFromAnswers('nope').ignored[0]?.key).toBe('*');
  });

  it('一个键非法不影响其他键（用户不该因为一个字段写错就整份失败）', () => {
    const { patch, ignored } = syncProfileFromAnswers({
      interestTags: ['badminton'],
      skillLevel: 'pro', // 非法
      department: '信息学院',
    });
    expect(patch.interestTags).toEqual(['badminton']);
    expect(patch.department).toBe('信息学院');
    expect(ignored.map((item) => item.key)).toEqual(['skillLevel']);
  });
});
