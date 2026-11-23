import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_EVIDENCE_MAX_CHARS,
  ACTIVITY_SOURCE_LABELS,
  ACTIVITY_TIMEZONE,
  extractActivityCandidates,
  truncateActivityEvidence,
  type ActivityArticleLike,
} from './activities-extract';

/**
 * 公众号单篇 → 活动候选。
 *
 * 这里锁的是「不猜」和「不存全文」两条边界：
 *   · 只有报名截止的活动也要能抽出来；
 *   · 日期只有「10月24日」时保留原文，不补 23:59；
 *   · 认不出时间（「本周五下午两点」）就不产出候选；
 *   · 证据片段永远 ≤200 字；
 *   · 同一篇文章里的重复事件只留一条。
 */

const NOW = new Date('2026-10-20T00:00:00.000Z');

function article(over: Partial<ActivityArticleLike> = {}): ActivityArticleLike {
  return {
    title: '本周活动预告',
    accountName: '上科大信息学院',
    publishedAt: '2026-10-20T02:00:00.000+08:00',
    bodyLines: [],
    sourceUrl: 'https://mp.weixin.qq.com/s/abc',
    ...over,
  };
}

describe('共享展示常量', () => {
  it('时区与来源文案与契约一致，供 API / Web 复用', () => {
    expect(ACTIVITY_TIMEZONE).toBe('Asia/Shanghai');
    expect(ACTIVITY_SOURCE_LABELS['campus-mail']).toContain('邮箱');
    expect(ACTIVITY_SOURCE_LABELS['wechat-mp']).toContain('公众号');
    expect(ACTIVITY_SOURCE_LABELS.manual).toContain('手动');
  });
});

describe('extractActivityCandidates —— 多活动文章', () => {
  const full = article({
    bodyLines: [
      '本周活动预告',
      '【学术讲座】大模型与推理',
      '时间：2026年10月25日 14:00-16:00',
      '地点：信息学院 1-101 报告厅',
      '主办：信息科学与技术学院',
      '报名截止：2026年10月23日 12:00',
      '报名链接：https://events.shanghaitech.edu.cn/signup?id=42&sid=secret',
      '',
      '【工作坊】摄影入门',
      '时间：10月26日 19:00',
      '地点：创艺学院 305',
      '报名截止：10月24日',
      '扫码报名',
      'https://mp.weixin.qq.com/s/abc',
    ],
  });

  it('抽出两条候选，并按正文顺序排列', () => {
    const candidates = extractActivityCandidates(full, { now: NOW, timeZone: 'Asia/Shanghai' });
    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.title).toBe('【学术讲座】大模型与推理');
    expect(candidates[1]?.title).toBe('【工作坊】摄影入门');
  });

  it('开始/结束时刻按 Asia/Shanghai 解释，存 UTC ISO', () => {
    const [first] = extractActivityCandidates(full, { now: NOW, timeZone: 'Asia/Shanghai' });
    expect(first?.startsAt).toBe('2026-10-25T06:00:00.000Z');
    expect(first?.endsAt).toBe('2026-10-25T08:00:00.000Z');
    expect(first?.registrationDeadlineAt).toBe('2026-10-23T04:00:00.000Z');
    expect(first?.registrationDeadlineRaw).toBe('2026年10月23日 12:00');
  });

  it('地点、主办、报名链接都从正文里取；链接去掉会话参数', () => {
    const [first] = extractActivityCandidates(full, { now: NOW, timeZone: 'Asia/Shanghai' });
    expect(first?.location).toBe('信息学院 1-101 报告厅');
    expect(first?.organizer).toBe('信息科学与技术学院');
    expect(first?.registrationUrl).toBe('https://events.shanghaitech.edu.cn/signup?id=42');
    expect(first?.registrationUrl).not.toContain('sid=');
  });

  it('日期只有「10月24日」时保留原文，不擅自补 23:59', () => {
    const [, second] = extractActivityCandidates(full, { now: NOW, timeZone: 'Asia/Shanghai' });
    expect(second?.startsAt).toBe('2026-10-26T11:00:00.000Z');
    expect(second?.endsAt).toBeNull();
    expect(second?.registrationDeadlineAt).toBeNull();
    expect(second?.registrationDeadlineRaw).toBe('10月24日');
    expect(second?.registrationDeadlineRaw).not.toContain('23:59');
  });

  it('证据片段只覆盖本条活动的细节行，且不超过 200 字', () => {
    const [first, second] = extractActivityCandidates(full, { now: NOW, timeZone: 'Asia/Shanghai' });
    expect(first?.evidenceText).toContain('报名截止：2026年10月23日 12:00');
    expect(first?.evidenceText).toContain('时间：2026年10月25日 14:00-16:00');
    expect(first?.evidenceText).not.toContain('摄影入门');
    expect(second?.evidenceText).toContain('摄影入门');
    for (const candidate of [first, second]) {
      expect(candidate?.evidenceText.length ?? 0).toBeLessThanOrEqual(ACTIVITY_EVIDENCE_MAX_CHARS);
    }
  });

  it('字段完整的候选置信度高于只有截止日期的候选', () => {
    const [first, second] = extractActivityCandidates(full, { now: NOW, timeZone: 'Asia/Shanghai' });
    expect(first?.confidence).toBeGreaterThan(second?.confidence ?? 1);
    for (const candidate of [first, second]) {
      expect(candidate?.confidence ?? -1).toBeGreaterThan(0);
      expect(candidate?.confidence ?? 2).toBeLessThanOrEqual(1);
    }
  });
});

