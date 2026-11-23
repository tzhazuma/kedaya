import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_BASE_PATH,
  ACTIVITY_DEFAULT_REMINDER_LEADS,
  ACTIVITY_EVIDENCE_MAX_CHARS,
  ACTIVITY_KINDS,
  ACTIVITY_KIND_LABELS,
  ACTIVITY_ROUTES,
  ACTIVITY_REMINDER_CHANNELS,
  ACTIVITY_REMINDER_KINDS,
  ACTIVITY_REMINDER_STATUSES,
  ACTIVITY_REMINDER_STATUS_FILTERS,
  ACTIVITY_SOURCES,
  ACTIVITY_SOURCE_LABELS,
  ACTIVITY_STATUSES,
  ACTIVITY_TIMEZONE,
  type ActivityImportResult,
  type ActivityItem,
  type ActivityReminderItem,
} from './activities';
import { MINIAPP_PAGES } from './pages';

/**
 * 校园活动域契约。
 *
 * 重点不是「字段齐全」，而是三条**安全边界**：
 *   1. 来源只能是 campus-mail / wechat-mp / manual —— 不做自动发现；
 *   2. 状态从 candidate 开始，确认前不能进日程/提醒；
 *   3. 只存 ≤200 字证据片段，不存邮件正文或公众号全文。
 */

const item: ActivityItem = {
  id: 'act-1',
  source: 'wechat-mp',
  kind: 'lecture',
  title: '大模型与推理',
  startsAt: '2026-10-25T06:00:00.000Z',
  endsAt: '2026-10-25T08:00:00.000Z',
  location: '信息学院 1-101 报告厅',
  organizer: '信息科学与技术学院',
  registrationDeadlineAt: '2026-10-23T04:00:00.000Z',
  registrationDeadlineRaw: '2026年10月23日 12:00',
  registrationUrl: 'https://events.shanghaitech.edu.cn/signup?id=42',
  evidenceText: '时间：2026年10月25日 14:00-16:00 地点：信息学院 1-101 报告厅',
  confidence: 0.9,
  status: 'candidate',
  sourceUrl: 'https://mp.weixin.qq.com/s/abc',
  sourceLabel: '上科大信息学院',
  publishedAt: '2026-10-20T02:00:00.000Z',
  stale: false,
};

const reminder: ActivityReminderItem = {
  id: 'rem-1',
  kind: 'registration',
  remindAt: '2026-10-22T04:00:00.000Z',
  channel: 'inapp',
  status: 'pending',
};

describe('活动域枚举', () => {
  it('来源只有 campus-mail / wechat-mp / manual（不做自动发现）', () => {
    expect([...ACTIVITY_SOURCES]).toEqual(['campus-mail', 'wechat-mp', 'manual']);
    expect(ACTIVITY_SOURCE_LABELS['campus-mail']).toContain('邮箱');
    expect(ACTIVITY_SOURCE_LABELS['wechat-mp']).toContain('公众号');
    expect(ACTIVITY_SOURCE_LABELS.manual).toContain('手动');
  });

  it('状态只有 candidate / confirmed / dismissed / archived', () => {
    expect([...ACTIVITY_STATUSES]).toEqual(['candidate', 'confirmed', 'dismissed', 'archived']);
  });

  it('活动类型覆盖讲座、会议、宣讲、体育、社团等校园场景，且无重复', () => {
    expect([...ACTIVITY_KINDS]).toEqual([
      'lecture',
      'meeting',
      'info-session',
      'sports',
      'club',
      'other',
    ]);
    expect(new Set(ACTIVITY_KINDS).size).toBe(ACTIVITY_KINDS.length);
    for (const kind of ACTIVITY_KINDS) {
      expect(ACTIVITY_KIND_LABELS[kind].length).toBeGreaterThan(0);
    }
  });

  it('提醒类型 / 渠道 / 状态', () => {
    expect([...ACTIVITY_REMINDER_KINDS]).toEqual(['registration', 'start', 'custom']);
    expect([...ACTIVITY_REMINDER_CHANNELS]).toEqual(['inapp', 'wechat-subscribe']);
    expect([...ACTIVITY_REMINDER_STATUSES]).toEqual([
      'pending',
      'sending',
      'sent',
      'failed',
      'cancelled',
    ]);
  });

  it('提醒列表查询支持 scheduled 别名（pending + sending）', () => {
    expect([...ACTIVITY_REMINDER_STATUS_FILTERS]).toEqual([
      'pending',
      'sending',
      'sent',
      'failed',
      'cancelled',
      'scheduled',
    ]);
  });

  it('证据上限 200 字、展示时区 Asia/Shanghai', () => {
    expect(ACTIVITY_EVIDENCE_MAX_CHARS).toBe(200);
    expect(ACTIVITY_TIMEZONE).toBe('Asia/Shanghai');
  });

  it('默认提醒提前量：报名 24h / 开始 1h / 兜底 5min', () => {
    expect(ACTIVITY_DEFAULT_REMINDER_LEADS).toEqual({
      registrationMs: 24 * 60 * 60 * 1000,
      startMs: 60 * 60 * 1000,
      fallbackDelayMs: 5 * 60 * 1000,
    });
  });
});

