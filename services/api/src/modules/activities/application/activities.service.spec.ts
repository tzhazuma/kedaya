import { describe, expect, it, vi } from "vitest";

import { MINIAPP_PAGES } from "@kedaya/contracts";

import {
  ConflictError,
  NotFoundError,
  UpstreamUnavailableError,
  ValidationError,
} from "../../../common/errors/app-error";
import type {
  MailEventRecord,
  MailMessageRepository,
  NewMailEvent,
} from "../../mail/domain/mail.domain";
import type { WechatArticleService } from "../../wechat/application/wechat-article.service";
import type { WechatOfficialAccountService } from "../../wechat/application/wechat-official-account.service";
import { ActivitiesService } from "./activities.service";
import {
  ACTIVITY_REMINDER_LEASE_MS,
  ACTIVITY_REMINDER_MAX_ATTEMPTS,
  ACTIVITY_REMINDER_NOW_SHIFT_MS,
  type ActivityClock,
  type ActivityListPage,
  type ActivityRecord,
  type ActivityReminderRecord,
  type ActivityReminderRepository,
  type ActivityRepository,
  type ActivityUpdateData,
  type ClaimedActivityReminder,
  type NewActivity,
  type NewActivityReminder,
  type NewActivityReminderInput,
  type ReminderListPage,
  type ReminderListQuery,
} from "../domain/activities.domain";

const USER = "user-a";
const OTHER = "user-b";
const NOW = new Date("2026-11-22T00:00:00.000Z");
const HOUR = 60 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * 假仓储
 * ------------------------------------------------------------------ */

