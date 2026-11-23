import { describe, expect, it } from 'vitest';

import {
  fromShanghaiDateTimeLocal,
  toShanghaiDateTimeLocal,
  validateWechatArticleUrl,
  type ActivityItem,
} from '@/domain/models/activities';

import {
  articleFromPastedText,
  buildActivityIcs,
  buildActivityJson,
  confirmActivity,
  confirmedActivities,
  createManualActivity,
  dismissActivity,
  extractActivities,
  mergeActivityCandidates,
  restoreActivity,
  submitPastedText,
  unconfirmActivity,
  updateActivity,
  validateActivity,
} from './logic';

/**
 * 校园活动导入的纯逻辑。
 *
 * 这里锁的不是「解析得有多聪明」，而是**不许编时间**与**不许带走正文**：
 * - 认不出的时刻留 `null` + 原文，不补 23:59；
 * - 证据片段 ≤ 200 字，导出里不能出现正文后段；
 * - 候选只有用户逐条确认后才进入导出。
 */
const NOW = new Date('2026-10-20T00:00:00.000Z');

const ARTICLE = {
  title: '人工智能前沿讲座',
  accountName: '上科大信息学院',
  publishedAt: '2026-10-20T10:00:00+08:00',
  sourceUrl: 'https://mp.weixin.qq.com/s/demo-article',
  bodyLines: [
    '人工智能前沿讲座',
    '讲座时间：2026年10月25日 14:00',
    '地点：信息学院 1-101',
    '报名截止：10月24日 18:00',
    '报名链接：https://example.edu/register?token=secret',
    '主办：信息科学与技术学院',
  ],
} as const;

function extractOne(): ActivityItem {
  const items = extractActivities(ARTICLE, { now: NOW });
  const first = items[0];
  if (first === undefined) throw new Error('没有抽取到候选活动');
  return first;
}