describe('ActivityImportResult —— 多候选导入响应', () => {
  it('包含 item / items / created / skipped 四个字段', () => {
    const result: ActivityImportResult = {
      item,
      items: [item],
      created: 1,
      skipped: 0,
    };
    expect(result.item?.id).toBe('act-1');
    expect(result.items).toHaveLength(1);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('没有新候选时 item 为 null、items 为空、created 为 0', () => {
    const empty: ActivityImportResult = {
      item: null,
      items: [],
      created: 0,
      skipped: 2,
    };
    expect(empty.item).toBeNull();
    expect(empty.skipped).toBe(2);
  });
});

describe('ActivityItem / ActivityReminderItem 形状', () => {
  it('ActivityItem 接受空的可选时刻与原始截止文本', () => {
    const onlyDeadline: ActivityItem = {
      ...item,
      startsAt: null,
      endsAt: null,
      location: null,
      organizer: null,
      registrationDeadlineAt: null,
      registrationDeadlineRaw: '10月23日',
      registrationUrl: null,
      sourceUrl: null,
      sourceLabel: null,
      publishedAt: null,
    };
    expect(onlyDeadline.registrationDeadlineAt).toBeNull();
    expect(onlyDeadline.registrationDeadlineRaw).toBe('10月23日');
    expect(onlyDeadline.sourceLabel).toBeNull();
  });

  it('stale 是必填布尔值（列表里不能用「缺字段」表示未知）', () => {
    // @ts-expect-error —— 省略 stale 会让「上次同步失败」与「从未同步」分不清
    const missing: ActivityItem = { ...item, stale: undefined };
    void missing;
  });

  it('ActivityItem.source 拒绝非约定来源', () => {
    // @ts-expect-error —— 来源是冻结枚举，不能私自扩展成邮件自动抓取
    const invalid: ActivityItem = { ...item, source: 'email-auto' };
    void invalid;
  });

  it('ActivityItem.status 拒绝未约定状态', () => {
    // @ts-expect-error —— 未确认的 candidate 不能被标成「已加入日程」
    const invalid: ActivityItem = { ...item, status: 'scheduled' };
    void invalid;
  });

  it('ActivityReminderItem 的 kind 与 channel 是冻结枚举', () => {
    expect(reminder.channel).toBe('inapp');
    // @ts-expect-error —— MVP 不假装 APNs / FCM 已接通
    const invalid: ActivityReminderItem = { ...reminder, channel: 'apns' };
    void invalid;
  });
});

describe('活动路由常量', () => {
  it('基础路径是 /activities', () => {
    expect(ACTIVITY_BASE_PATH).toBe('/activities');
    expect(ACTIVITY_ROUTES.base).toBe('/activities');
  });

  it('列表 / 手动创建 / 详情 / 确认 / 忽略', () => {
    expect(ACTIVITY_ROUTES.items).toBe('/activities/items');
    expect(ACTIVITY_ROUTES.item('act-1')).toBe('/activities/items/act-1');
    expect(ACTIVITY_ROUTES.confirm('act-1')).toBe('/activities/items/act-1/confirm');
    expect(ACTIVITY_ROUTES.dismiss('act-1')).toBe('/activities/items/act-1/dismiss');
    expect(ACTIVITY_ROUTES.archive('act-1')).toBe('/activities/items/act-1/archive');
    expect(ACTIVITY_ROUTES.restore('act-1')).toBe('/activities/items/act-1/restore');
  });

  it('单篇公众号导入与邮件提升', () => {
    expect(ACTIVITY_ROUTES.importWechat).toBe('/activities/imports/wechat');
    expect(ACTIVITY_ROUTES.importMail).toBe('/activities/imports/mail');
  });

  it('归档与恢复是独立领域动作', () => {
    expect(ACTIVITY_ROUTES.archive('act-1')).toBe('/activities/items/act-1/archive');
    expect(ACTIVITY_ROUTES.restore('act-1')).toBe('/activities/items/act-1/restore');
  });

  it('提醒列表 / 条目提醒 / 删除提醒 / 管理员派发', () => {
    expect(ACTIVITY_ROUTES.reminders).toBe('/activities/reminders');
    expect(ACTIVITY_ROUTES.itemReminders('act-1')).toBe('/activities/items/act-1/reminders');
    expect(ACTIVITY_ROUTES.reminder('rem-1')).toBe('/activities/reminders/rem-1');
    expect(ACTIVITY_ROUTES.dispatch).toBe('/activities/reminders/dispatch');
  });

  it('路径参数会转义，避免拼出第二条路径', () => {
    expect(ACTIVITY_ROUTES.item('a b')).toBe('/activities/items/a%20b');
    expect(ACTIVITY_ROUTES.reminder('a/b')).toBe('/activities/reminders/a%2Fb');
  });
});

describe('小程序活动页面路径', () => {
  it('列表与详情已登记（小程序侧必须同步 PAGE_PATHS）', () => {
    expect(MINIAPP_PAGES.activitiesList).toBe('/presentation/pages/activities/list/index');
    expect(MINIAPP_PAGES.activitiesDetail).toBe('/presentation/pages/activities/detail/index');
  });

  it('导入 / 邮件提升 / 提醒页面也已登记', () => {
    expect(MINIAPP_PAGES.activitiesImport).toBe('/presentation/pages/activities/import/index');
    expect(MINIAPP_PAGES.activitiesMail).toBe('/presentation/pages/activities/mail/index');
    expect(MINIAPP_PAGES.activitiesReminders).toBe(
      '/presentation/pages/activities/reminders/index',
    );
  });
});