function makeActivity(input: NewActivity, sequence: number): ActivityRecord {
  return {
    id: `act-${sequence}`,
    userId: input.userId,
    source: input.source,
    sourceRef: input.sourceRef,
    kind: input.kind,
    title: input.title,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    location: input.location ?? null,
    organizer: input.organizer ?? null,
    registrationDeadlineAt: input.registrationDeadlineAt ?? null,
    registrationDeadlineRaw: input.registrationDeadlineRaw ?? null,
    registrationUrl: input.registrationUrl ?? null,
    evidenceText: input.evidenceText,
    confidence: input.confidence,
    status: input.status,
    sourceUrl: input.sourceUrl ?? null,
    sourceLabel: input.sourceLabel ?? null,
    publishedAt: input.publishedAt ?? null,
    stale: input.stale ?? false,
    mailAccountId: input.mailAccountId ?? null,
    mailEventId: input.mailEventId ?? null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

class MemoryActivities implements ActivityRepository {
  readonly rows = new Map<string, ActivityRecord>();
  private sequence = 0;

  async create(input: NewActivity): Promise<ActivityRecord> {
    this.sequence += 1;
    const row = makeActivity(input, this.sequence);
    this.rows.set(row.id, row);
    return row;
  }

  async upsertBySourceRef(
    input: NewActivity,
  ): Promise<{ record: ActivityRecord; created: boolean }> {
    const existing = [...this.rows.values()].find(
      (row) =>
        row.userId === input.userId &&
        row.source === input.source &&
        row.sourceRef === input.sourceRef,
    );
    if (existing !== undefined) return { record: existing, created: false };
    return { record: await this.create(input), created: true };
  }

  async findById(userId: string, id: string): Promise<ActivityRecord | null> {
    const row = this.rows.get(id);
    return row !== undefined && row.userId === userId ? row : null;
  }

  async findByIds(ids: readonly string[]): Promise<ActivityRecord[]> {
    return ids
      .map((id) => this.rows.get(id))
      .filter((row): row is ActivityRecord => row !== undefined);
  }

  async listByUser(
    userId: string,
    filters: {
      status?: string | undefined;
      source?: string | undefined;
      from?: Date;
      to?: Date;
    },
    page: { cursor?: string; limit: number },
  ): Promise<ActivityListPage> {
    const filtered = [...this.rows.values()]
      .filter((row) => row.userId === userId)
      .filter(
        (row) => filters.status === undefined || row.status === filters.status,
      )
      .filter(
        (row) => filters.source === undefined || row.source === filters.source,
      )
      .filter(
        (row) =>
          (filters.from === undefined ||
            (row.startsAt !== null &&
              row.startsAt.getTime() >= filters.from.getTime())) &&
          (filters.to === undefined ||
            (row.startsAt !== null &&
              row.startsAt.getTime() < filters.to.getTime())),
      )
      .sort(
        (left, right) =>
          (left.startsAt?.getTime() ?? Number.POSITIVE_INFINITY) -
            (right.startsAt?.getTime() ?? Number.POSITIVE_INFINITY) ||
          left.id.localeCompare(right.id),
      );

    const start =
      page.cursor === undefined
        ? 0
        : filtered.findIndex((row) => row.id === page.cursor) + 1;
    const visible = filtered.slice(start, start + page.limit);
    return {
      items: visible,
      nextCursor:
        start + page.limit < filtered.length
          ? (visible.at(-1)?.id ?? null)
          : null,
    };
  }

  async update(
    userId: string,
    id: string,
    data: ActivityUpdateData,
  ): Promise<ActivityRecord | null> {
    const row = await this.findById(userId, id);
    if (row === null) return null;
    const next: ActivityRecord = { ...row, ...data, updatedAt: NOW };
    this.rows.set(id, next);
    return next;
  }
}

class MemoryReminders implements ActivityReminderRepository {
  readonly rows: ActivityReminderRecord[] = [];
  private sequence = 0;

  constructor(private readonly activities: MemoryActivities) {}

  private titleFor(activityId: string): string {
    return this.activities.rows.get(activityId)?.title ?? "活动";
  }

  async createMany(inputs: readonly NewActivityReminder[]): Promise<number> {
    let count = 0;
    for (const input of inputs) {
      // 与迁移里的部分唯一索引一致：只约束 pending/sending，sent/cancelled 不挡新提醒。
      const duplicate = this.rows.some(
        (row) =>
          row.activityId === input.activityId &&
          (row.status === "pending" || row.status === "sending") &&
          ((input.dedupeKey !== null && row.dedupeKey === input.dedupeKey) ||
            (row.kind === input.kind &&
              row.remindAt.getTime() === input.remindAt.getTime())),
      );
      if (duplicate) continue;
      this.sequence += 1;
      this.rows.push({
        ...input,
        id: `rem-${this.sequence}`,
        activityTitle: this.titleFor(input.activityId),
        status: "pending",
        attempts: 0,
        lastError: null,
        sentAt: null,
        claimedAt: null,
        createdAt: NOW,
      });
      count += 1;
    }
    return count;
  }

  async create(
    input: NewActivityReminderInput,
  ): Promise<ActivityReminderRecord> {
    const duplicate = this.rows.some(
      (row) =>
        row.activityId === input.activityId &&
        (row.status === "pending" || row.status === "sending") &&
        row.kind === input.kind &&
        row.remindAt.getTime() === input.remindAt.getTime(),
    );
    if (duplicate) throw new ConflictError("相同时间的提醒已存在");
    this.sequence += 1;
    const row: ActivityReminderRecord = {
      id: `rem-${this.sequence}`,
      userId: input.userId,
      activityId: input.activityId,
      activityTitle: this.titleFor(input.activityId),
      kind: input.kind,
      remindAt: input.remindAt,
      channel: input.channel,
      status: "pending",
      dedupeKey: input.dedupeKey ?? null,
      attempts: 0,
      lastError: null,
      sentAt: null,
      claimedAt: null,
      createdAt: NOW,
    };
    this.rows.push(row);
    return row;
  }

  async listByUser(
    userId: string,
    query: ReminderListQuery,
  ): Promise<ReminderListPage> {
    const filtered = this.rows
      .filter((row) => row.userId === userId)
      .filter((row) => {
        if (query.status === undefined) return true;
        if (query.status === "scheduled")
          return row.status === "pending" || row.status === "sending";
        return row.status === query.status;
      })
      .sort(
        (left, right) => left.remindAt.getTime() - right.remindAt.getTime(),
      );
    const start =
      query.cursor === undefined
        ? 0
        : filtered.findIndex((row) => row.id === query.cursor) + 1;
    const visible = filtered.slice(start, start + query.limit);
    return {
      items: visible,
      nextCursor:
        start + query.limit < filtered.length
          ? (visible.at(-1)?.id ?? null)
          : null,
    };
  }

  async listByActivity(
    userId: string,
    activityId: string,
  ): Promise<ActivityReminderRecord[]> {
    return this.rows.filter(
      (row) => row.userId === userId && row.activityId === activityId,
    );
  }

  async findById(
    userId: string,
    id: string,
  ): Promise<ActivityReminderRecord | null> {
    return (
      this.rows.find((row) => row.userId === userId && row.id === id) ?? null
    );
  }

  async deleteById(userId: string, id: string): Promise<boolean> {
    const index = this.rows.findIndex(
      (row) => row.userId === userId && row.id === id,
    );
    if (index < 0) return false;
    this.rows.splice(index, 1);
    return true;
  }

  async deletePendingForActivity(activityId: string): Promise<number> {
    const before = this.rows.length;
    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      const row = this.rows[index]!;
      if (row.activityId === activityId && row.status === "pending")
        this.rows.splice(index, 1);
    }
    return before - this.rows.length;
  }

  async deletePendingDefaults(
    activityId: string,
    kinds?: readonly string[],
  ): Promise<number> {
    const before = this.rows.length;
    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      const row = this.rows[index]!;
      if (
        row.activityId === activityId &&
        row.status === "pending" &&
        row.dedupeKey !== null &&
        row.dedupeKey.startsWith("default:") &&
        (kinds === undefined || kinds.includes(row.kind))
      ) {
        this.rows.splice(index, 1);
      }
    }
    return before - this.rows.length;
  }

  async claimDue(now: Date, limit: number): Promise<ClaimedActivityReminder[]> {
    const claimed: ClaimedActivityReminder[] = [];
    for (const row of this.rows) {
      if (claimed.length >= limit) break;
      const activity = this.activities.rows.get(row.activityId);
      if (
        row.status !== "pending" ||
        row.remindAt.getTime() > now.getTime() ||
        activity === undefined
      ) {
        continue;
      }
      row.status = "sending";
      row.claimedAt = now;
      row.attempts += 1;
      claimed.push({
        ...row,
        activityTitle: activity.title,
        activityStatus: activity.status,
        activityStartsAt: activity.startsAt,
        activityRegistrationDeadlineAt: activity.registrationDeadlineAt,
      });
    }
    return claimed;
  }

  async releaseStale(claimedBefore: Date): Promise<number> {
    let released = 0;
    for (const row of this.rows) {
      if (
        row.status === "sending" &&
        (row.claimedAt === null ||
          row.claimedAt.getTime() < claimedBefore.getTime())
      ) {
        row.status = "pending";
        row.claimedAt = null;
        released += 1;
      }
    }
    return released;
  }

  async markFailed(id: string, reason: string): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row === undefined) return false;
    row.status = "failed";
    row.lastError = reason;
    row.claimedAt = null;
    return true;
  }

  async markSent(id: string, sentAt: Date): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row === undefined) return false;
    row.status = "sent";
    row.sentAt = sentAt;
    row.claimedAt = null;
    return true;
  }

  async release(id: string): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row === undefined) return false;
    row.status = "pending";
    row.claimedAt = null;
    return true;
  }

  async cancel(id: string): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row === undefined) return false;
    row.status = "cancelled";
    row.claimedAt = null;
    return true;
  }
}

class MemoryMailEvents implements MailMessageRepository {
  rows: MailEventRecord[] = [];

