import { describe, expect, it } from 'vitest';
import { extractEventFromMail } from './mail-event.domain';

/**
 * `extractEventFromMail` 的回归测试。
 *
 * 重点不是"能把日期转成 ISO"（那是 `parseDueText` 的测试），而是：
 *   · 能不能从**邮件这种格式**里把时间片段切出来；
 *   · 主题里的时间、跨行 Date/Time、中文星期/下午、起止时间；
 *   · **认不出时返回 null**（不编时间、不猜活动）。
 */

const SHANGHAI = 'Asia/Shanghai';

/** 固定收信时刻：所有"缺年份"的推断都以它为基准，保证测试确定性 */
const RECEIVED_AT = new Date('2026-10-19T00:00:00.000Z');

function extract(subject: string, body: string, receivedAt = RECEIVED_AT) {
  return extractEventFromMail(subject, body, receivedAt, SHANGHAI);
}

describe('extractEventFromMail · 中文邮件', () => {
  it('中文讲座：正文里的「2026年10月20日（周二）14:00」，提取地点与主办', () => {
    const result = extract(
      '【讲座】AI for Science',
      [
        '各位老师、同学：',
        '',
        '兹定于 2026年10月20日（周二）14:00 在图书馆 302 举办“AI for Science”学术讲座。',
        '地点：图书馆 302',
        '主办：信息科学与技术学院',
      ].join('\n'),
    );

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      title: 'AI for Science',
      startsAt: '2026-10-20T06:00:00.000Z',
      location: '图书馆 302',
      organizer: '信息科学与技术学院',
    });
    expect(result!.confidence).toBeGreaterThan(0.6);
    expect(result!.matchedText).toContain('2026年10月20日');
  });

  it('中文会议：主题就是标题，正文用「时间：」「地点：」两行', () => {
    const result = extract(
      '关于召开 2026 年秋季学期教学工作会议的通知',
      ['时间：2026年10月23日 09:00', '地点：行政楼 201', '主办：教务处'].join('\n'),
    );

    expect(result).toMatchObject({
      title: '关于召开 2026 年秋季学期教学工作会议的通知',
      startsAt: '2026-10-23T01:00:00.000Z',
      location: '行政楼 201',
      organizer: '教务处',
    });
  });

  it('中文「下午2:00」被归一成 14:00，起止时间取开始时刻', () => {
    const result = extract(
      '宣讲会通知',
      '时间：2026年10月24日 下午2:00-15:30\n地点：报告厅',
    );

    expect(result).not.toBeNull();
    expect(result!.startsAt).toBe('2026-10-24T06:00:00.000Z');
  });

  it('主题泛化成「通知」时，从正文里找真正的活动标题', () => {
    const result = extract(
      '通知',
      ['讲座题目：AI for Science', '时间：2026年10月20日 14:00', '地点：图书馆 302'].join(
        '\n',
      ),
    );

    expect(result).not.toBeNull();
    expect(result!.title).toBe('AI for Science');
    expect(result!.startsAt).toBe('2026-10-20T06:00:00.000Z');
  });

  it('相对时间也能识别（in 2 days / 2 天后）', () => {
    const result = extract('学术讲座提醒', 'The seminar is in 2 days.');
    expect(result).not.toBeNull();
    expect(result!.startsAt).toBe('2026-10-21T00:00:00.000Z');
  });
});

describe('extractEventFromMail · 英文邮件', () => {
  it('英文讲座：Date / Time / Location / Organizer 分四行', () => {
    const result = extract(
      'Distinguished Lecture: Quantum Computing',
      [
        'You are invited to a lecture.',
        '',
        'Date: October 21, 2026',
        'Time: 3:30 PM',
        'Location: Lecture Hall 101',
        'Organizer: School of Physical Science',
      ].join('\n'),
    );

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      title: 'Distinguished Lecture: Quantum Computing',
      startsAt: '2026-10-21T07:30:00.000Z',
      location: 'Lecture Hall 101',
      organizer: 'School of Physical Science',
    });
  });

  it('时间在主题里：`[Seminar] ... Oct 22, 2026 10:00 AM`', () => {
    const result = extract(
      '[Seminar] Graph Neural Networks — Oct 22, 2026 10:00 AM',
      'Join us in Room 205.',
    );

    expect(result).not.toBeNull();
    expect(result!.startsAt).toBe('2026-10-22T02:00:00.000Z');
    expect(result!.title).toContain('Graph Neural Networks');
  });

  it('英文宣讲会：`Date: November 5, 2026 at 6:00 PM` + `Venue:`', () => {
    const result = extract(
      'Information Session: Summer Research Program',
      ['Date: November 5, 2026 at 6:00 PM', 'Venue: Auditorium'].join('\n'),
    );

    expect(result).not.toBeNull();
    expect(result!.startsAt).toBe('2026-11-05T10:00:00.000Z');
    expect(result!.location).toBe('Auditorium');
  });

  it('缺年份：`Oct 25` + `2:00 PM` 以收信时刻推断到最近的未来', () => {
    const result = extract(
      'Lecture invitation',
      ['Date: Oct 25', 'Time: 2:00 PM', 'Place: Room 101'].join('\n'),
    );

    expect(result).not.toBeNull();
    expect(result!.startsAt).toBe('2026-10-25T06:00:00.000Z');
    expect(result!.location).toBe('Room 101');
  });

  it('ISO 时间带偏移：`2026-10-20T23:59:00+08:00`', () => {
    const result = extract('Lecture', 'Join us at 2026-10-20T23:59:00+08:00.');
    expect(result).not.toBeNull();
    expect(result!.startsAt).toBe('2026-10-20T15:59:00.000Z');
  });
});

describe('extractEventFromMail · 认不出就返回 null（不编）', () => {
  it('有活动关键词、但没有时间 → null', () => {
    expect(
      extract('Lecture: AI for Science', 'Please join us. Location: Library 302.'),
    ).toBeNull();
  });

  it('有时间、但没有活动关键词 → null（不能把普通邮件塞进日历）', () => {
    expect(extract('Lunch menu', '2026-10-20 12:00')).toBeNull();
  });

  it('非法日期（2 月 30 日）→ null，而不是进位成 3 月 2 日', () => {
    expect(extract('Lecture', 'Date: 2026-02-30 10:00')).toBeNull();
  });

  it('只有日期、没有时间 → null（缺时间的纯日期不猜）', () => {
    expect(extract('Lecture', 'Date: October 21, 2026')).toBeNull();
  });

  it('空主题 + 空正文 → null', () => {
    expect(extract('', '')).toBeNull();
  });

  it('空正文 + 无时间主题 → null', () => {
    expect(extract('Seminar', '')).toBeNull();
  });

  it('TBD 不算时间 → null', () => {
    expect(extract('Meeting', 'Time: TBD')).toBeNull();
  });
});

describe('extractEventFromMail · 参数边界', () => {
  it('receivedAt 非法时抛 RangeError（配置错误不能静默）', () => {
    expect(() =>
      extractEventFromMail('Lecture', '2026-10-20 10:00', new Date('not-a-date'), SHANGHAI),
    ).toThrow(RangeError);
  });

  it('timeZone 为空时抛 RangeError', () => {
    expect(() => extractEventFromMail('Lecture', '2026-10-20 10:00', RECEIVED_AT, '')).toThrow(
      RangeError,
    );
  });
});