describe('从公众号文章抽取候选活动', () => {
  it('开始时间按 Asia/Shanghai 解释并转成 UTC', () => {
    const item = extractOne();
    expect(item.startsAt).toBe('2026-10-25T06:00:00.000Z');
    expect(item.source).toBe('wechat-mp');
    expect(item.status).toBe('candidate');
    expect(item.stale).toBe(false);
    expect(item.publishedAt).toBe('2026-10-20T02:00:00.000Z');
  });

  it('报名截止时间同样按上海时区解释，并清洗报名链接里的会话参数', () => {
    const item = extractOne();
    expect(item.registrationDeadlineAt).toBe('2026-10-24T10:00:00.000Z');
    expect(item.registrationDeadlineRaw ?? '').toContain('10月24日 18:00');
    expect(item.registrationUrl).toBe('https://example.edu/register');
  });

  it('地点、主办方、类型与标题都来自原文', () => {
    const item = extractOne();
    expect(item.title).toBe('人工智能前沿讲座');
    expect(item.location).toBe('信息学院 1-101');
    expect(item.organizer).toBe('信息科学与技术学院');
    expect(item.kind).toBe('lecture');
    expect(item.sourceLabel).toBe('上科大信息学院');
    expect(item.sourceUrl).toBe('https://mp.weixin.qq.com/s/demo-article');
    expect(item.confidence).toBeGreaterThan(0.5);
    expect(item.confidence).toBeLessThanOrEqual(1);
  });

  it('证据片段保留原文，且不超过 200 字', () => {
    const item = extractOne();
    expect(item.evidenceText).toContain('讲座时间');
    expect(item.evidenceText).toContain('地点');
    expect(Array.from(item.evidenceText).length).toBeLessThanOrEqual(200);
  });

  it('证据片段里的会话参数也会被清洗，不把 sid / token 带进 JSON', () => {
    const item = extractOne();
    expect(item.evidenceText).not.toContain('token=secret');
    expect(item.evidenceText).toContain('https://example.edu/register');
    expect(buildActivityJson([confirmActivity(item)])).not.toContain('token=secret');
  });

  it('只给日期不给时刻的报名截止 → 保留原文，绝不补 23:59', () => {
    const items = extractActivities(
      {
        ...ARTICLE,
        bodyLines: ['活动时间：2026年10月25日 14:00', '报名截止：10月24日'],
      },
      { now: NOW },
    );
    const item = items[0];
    if (item === undefined) throw new Error('没有抽取到候选活动');
    expect(item.registrationDeadlineAt).toBeNull();
    expect(item.registrationDeadlineRaw ?? '').toContain('10月24日');
    expect(buildActivityIcs([confirmActivity(item)], { calendarName: '活动', now: NOW })).not.toContain(
      '23:59',
    );
  });

  it('认不出可靠时间（「本周五下午两点」）就不产出候选，绝不硬猜', () => {
    const items = extractActivities(
      {
        ...ARTICLE,
        bodyLines: ['本周五下午两点 人工智能讲座', '地点：图书馆报告厅'],
      },
      { now: NOW },
    );
    expect(items).toEqual([]);
    expect(buildActivityIcs([], { calendarName: '活动', now: NOW })).not.toContain('BEGIN:VEVENT');
  });

  it('同一篇文章里的多场活动各自成为候选，互不合并', () => {
    const items = extractActivities(
      {
        ...ARTICLE,
        title: '一周活动预告',
        bodyLines: [
          '【讲座】AI 前沿',
          '10月25日 14:00 地点：信息学院 1-101',
          '【社团活动】摄影',
          '10月26日 19:00 地点：图书馆 2 楼',
        ],
      },
      { now: NOW },
    );
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.startsAt)).toEqual([
      '2026-10-25T06:00:00.000Z',
      '2026-10-26T11:00:00.000Z',
    ]);
    expect(items.map((item) => item.kind)).toEqual(['lecture', 'club']);
    expect(new Set(items.map((item) => item.title)).size).toBe(2);
  });

  it('时间与地点分成两行时，Web 适配层会先合并相邻行再交给共享抽取', () => {
    const items = extractActivities(
      {
        ...ARTICLE,
        bodyLines: [
          '人工智能前沿讲座',
          '时间：2026年10月25日 14:00',
          '地点：信息学院 1-101',
        ],
      },
      { now: NOW },
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.startsAt).toBe('2026-10-25T06:00:00.000Z');
    expect(items[0]?.location).toBe('信息学院 1-101');
  });

  it('重复段落不会产生重复候选', () => {
    const line = '10月25日 14:00 讲座：AI 前沿 地点：信息学院 1-101';
    const items = extractActivities({ ...ARTICLE, bodyLines: [line, line] }, { now: NOW });
    expect(items).toHaveLength(1);
  });
});

describe('直接粘贴正文', () => {
  it('从纯文本得到标题与正文行', () => {
    const parsed = articleFromPastedText(
      '校园歌手大赛\n报名截止：10月30日\n比赛时间：2026年11月5日 19:00\n地点：体育馆',
    );
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.article.title).toBe('校园歌手大赛');
    expect(parsed.article.accountName).toBe('');
    expect(parsed.article.sourceUrl).toBe('');
    const items = extractActivities(parsed.article, { now: NOW });
    const item = items[0];
    if (item === undefined) throw new Error('没有抽取到候选活动');
    expect(item.kind).toBe('other');
    expect(item.location).toBe('体育馆');
    expect(item.startsAt).toBe('2026-11-05T11:00:00.000Z');
    expect(item.registrationDeadlineAt).toBeNull();
    expect(item.registrationDeadlineRaw ?? '').toContain('10月30日');
  });

  it('空正文 / 只有一行的碎片会被拒绝', () => {
    expect(articleFromPastedText('   ').ok).toBe(false);
    expect(articleFromPastedText('太短了').ok).toBe(false);
  });
});