  async knownUids(): Promise<Set<number>> {
    return new Set();
  }

  async saveEvents(events: readonly NewMailEvent[]): Promise<number> {
    return events.length;
  }

  async listEvents(userId: string): Promise<MailEventRecord[]> {
    return this.rows.filter((row) => row.userId === userId);
  }

  async markStale(): Promise<number> {
    return 0;
  }

  async clearStale(): Promise<number> {
    return 0;
  }

  async purgeForAccount(): Promise<number> {
    return 0;
  }
}

function build(official?: WechatOfficialAccountService) {
  const activities = new MemoryActivities();
  const reminders = new MemoryReminders(activities);
  const mailEvents = new MemoryMailEvents();
  const notifier = {
    notifyStrict: vi.fn(async (..._args: unknown[]) => undefined),
  };
  const wechat = {
    fetchAndParse: vi.fn(),
  } as unknown as WechatArticleService & {
    fetchAndParse: ReturnType<typeof vi.fn>;
  };
  const clock: ActivityClock = { now: () => NOW };
  const config = {
    get: (key: string) =>
      key === "ACTIVITIES_TIME_ZONE" ? "Asia/Shanghai" : undefined,
  };

  const service = new ActivitiesService(
    activities,
    reminders,
    clock,
    notifier,
    mailEvents,
    wechat,
    config as never,
    official,
  );

  return { service, activities, reminders, mailEvents, notifier, wechat };
}

function seedActivity(
  activities: MemoryActivities,
  overrides: Partial<ActivityRecord> = {},
): ActivityRecord {
  const base = makeActivity(
    {
      userId: USER,
      source: "manual",
      sourceRef: "manual-1",
      kind: "lecture",
      title: "AI for Science",
      startsAt: new Date("2026-11-25T10:00:00.000Z"),
      registrationDeadlineAt: new Date("2026-11-24T10:00:00.000Z"),
      evidenceText: "",
      confidence: 1,
      status: "confirmed",
    },
    99,
  );
  const row: ActivityRecord = { ...base, ...overrides };
  activities.rows.set(row.id, row);
  return row;
}

/* ------------------------------------------------------------------ *
 * 手动创建
 * ------------------------------------------------------------------ */

describe("ActivitiesService · 手动创建", () => {
  it("手动创建固定 candidate（客户端不能指定 status/confidence）；确认后才建两条默认提醒", async () => {
    const { service, reminders } = build();

    const item = await service.createManual(USER, {
      kind: "lecture",
      title: "AI for Science",
      startsAt: new Date("2026-11-25T10:00:00.000Z"),
      endsAt: new Date("2026-11-25T12:00:00.000Z"),
      registrationDeadlineAt: new Date("2026-11-24T10:00:00.000Z"),
    });

    expect(item).toMatchObject({
      source: "manual",
      status: "candidate",
      title: "AI for Science",
      startsAt: "2026-11-25T10:00:00.000Z",
      endsAt: "2026-11-25T12:00:00.000Z",
      sourceLabel: "手动添加",
    });
    expect(item.confidence).toBeGreaterThan(0.6);
    expect(reminders.rows).toHaveLength(0);

    const confirmed = await service.confirm(USER, item.id);
    expect(confirmed.status).toBe("confirmed");
    expect(
      reminders.rows.map((row) => [row.kind, row.remindAt.toISOString()]),
    ).toEqual([
      ["registration", "2026-11-23T10:00:00.000Z"],
      ["start", "2026-11-25T09:00:00.000Z"],
    ]);
    expect(reminders.rows.every((row) => row.channel === "inapp")).toBe(true);
  });

  it("目标已过不建提醒；提醒时刻已过则 now+5min（且不晚于目标）", async () => {
    const { service, reminders } = build();

    const ended = await service.createManual(USER, {
      kind: "lecture",
      title: "已结束",
      startsAt: new Date(NOW.getTime() - HOUR),
      registrationDeadlineAt: new Date(NOW.getTime() - 2 * HOUR),
    });
    await service.confirm(USER, ended.id);
    expect(reminders.rows).toHaveLength(0);

    const soon = await service.createManual(USER, {
      kind: "lecture",
      title: "马上开始",
      startsAt: new Date(NOW.getTime() + 30 * 60 * 1000),
      // 报名截止必须不晚于开始；20 分钟后截止，24h 提前量已过 → 兜底 now+5min
      registrationDeadlineAt: new Date(NOW.getTime() + 20 * 60 * 1000),
    });
    await service.confirm(USER, soon.id);
    expect(
      reminders.rows
        .filter((row) => row.status === "pending")
        .map((row) => row.remindAt.getTime()),
    ).toEqual([
      NOW.getTime() + ACTIVITY_REMINDER_NOW_SHIFT_MS,
      NOW.getTime() + ACTIVITY_REMINDER_NOW_SHIFT_MS,
    ]);
  });

  it("证据片段最多 200 字，不存邮件正文/公众号全文", async () => {
    const { service } = build();
    const item = await service.createManual(USER, {
      kind: "club",
      title: "长证据",
      startsAt: new Date("2026-11-25T10:00:00.000Z"),
      evidenceText: "正".repeat(260),
    });

    expect([...item.evidenceText]).toHaveLength(200);
    expect(item).not.toHaveProperty("body");
  });
});

/* ------------------------------------------------------------------ *
 * 微信单篇导入
 * ------------------------------------------------------------------ */

