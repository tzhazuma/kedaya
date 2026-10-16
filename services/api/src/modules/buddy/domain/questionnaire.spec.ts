import { describe, expect, it } from 'vitest';
import { parseQuestions, validateAnswers, type Question } from './questionnaire';

/**
 * 规格 §2.6：题型与校验（移植 STUMatch `questionnaires.py:30-107`）。
 *
 * 题型集合刻意保留 STUMatch 的四种（`single_choice` / `multiple_choice` /
 * `rating` / `text`），因为它是可用的最小设计：
 * 题目定义存 DB（可运营调整，不需发版），答案存 JSON。
 */
const QUESTIONS: Question[] = [
  {
    id: 'interestTags',
    type: 'multiple_choice',
    options: [
      { value: 'badminton', label: '羽毛球' },
      { value: 'music', label: '音乐' },
      { value: 'movie', label: '电影' },
    ],
  },
  {
    id: 'skillLevel',
    type: 'single_choice',
    required: true,
    options: [
      { value: 'beginner', label: '新手' },
      { value: 'regular', label: '经常打' },
    ],
  },
  { id: 'weeklyHours', type: 'rating', min: 1, max: 5 },
  { id: 'bio', type: 'text', maxLength: 20 },
];

describe('parseQuestions（题目定义校验）', () => {
  it('合法题目解析成功', () => {
    const parsed = parseQuestions([
      { id: 'q1', type: 'single_choice', options: [{ value: 'a', label: 'A' }] },
      { id: 'q2', type: 'rating', min: 1, max: 5 },
      { id: 'q3', type: 'text', maxLength: 10 },
      { id: 'q4', type: 'multiple_choice', options: [{ value: 'x', label: 'X' }] },
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.questions).toHaveLength(4);
  });

  it('非法题目整体拒绝（不静默忽略一道题）', () => {
    const bad = [
      'not-an-array',
      [{}],
      [{ id: 'q1', type: 'unknown' }],
      [{ id: 'q1', type: 'single_choice' }], // 缺 options
      [{ id: 'q1', type: 'single_choice', options: [] }],
      [{ id: 'q1', type: 'rating', min: 5, max: 1 }],
      [{ id: 'q1', type: 'text' }], // 缺 maxLength
      [
        { id: 'dup', type: 'text', maxLength: 5 },
        { id: 'dup', type: 'text', maxLength: 5 },
      ],
    ];
    for (const questions of bad) {
      expect(parseQuestions(questions).ok, JSON.stringify(questions)).toBe(false);
    }
  });

  it('option 缺 label 时回落为 value（运营可以只填 value）', () => {
    const parsed = parseQuestions([{ id: 'q', type: 'single_choice', options: [{ value: 'a' }] }]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect((parsed.questions[0] as { options: Array<{ label: string }> }).options[0]?.label).toBe('a');
    }
  });
});

describe('validateAnswers（答案校验与规整）', () => {
  it('全部合法 → ok，且只保留已声明题目的答案', () => {
    const result = validateAnswers(QUESTIONS, {
      interestTags: ['badminton', 'music'],
      skillLevel: 'regular',
      weeklyHours: 3,
      bio: '常打羽毛球',
      unknownQuestion: 'should be dropped',
    });
    expect(result.ok).toBe(true);
    expect(result.answers).toEqual({
      interestTags: ['badminton', 'music'],
      skillLevel: 'regular',
      weeklyHours: 3,
      bio: '常打羽毛球',
    });
  });

  it('未知题目 id 被**丢弃**（题目可能已下架，用户手里还是旧版小程序）', () => {
    const result = validateAnswers(QUESTIONS, { skillLevel: 'regular', removedQuestion: 'x' });
    expect(result.ok).toBe(true);
    expect(result.answers).not.toHaveProperty('removedQuestion');
  });

  it('必填缺失 → 报错', () => {
    const result = validateAnswers(QUESTIONS, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ questionId: 'skillLevel', reason: '必填' }]);
  });

  it('显式 null 与"没传"等价（小程序清空输入框会发 null）', () => {
    const result = validateAnswers(QUESTIONS, { skillLevel: null });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.questionId).toBe('skillLevel');
  });

  it('非必填缺失 → 通过且不进 answers', () => {
    const result = validateAnswers(QUESTIONS, { skillLevel: 'regular' });
    expect(result.ok).toBe(true);
    expect(Object.keys(result.answers)).toEqual(['skillLevel']);
  });

  it('single_choice 非法选项 → 报错', () => {
    const result = validateAnswers(QUESTIONS, { skillLevel: 'pro' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.reason).toBe('不是合法选项');
  });

  it('multiple_choice：非数组 / 含非法项 → 报错；重复项被去重', () => {
    expect(validateAnswers(QUESTIONS, { skillLevel: 'regular', interestTags: 'music' }).ok).toBe(false);
    expect(
      validateAnswers(QUESTIONS, { skillLevel: 'regular', interestTags: ['music', 'nope'] }).ok,
    ).toBe(false);

    const deduped = validateAnswers(QUESTIONS, {
      skillLevel: 'regular',
      interestTags: ['music', 'music'],
    });
    expect(deduped.answers.interestTags).toEqual(['music']);
  });

  it('rating：必须是整数且在 min–max 内', () => {
    expect(validateAnswers(QUESTIONS, { skillLevel: 'regular', weeklyHours: 0 }).ok).toBe(false);
    expect(validateAnswers(QUESTIONS, { skillLevel: 'regular', weeklyHours: 6 }).ok).toBe(false);
    expect(validateAnswers(QUESTIONS, { skillLevel: 'regular', weeklyHours: 2.5 }).ok).toBe(false);
    expect(validateAnswers(QUESTIONS, { skillLevel: 'regular', weeklyHours: 1 }).ok).toBe(true);
    expect(validateAnswers(QUESTIONS, { skillLevel: 'regular', weeklyHours: 5 }).ok).toBe(true);
  });

  it('text：必须是字符串且不超长', () => {
    expect(validateAnswers(QUESTIONS, { skillLevel: 'regular', bio: 123 }).ok).toBe(false);
    expect(validateAnswers(QUESTIONS, { skillLevel: 'regular', bio: 'x'.repeat(21) }).ok).toBe(false);
    expect(validateAnswers(QUESTIONS, { skillLevel: 'regular', bio: 'x'.repeat(20) }).ok).toBe(true);
  });

  it('多个错误一次性全部返回（不逐次试错）', () => {
    const result = validateAnswers(QUESTIONS, { skillLevel: 'bad', weeklyHours: 99, bio: 1 });
    expect(result.errors).toHaveLength(3);
  });

  it('answers 不是对象 → 单条全局错误', () => {
    const result = validateAnswers(QUESTIONS, 'nope');
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ questionId: '*', reason: 'answers 不是对象' }]);
  });

  it('undefined / null 视为空答案对象（必填会报错，其余通过）', () => {
    expect(validateAnswers(QUESTIONS, undefined).errors).toEqual([{ questionId: 'skillLevel', reason: '必填' }]);
    expect(validateAnswers(QUESTIONS, null).errors).toEqual([{ questionId: 'skillLevel', reason: '必填' }]);
  });
});
