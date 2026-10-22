import { describe, expect, it } from 'vitest';

import {
  describeRemaining,
  describeSinceConfirm,
  describeTeabreakProblem,
  sortTeabreaks,
  TEABREAK_ACCESS,
  TEABREAK_ACCESS_HINTS,
  TEABREAK_ACCESS_LABELS,
  TEABREAK_FRESHNESS_LABELS,
  TEABREAK_FRESHNESS_MS,
  teabreakStatus,
  validateTeabreakDraft,
  type Teabreak,
  type TeabreakConfirm,
} from './teabreaks';

/**
 * 学术会议茶歇分享的规则层。
 *
 * ## 这组测试的重心
 *
 * 1. **茶歇有保质期** —— 20 分钟没人确认就该降级，这是本模块的核心机制
 * 2. **`stale` 仍然值得去** —— 但文案要说清是「可能还有」
 * 3. **排序真的按「先冲哪个」** —— 快结束的排前面
 * 4. **茶歇必须在会议时间窗内** —— 否则是填错了
 * 5. **access 三态都有风险提示** —— 不谴责蹭会，但要说事实
 */
const NOW = new Date('2026-10-22T06:00:00.000Z');

function confirm(minutesAgo: number): TeabreakConfirm {
  return {
    confirmId: `c-${minutesAgo}`,
    confirmedAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
  };
}

function teabreak(over: Partial<Teabreak> = {}): Teabreak {
  return {
    id: 'T-1',
    conferenceName: '第七届信息科学前沿论坛',
    venue: '信息学院 1-101',
    conferenceStartsAt: '2026-10-22T05:00:00.000Z',
    conferenceEndsAt: '2026-10-22T09:00:00.000Z',
    teaStartsAt: '2026-10-22T05:30:00.000Z',
    teaEndsAt: '2026-10-22T06:20:00.000Z',
    access: 'open',
    postedBy: '李四',
    createdAt: '2026-10-22T04:00:00.000Z',
    confirms: [],
    note: null,
    ...over,
  };
}

describe('茶歇的保质期：这是本模块的核心机制', () => {
  it('20 分钟内有人确认 → fresh', () => {
    const s = teabreakStatus(teabreak({ confirms: [confirm(5)] }), NOW);
    expect(s.freshness).toBe('fresh');
    expect(s.sinceLastConfirmMs).toBe(5 * 60_000);
    expect(s.worthGoing).toBe(true);
  });

  it('⚠️ 超过 20 分钟没确认 → 降级为 stale（但**仍然值得去**）', () => {
    const s = teabreakStatus(teabreak({ confirms: [confirm(45)] }), NOW);
    expect(s.freshness).toBe('stale');
    // 关键：判断「值不值得去」看的是**时间窗**，不是新鲜度
    expect(s.worthGoing).toBe(true);
  });

  it('从未被确认 → stale，且 sinceLastConfirmMs 为 null', () => {
    const s = teabreakStatus(teabreak({ confirms: [] }), NOW);
    expect(s.freshness).toBe('stale');
    expect(s.sinceLastConfirmMs).toBeNull();
    expect(s.worthGoing).toBe(true);
  });

  it('窗口边界：正好 20 分钟还算 fresh，多 1 毫秒就不算', () => {
    const exactly = teabreakStatus(
      teabreak({ confirms: [{ confirmId: 'x', confirmedAt: new Date(NOW.getTime() - TEABREAK_FRESHNESS_MS).toISOString() }] }),
      NOW,
    );
    expect(exactly.freshness).toBe('fresh');

    const over = teabreakStatus(
      teabreak({ confirms: [{ confirmId: 'x', confirmedAt: new Date(NOW.getTime() - TEABREAK_FRESHNESS_MS - 1).toISOString() }] }),
      NOW,
    );
    expect(over.freshness).toBe('stale');
  });

  it('多条确认取**最近**那条', () => {
    const s = teabreakStatus(teabreak({ confirms: [confirm(60), confirm(3), confirm(30)] }), NOW);
    expect(s.freshness).toBe('fresh');
    expect(s.sinceLastConfirmMs).toBe(3 * 60_000);
  });

  it('已过结束时间 → over，绝不 worthGoing', () => {
    const s = teabreakStatus(teabreak({ teaEndsAt: '2026-10-22T05:59:00.000Z' }), NOW);
    expect(s.freshness).toBe('over');
    expect(s.worthGoing).toBe(false);
  });

  it('还没到开始时间 → notStarted，不值得去', () => {
    const s = teabreakStatus(teabreak({ teaStartsAt: '2026-10-22T07:00:00.000Z' }), NOW);
    expect(s.freshness).toBe('notStarted');
    expect(s.worthGoing).toBe(false);
  });

  it('⚠️ 即使刚刚被确认，已结束也不能 worthGoing', () => {
    // 这条防的是：有人 5 分钟前确认「还有」，但结束时间已过 —— 那就是收摊了
    const s = teabreakStatus(
      teabreak({ teaEndsAt: '2026-10-22T05:59:00.000Z', confirms: [confirm(5)] }),
      NOW,
    );
    expect(s.freshness).toBe('over');
    expect(s.worthGoing).toBe(false);
  });
});