describe('粘贴正文的提交结果（失败必须保留草稿）', () => {
  it('抽取失败时保留用户原文，成功后才清空', () => {
    const draft = '本周五下午两点 人工智能讲座\n地点：图书馆报告厅';
    const failed = submitPastedText(draft, { now: NOW });
    expect(failed.error).toBeTruthy();
    expect(failed.draft).toBe(draft);
    expect(failed.candidates).toEqual([]);

    const successDraft = [
      '人工智能前沿讲座',
      '讲座时间：2026年10月25日 14:00',
      '地点：信息学院 1-101',
    ].join('\n');
    const success = submitPastedText(successDraft, { now: NOW });
    expect(success.error).toBeNull();
    expect(success.draft).toBe('');
    expect(success.candidates).toHaveLength(1);
  });

  it('空正文 / 太短正文同样保留原文，并给出可执行提示', () => {
    const empty = submitPastedText('   ', { now: NOW });
    expect(empty.draft).toBe('   ');
    expect(empty.error).toContain('正文');

    const short = submitPastedText('太短了', { now: NOW });
    expect(short.draft).toBe('太短了');
    expect(short.error).toContain('正文');
  });
});

describe('手动新增活动', () => {
  it('生成 source=manual 的空白候选，不预填时间、链接或证据', () => {
    const item = createManualActivity(NOW);
    expect(item.id).toMatch(/^manual-/);
    expect(item.source).toBe('manual');
    expect(item.sourceLabel).toBe('手动添加');
    expect(item.status).toBe('candidate');
    expect(item.title).toBe('');
    expect(item.startsAt).toBeNull();
    expect(item.endsAt).toBeNull();
    expect(item.registrationDeadlineAt).toBeNull();
    expect(item.registrationDeadlineRaw).toBeNull();
    expect(item.registrationUrl).toBeNull();
    expect(item.sourceUrl).toBeNull();
    expect(item.evidenceText).toBe('');
    expect(item.confidence).toBe(1);
    expect(item.stale).toBe(false);
  });

  it('补齐标题与至少一个时间之前不能确认导出', () => {
    const item = createManualActivity(NOW);
    const errors = validateActivity(item);
    expect(errors.title).toBeTruthy();
    expect(errors.time).toBeTruthy();
  });
});

