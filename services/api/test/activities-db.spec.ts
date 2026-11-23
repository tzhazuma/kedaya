/**
 * 校园活动 · **真实 PostgreSQL**（PGlite）验证
 *
 * 只验证"假 Prisma 证明不了"的东西：
 *   · 新迁移真的建起 Activity / ActivityReminder 与 MailEvent 扩展列；
 *   · `(userId, source, sourceRef)` 唯一约束真的挡重复；
 *   · 解绑校园邮箱时，由邮件提升的活动与提醒真的被级联删除；
 *   · `claimDue` 的 `FOR UPDATE SKIP LOCKED` 单条 SQL 真能原子抢占、
 *     第二次拿不到、失败 release 后能再次抢到；
 *   · MailEvent 扩展字段真的落库并读回。
 *
 * ⚠️ 限制：PGlite 的 socket 服务端把查询全局串行化，所以这里不能证明
 * "真实多连接并发不重复"；它能证明的是 SQL 语义与状态机正确。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ActivityPrismaRepository } from '../src/modules/activities/data/activity.prisma-repository';
import { ActivityReminderPrismaRepository } from '../src/modules/activities/data/activity-reminder.prisma-repository';
import { MailMessagePrismaRepository } from '../src/modules/mail/data/mail-event.prisma-repository';
import { createPglitePrisma, reconnect, seedUser, type PglitePrisma } from './fixtures/pglite-prisma';

const ME = 'user-activities-me';
const OTHER = 'user-activities-other';
const PAGER = 'user-activities-pager';
const SORTER = 'user-activities-sorter';
const NOW = new Date('2026-11-22T00:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const LEASE_MS = 10 * 60 * 1000;

let ctx: PglitePrisma;
let activities: ActivityPrismaRepository;
let reminders: ActivityReminderPrismaRepository;
let mailEvents: MailMessagePrismaRepository;

beforeAll(async () => {
  ctx = await createPglitePrisma();
  activities = new ActivityPrismaRepository(ctx.prisma as never);
  reminders = new ActivityReminderPrismaRepository(ctx.prisma as never);
  mailEvents = new MailMessagePrismaRepository(ctx.prisma as never);

  await seedUser(ctx.prisma, ME, '我');
  await seedUser(ctx.prisma, OTHER, '同学乙');
  await seedUser(ctx.prisma, PAGER, '分页同学');
  await seedUser(ctx.prisma, SORTER, '排序同学');
}, 120_000);

afterAll(async () => {
  await ctx?.dispose();
});

async function createActivity(
  overrides: {
    id?: string;
    userId?: string;
    source?: string;
    sourceRef?: string;
    status?: string;
    mailAccountId?: string | null;
    mailEventId?: string | null;
    startsAt?: Date | null;
    registrationDeadlineAt?: Date | null;
  } = {},
): Promise<string> {
  const id = overrides.id ?? `act-${Math.random().toString(36).slice(2, 10)}`;
  await ctx.prisma.activity.create({
    data: {
      id,
      userId: overrides.userId ?? ME,
      source: overrides.source ?? 'manual',
      sourceRef: overrides.sourceRef ?? id,
      kind: 'lecture',
      title: `活动 ${id}`,
      startsAt: overrides.startsAt === undefined ? new Date(NOW.getTime() + HOUR) : overrides.startsAt,
      registrationDeadlineAt: overrides.registrationDeadlineAt ?? null,
      evidenceText: '2026年11月25日 14:00',
      confidence: 0.8,
      status: overrides.status ?? 'confirmed',
      mailAccountId: overrides.mailAccountId ?? null,
      mailEventId: overrides.mailEventId ?? null,
    },
  });
  return id;
}

describe('迁移产物', () => {
  it('Activity / ActivityReminder 表与 MailEvent 扩展列真的存在', async () => {
    const tables = await ctx.prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('Activity', 'ActivityReminder')
      ORDER BY table_name
    `;
    expect(tables.map((row) => row.table_name)).toEqual(['Activity', 'ActivityReminder']);

    const columns = await ctx.prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'MailEvent'
        AND column_name IN ('kind','endsAt','registrationDeadlineAt','registrationDeadlineRaw','registrationUrl')
      ORDER BY column_name
    `;
    expect(columns.map((row) => row.column_name)).toEqual([
      'endsAt',
      'kind',
      'registrationDeadlineAt',
      'registrationDeadlineRaw',
      'registrationUrl',
    ]);
  });
});

describe('活动仓储：幂等与用户隔离', () => {
  it('同一 (userId, source, sourceRef) 重复导入返回既有行；不同用户可各自持有', async () => {
    const input = {
      userId: ME,
      source: 'wechat-mp' as const,
      sourceRef: 'https://mp.weixin.qq.com/s/unique',
      kind: 'lecture' as const,
      title: 'AI for Science',
      startsAt: new Date(NOW.getTime() + HOUR),
      evidenceText: '2026年11月25日 14:00',
      confidence: 0.8,
      status: 'candidate' as const,
    };

    const first = await activities.upsertBySourceRef(input);
    const second = await activities.upsertBySourceRef(input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);

    const other = await activities.upsertBySourceRef({ ...input, userId: OTHER });
    expect(other.created).toBe(true);
    expect(other.record.id).not.toBe(first.record.id);
  });

  it('listByUser 只返回自己的活动；按 startsAt 升序（空时间排最后）', async () => {
    const early = await createActivity({ startsAt: new Date(NOW.getTime() + HOUR) });
    const late = await createActivity({ startsAt: new Date(NOW.getTime() + 3 * HOUR) });
    const noTime = await createActivity({ startsAt: null });
    const other = await createActivity({ userId: OTHER });

    const rows = await activities.listByUser(ME, {}, { limit: 50 });
    const ids = rows.items.map((row) => row.id);

    expect(ids).toContain(early);
    expect(ids).toContain(late);
    expect(ids).toContain(noTime);
    expect(ids).not.toContain(other);
    expect(ids.indexOf(early)).toBeLessThan(ids.indexOf(late));
    expect(ids.indexOf(late)).toBeLessThan(ids.indexOf(noTime));
  });

  it('默认列表只返回 candidate + confirmed；dismissed / archived 需显式查询', async () => {
    const dismissed = await createActivity({ status: 'dismissed' });
    const archived = await createActivity({ status: 'archived' });

    const defaults = await activities.listByUser(ME, {}, { limit: 100 });
    const defaultIds = defaults.items.map((row) => row.id);
    expect(defaultIds).not.toContain(dismissed);
    expect(defaultIds).not.toContain(archived);

    const dismissedPage = await activities.listByUser(ME, { status: 'dismissed' }, { limit: 100 });
    expect(dismissedPage.items.map((row) => row.id)).toContain(dismissed);
  });

  it('游标分页按 startsAt 升序，不重不漏', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      ids.push(
        await createActivity({
          userId: PAGER,
          startsAt: new Date(NOW.getTime() + (index + 1) * HOUR),
        }),
      );
    }

    const first = await activities.listByUser(PAGER, {}, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await activities.listByUser(
      PAGER,
      {},
      { limit: 2, ...(first.nextCursor === null ? {} : { cursor: first.nextCursor }) },
    );
    expect(second.items).toHaveLength(1);
    expect([...first.items, ...second.items].map((row) => row.id)).toEqual(ids);
  });

  it('只有报名截止时间的活动按 registrationDeadlineAt 兜底排序（不排到最末）', async () => {
    const withStart = await createActivity({
      userId: SORTER,
      startsAt: new Date(NOW.getTime() + 3 * HOUR),
    });
    const deadlineLater = await createActivity({
      userId: SORTER,
      startsAt: null,
      registrationDeadlineAt: new Date(NOW.getTime() + 2 * HOUR),
    });
    const deadlineSooner = await createActivity({
      userId: SORTER,
      startsAt: null,
      registrationDeadlineAt: new Date(NOW.getTime() + HOUR),
    });
    const noTime = await createActivity({
      userId: SORTER,
      startsAt: null,
      registrationDeadlineAt: null,
    });

    const rows = await activities.listByUser(SORTER, {}, { limit: 50 });
    expect(rows.items.map((row) => row.id)).toEqual([
      withStart,
      deadlineSooner,
      deadlineLater,
      noTime,
    ]);
  });
});

describe('提醒：默认去重、邮箱解绑级联、原子抢占', () => {
  it('默认提醒 dedupeKey 唯一：重复 createMany 不产生第二条', async () => {
    const activityId = await createActivity();
    const draft = {
      userId: ME,
      activityId,
      kind: 'start' as const,
      remindAt: new Date(NOW.getTime() + 30 * 60 * 1000),
      channel: 'inapp' as const,
      dedupeKey: 'default:start',
    };

    expect(await reminders.createMany([draft])).toBe(1);
    expect(await reminders.createMany([draft])).toBe(0);
    expect(await reminders.listByActivity(ME, activityId)).toHaveLength(1);
  });

  it('唯一键只约束 pending/sending：已 sent 的默认提醒不挡改期后重建', async () => {
    const activityId = await createActivity();
    const first = {
      userId: ME,
      activityId,
      kind: 'start' as const,
      remindAt: new Date(NOW.getTime() - HOUR),
      channel: 'inapp' as const,
      dedupeKey: 'default:start',
    };

    expect(await reminders.createMany([first])).toBe(1);
    const [claimed] = (await reminders.claimDue(NOW, 50)).filter(
      (row) => row.activityId === activityId,
    );
    expect(await reminders.markSent(claimed!.id, NOW)).toBe(true);

    const rescheduled = { ...first, remindAt: new Date(NOW.getTime() + 2 * HOUR) };
    expect(await reminders.createMany([rescheduled])).toBe(1);
    // 仍处于 pending 的同一 dedupeKey 依旧挡重复
    expect(await reminders.createMany([rescheduled])).toBe(0);

    // 已 sent 的自定义提醒也不挡同一 kind + 新时刻
    const custom = {
      userId: ME,
      activityId,
      kind: 'custom' as const,
      remindAt: new Date(NOW.getTime() - 2 * HOUR),
      channel: 'inapp' as const,
      dedupeKey: null,
    };
    expect(await reminders.createMany([custom])).toBe(1);
    const [customClaimed] = (await reminders.claimDue(NOW, 50)).filter(
      (row) => row.activityId === activityId,
    );
    expect(await reminders.markSent(customClaimed!.id, NOW)).toBe(true);
    expect(
      await reminders.createMany([{ ...custom, remindAt: new Date(NOW.getTime() + 3 * HOUR) }]),
    ).toBe(1);
  });

  it('解绑校园邮箱：由邮件提升的活动与提醒被级联删除，手动活动保留', async () => {
    const account = await ctx.prisma.mailAccount.create({
      data: {
        userId: ME,
        email: 'student@stu.shanghaitech.edu.cn',
        imapHost: 'imap.stu.shanghaitech.edu.cn',
        imapPort: 993,
        passwordCipher: 'v1.iv.tag.cipher',
        cipherKeyId: 'v1',
      },
    });

    const mailActivity = await createActivity({
      source: 'campus-mail',
      sourceRef: 'mail-event-1',
      mailAccountId: account.id,
    });
    const manualActivity = await createActivity();
    await reminders.createMany([
      {
        userId: ME,
        activityId: mailActivity,
        kind: 'start',
        remindAt: new Date(NOW.getTime() + HOUR),
        channel: 'inapp',
        dedupeKey: 'default:start',
      },
    ]);

    await ctx.prisma.mailAccount.delete({ where: { id: account.id } });

    expect(await ctx.prisma.activity.findUnique({ where: { id: mailActivity } })).toBeNull();
    expect(
      await ctx.prisma.activityReminder.count({ where: { activityId: mailActivity } }),
    ).toBe(0);
    expect(await ctx.prisma.activity.findUnique({ where: { id: manualActivity } })).not.toBeNull();
  });

  it('换邮箱清理 MailEvent 时级联删除由它提升的活动与提醒', async () => {
    const account = await ctx.prisma.mailAccount.create({
      data: {
        userId: PAGER,
        email: 'student@stu.shanghaitech.edu.cn',
        imapHost: 'imap.stu.shanghaitech.edu.cn',
        imapPort: 993,
        passwordCipher: 'v1.iv.tag.cipher',
        cipherKeyId: 'v1',
      },
    });
    const event = await ctx.prisma.mailEvent.create({
      data: {
        userId: PAGER,
        accountId: account.id,
        uid: 701,
        title: 'AI for Science',
        startsAt: new Date(NOW.getTime() + HOUR),
        confidence: 0.8,
        matchedText: '2026年11月25日 14:00',
        receivedAt: NOW,
        stale: false,
      },
    });
    const activityId = await createActivity({
      userId: PAGER,
      source: 'campus-mail',
      sourceRef: event.id,
      mailAccountId: account.id,
      mailEventId: event.id,
    });
    await reminders.createMany([
      {
        userId: PAGER,
        activityId,
        kind: 'start',
        remindAt: new Date(NOW.getTime() + HOUR),
        channel: 'inapp',
        dedupeKey: 'default:start',
      },
    ]);

    await ctx.prisma.mailEvent.delete({ where: { id: event.id } });

    expect(await ctx.prisma.activity.findUnique({ where: { id: activityId } })).toBeNull();
    expect(await ctx.prisma.activityReminder.count({ where: { activityId } })).toBe(0);
  });

  it('claimDue 原子抢占到期行；第二次拿不到；release 后可再次抢到', async () => {
    const activityId = await createActivity({ status: 'confirmed' });
    await reminders.createMany([
      {
        userId: ME,
        activityId,
        kind: 'registration',
        remindAt: new Date(NOW.getTime() - 2 * HOUR),
        channel: 'inapp',
        dedupeKey: 'default:registration',
      },
      {
        userId: ME,
        activityId,
        kind: 'start',
        remindAt: new Date(NOW.getTime() - HOUR),
        channel: 'inapp',
        dedupeKey: 'default:start',
      },
      {
        userId: ME,
        activityId,
        kind: 'custom',
        remindAt: new Date(NOW.getTime() + HOUR),
        channel: 'inapp',
        dedupeKey: null,
      },
    ]);

    const claimed = await reminders.claimDue(NOW, 10);
    expect(claimed).toHaveLength(2);
    expect(claimed.every((row) => row.status === 'sending')).toBe(true);
    expect(claimed[0]).toMatchObject({
      activityTitle: `活动 ${activityId}`,
      activityStatus: 'confirmed',
    });
    expect(claimed[0]!.activityStartsAt).toBeInstanceOf(Date);

    expect(await reminders.claimDue(NOW, 10)).toHaveLength(0);

    const sent = claimed[0]!;
    const released = claimed[1]!;
    expect(await reminders.markSent(sent.id, NOW)).toBe(true);
    expect(await reminders.release(released.id)).toBe(true);

    const retry = await reminders.claimDue(NOW, 10);
    expect(retry.map((row) => row.id)).toEqual([released.id]);
  });

  it('已忽略活动的提醒仍会被抢占（由应用层取消），cancel 后不再出现', async () => {
    const activityId = await createActivity({ status: 'dismissed' });
    await reminders.createMany([
      {
        userId: ME,
        activityId,
        kind: 'start',
        remindAt: new Date(NOW.getTime() - HOUR),
        channel: 'inapp',
        dedupeKey: 'default:start',
      },
    ]);

    const claimed = await reminders.claimDue(NOW, 10);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.activityStatus).toBe('dismissed');
    expect(await reminders.cancel(claimed[0]!.id)).toBe(true);
    expect(await reminders.claimDue(NOW, 10)).toHaveLength(0);
  });

  it('claimDue 只抢 inapp；releaseStale 回收超过租约的 sending', async () => {
    const activityId = await createActivity({ status: 'confirmed' });
    await reminders.createMany([
      {
        userId: ME,
        activityId,
        kind: 'start',
        remindAt: new Date(NOW.getTime() - 2 * HOUR),
        channel: 'inapp',
        dedupeKey: 'default:start',
      },
      {
        userId: ME,
        activityId,
        kind: 'custom',
        remindAt: new Date(NOW.getTime() - 2 * HOUR),
        channel: 'wechat-subscribe',
        dedupeKey: null,
      },
    ]);

    await ctx.prisma.activityReminder.create({
      data: {
        userId: ME,
        activityId,
        kind: 'registration',
        remindAt: new Date(NOW.getTime() - 2 * HOUR),
        channel: 'inapp',
        status: 'sending',
        claimedAt: new Date(NOW.getTime() - LEASE_MS - 60_000),
        dedupeKey: 'default:registration',
      },
    });
    await ctx.prisma.activityReminder.create({
      data: {
        userId: ME,
        activityId,
        kind: 'custom',
        remindAt: new Date(NOW.getTime() - 90 * 60 * 1000),
        channel: 'inapp',
        status: 'sending',
        claimedAt: new Date(NOW.getTime() - 60_000),
        dedupeKey: null,
      },
    });

    expect(await reminders.releaseStale(new Date(NOW.getTime() - LEASE_MS))).toBe(1);

    const claimed = await reminders.claimDue(NOW, 10);
    expect(claimed.map((row) => row.channel)).toEqual(['inapp', 'inapp']);
    expect(claimed.map((row) => row.kind).sort()).toEqual(['registration', 'start']);
    expect(claimed.every((row) => row.attempts >= 1)).toBe(true);

    const wechat = await ctx.prisma.activityReminder.findFirst({
      where: { activityId, channel: 'wechat-subscribe' },
    });
    expect(wechat?.status).toBe('pending');

    const freshSending = await ctx.prisma.activityReminder.findFirst({
      where: { activityId, status: 'sending' },
    });
    expect(freshSending?.claimedAt?.getTime()).toBe(NOW.getTime() - 60_000);
  });

  it('提醒列表支持 scheduled 别名与游标分页', async () => {
    const activityId = await createActivity({ userId: PAGER });
    const base = NOW.getTime() + HOUR;
    await reminders.createMany([
      {
        userId: PAGER,
        activityId,
        kind: 'custom',
        remindAt: new Date(base),
        channel: 'inapp',
        dedupeKey: null,
      },
      {
        userId: PAGER,
        activityId,
        kind: 'custom',
        remindAt: new Date(base + HOUR),
        channel: 'inapp',
        dedupeKey: null,
      },
      {
        userId: PAGER,
        activityId,
        kind: 'custom',
        remindAt: new Date(base + 2 * HOUR),
        channel: 'inapp',
        dedupeKey: null,
      },
    ]);

    const first = await reminders.listByUser(PAGER, { limit: 2, status: 'scheduled' });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await reminders.listByUser(PAGER, {
      limit: 2,
      status: 'scheduled',
      ...(first.nextCursor === null ? {} : { cursor: first.nextCursor }),
    });
    expect(second.items).toHaveLength(1);
    expect([...first.items, ...second.items].every((row) => row.status === 'pending')).toBe(true);
  });
});

describe('MailEvent 扩展字段真实落库', () => {
  it('saveEvents 写入并读回 kind / endsAt / 报名截止 / 报名链接', async () => {
    const account = await ctx.prisma.mailAccount.create({
      data: {
        userId: ME,
        email: 'student@stu.shanghaitech.edu.cn',
        imapHost: 'imap.stu.shanghaitech.edu.cn',
        imapPort: 993,
        passwordCipher: 'v1.iv.tag.cipher',
        cipherKeyId: 'v1',
      },
    });

    await mailEvents.saveEvents([
      {
        userId: ME,
        accountId: account.id,
        uid: 501,
        title: 'AI for Science',
        kind: 'lecture',
        startsAt: new Date('2026-11-25T06:00:00.000Z'),
        endsAt: new Date('2026-11-25T08:00:00.000Z'),
        location: '图书馆 302',
        organizer: '信息学院',
        registrationDeadlineAt: new Date('2026-11-24T15:59:00.000Z'),
        registrationDeadlineRaw: '2026年11月24日 23:59',
        registrationUrl: 'https://example.com/sign',
        confidence: 0.85,
        matchedText: '2026年11月25日 14:00',
        receivedAt: NOW,
        stale: false,
      },
    ]);

    const rows = await mailEvents.listEvents(ME);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'lecture',
      endsAt: new Date('2026-11-25T08:00:00.000Z'),
      registrationDeadlineAt: new Date('2026-11-24T15:59:00.000Z'),
      registrationDeadlineRaw: '2026年11月24日 23:59',
      registrationUrl: 'https://example.com/sign',
    });
  });
});

/**
 * 这个用例**必须放最后**：PGlite 在语句级错误后会关闭当前 socket 连接
 * （夹具已知特性）。放在中间会让后续 Prisma 查询偶发 `Server has closed the connection`。
 */
describe('数据库唯一约束（故意触发错误，放最后）', () => {
  it('绕过仓储直接插入相同 (userId, source, sourceRef) 也被拒绝', async () => {
    const sourceRef = 'unique-direct-check';
    await createActivity({ source: 'wechat-mp', sourceRef });

    await expect(
      ctx.prisma.activity.create({
        data: {
          userId: ME,
          source: 'wechat-mp',
          sourceRef,
          kind: 'lecture',
          title: '重复',
          evidenceText: '',
          confidence: 0.1,
          status: 'candidate',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await reconnect(ctx.prisma);
  });
});