describe('排序：先冲哪个', () => {
  it('值得去的排在已结束的前面', () => {
    const live = teabreak({ id: 'live', teaStartsAt: '2026-10-22T05:30:00.000Z', teaEndsAt: '2026-10-22T06:20:00.000Z' });
    const dead = teabreak({ id: 'dead', teaStartsAt: '2026-10-21T05:00:00.000Z', teaEndsAt: '2026-10-21T05:30:00.000Z' });
    const sorted = sortTeabreaks([dead, live], NOW);
    expect(sorted.map((t) => t.id)).toEqual(['live', 'dead']);
  });

  it('都是 worthGoing 时 fresh 排在 stale 前面', () => {
    const fresh = teabreak({ id: 'fresh', confirms: [confirm(2)] });
    const stale = teabreak({ id: 'stale', confirms: [confirm(90)] });
    expect(sortTeabreaks([stale, fresh], NOW).map((t) => t.id)).toEqual(['fresh', 'stale']);
  });

  it('⚠️ 同样新鲜度时，**快结束的**排前面（它先没了）', () => {
    const soon = teabreak({ id: 'soon', teaStartsAt: '2026-10-22T05:30:00.000Z', teaEndsAt: '2026-10-22T06:05:00.000Z' });
    const later = teabreak({ id: 'later', teaStartsAt: '2026-10-22T05:30:00.000Z', teaEndsAt: '2026-10-22T06:45:00.000Z' });
    expect(sortTeabreaks([later, soon], NOW).map((t) => t.id)).toEqual(['soon', 'later']);
  });

  it('不修改入参（返回新数组）', () => {
    const a = teabreak({ id: 'a' });
    const b = teabreak({ id: 'b', confirms: [confirm(1)] });
    const input = [a, b];
    const sorted = sortTeabreaks(input, NOW);
    expect(input.map((t) => t.id)).toEqual(['a', 'b']);
    expect(sorted).not.toBe(input);
  });
});