describe("ActivitiesService · 微信单篇导入", () => {
  it("用户给单篇链接：解析 → candidate → 确认后才建提醒；截止时间无法确定时保留 raw", async () => {
    const { service, reminders, wechat } = build();
    wechat.fetchAndParse.mockResolvedValue({
      ok: true,
      article: {
        title: "【讲座】AI for Science",
        accountName: "上科大信息学院",
        publishedAt: "2026-11-20T02:00:00+08:00",
        bodyLines: [
          "时间：2026年11月25日 14:00",
          "地点：图书馆 302",
          "报名截止：2026年11月24日",
          "报名链接：https://example.com/sign",
        ],
        images: [],
        sourceUrl: "https://mp.weixin.qq.com/s/abc",
      },
    });

    const result = await service.importWechat(USER, {
      url: "https://mp.weixin.qq.com/s/abc",
    });

    expect(result.created).toBe(1);
    expect(result.item).toMatchObject({
      source: "wechat-mp",
      kind: "lecture",
      status: "candidate",
      startsAt: "2026-11-25T06:00:00.000Z",
      location: "图书馆 302",
      registrationDeadlineAt: null,
      registrationUrl: "https://example.com/sign",
      sourceUrl: "https://mp.weixin.qq.com/s/abc",
      sourceLabel: "上科大信息学院",
      publishedAt: "2026-11-19T18:00:00.000Z",
    });
    expect(result.item!.registrationDeadlineRaw).toContain("2026年11月24日");
    expect([...result.item!.evidenceText].length).toBeLessThanOrEqual(200);
    expect(reminders.rows).toHaveLength(0);

    await service.confirm(USER, result.item!.id);
    expect(reminders.rows.map((row) => row.kind)).toEqual(["start"]);
  });

  it("重复导入同一链接不产生第二条活动", async () => {
    const { service, wechat } = build();
    wechat.fetchAndParse.mockResolvedValue({
      ok: true,
      article: {
        title: "讲座通知",
        accountName: "信息学院",
        publishedAt: null,
        bodyLines: ["时间：2026年11月25日 14:00", "地点：图书馆 302"],
        images: [],
        sourceUrl: "https://mp.weixin.qq.com/s/abc",
      },
    });

    const first = await service.importWechat(USER, {
      url: "https://mp.weixin.qq.com/s/abc",
    });
    const second = await service.importWechat(USER, {
      url: "https://mp.weixin.qq.com/s/abc",
    });

    expect(second.created).toBe(0);
    expect(second.item!.id).toBe(first.item!.id);
  });

  it("文章不可见（需关注/已删除）→ 503，不落库", async () => {
    const { service, wechat, activities } = build();
    wechat.fetchAndParse.mockResolvedValue({
      ok: false,
      code: "login-required",
      message: "该文章需要关注后查看",
    });

    await expect(
      service.importWechat(USER, { url: "https://mp.weixin.qq.com/s/abc" }),
    ).rejects.toBeInstanceOf(UpstreamUnavailableError);
    expect(activities.rows.size).toBe(0);
  });

  it("粘贴正文：不取网络、sourceRef 用内容哈希、不保存全文", async () => {
    const { service, wechat } = build();
    const text = [
      "讲座题目：图神经网络",
      "时间：2026年11月25日 14:00",
      "地点：信息学院 1A-200",
    ].join("\n");

    const result = await service.importWechat(USER, { text });

    expect(wechat.fetchAndParse).not.toHaveBeenCalled();
    expect(result.item!.source).toBe("wechat-mp");
    expect(result.item!.sourceUrl).toBeNull();
    expect(result.item!.sourceLabel).toBe("微信粘贴");
    expect(result.item!.evidenceText.length).toBeLessThanOrEqual(200);
    expect(result.item).not.toHaveProperty("text");
  });

  it("一篇文章里有多场活动：全部落候选，返回 item/items/created/skipped", async () => {
    const { service, activities, wechat } = build();
    wechat.fetchAndParse.mockResolvedValue({
      ok: true,
      article: {
        title: "本周活动预告",
        accountName: "上科大信息学院",
        publishedAt: null,
        bodyLines: [
          "【学术讲座】大模型与推理",
          "时间：2026年11月25日 14:00-16:00",
          "地点：信息学院 1-101 报告厅",
          "主办：信息科学与技术学院",
          "报名截止：2026年11月23日 12:00",
          "报名链接：https://events.shanghaitech.edu.cn/signup?id=42&sid=secret",
          "【工作坊】摄影入门",
          "时间：2026年11月26日 19:00",
          "地点：创艺学院 305",
          "报名截止：2026年11月24日",
        ],
        images: [],
        sourceUrl: "https://mp.weixin.qq.com/s/multi?scene=1&utm_source=share",
      },
    });

    const result = await service.importWechat(USER, {
      url: "https://mp.weixin.qq.com/s/multi?scene=1&utm_source=share",
    });

    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.items).toHaveLength(2);
    expect(result.item?.id).toBe(result.items[0]!.id);
    expect(result.items.map((item) => item.title)).toEqual([
      "【学术讲座】大模型与推理",
      "【工作坊】摄影入门",
    ]);
    expect(result.items.every((item) => item.status === "candidate")).toBe(
      true,
    );
    expect(activities.rows.size).toBe(2);
    // sourceRef 用清洗后的稳定 URL，而不是带分享参数的原始链接
    expect([...activities.rows.values()].map((row) => row.sourceRef)).toEqual([
      expect.stringMatching(/^wechat:https:\/\/mp\.weixin\.qq\.com\/s\/multi#/),
      expect.stringMatching(/^wechat:https:\/\/mp\.weixin\.qq\.com\/s\/multi#/),
    ]);
    expect(result.items[0]!.sourceUrl).toBe("https://mp.weixin.qq.com/s/multi");

    const again = await service.importWechat(USER, {
      url: "https://mp.weixin.qq.com/s/multi?scene=1&utm_source=share",
    });
    expect(again.created).toBe(0);
    expect(again.skipped).toBe(2);
    expect(again.items.map((item) => item.id)).toEqual(
      result.items.map((item) => item.id),
    );
    expect(activities.rows.size).toBe(2);
  });

  it("非微信链接按 422 拒绝，不当成上游不可用", async () => {
    const { service, wechat, activities } = build();
    wechat.fetchAndParse.mockResolvedValue({
      ok: false,
      code: "invalid-url",
      message: "只支持 https://mp.weixin.qq.com/s/ 形式的公众号文章链接",
    });

    await expect(
      service.importWechat(USER, { url: "https://example.com/not-wechat" }),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_FAILED" });
    expect(activities.rows.size).toBe(0);
  });
});

describe("ActivitiesService · 认证公众号同步", () => {
  it("article_id 去重，非活动只记 skipped，全文不落库", async () => {
    const official = {
      listPublished: vi.fn().mockResolvedValue([
        {
          articleId: "article-1",
          accountKey: "shtu",
          accountName: "上海科技大学",
          title: "【讲座】AI for Science",
          digest: "摘要",
          publishedAt: "2026-11-20T02:00:00.000Z",
          sourceUrl: "https://mp.weixin.qq.com/s/official-1",
          bodyLines: ["时间：2026年11月25日 14:00", "地点：图书馆 302"],
        },
        {
          articleId: "article-2",
          accountKey: "shtu",
          accountName: "上海科技大学",
          title: "校园风景摄影",
          digest: "摘要",
          publishedAt: "2026-11-20T02:00:00.000Z",
          sourceUrl: "https://mp.weixin.qq.com/s/official-2",
          bodyLines: ["一起来看看秋天的校园"],
        },
      ]),
    } as unknown as WechatOfficialAccountService;
    const { service, activities } = build(official);

    const first = await service.syncOfficial(USER, "shtu");
    const second = await service.syncOfficial(USER, "shtu");
    expect(first).toMatchObject({ created: 1, skipped: 1 });
    expect(second.created).toBe(0);
    expect(activities.rows.size).toBe(1);
    const record = [...activities.rows.values()][0]!;
    expect(record.sourceRef).toMatch(/^official:shtu:article-1#/);
    expect(record.status).toBe("candidate");
    expect(record).not.toHaveProperty("body");
    expect(record.evidenceText).not.toContain("一起来看看秋天的校园");
  });
});

/* ------------------------------------------------------------------ *
 * 邮件提升
 * ------------------------------------------------------------------ */

describe("ActivitiesService · 邮件提升", () => {
  function seedMail(events: MemoryMailEvents) {
    events.rows = [
      {
        id: "mail-1",
        userId: USER,
        accountId: "acc-1",
        uid: 1,
        kind: "lecture",
        title: "AI for Science",
        startsAt: new Date("2026-11-25T06:00:00.000Z"),
        endsAt: new Date("2026-11-25T08:00:00.000Z"),
        location: "图书馆 302",
        organizer: "信息学院",
        registrationDeadlineAt: new Date("2026-11-24T15:59:00.000Z"),
        registrationDeadlineRaw: "2026年11月24日 23:59",
        registrationUrl: "https://example.com/sign",
        confidence: 0.85,
        matchedText: "2026年11月25日 14:00",
        receivedAt: NOW,
        stale: false,
      },
      {
        id: "mail-other",
        userId: OTHER,
        accountId: "acc-2",
        uid: 2,
        title: "别人的活动",
        startsAt: new Date("2026-11-26T06:00:00.000Z"),
        location: null,
        organizer: null,
        confidence: 0.7,
        matchedText: "2026年11月26日 14:00",
        receivedAt: NOW,
        stale: false,
      },
    ];
  }

  it("只提升当前用户的邮件，保留扩展字段，状态 candidate 且不建提醒", async () => {
    const { service, mailEvents, reminders } = build();
    seedMail(mailEvents);

    const result = await service.importMail(USER, { eventIds: ["mail-1"] });

    expect(result.items).toHaveLength(1);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.items[0]).toMatchObject({
      source: "campus-mail",
      kind: "lecture",
      status: "candidate",
      title: "AI for Science",
      endsAt: "2026-11-25T08:00:00.000Z",
      registrationDeadlineAt: "2026-11-24T15:59:00.000Z",
      registrationDeadlineRaw: "2026年11月24日 23:59",
      registrationUrl: "https://example.com/sign",
    });
    expect(result.items[0]!.evidenceText.length).toBeLessThanOrEqual(200);
    expect(reminders.rows).toHaveLength(0);
  });

  it("别人的邮件 id 按 404（不透露存在性），不提升任何行", async () => {
    const { service, mailEvents, activities } = build();
    seedMail(mailEvents);

    await expect(
      service.importMail(USER, { eventIds: ["mail-other"] }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(activities.rows.size).toBe(0);
  });

  it("同一封邮件重复提升不重复；确认后按扩展字段建默认提醒", async () => {
    const { service, mailEvents, reminders } = build();
    seedMail(mailEvents);

    const first = await service.importMail(USER, { eventIds: ["mail-1"] });
    const second = await service.importMail(USER, { eventIds: ["mail-1"] });

    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.items[0]!.id).toBe(first.items[0]!.id);

    await service.confirm(USER, first.items[0]!.id);
    expect(
      reminders.rows.map((row) => [row.kind, row.remindAt.toISOString()]),
    ).toEqual([
      ["registration", "2026-11-23T15:59:00.000Z"],
      ["start", "2026-11-25T05:00:00.000Z"],
    ]);
  });

  it("旧邮件没有扩展字段时按 null / other 兼容，不猜测", async () => {
    const { service, mailEvents } = build();
    mailEvents.rows = [
      {
        id: "mail-legacy",
        userId: USER,
        accountId: "acc-1",
        uid: 9,
        title: "旧会议",
        startsAt: new Date("2026-11-26T06:00:00.000Z"),
        location: null,
        organizer: null,
        confidence: 0.7,
        matchedText: "2026年11月26日 14:00",
        receivedAt: NOW,
        stale: false,
      },
    ];

    const result = await service.importMail(USER, {
      eventIds: ["mail-legacy"],
    });
    expect(result.items[0]).toMatchObject({
      kind: "other",
      endsAt: null,
      registrationDeadlineAt: null,
      registrationDeadlineRaw: null,
      registrationUrl: null,
    });
  });
});

/* ------------------------------------------------------------------ *
 * 确认 / 忽略 / 编辑
 * ------------------------------------------------------------------ */

describe("ActivitiesService · 确认 / 忽略 / 编辑", () => {
  it("编辑内容更新 UTC 字段；换用户访问按 404（不泄露存在性）", async () => {
    const { service, activities } = build();
    const activity = seedActivity(activities);

    const updated = await service.update(USER, activity.id, {
      title: "新标题",
      location: null,
      startsAt: new Date("2026-11-26T10:00:00.000Z"),
    });
    expect(updated.title).toBe("新标题");
    expect(updated.location).toBeNull();
    expect(updated.startsAt).toBe("2026-11-26T10:00:00.000Z");

    await expect(
      service.update(OTHER, activity.id, { title: "越权" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.detail(OTHER, activity.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("编辑已确认活动的开始时间会重算待发默认提醒；编辑 candidate 不建提醒", async () => {
    const { service, activities, reminders } = build();
    const confirmed = seedActivity(activities);
    await service.confirm(USER, confirmed.id);
    expect(reminders.rows.map((row) => row.remindAt.toISOString())).toEqual([
      "2026-11-23T10:00:00.000Z",
      "2026-11-25T09:00:00.000Z",
    ]);

    await service.update(USER, confirmed.id, {
      startsAt: new Date("2026-11-27T10:00:00.000Z"),
    });
    expect(reminders.rows.map((row) => row.remindAt.toISOString())).toEqual([
      "2026-11-23T10:00:00.000Z",
      "2026-11-27T09:00:00.000Z",
    ]);

    const candidate = seedActivity(activities, {
      id: "act-edit-candidate",
      sourceRef: "manual-edit-candidate",
      status: "candidate",
    });
    await service.update(USER, candidate.id, {
      startsAt: new Date("2026-11-28T10:00:00.000Z"),
    });
    expect(reminders.rows).toHaveLength(2);
  });

  it("默认提醒已 sent 后改期，仍会生成新的待发提醒（dedupe 冲突不能吞掉）", async () => {
    const { service, activities, reminders } = build();
    const confirmed = seedActivity(activities);
    await service.confirm(USER, confirmed.id);
    for (const row of reminders.rows) {
      row.status = "sent";
      row.sentAt = NOW;
    }

    await service.update(USER, confirmed.id, {
      startsAt: new Date("2026-11-27T10:00:00.000Z"),
    });

    const pending = reminders.rows.filter((row) => row.status === "pending");
    expect(
      pending.map((row) => [row.kind, row.remindAt.toISOString()]),
    ).toEqual([["start", "2026-11-27T09:00:00.000Z"]]);
    // 已发送的历史保留
    expect(reminders.rows.filter((row) => row.status === "sent")).toHaveLength(
      2,
    );
  });

  it("只有 candidate 可以确认；已忽略/已归档再确认按 409", async () => {
    const { service, activities } = build();
    const dismissed = seedActivity(activities, {
      id: "act-dismissed",
      sourceRef: "manual-dismissed",
      status: "dismissed",
    });
    const archived = seedActivity(activities, {
      id: "act-archived",
      sourceRef: "manual-archived",
      status: "archived",
    });

    await expect(service.confirm(USER, dismissed.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(service.confirm(USER, archived.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("忽略会取消待发提醒；已忽略不能再次确认", async () => {
    const { service, activities, reminders } = build();
    const activity = seedActivity(activities);

    await service.confirm(USER, activity.id);
    expect(reminders.rows).toHaveLength(2);

    const dismissed = await service.dismiss(USER, activity.id);
    expect(dismissed.status).toBe("dismissed");
    expect(reminders.rows).toHaveLength(0);

    await expect(service.confirm(USER, activity.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("归档活动不能再确认或忽略（状态流转走领域动作，PATCH 不碰 status）", async () => {
    const { service, activities } = build();
    const activity = seedActivity(activities, { status: "archived" });

    await expect(service.confirm(USER, activity.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(service.dismiss(USER, activity.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("结束时刻必须晚于开始；报名截止不得晚于开始（创建与 PATCH 合并后都校验）", async () => {
    const { service, activities } = build();

    await expect(
      service.createManual(USER, {
        kind: "lecture",
        title: "倒序时间",
        startsAt: new Date("2026-11-25T10:00:00.000Z"),
        endsAt: new Date("2026-11-25T10:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_FAILED" });

    await expect(
      service.createManual(USER, {
        kind: "lecture",
        title: "报名截止晚于开始",
        startsAt: new Date("2026-11-25T10:00:00.000Z"),
        registrationDeadlineAt: new Date("2026-11-25T11:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_FAILED" });

    const activity = seedActivity(activities, {
      startsAt: new Date("2026-11-25T10:00:00.000Z"),
      endsAt: new Date("2026-11-25T12:00:00.000Z"),
    });

    // 只改开始时间，与既有 endsAt 合并后变成倒序 → 拒绝
    await expect(
      service.update(USER, activity.id, {
        startsAt: new Date("2026-11-26T10:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_FAILED" });

    // 只改报名截止，与既有 startsAt 合并后晚于开始 → 拒绝
    await expect(
      service.update(USER, activity.id, {
        registrationDeadlineAt: new Date("2026-11-25T11:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_FAILED" });

    // 合法：截止恰好等于开始时间允许（“不得晚于”）
    const ok = await service.update(USER, activity.id, {
      registrationDeadlineAt: new Date("2026-11-25T10:00:00.000Z"),
    });
    expect(ok.registrationDeadlineAt).toBe("2026-11-25T10:00:00.000Z");
  });

  it("标题/来源名/地点/主办方截断到 160，报名截止原文截断到 200，控制字符全部清理", async () => {
    const { service } = build();
    const item = await service.createManual(USER, {
      kind: "lecture",
      title: ` \u0000讲座 ${"长".repeat(200)} `,
      location: "图书馆\u0007 302",
      organizer: `主办\u0002方 ${"甲".repeat(200)}`,
      sourceLabel: `来源\u0003 ${"乙".repeat(200)}`,
      registrationDeadlineRaw: ` \u0004${"丙".repeat(260)} `,
      startsAt: new Date("2026-11-25T10:00:00.000Z"),
    });

    expect([...item.title]).toHaveLength(160);
    expect(item.title.startsWith("讲座")).toBe(true);
    expect(item.location).toBe("图书馆 302");
    expect([...item.organizer!]).toHaveLength(160);
    expect([...item.sourceLabel!]).toHaveLength(160);
    expect([...item.registrationDeadlineRaw!]).toHaveLength(200);
    for (const value of [
      item.title,
      item.location,
      item.organizer,
      item.sourceLabel,
      item.registrationDeadlineRaw,
    ]) {
      const codes = [...(value ?? "")].map((char) => char.codePointAt(0) ?? 0);
      expect(
        codes.some((code) => code < 32 || (code >= 127 && code <= 159)),
      ).toBe(false);
    }
  });

  it("归档会取消待发提醒、重复归档幂等；恢复回到 candidate、重复恢复幂等；跨用户 404", async () => {
    const { service, activities, reminders } = build();
    const activity = seedActivity(activities);
    await service.confirm(USER, activity.id);
    expect(reminders.rows).toHaveLength(2);

    const archived = await service.archive(USER, activity.id);
    expect(archived.status).toBe("archived");
    expect(reminders.rows).toHaveLength(0);
    expect((await service.archive(USER, activity.id)).status).toBe("archived");

    const restored = await service.restore(USER, activity.id);
    expect(restored.status).toBe("candidate");
    expect((await service.restore(USER, activity.id)).status).toBe("candidate");

    await expect(service.archive(OTHER, activity.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(service.restore(OTHER, activity.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("已忽略的活动不能 restore（语义不明确按 409）", async () => {
    const { service, activities } = build();
    const activity = seedActivity(activities, { status: "dismissed" });
    await expect(service.restore(USER, activity.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

/* ------------------------------------------------------------------ *
 * 提醒
 * ------------------------------------------------------------------ */

describe("ActivitiesService · 提醒", () => {
  it("确认后的活动可加自定义站内信提醒；candidate 不能加", async () => {
    const { service, activities } = build();
    const confirmed = seedActivity(activities);
    const candidate = seedActivity(activities, {
      id: "act-candidate",
      sourceRef: "manual-2",
      status: "candidate",
    });

    const reminder = await service.createReminder(USER, confirmed.id, {
      kind: "custom",
      remindAt: new Date("2026-11-24T00:00:00.000Z"),
      channel: "inapp",
    });
    expect(reminder).toMatchObject({
      kind: "custom",
      remindAt: "2026-11-24T00:00:00.000Z",
      channel: "inapp",
      status: "pending",
    });

    await expect(
      service.createReminder(USER, candidate.id, {
        kind: "custom",
        remindAt: new Date("2026-11-24T00:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("微信订阅消息 / 过去时刻 / 别人的活动都被拒绝", async () => {
    const { service, activities } = build();
    const activity = seedActivity(activities);

    await expect(
      service.createReminder(USER, activity.id, {
        kind: "custom",
        remindAt: new Date("2026-11-24T00:00:00.000Z"),
        channel: "wechat-subscribe",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      service.createReminder(USER, activity.id, {
        kind: "custom",
        remindAt: new Date(NOW.getTime() - HOUR),
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      service.createReminder(OTHER, activity.id, {
        kind: "custom",
        remindAt: new Date("2026-11-24T00:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("列表只返回自己的提醒；删除别人的提醒按 404", async () => {
    const { service, activities, reminders } = build();
    const mine = seedActivity(activities);
    const others = seedActivity(activities, {
      id: "act-other",
      userId: OTHER,
      sourceRef: "manual-other",
    });

    await service.createReminder(USER, mine.id, {
      kind: "custom",
      remindAt: new Date("2026-11-24T00:00:00.000Z"),
    });
    await service.createReminder(OTHER, others.id, {
      kind: "custom",
      remindAt: new Date("2026-11-24T01:00:00.000Z"),
    });

    const list = await service.listReminders(USER);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.activityId).toBe(mine.id);

    const otherReminder = reminders.rows.find((row) => row.userId === OTHER)!;
    await expect(
      service.deleteReminder(USER, otherReminder.id),
    ).rejects.toBeInstanceOf(NotFoundError);

    const deleted = await service.deleteReminder(USER, list.items[0]!.id);
    expect(deleted).toEqual({ id: list.items[0]!.id, deleted: true });
  });
});

/* ------------------------------------------------------------------ *
 * 管理员派发
 * ------------------------------------------------------------------ */

describe("ActivitiesService · 到期派发", () => {
  function seedDue(
    activities: MemoryActivities,
    reminders: MemoryReminders,
    options: {
      status?: ActivityRecord["status"];
      remindAt?: Date;
      id?: string;
      userId?: string;
    } = {},
  ) {
    const activity = seedActivity(activities, {
      id: options.id === undefined ? "act-due" : `act-${options.id}`,
      userId: options.userId ?? USER,
      sourceRef: `manual-${options.id ?? "due"}`,
      status: options.status ?? "confirmed",
    });
    reminders.rows.push({
      id: options.id === undefined ? "rem-due" : `rem-${options.id}`,
      userId: options.userId ?? USER,
      activityId: activity.id,
      activityTitle: activity.title,
      kind: "start",
      remindAt: options.remindAt ?? new Date(NOW.getTime() - 60_000),
      channel: "inapp",
      status: "pending",
      dedupeKey: null,
      attempts: 0,
      lastError: null,
      sentAt: null,
      claimedAt: null,
      createdAt: NOW,
    });
    return { activity, reminder: reminders.rows[reminders.rows.length - 1]! };
  }

  it("原子抢占到期提醒 → 严格写站内信 → 标记 sent；重复派发不重复发", async () => {
    const { service, activities, reminders, notifier } = build();
    seedDue(activities, reminders, { id: "a" });
    seedDue(activities, reminders, { id: "b" });
    seedDue(activities, reminders, {
      id: "future",
      remindAt: new Date(NOW.getTime() + HOUR),
    });

    const first = await service.dispatchDue(10);
    expect(first).toEqual({
      claimed: 2,
      sent: 2,
      failed: 0,
      cancelled: 0,
      reclaimed: 0,
    });
    expect(notifier.notifyStrict).toHaveBeenCalledTimes(2);
    expect(notifier.notifyStrict.mock.calls[0]?.[0]).toMatchObject({
      source: "activities",
      link: `${MINIAPP_PAGES.activitiesDetail}?id=act-a`,
    });
    expect(reminders.rows.filter((row) => row.status === "sent")).toHaveLength(
      2,
    );
    expect(reminders.rows.find((row) => row.id === "rem-future")!.status).toBe(
      "pending",
    );

    const second = await service.dispatchDue(10);
    expect(second).toEqual({
      claimed: 0,
      sent: 0,
      failed: 0,
      cancelled: 0,
      reclaimed: 0,
    });
    expect(notifier.notifyStrict).toHaveBeenCalledTimes(2);
  });

  it("站内信写入失败 → 回退 pending 供下次重试，不标记 sent", async () => {
    const { service, activities, reminders, notifier } = build();
    seedDue(activities, reminders, { id: "a" });
    notifier.notifyStrict.mockRejectedValueOnce(new Error("db down"));

    const result = await service.dispatchDue(10);
    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      failed: 1,
      cancelled: 0,
      reclaimed: 0,
    });
    expect(reminders.rows[0]!.status).toBe("pending");
    expect(reminders.rows[0]!.sentAt).toBeNull();

    const retry = await service.dispatchDue(10);
    expect(retry.sent).toBe(1);
  });

  it("抢占后活动已被忽略/归档 → 取消提醒，不发站内信", async () => {
    const { service, activities, reminders, notifier } = build();
    seedDue(activities, reminders, { id: "a", status: "dismissed" });

    const result = await service.dispatchDue(10);
    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      failed: 0,
      cancelled: 1,
      reclaimed: 0,
    });
    expect(notifier.notifyStrict).not.toHaveBeenCalled();
    expect(reminders.rows[0]!.status).toBe("cancelled");
  });

  it("派发前回收超过 10 分钟仍 sending 的行，并可在同一次派发里补发", async () => {
    const { service, activities, reminders, notifier } = build();
    const { activity } = seedDue(activities, reminders, { id: "stale" });
    reminders.rows[0]!.status = "sending";
    reminders.rows[0]!.claimedAt = new Date(
      NOW.getTime() - ACTIVITY_REMINDER_LEASE_MS - 60_000,
    );

    reminders.rows.push({
      id: "rem-fresh",
      userId: USER,
      activityId: activity.id,
      activityTitle: activity.title,
      kind: "custom",
      remindAt: new Date(NOW.getTime() - 60_000),
      channel: "inapp",
      status: "sending",
      dedupeKey: null,
      attempts: 1,
      lastError: null,
      sentAt: null,
      claimedAt: new Date(NOW.getTime() - 60_000),
      createdAt: NOW,
    });

    const result = await service.dispatchDue(10);
    expect(result).toEqual({
      claimed: 1,
      sent: 1,
      failed: 0,
      cancelled: 0,
      reclaimed: 1,
    });
    expect(notifier.notifyStrict).toHaveBeenCalledTimes(1);
    expect(reminders.rows.find((row) => row.id === "rem-stale")!.status).toBe(
      "sent",
    );
    expect(reminders.rows.find((row) => row.id === "rem-fresh")!.status).toBe(
      "sending",
    );
  });

  it("站内信持续失败达到上限 → 标记 failed（可见），不再无限重试", async () => {
    const { service, activities, reminders, notifier } = build();
    seedDue(activities, reminders, { id: "a" });
    notifier.notifyStrict.mockRejectedValue(new Error("db down"));

    for (
      let attempt = 0;
      attempt < ACTIVITY_REMINDER_MAX_ATTEMPTS;
      attempt += 1
    ) {
      await service.dispatchDue(10);
    }

    const row = reminders.rows[0]!;
    expect(row.status).toBe("failed");
    expect(row.lastError).toContain("db down");
    expect(row.attempts).toBe(ACTIVITY_REMINDER_MAX_ATTEMPTS);

    const after = await service.dispatchDue(10);
    expect(after).toEqual({
      claimed: 0,
      sent: 0,
      failed: 0,
      cancelled: 0,
      reclaimed: 0,
    });
    expect(notifier.notifyStrict).toHaveBeenCalledTimes(
      ACTIVITY_REMINDER_MAX_ATTEMPTS,
    );
  });

  it("非站内信渠道的行即使被抢占也不会发送（防御性取消）", async () => {
    const { service, activities, reminders, notifier } = build();
    seedDue(activities, reminders, { id: "a" });
    reminders.rows[0]!.channel = "wechat-subscribe";

    const result = await service.dispatchDue(10);
    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      failed: 0,
      cancelled: 1,
      reclaimed: 0,
    });
    expect(notifier.notifyStrict).not.toHaveBeenCalled();
    expect(reminders.rows[0]!.status).toBe("cancelled");
  });
});