describe('extractActivityCandidates —— 边界', () => {
  it('只有报名截止、没有开始时间时也产出候选', () => {
    const onlyDeadline = article({
      bodyLines: [
        '活动预告',
        '【讲座】如何做科研',
        '报名截止：2026年10月23日 12:00',
        '报名链接：https://example.com/signup',
      ],
    });
    const candidates = extractActivityCandidates(onlyDeadline, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.startsAt).toBeNull();
    expect(candidates[0]?.registrationDeadlineAt).toBe('2026-10-23T04:00:00.000Z');
    expect(candidates[0]?.title).toBe('【讲座】如何做科研');
  });

  it('认不出可靠时间就不产出候选（「本周五下午两点」不硬猜）', () => {
    const vague = article({
      bodyLines: ['活动预告', '【活动】本周五下午两点', '本周五下午两点 地点：图书馆 报名请扫码'],
    });
    expect(extractActivityCandidates(vague, { now: NOW, timeZone: 'Asia/Shanghai' })).toEqual([]);
  });

  it('非法日期不产出候选（2026年2月30日不算可靠时间）', () => {
    const invalid = article({
      bodyLines: ['活动预告', '时间：2026年2月30日 14:00 地点：图书馆 报名'],
    });
    expect(extractActivityCandidates(invalid, { now: NOW, timeZone: 'Asia/Shanghai' })).toEqual([]);
  });

  it('「报名将于10月23日 12:00 截止」也能识别（日期在「截止」之前）', () => {
    const deadlineFirst = article({
      bodyLines: [
        '活动预告',
        '【讲座】截止在前',
        '时间：2026年10月25日 14:00 地点：图书馆 报名',
        '报名将于2026年10月23日 12:00 截止',
      ],
    });
    const candidates = extractActivityCandidates(deadlineFirst, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.registrationDeadlineAt).toBe('2026-10-23T04:00:00.000Z');
  });

  it('只有「报名将于…截止」时不把截止时刻当成开始时间', () => {
    const onlyDeadlineBefore = article({
      bodyLines: ['活动预告', '【讲座】只有截止', '报名将于2026年10月23日 12:00 截止'],
    });
    const candidates = extractActivityCandidates(onlyDeadlineBefore, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.startsAt).toBeNull();
    expect(candidates[0]?.registrationDeadlineAt).toBe('2026-10-23T04:00:00.000Z');
  });

  it('斜杠日期 2026/10/25 14:00 也按 Asia/Shanghai 解释', () => {
    const slash = article({
      bodyLines: ['活动预告', '时间：2026/10/25 14:00 地点：图书馆 报名'],
    });
    const candidates = extractActivityCandidates(slash, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.startsAt).toBe('2026-10-25T06:00:00.000Z');
  });

  it('斜杠日期的报名截止也能解析', () => {
    const slashDeadline = article({
      bodyLines: [
        '活动预告',
        '【讲座】斜杠截止',
        '时间：2026/10/25 14:00 地点：图书馆 报名',
        '报名截止：2026/10/23 12:00',
      ],
    });
    const candidates = extractActivityCandidates(slashDeadline, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.registrationDeadlineAt).toBe('2026-10-23T04:00:00.000Z');
  });

  it('「报名时间：即日起至10月23日 12:00」也能识别', () => {
    const until = article({
      bodyLines: [
        '活动预告',
        '【讲座】报名至',
        '时间：2026年10月25日 14:00 地点：图书馆',
        '报名时间：即日起至10月23日 12:00',
      ],
    });
    const candidates = extractActivityCandidates(until, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.registrationDeadlineAt).toBe('2026-10-23T04:00:00.000Z');
  });

  it('同篇重复的同一活动只留一条', () => {
    const duplicated = article({
      bodyLines: [
        '活动预告',
        '【讲座】重复事件',
        '时间：2026年11月1日 10:00-11:30',
        '地点：图书馆 302',
        '报名截止：2026年10月30日 18:00',
        '【讲座】重复事件',
        '时间：2026年11月1日 10:00-11:30',
        '地点：图书馆 302',
        '报名截止：2026年10月30日 18:00',
      ],
    });
    const candidates = extractActivityCandidates(duplicated, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.startsAt).toBe('2026-11-01T02:00:00.000Z');
  });

  it('纯日期行不当作小标题（标题回落到文章标题）', () => {
    const dateHeading = article({
      title: '周末活动',
      bodyLines: ['2026年10月25日', '时间：2026年10月25日 14:00 地点：图书馆 报名'],
    });
    const candidates = extractActivityCandidates(dateHeading, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    expect(candidates[0]?.title).toBe('周末活动');
  });

  it('没有小标题时用文章标题兜底', () => {
    const noHeading = article({
      title: '摄影工作坊报名',
      bodyLines: ['时间：2026年10月25日 14:00 地点：图书馆 报名请扫码'],
    });
    const candidates = extractActivityCandidates(noHeading, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.title).toBe('摄影工作坊报名');
  });

  it('正文为空时返回空数组，不抛异常', () => {
    expect(
      extractActivityCandidates(article({ bodyLines: [] }), {
        now: NOW,
        timeZone: 'Asia/Shanghai',
      }),
    ).toEqual([]);
  });

  it('maxCandidates 限制产出数量', () => {
    const many = article({
      bodyLines: [
        '活动预告',
        '【讲座】一',
        '时间：2026年11月1日 10:00 地点：图书馆 报名',
        '【讲座】二',
        '时间：2026年11月2日 10:00 地点：图书馆 报名',
        '【讲座】三',
        '时间：2026年11月3日 10:00 地点：图书馆 报名',
      ],
    });
    expect(
      extractActivityCandidates(many, { now: NOW, timeZone: 'Asia/Shanghai', maxCandidates: 2 }),
    ).toHaveLength(2);
  });
});

describe('extractActivityCandidates —— 截止与报名窗口', () => {
  it('裸「截止时间」产出仅报名截止候选，不当作开始时间', () => {
    const bare = article({
      bodyLines: [
        '活动预告',
        '【讲座】裸截止',
        '截止时间：2026年10月23日 12:00',
        '报名链接：https://example.com/signup',
      ],
    });
    const candidates = extractActivityCandidates(bare, { now: NOW, timeZone: 'Asia/Shanghai' });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.startsAt).toBeNull();
    expect(candidates[0]?.registrationDeadlineAt).toBe('2026-10-23T04:00:00.000Z');
  });

  it('截止在前、活动时间在后时，开始时间取活动时间', () => {
    const deadlineFirst = article({
      bodyLines: [
        '活动预告',
        '【讲座】截止在前',
        '截止时间：2026年10月23日 12:00 活动时间：2026年10月25日 14:00 地点：图书馆 报名',
      ],
    });
    const [candidate] = extractActivityCandidates(deadlineFirst, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    expect(candidate?.startsAt).toBe('2026-10-25T06:00:00.000Z');
    expect(candidate?.registrationDeadlineAt).toBe('2026-10-23T04:00:00.000Z');
  });

  it('报名窗口的起点不当作活动开始；截止仍取窗口结束', () => {
    const window = article({
      bodyLines: [
        '活动预告',
        '【讲座】报名窗口',
        '报名时间：2026年10月20日 09:00 至 2026年10月23日 12:00',
        '活动时间：2026年10月25日 14:00 地点：图书馆',
      ],
    });
    const [candidate] = extractActivityCandidates(window, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    expect(candidate?.startsAt).toBe('2026-10-25T06:00:00.000Z');
    expect(candidate?.registrationDeadlineAt).toBe('2026-10-23T04:00:00.000Z');
  });

  it('只有报名窗口时：开始为 null，截止取窗口结束', () => {
    const onlyWindow = article({
      bodyLines: [
        '活动预告',
        '【讲座】只有报名窗口',
        '报名时间：2026年10月20日 09:00 至 2026年10月23日 12:00',
        '报名链接：https://example.com/signup',
      ],
    });
    const [candidate] = extractActivityCandidates(onlyWindow, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    expect(candidate?.startsAt).toBeNull();
    expect(candidate?.registrationDeadlineAt).toBe('2026-10-23T04:00:00.000Z');
  });
});

describe('extractActivityCandidates —— 分行与多活动', () => {
  it('时间与地点分行时仍能抽取，标题不被地点行污染', () => {
    const split = article({
      bodyLines: [
        '活动预告',
        '【讲座】分行通知',
        '时间：2026年10月25日 14:00',
        '地点：图书馆 302',
      ],
    });
    const candidates = extractActivityCandidates(split, { now: NOW, timeZone: 'Asia/Shanghai' });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.title).toBe('【讲座】分行通知');
    expect(candidates[0]?.startsAt).toBe('2026-10-25T06:00:00.000Z');
    expect(candidates[0]?.location).toBe('图书馆 302');
    expect(candidates[0]?.evidenceText).toContain('时间：2026年10月25日 14:00');
    expect(candidates[0]?.evidenceText).toContain('地点：图书馆 302');
  });

  it('同文多活动按空行分段，截止与地点不串台', () => {
    const two = article({
      bodyLines: [
        '活动预告',
        '【讲座】甲',
        '时间：2026年10月25日 14:00',
        '地点：图书馆 302',
        '报名截止：2026年10月23日 12:00',
        '',
        '【工作坊】乙',
        '时间：2026年10月26日 19:00',
        '地点：创艺学院 305',
      ],
    });
    const candidates = extractActivityCandidates(two, { now: NOW, timeZone: 'Asia/Shanghai' });
    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.registrationDeadlineAt).toBe('2026-10-23T04:00:00.000Z');
    expect(candidates[0]?.location).toBe('图书馆 302');
    expect(candidates[1]?.registrationDeadlineAt).toBeNull();
    expect(candidates[1]?.location).toBe('创艺学院 305');
  });

  it('第二段没有小标题时回落到文章标题，不沿用上一段标题', () => {
    const noHeading = article({
      title: '十月活动合集',
      bodyLines: [
        '活动预告',
        '【讲座】甲',
        '时间：2026年10月25日 14:00',
        '地点：图书馆 302',
        '',
        '时间：2026年10月26日 19:00',
        '地点：创艺学院 305',
      ],
    });
    const candidates = extractActivityCandidates(noHeading, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    expect(candidates).toHaveLength(2);
    expect(candidates[1]?.title).toBe('十月活动合集');
  });
});

describe('extractActivityCandidates —— 缺年份与字段边界', () => {
  it('缺年份的过去日期留在今年，不推下一年', () => {
    const past = article({
      bodyLines: ['活动预告', '【讲座】旧日期', '时间：1月5日 14:00', '地点：图书馆 302'],
    });
    const [candidate] = extractActivityCandidates(past, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    expect(candidate?.startsAt).toBe('2026-01-05T06:00:00.000Z');
  });

  it('缺年份的过去报名截止也留在今年', () => {
    const pastDeadline = article({
      bodyLines: [
        '活动预告',
        '【讲座】旧截止',
        '截止时间：1月4日 12:00',
        '报名链接：https://example.com/signup',
      ],
    });
    const [candidate] = extractActivityCandidates(pastDeadline, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    expect(candidate?.registrationDeadlineAt).toBe('2026-01-04T04:00:00.000Z');
  });

  it('地点尾部的动作词被剥离', () => {
    const noisy = article({
      bodyLines: [
        '活动预告',
        '【讲座】地点噪声',
        '时间：2026年10月25日 14:00',
        '地点：图书馆 302 扫码报名',
        '报名截止：2026年10月23日 12:00',
      ],
    });
    const [candidate] = extractActivityCandidates(noisy, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    expect(candidate?.location).toBe('图书馆 302');
  });

  it('地点后接逗号与名额提示时也只保留地点', () => {
    const noisy = article({
      bodyLines: [
        '活动预告',
        '【讲座】地点噪声二',
        '时间：2026年10月25日 14:00',
        '地点：信息学院 1-101 报告厅，名额有限',
      ],
    });
    const [candidate] = extractActivityCandidates(noisy, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    expect(candidate?.location).toBe('信息学院 1-101 报告厅');
  });

  it('报名链接后的中文标点不进入 URL', () => {
    const punctuation = article({
      bodyLines: [
        '活动预告',
        '【讲座】链接标点',
        '时间：2026年10月25日 14:00 地点：图书馆',
        '报名链接：https://example.com/signup，请扫码报名',
      ],
    });
    const [candidate] = extractActivityCandidates(punctuation, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    expect(candidate?.registrationUrl).toBe('https://example.com/signup');
  });

  it('文章自身 sourceUrl 不成为报名链接', () => {
    const sourceOnly = article({
      sourceUrl: 'https://mp.weixin.qq.com/s/abc?scene=1&srcid=2',
      bodyLines: [
        '活动预告',
        '【讲座】只有来源链接',
        '时间：2026年10月25日 14:00',
        '地点：图书馆 302',
        '扫码报名',
        'https://mp.weixin.qq.com/s/abc',
      ],
    });
    const [candidate] = extractActivityCandidates(sourceOnly, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    expect(candidate?.registrationUrl).toBeNull();
  });

  it('标题与地点按 OpenAPI 的 160 字上限截断', () => {
    const longTitle = '标题'.repeat(100);
    const longLocation = `地点：${'楼'.repeat(200)}`;
    const oversized = article({
      title: longTitle,
      bodyLines: ['时间：2026年10月25日 14:00', longLocation],
    });
    const [candidate] = extractActivityCandidates(oversized, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    expect([...(candidate?.title ?? '')]).toHaveLength(160);
    expect([...(candidate?.location ?? '')].length).toBeLessThanOrEqual(160);
  });
});

describe('extractActivityCandidates —— 证据链接清洗', () => {
  it('证据片段里的 URL 复用统一清洗，剥掉会话参数', () => {
    const withUrls = article({
      bodyLines: [
        '活动预告',
        '【讲座】链接清洗',
        '时间：2026年10月25日 14:00 地点：图书馆 报名',
        '报名链接：https://events.shanghaitech.edu.cn/signup?id=42&sid=secret&scene=1&chksm=abc&srcid=2&exportkey=xyz&signature=sig&key=k',
        '详情见 https://mp.weixin.qq.com/s/abc?scene=1&srcid=2',
      ],
    });
    const [candidate] = extractActivityCandidates(withUrls, {
      now: NOW,
      timeZone: 'Asia/Shanghai',
    });
    const evidence = candidate?.evidenceText ?? '';
    expect(evidence).toContain('id=42');
    for (const parameter of [
      'sid=',
      'scene=',
      'chksm=',
      'srcid=',
      'exportkey=',
      'signature=',
      'sig=',
      'key=',
    ]) {
      expect(evidence, `证据片段不应含 ${parameter}`).not.toContain(parameter);
    }
  });
});

describe('truncateActivityEvidence', () => {
  it('短文本原样返回', () => {
    expect(truncateActivityEvidence('时间：10月25日 14:00')).toBe('时间：10月25日 14:00');
  });

  it('超过 200 字截断到 200 字并以省略号收尾', () => {
    const long = '字'.repeat(250);
    const truncated = truncateActivityEvidence(long);
    expect(truncated).toHaveLength(ACTIVITY_EVIDENCE_MAX_CHARS);
    expect(truncated.endsWith('…')).toBe(true);
  });

  it('恰好 200 字不截断', () => {
    const exact = '字'.repeat(ACTIVITY_EVIDENCE_MAX_CHARS);
    expect(truncateActivityEvidence(exact)).toBe(exact);
  });

  it('按码点截断，不劈开 emoji 代理对', () => {
    const long = '😀'.repeat(250);
    const truncated = truncateActivityEvidence(long);
    expect([...truncated]).toHaveLength(ACTIVITY_EVIDENCE_MAX_CHARS);
    expect(truncated.endsWith('…')).toBe(true);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(truncated)).toBe(false);
    expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(truncated)).toBe(false);
  });
});