describe('草稿校验', () => {
  const good = {
    conferenceName: '第七届信息科学前沿论坛',
    venue: '信息学院 1-101',
    conferenceStartsAt: '2026-10-22T07:00:00.000Z',
    conferenceEndsAt: '2026-10-22T10:00:00.000Z',
    teaStartsAt: '2026-10-22T08:00:00.000Z',
    teaEndsAt: '2026-10-22T08:30:00.000Z',
  };

  it('合法草稿无问题', () => {
    expect(validateTeabreakDraft(good, NOW)).toEqual([]);
  });

  it('会议名/地点长度', () => {
    expect(validateTeabreakDraft({ ...good, conferenceName: 'AB' }, NOW)).toContain('conference-too-short');
    expect(validateTeabreakDraft({ ...good, conferenceName: 'A'.repeat(81) }, NOW)).toContain('conference-too-long');
    expect(validateTeabreakDraft({ ...good, venue: 'A' }, NOW)).toContain('venue-too-short');
    expect(validateTeabreakDraft({ ...good, venue: 'A'.repeat(61) }, NOW)).toContain('venue-too-long');
  });

  it('会议结束必须晚于开始', () => {
    expect(
      validateTeabreakDraft(
        { ...good, conferenceEndsAt: '2026-10-22T06:00:00.000Z' },
        NOW,
      ),
    ).toContain('conference-end-before-start');
  });

  it('茶歇窗口 10 分钟到 3 小时', () => {
    expect(
      validateTeabreakDraft({ ...good, teaEndsAt: '2026-10-22T08:05:00.000Z' }, NOW),
    ).toContain('tea-window-too-short');
    expect(
      validateTeabreakDraft({ ...good, teaEndsAt: '2026-10-22T12:00:00.000Z' }, NOW),
    ).toContain('tea-window-too-long');
  });

  it('⚠️ 茶歇必须在会议时间之内', () => {
    // 茶歇开始在会议开始之前
    expect(
      validateTeabreakDraft(
        { ...good, teaStartsAt: '2026-10-22T06:00:00.000Z', teaEndsAt: '2026-10-22T06:30:00.000Z' },
        NOW,
      ),
    ).toContain('tea-outside-conference');
    // 茶歇结束在会议结束之后
    expect(
      validateTeabreakDraft(
        { ...good, teaStartsAt: '2026-10-22T09:30:00.000Z', teaEndsAt: '2026-10-22T10:30:00.000Z' },
        NOW,
      ),
    ).toContain('tea-outside-conference');
  });

  it('贴边是允许的（茶歇正好从会议开始到会议结束）', () => {
    expect(
      validateTeabreakDraft(
        { ...good, teaStartsAt: good.conferenceStartsAt, teaEndsAt: good.conferenceEndsAt },
        NOW,
      ),
    ).toEqual([]);
  });

  it('已经结束的会不能发', () => {
    expect(
      validateTeabreakDraft(
        {
          ...good,
          conferenceStartsAt: '2026-10-21T07:00:00.000Z',
          conferenceEndsAt: '2026-10-21T10:00:00.000Z',
          teaStartsAt: '2026-10-21T08:00:00.000Z',
          teaEndsAt: '2026-10-21T08:30:00.000Z',
        },
        NOW,
      ),
    ).toContain('in-the-past');
  });

  it('时间解析不了时不会崩，只报一个错', () => {
    const problems = validateTeabreakDraft({ ...good, teaStartsAt: '不是时间' }, NOW);
    expect(problems).toContain('tea-window-too-short');
    expect(problems.length).toBeLessThanOrEqual(2);
  });

  it('每个问题码都有中文提示，且互不相同', () => {
    const codes = [
      'conference-too-short',
      'conference-too-long',
      'venue-too-short',
      'venue-too-long',
      'conference-end-before-start',
      'tea-window-too-short',
      'tea-window-too-long',
      'tea-outside-conference',
      'in-the-past',
    ] as const;
    const texts = codes.map((c) => describeTeabreakProblem(c));
    for (const t of texts) expect(t.length).toBeGreaterThan(5);
    expect(new Set(texts).size).toBe(codes.length);
  });
});

describe('人话文案', () => {
  it('describeRemaining', () => {
    expect(describeRemaining('2026-10-22T06:20:00.000Z', NOW)).toBe('还有 20 分钟');
    expect(describeRemaining('2026-10-22T05:59:00.000Z', NOW)).toBe('已结束');
    expect(describeRemaining('2026-10-22T07:30:00.000Z', NOW)).toBe('还有 1 小时 30 分钟');
    expect(describeRemaining('2026-10-22T08:00:00.000Z', NOW)).toBe('还有 2 小时');
    expect(describeRemaining('坏值', NOW)).toBe('');
  });

  it('describeSinceConfirm', () => {
    expect(describeSinceConfirm(null)).toBe('还没有人确认');
    expect(describeSinceConfirm(30_000)).toBe('刚刚确认');
    expect(describeSinceConfirm(5 * 60_000)).toBe('5 分钟前确认');
    expect(describeSinceConfirm(3 * 3600_000)).toBe('3 小时前确认');
  });
});

describe('⚠️ access 三态都有风险提示（不谴责蹭会，但要说事实）', () => {
  it('每种开放程度都有 label 与 hint', () => {
    for (const access of TEABREAK_ACCESS) {
      expect(TEABREAK_ACCESS_LABELS[access].length).toBeGreaterThan(2);
      expect(TEABREAK_ACCESS_HINTS[access].length).toBeGreaterThan(5);
    }
  });

  it('registered 的提示必须说明「可能被询问」', () => {
    // 这不是说教，是让用户知道去了会发生什么
    expect(TEABREAK_ACCESS_HINTS.registered).toContain('询问');
  });

  it('四种新鲜度都有中文 label', () => {
    for (const f of ['fresh', 'stale', 'over', 'notStarted'] as const) {
      expect(TEABREAK_FRESHNESS_LABELS[f].length).toBeGreaterThan(1);
    }
  });

  it('⚠️ 没有「催人蹭会」的措辞（保持中立）', () => {
    // 模块不鼓励也不阻止；出现「冲」「蹭就完了」这类词就说明文案失守了
    for (const access of TEABREAK_ACCESS) {
      const hint = TEABREAK_ACCESS_HINTS[access];
      expect(hint).not.toContain('冲');
      expect(hint).not.toContain('蹭就');
    }
  });
});