describe('证据与导出边界', () => {
  it('超长证据截到 200 字，正文后段不会进入 JSON', () => {
    const longLine = `10月25日 14:00 讲座：AI 前沿 地点：信息学院 1-101 ${'很长的正文'.repeat(80)} SECRET_TAIL`;
    const items = extractActivities(
      { ...ARTICLE, bodyLines: [longLine] },
      { now: NOW },
    );
    const item = items[0];
    if (item === undefined) throw new Error('没有抽取到候选活动');
    expect(Array.from(item.evidenceText).length).toBe(200);
    expect(item.evidenceText.endsWith('…')).toBe(true);
    const json = buildActivityJson([confirmActivity(item)]);
    expect(json).not.toContain('SECRET_TAIL');
    // 200 字以内允许出现重复短语；这里锁的是**超出 200 字的后段**没有泄漏
    expect(json).not.toContain('很长的正文'.repeat(60));
  });

  it('用户编辑报名链接 / 来源链接后，JSON 与 ICS 都不带会话参数', () => {
    const base = confirmActivity(
      updateActivity(extractOne(), {
        registrationUrl: 'https://example.edu/register?token=secret&sid=abc&lang=zh',
      }),
    );
    const withSourceToken: ActivityItem = {
      ...base,
      evidenceText: '报名：https://example.edu/register?token=secret&sid=abc&lang=zh 请准时',
      sourceUrl: 'https://mp.weixin.qq.com/s/demo-article?token=secret&sid=abc',
    };

    const json = buildActivityJson([withSourceToken]);
    expect(json).not.toContain('token=secret');
    expect(json).not.toContain('sid=abc');
    expect(json).toContain('https://example.edu/register?lang=zh');
    expect(json).toContain('https://mp.weixin.qq.com/s/demo-article');

    const ics = buildActivityIcs([withSourceToken], { calendarName: '活动', now: NOW });
    expect(ics).not.toContain('token=secret');
    expect(ics).not.toContain('sid=abc');
    expect(ics).toContain('https://example.edu/register?lang=zh');
  });

  it('用户编辑后的超长证据仍会在导出时截到 200 字', () => {
    const item: ActivityItem = {
      ...confirmActivity(extractOne()),
      evidenceText: `${'很长的证据'.repeat(60)} SECRET_TAIL`,
    };
    const parsed = JSON.parse(buildActivityJson([item])) as ActivityItem[];
    const evidence = parsed[0]?.evidenceText ?? '';
    expect(Array.from(evidence).length).toBeLessThanOrEqual(200);
    expect(evidence).not.toContain('SECRET_TAIL');
  });

  it('JSON 只含已确认活动，且字段与 ActivityItem 契约一致', () => {
    const item = extractOne();
    const json = buildActivityJson([item, confirmActivity({ ...item, id: 'confirmed-2' })]);
    const parsed = JSON.parse(json) as ActivityItem[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe('confirmed-2');
    expect(Object.keys(parsed[0] ?? {}).sort()).toEqual(
      [
        'confidence',
        'endsAt',
        'evidenceText',
        'id',
        'kind',
        'location',
        'organizer',
        'publishedAt',
        'registrationDeadlineAt',
        'registrationDeadlineRaw',
        'registrationUrl',
        'source',
        'sourceLabel',
        'sourceUrl',
        'stale',
        'startsAt',
        'status',
        'title',
      ].sort(),
    );
  });
});

describe('确认与编辑', () => {
  it('候选默认未确认；确认后才进入导出集合', () => {
    const item = extractOne();
    expect(confirmedActivities([item])).toHaveLength(0);
    expect(confirmedActivities([confirmActivity(item)])).toHaveLength(1);
  });

  it('编辑已确认的活动会退回 candidate，要求重新确认', () => {
    const confirmed = confirmActivity(extractOne());
    const edited = updateActivity(confirmed, { title: '改过的标题' });
    expect(edited.title).toBe('改过的标题');
    expect(edited.status).toBe('candidate');
  });

  it('忽略的活动不进入导出集合', () => {
    const dismissed = dismissActivity(extractOne());
    expect(dismissed.status).toBe('dismissed');
    expect(confirmedActivities([dismissed])).toHaveLength(0);
  });

  it('新导入追加到当前候选：跳过重复 id，保留已有编辑', () => {
    const first = updateActivity(extractOne(), { title: '已编辑的标题' });
    const second = { ...extractOne(), id: 'act-second' };
    const merged = mergeActivityCandidates([first], [first, second]);
    expect(merged.map((item) => item.id)).toEqual([first.id, 'act-second']);
    expect(merged[0]?.title).toBe('已编辑的标题');
  });

  it('取消确认 / 撤销忽略都回到 candidate，不直接回到已确认', () => {
    const confirmed = confirmActivity(extractOne());
    expect(unconfirmActivity(confirmed).status).toBe('candidate');
    const dismissed = dismissActivity(extractOne());
    expect(restoreActivity(dismissed).status).toBe('candidate');
  });
});

describe('导出前校验', () => {
  it('标题为空、两个时间都没有、结束早于开始、报名链接非法都会报错', () => {
    const item = extractOne();
    const errors = validateActivity({
      ...item,
      title: '   ',
      startsAt: null,
      registrationDeadlineAt: null,
      registrationUrl: 'javascript:alert(1)',
    });
    expect(errors.title).toBeTruthy();
    expect(errors.time).toBeTruthy();
    expect(errors.registrationUrl).toBeTruthy();

    const endErrors = validateActivity({
      ...item,
      startsAt: '2026-10-25T06:00:00.000Z',
      endsAt: '2026-10-25T05:00:00.000Z',
    });
    expect(endErrors.endsAt).toBeTruthy();
  });

  it('合法的候选没有错误', () => {
    expect(validateActivity(extractOne())).toEqual({});
  });
});

describe('ICS 导出', () => {
  it('已确认活动导出开始/结束事件，并带开始前 1 小时提醒', () => {
    const item = confirmActivity(
      updateActivity(extractOne(), {
        endsAt: '2026-10-25T08:00:00.000Z',
      }),
    );
    const ics = buildActivityIcs([item], { calendarName: '校园活动', now: NOW });
    expect(ics).toContain('DTSTART:20261025T060000Z');
    expect(ics).toContain('DTEND:20261025T080000Z');
    expect(ics).toContain('SUMMARY:人工智能前沿讲座');
    expect(ics).toContain('LOCATION:信息学院 1-101');
    expect(ics).toContain('TRIGGER:-PT1H');
    expect(ics).toContain('\r\n');
  });

  it('只有报名截止时导出「报名截止」事件，并在截止前 24 小时提醒', () => {
    const item = confirmActivity({ ...extractOne(), startsAt: null, endsAt: null });
    const ics = buildActivityIcs([item], { calendarName: '校园活动', now: NOW });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('DTSTART:20261024T100000Z');
    expect(ics).toContain('SUMMARY:报名截止：人工智能前沿讲座');
    expect(ics).toContain('TRIGGER:-PT24H');
  });

  it('未确认 / 已忽略的活动不导出', () => {
    const item = extractOne();
    expect(buildActivityIcs([item], { calendarName: '活动', now: NOW })).not.toContain('BEGIN:VEVENT');
    expect(
      buildActivityIcs([dismissActivity(item)], { calendarName: '活动', now: NOW }),
    ).not.toContain('BEGIN:VEVENT');
  });

  it('逗号与分号会被转义，避免字段提前结束', () => {
    const item = confirmActivity(
      updateActivity(extractOne(), { title: '讲座, 第一场; 请准时' }),
    );
    const ics = buildActivityIcs([item], { calendarName: '活动', now: NOW });
    expect(ics).toContain('讲座\\, 第一场\\; 请准时');
  });
});

describe('单篇公众号链接校验', () => {
  it('只接受 https://mp.weixin.qq.com/s/…（含历史 appmsg 路径）', () => {
    expect(validateWechatArticleUrl('https://mp.weixin.qq.com/s/demo-article').ok).toBe(true);
    expect(
      validateWechatArticleUrl('https://mp.weixin.qq.com/mp/appmsg/show?__biz=demo').ok,
    ).toBe(true);
  });

  it('拒绝 http、别的域名、公众号历史列表页、带凭据的链接', () => {
    for (const url of [
      'http://mp.weixin.qq.com/s/demo',
      'https://example.com/s/demo',
      'https://mp.weixin.qq.com/mp/profile_ext?action=home',
      'https://user:pass@mp.weixin.qq.com/s/demo',
    ]) {
      const result = validateWechatArticleUrl(url);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message.length).toBeGreaterThan(8);
    }
  });
});

describe('上海时间输入框换算', () => {
  it('UTC ISO ↔ datetime-local 都显式按 +08:00 换算', () => {
    expect(toShanghaiDateTimeLocal('2026-10-25T06:00:00.000Z')).toBe('2026-10-25T14:00');
    expect(fromShanghaiDateTimeLocal('2026-10-25T14:00')).toBe('2026-10-25T06:00:00.000Z');
  });

  it('空值与非法值不猜', () => {
    expect(toShanghaiDateTimeLocal(null)).toBe('');
    expect(toShanghaiDateTimeLocal('not-a-date')).toBe('');
    expect(fromShanghaiDateTimeLocal('')).toBeNull();
    expect(fromShanghaiDateTimeLocal('2026-13-40T99:99')).toBeNull();
  });
});
