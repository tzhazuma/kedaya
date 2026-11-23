/**
 * 校园活动 · 用例层
 *
 * 只编排：导入 → candidate → 用户确认 → 生成提醒 → 管理员派发站内信。
 * 网络（IMAP / 公众号）、数据库、时钟、通知全部通过端口注入。
 *
 * ## 四条硬规则
 *
 * 1. **候选不是日程**：`candidate` 不建提醒；确认后才建默认提醒。
 * 2. **默认提醒**：报名截止前 24h、开始前 1h；目标已过不建，
 *    计算时刻已过但目标未来 → now+5min（且不晚于目标；见 `buildDefaultReminderDrafts`）。
 * 3. **只向用户主动给的链接/正文导入**：不做公众号自动发现，也不批量抓历史。
 * 4. **站内信派发用严格通知**：写通知失败时提醒回退 `pending`，下次重试；
 *    绝不把"没发出去"标成 `sent`。微信订阅消息尚未接通，直接拒绝。
 */

import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  ConflictError,
  NotFoundError,
  UpstreamUnavailableError,
  ValidationError,
} from '../../../common/errors/app-error';
import {
  NOTIFICATION_STRICT_PORT,
  miniappDetailLink,
  type NotificationStrictPort,
} from '../../../common/notifications/notification.port';
import { detectMailEventKind } from '../../mail/domain/mail-event.domain';
import type { MailEventRecord, MailMessageRepository } from '../../mail/domain/mail.domain';
import { MAIL_MESSAGE_REPOSITORY } from '../../mail/domain/mail.domain';
import { WechatArticleService } from '../../wechat/application/wechat-article.service';
import { MINIAPP_PAGES } from '@kedaya/contracts';
import {
  ACTIVITY_SOURCE_LABELS,
  ACTIVITY_TIMEZONE,
  type ActivityArticleLike,
  type ActivityCandidate,
  extractActivityCandidates,
  sanitizeSourceUrl,
} from '@kedaya/shared';
import {
  ACTIVITY_CLOCK,
  ACTIVITY_DEADLINE_RAW_MAX,
  ACTIVITY_REMINDER_LEASE_MS,
  ACTIVITY_REMINDER_MAX_ATTEMPTS,
  ACTIVITY_REMINDER_REPOSITORY,
  ACTIVITY_REPOSITORY,
  ACTIVITY_TEXT_MAX,
  buildDefaultReminderDrafts,
  clampEvidence,
  sanitizeActivityText,
  toActivityItem,
  toActivityReminderItem,
  type ActivityClock,
  type ActivityItem,
  type ActivityRecord,
  type ActivityReminderItem,
  type ActivityReminderKind,
  type ActivityReminderRepository,
  type ActivityRepository,
  type ActivityStatus,
  type ActivityUpdateData,
  type ReminderListQuery,
  type CreateManualActivityInput,
  type CreateReminderInput,
  type DispatchResult,
  type ListActivitiesResult,
  type ListRemindersResult,
  type MailImportCommand,
  type MailImportResult,
  type UpdateActivityInput,
  type WechatImportCommand,
  type WechatImportResult,
} from '../domain/activities.domain';

const DEFAULT_TIME_ZONE = ACTIVITY_TIMEZONE;
const DEFAULT_DISPATCH_LIMIT = 50;
const MAX_DISPATCH_LIMIT = 200;

@Injectable()
export class ActivitiesService {
  private readonly logger = new Logger(ActivitiesService.name);

  constructor(
    @Inject(ACTIVITY_REPOSITORY) private readonly activities: ActivityRepository,
    @Inject(ACTIVITY_REMINDER_REPOSITORY) private readonly reminders: ActivityReminderRepository,
    @Inject(ACTIVITY_CLOCK) private readonly clock: ActivityClock,
    @Inject(NOTIFICATION_STRICT_PORT) private readonly notifications: NotificationStrictPort,
    @Inject(MAIL_MESSAGE_REPOSITORY) private readonly mailEvents: MailMessageRepository,
    @Inject(WechatArticleService) private readonly wechat: WechatArticleService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /* ---------------- 列表 / 详情 ---------------- */

  async list(
    userId: string,
    filters: {
      status?: ActivityStatus;
      source?: 'campus-mail' | 'wechat-mp' | 'manual';
      from?: Date;
      to?: Date;
    } = {},
    page: { cursor?: string; limit: number } = { limit: 20 },
  ): Promise<ListActivitiesResult> {
    const pageResult = await this.activities.listByUser(userId, filters, page);
    return {
      items: pageResult.items.map(toActivityItem),
      nextCursor: pageResult.nextCursor,
    };
  }

  async detail(userId: string, id: string): Promise<ActivityItem> {
    return toActivityItem(await this.requireActivity(userId, id));
  }

  /* ---------------- 手动创建 / 编辑 ---------------- */

  async createManual(userId: string, input: CreateManualActivityInput): Promise<ActivityItem> {
    // 共同契约：手动创建固定 candidate，必须再走 confirm；客户端不能指定 status/confidence。
    this.assertTimeOrder(
      input.startsAt ?? null,
      input.endsAt ?? null,
      input.registrationDeadlineAt ?? null,
    );
    const record = await this.activities.create({
      userId,
      source: 'manual',
      sourceRef: `manual:${randomUUID()}`,
      kind: input.kind,
      title: this.requireTitle(input.title),
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      location: this.cleanText(input.location),
      organizer: this.cleanText(input.organizer),
      registrationDeadlineAt: input.registrationDeadlineAt ?? null,
      registrationDeadlineRaw: this.cleanText(input.registrationDeadlineRaw, ACTIVITY_DEADLINE_RAW_MAX),
      registrationUrl: this.cleanUrl(input.registrationUrl),
      evidenceText: clampEvidence(input.evidenceText ?? ''),
      confidence: scoreManualActivity(input),
      status: 'candidate',
      sourceUrl: this.cleanUrl(input.sourceUrl),
      sourceLabel:
        this.cleanText(input.sourceLabel) ?? ACTIVITY_SOURCE_LABELS.manual,
      publishedAt: input.publishedAt ?? null,
      stale: false,
      mailAccountId: null,
      mailEventId: null,
    });

    return toActivityItem(record);
  }

  /**
   * 只改活动事实字段（标题/时间/地点/报名信息）。
   * 共同契约明确：**不能**借 PATCH 改 status —— 确认/忽略走各自的领域动作端点。
   */
  async update(userId: string, id: string, input: UpdateActivityInput): Promise<ActivityItem> {
    const current = await this.requireActivity(userId, id);

    const nextStartsAt = input.startsAt !== undefined ? input.startsAt : current.startsAt;
    const nextEndsAt = input.endsAt !== undefined ? input.endsAt : current.endsAt;
    const nextDeadline =
      input.registrationDeadlineAt !== undefined
        ? input.registrationDeadlineAt
        : current.registrationDeadlineAt;
    this.assertTimeOrder(nextStartsAt, nextEndsAt, nextDeadline);

    const data: ActivityUpdateData = {};
    if (input.kind !== undefined) data.kind = input.kind;
    if (input.title !== undefined) data.title = this.requireTitle(input.title);
    if (input.startsAt !== undefined) data.startsAt = input.startsAt;
    if (input.endsAt !== undefined) data.endsAt = input.endsAt;
    if (input.location !== undefined) data.location = this.cleanText(input.location);
    if (input.organizer !== undefined) data.organizer = this.cleanText(input.organizer);
    if (input.registrationDeadlineAt !== undefined) {
      data.registrationDeadlineAt = input.registrationDeadlineAt;
    }
    if (input.registrationDeadlineRaw !== undefined) {
      data.registrationDeadlineRaw = this.cleanText(
        input.registrationDeadlineRaw,
        ACTIVITY_DEADLINE_RAW_MAX,
      );
    }
    if (input.registrationUrl !== undefined) {
      data.registrationUrl = this.cleanUrl(input.registrationUrl);
    }
    if (input.evidenceText !== undefined) data.evidenceText = clampEvidence(input.evidenceText);
    if (input.sourceUrl !== undefined) data.sourceUrl = this.cleanUrl(input.sourceUrl);
    if (input.sourceLabel !== undefined) data.sourceLabel = this.cleanText(input.sourceLabel);
    if (input.publishedAt !== undefined) data.publishedAt = input.publishedAt;

    const updated = await this.activities.update(userId, id, data);
    if (updated === null) throw new NotFoundError('活动不存在');

    // 时间变了：只重算**受影响目标**的默认提醒（已发送的历史保留）。
    const changedKinds: ActivityReminderKind[] = [];
    if (input.startsAt !== undefined) changedKinds.push('start');
    if (input.registrationDeadlineAt !== undefined) changedKinds.push('registration');
    if (updated.status === 'confirmed' && changedKinds.length > 0) {
      await this.reminders.deletePendingDefaults(updated.id, changedKinds);
      await this.ensureDefaultReminders(updated, changedKinds);
    }

    return toActivityItem(updated);
  }

  /* ---------------- 确认 / 忽略 ---------------- */

  async confirm(userId: string, id: string): Promise<ActivityItem> {
    const activity = await this.requireActivity(userId, id);
    if (activity.status === 'confirmed') {
      await this.ensureDefaultReminders(activity);
      return toActivityItem(activity);
    }
    if (activity.status !== 'candidate') {
      throw new ConflictError('只有待确认的活动可以确认', {
        reason: 'ACTIVITY_STATUS_INVALID',
        status: activity.status,
      });
    }

    const confirmed = await this.activities.update(userId, id, { status: 'confirmed' });
    if (confirmed === null) throw new NotFoundError('活动不存在');

    await this.ensureDefaultReminders(confirmed);
    return toActivityItem(confirmed);
  }

  async dismiss(userId: string, id: string): Promise<ActivityItem> {
    const activity = await this.requireActivity(userId, id);
    if (activity.status === 'dismissed') {
      return toActivityItem(activity);
    }
    if (activity.status !== 'candidate' && activity.status !== 'confirmed') {
      throw new ConflictError('只有待确认或已确认的活动可以忽略', {
        reason: 'ACTIVITY_STATUS_INVALID',
        status: activity.status,
      });
    }

    const dismissed = await this.activities.update(userId, id, { status: 'dismissed' });
    if (dismissed === null) throw new NotFoundError('活动不存在');

    // 忽略 = 不再提醒。已发送的历史保留，待发的清掉。
    await this.reminders.deletePendingForActivity(dismissed.id);
    return toActivityItem(dismissed);
  }

  /* ---------------- 归档 / 恢复 ---------------- */

  /**
   * 归档：保留活动与已发送历史，清掉待发提醒。
   * 重复归档返回原条目（幂等）；`archived` 之后只能 restore，不能 confirm/dismiss。
   */
  async archive(userId: string, id: string): Promise<ActivityItem> {
    const activity = await this.requireActivity(userId, id);
    if (activity.status === 'archived') return toActivityItem(activity);

    const archived = await this.activities.update(userId, id, { status: 'archived' });
    if (archived === null) throw new NotFoundError('活动不存在');

    await this.reminders.deletePendingForActivity(archived.id);
    return toActivityItem(archived);
  }

  /**
   * 恢复：只把 `archived` 还原成 `candidate`，**不自动重建提醒**（需要重新确认）。
   * 已在 candidate/confirmed 时返回原样（幂等）；dismissed 语义不同，按 409。
   */
  async restore(userId: string, id: string): Promise<ActivityItem> {
    const activity = await this.requireActivity(userId, id);
    if (activity.status === 'candidate' || activity.status === 'confirmed') {
      return toActivityItem(activity);
    }
    if (activity.status !== 'archived') {
      throw new ConflictError('只有已归档的活动可以恢复', {
        reason: 'ACTIVITY_STATUS_INVALID',
        status: activity.status,
      });
    }

    const restored = await this.activities.update(userId, id, { status: 'candidate' });
    if (restored === null) throw new NotFoundError('活动不存在');
    return toActivityItem(restored);
  }

  /* ---------------- 单篇公众号导入 ---------------- */

  async importWechat(userId: string, command: WechatImportCommand): Promise<WechatImportResult> {
    const url = command.url?.trim();
    const text = command.text?.trim();

    if ((url === undefined || url.length === 0) === (text === undefined || text.length === 0)) {
      throw new ValidationError('必须且只能给一个公众号链接（url）或粘贴正文（text）', {
        reason: 'WECHAT_IMPORT_SOURCE_REQUIRED',
      });
    }

    if (text !== undefined && text.length > 0) {
      const title = this.requireTitle(command.title?.trim() ?? firstLine(text) ?? '公众号活动');
      const article: ActivityArticleLike = {
        title,
        accountName: '微信粘贴',
        publishedAt: null,
        bodyLines: splitBodyLines(text),
        sourceUrl: '',
      };
      const candidates = this.extractCandidates(article, this.clock.now());
      if (candidates.length === 0) {
        throw new ValidationError('没能从粘贴内容里识别出活动（需要活动关键词与明确时间）', {
          reason: 'WECHAT_NOT_ACTIVITY',
        }, 422);
      }

      return this.persistImportedCandidates(userId, {
        baseSourceRef: `paste:${sha256(text.replace(/\s+/g, ' ').trim())}`,
        candidates,
        kind: inferActivityKind(article),
        sourceUrl: null,
        sourceLabel: '微信粘贴',
        publishedAt: null,
      });
    }

    const normalizedUrl = url ?? '';
    const outcome = await this.wechat.fetchAndParse(normalizedUrl);
    if (!outcome.ok) {
      // 非 mp.weixin.qq.com 链接是**用户输入问题**，不是上游故障：422 而不是 503。
      if (outcome.code === 'invalid-url') {
        throw new ValidationError(outcome.message, {
          reason: 'WECHAT_URL_UNSUPPORTED',
        }, 422);
      }
      throw new UpstreamUnavailableError(`无法导入这篇公众号文章：${outcome.message}`, {
        reason: outcome.code,
      });
    }

    const article = outcome.article;
    const publishedAt = parseOptionalDate(article.publishedAt);
    const candidates = this.extractCandidates(article, publishedAt ?? this.clock.now());
    if (candidates.length === 0) {
      throw new ValidationError('这篇公众号文章里没有识别出活动（需要活动关键词与明确时间）', {
        reason: 'WECHAT_NOT_ACTIVITY',
      }, 422);
    }

    // sourceRef 用**清洗后的稳定 URL**：去掉会话/分享参数；`/s/<id>` 形式连查询串一起丢。
    const safeSourceUrl = canonicalArticleUrl(article.sourceUrl);
    const sourceLabel =
      sanitizeActivityText(article.accountName, ACTIVITY_TEXT_MAX) ??
      ACTIVITY_SOURCE_LABELS['wechat-mp'];
    return this.persistImportedCandidates(userId, {
      baseSourceRef: `wechat:${safeSourceUrl ?? sha256(article.sourceUrl)}`,
      candidates,
      kind: inferActivityKind(article),
      sourceUrl: safeSourceUrl,
      sourceLabel,
      publishedAt,
    });
  }

  private extractCandidates(article: ActivityArticleLike, now: Date): ActivityCandidate[] {
    return extractActivityCandidates(article, { now, timeZone: this.timeZone() });
  }

  private async persistImportedCandidates(
    userId: string,
    input: {
      baseSourceRef: string;
      candidates: readonly ActivityCandidate[];
      kind: ActivityItem['kind'];
      sourceUrl: string | null;
      sourceLabel: string;
      publishedAt: Date | null;
    },
  ): Promise<WechatImportResult> {
    let created = 0;
    let skipped = 0;
    const items: ActivityItem[] = [];

    for (const candidate of input.candidates) {
      const fields = sanitizeImportedCandidate(candidate);
      // 同一篇文章可能有多场活动：稳定 URL + 候选指纹，既区分又不随重复导入漂移。
      const sourceRef = `${input.baseSourceRef}#${candidateFingerprint(fields)}`;
      const result = await this.activities.upsertBySourceRef({
        userId,
        source: 'wechat-mp',
        sourceRef,
        kind: input.kind,
        title: fields.title,
        startsAt: fields.startsAt,
        endsAt: fields.endsAt,
        location: fields.location,
        organizer: fields.organizer,
        registrationDeadlineAt: fields.registrationDeadlineAt,
        registrationDeadlineRaw: fields.registrationDeadlineRaw,
        registrationUrl: fields.registrationUrl,
        evidenceText: fields.evidenceText,
        confidence: fields.confidence,
        status: 'candidate',
        sourceUrl: input.sourceUrl,
        sourceLabel: input.sourceLabel,
        publishedAt: input.publishedAt,
        stale: false,
        mailAccountId: null,
        mailEventId: null,
      });

      if (result.created) created += 1;
      else skipped += 1;
      items.push(toActivityItem(result.record));
    }

    return { item: items[0] ?? null, items, created, skipped };
  }

  /* ---------------- 邮件提升 ---------------- */

  async importMail(userId: string, command: MailImportCommand): Promise<MailImportResult> {
    const wanted = Array.isArray(command.eventIds) ? command.eventIds : [];
    if (wanted.length === 0) {
      throw new ValidationError('必须明确指定要提升的邮件事件 id', {
        reason: 'MAIL_IMPORT_IDS_REQUIRED',
      });
    }

    const events = await this.mailEvents.listEvents(userId);
    const byId = new Map(events.map((event) => [event.id, event]));
    const selected: MailEventRecord[] = [];
    for (const id of wanted) {
      const event = byId.get(id);
      // 不属于当前用户与不存在都按 404：不透露"这封邮件存在但不是你的"
      if (event === undefined) throw new NotFoundError('邮件事件不存在或不属于你');
      selected.push(event);
    }

    let created = 0;
    let skipped = 0;
    const items: ActivityItem[] = [];
    for (const event of selected) {
      const startsAt = validDate(event.startsAt);
      const endsAt = dropInvalidEnd(startsAt, event.endsAt ?? null);
      const deadlineAt = dropInvalidDeadline(startsAt, event.registrationDeadlineAt ?? null);
      const result = await this.activities.upsertBySourceRef({
        userId,
        source: 'campus-mail',
        sourceRef: event.id,
        kind: event.kind ?? 'other',
        title: sanitizeActivityText(event.title, ACTIVITY_TEXT_MAX) ?? '未命名活动',
        startsAt,
        endsAt,
        location: sanitizeActivityText(event.location, ACTIVITY_TEXT_MAX),
        organizer: sanitizeActivityText(event.organizer, ACTIVITY_TEXT_MAX),
        registrationDeadlineAt: deadlineAt,
        registrationDeadlineRaw: sanitizeActivityText(
          event.registrationDeadlineRaw,
          ACTIVITY_DEADLINE_RAW_MAX,
        ),
        registrationUrl: event.registrationUrl === null ? null : sanitizeSourceUrl(event.registrationUrl),
        evidenceText: clampEvidence(
          [event.matchedText, event.registrationDeadlineRaw]
            .filter((part): part is string => typeof part === 'string' && part.length > 0)
            .join(' · '),
        ),
        confidence: event.confidence,
        status: 'candidate',
        sourceUrl: null,
        sourceLabel: ACTIVITY_SOURCE_LABELS['campus-mail'],
        publishedAt: null,
        stale: event.stale,
        mailAccountId: event.accountId,
        mailEventId: event.id,
      });

      if (result.created) created += 1;
      else skipped += 1;
      items.push(toActivityItem(result.record));
    }

    return { item: items[0] ?? null, items, created, skipped };
  }

  /* ---------------- 提醒 ---------------- */

  async listReminders(
    userId: string,
    query: ReminderListQuery = { limit: 20 },
  ): Promise<ListRemindersResult> {
    const page = await this.reminders.listByUser(userId, query);
    return {
      items: page.items.map(toActivityReminderItem),
      nextCursor: page.nextCursor,
    };
  }

  async createReminder(
    userId: string,
    activityId: string,
    input: CreateReminderInput,
  ): Promise<ActivityReminderItem> {
    const activity = await this.requireActivity(userId, activityId);
    if (activity.status !== 'confirmed') {
      throw new ConflictError('请先确认活动，再添加提醒', { reason: 'ACTIVITY_NOT_CONFIRMED' });
    }

    const channel = input.channel ?? 'inapp';
    if (channel !== 'inapp') {
      throw new ValidationError(
        '微信订阅消息尚未接通，提醒目前只发站内信',
        { reason: 'REMINDER_CHANNEL_NOT_AVAILABLE', channel },
        422,
      );
    }

    const now = this.clock.now();
    if (!(input.remindAt instanceof Date) || Number.isNaN(input.remindAt.getTime())) {
      throw new ValidationError('提醒时刻不合法');
    }
    if (input.remindAt.getTime() <= now.getTime()) {
      throw new ValidationError('提醒时刻必须晚于当前时间', { reason: 'REMINDER_IN_PAST' }, 422);
    }

    const reminder = await this.reminders.create({
      userId,
      activityId,
      kind: input.kind,
      remindAt: input.remindAt,
      channel: 'inapp',
      dedupeKey: null,
    });
    return toActivityReminderItem(reminder);
  }

  async deleteReminder(userId: string, id: string): Promise<{ id: string; deleted: true }> {
    const deleted = await this.reminders.deleteById(userId, id);
    if (!deleted) throw new NotFoundError('提醒不存在');
    return { id, deleted: true };
  }

  /* ---------------- 管理员派发 ---------------- */

  /**
   * 派发到期提醒。由外部 cron 携带管理员凭据调用（不引入 @nestjs/schedule）。
   *
   * 多副本安全：`claimDue` 用 `FOR UPDATE SKIP LOCKED` 原子抢占 pending → sending；
   * 派发前先回收超过租约仍停在 sending 的行（上一次派发崩溃的残留）。
   * 单条失败先回退 pending 供下次重试；达到上限标记 failed（可见），不再无限重试。
   */
  async dispatchDue(limit = DEFAULT_DISPATCH_LIMIT): Promise<DispatchResult> {
    const now = this.clock.now();
    const safeLimit = Math.min(
      MAX_DISPATCH_LIMIT,
      Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : DEFAULT_DISPATCH_LIMIT),
    );

    const staleBefore = new Date(now.getTime() - this.dispatchLeaseMs());
    const reclaimed = await this.reminders.releaseStale(staleBefore);
    const claimed = await this.reminders.claimDue(now, safeLimit);
    let sent = 0;
    let failed = 0;
    let cancelled = 0;

    for (const reminder of claimed) {
      // 防御性检查：claimDue 只抢 inapp；若历史行/并发写入带进别的渠道，不假装已送达。
      if (reminder.channel !== 'inapp') {
        await this.reminders.cancel(reminder.id);
        cancelled += 1;
        continue;
      }

      // 抢占与发送之间活动可能被忽略/归档：不再发送，把提醒取消。
      const activity = await this.activities.findById(reminder.userId, reminder.activityId);
      if (activity === null || activity.status !== 'confirmed') {
        await this.reminders.cancel(reminder.id);
        cancelled += 1;
        continue;
      }

      try {
        await this.notifications.notifyStrict({
          userId: reminder.userId,
          title: this.reminderTitle(activity),
          body: this.reminderBody(activity, reminder.kind, reminder.remindAt),
          source: 'activities',
          link: miniappDetailLink(MINIAPP_PAGES.activitiesDetail, activity.id),
        });
        await this.reminders.markSent(reminder.id, now);
        sent += 1;
      } catch (error) {
        // 通知没写成功：未到上限回退 pending 供下次重试；到上限标 failed，绝不标 sent。
        const message = error instanceof Error ? error.message : String(error);
        if (reminder.attempts >= this.dispatchMaxAttempts()) {
          await this.reminders.markFailed(reminder.id, message);
          this.logger.warn(`活动提醒派发失败（已达重试上限，标记 failed）：${message}`);
        } else {
          await this.reminders.release(reminder.id);
          this.logger.warn(`活动提醒派发失败（已回退 pending）：${message}`);
        }
        failed += 1;
      }
    }

    return { claimed: claimed.length, sent, failed, cancelled, reclaimed };
  }

  /* ---------------- 内部 ---------------- */

  private async requireActivity(userId: string, id: string): Promise<ActivityRecord> {
    const activity = await this.activities.findById(userId, id);
    if (activity === null) throw new NotFoundError('活动不存在');
    return activity;
  }

  private async ensureDefaultReminders(
    activity: ActivityRecord,
    kinds?: readonly ActivityReminderKind[],
  ): Promise<void> {
    const drafts = buildDefaultReminderDrafts(
      { startsAt: activity.startsAt, registrationDeadlineAt: activity.registrationDeadlineAt },
      this.clock.now(),
    ).filter((draft) => kinds === undefined || kinds.includes(draft.kind));
    if (drafts.length === 0) return;

    await this.reminders.createMany(
      drafts.map((draft) => ({
        userId: activity.userId,
        activityId: activity.id,
        kind: draft.kind,
        remindAt: draft.remindAt,
        channel: draft.channel,
        dedupeKey: draft.dedupeKey,
      })),
    );
  }

  private reminderTitle(activity: ActivityRecord): string {
    return `活动提醒：${activity.title}`;
  }

  private reminderBody(
    activity: ActivityRecord,
    kind: ActivityReminderItem['kind'],
    fallbackTime: Date,
  ): string {
    if (kind === 'registration') {
      const target = activity.registrationDeadlineAt ?? fallbackTime;
      return `「${activity.title}」报名截止：${this.formatShanghai(target)}（北京时间）`;
    }
    if (kind === 'start') {
      const target = activity.startsAt ?? fallbackTime;
      return `「${activity.title}」开始时间：${this.formatShanghai(target)}（北京时间）`;
    }
    return `「${activity.title}」提醒：${this.formatShanghai(fallbackTime)}（北京时间）`;
  }

  private formatShanghai(value: Date): string {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: this.timeZone(),
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(value);
  }

  private timeZone(): string {
    const configured = this.config.get<string>('ACTIVITIES_TIME_ZONE');
    return configured?.trim() ? configured.trim() : DEFAULT_TIME_ZONE;
  }

  private requireTitle(value: string): string {
    const title = sanitizeActivityText(value, ACTIVITY_TEXT_MAX);
    if (title === null) throw new ValidationError('活动标题不能为空');
    return title;
  }

  private cleanText(
    value: string | null | undefined,
    max = ACTIVITY_TEXT_MAX,
  ): string | null {
    return sanitizeActivityText(value, max);
  }

  /**
   * 时间顺序校验：结束必须晚于开始；报名截止不得晚于开始（等于允许）。
   * 任一端为 null 时跳过对应比较 —— 未知不是错误，不猜。
   */
  private assertTimeOrder(
    startsAt: Date | null,
    endsAt: Date | null,
    registrationDeadlineAt: Date | null,
  ): void {
    if (startsAt === null) return;
    if (endsAt !== null && endsAt.getTime() <= startsAt.getTime()) {
      throw new ValidationError('结束时间必须晚于开始时间', {
        reason: 'ACTIVITY_END_BEFORE_START',
      }, 422);
    }
    if (
      registrationDeadlineAt !== null &&
      registrationDeadlineAt.getTime() > startsAt.getTime()
    ) {
      throw new ValidationError('报名截止时间不能晚于活动开始时间', {
        reason: 'ACTIVITY_DEADLINE_AFTER_START',
      }, 422);
    }
  }

  private dispatchLeaseMs(): number {
    return this.readPositiveInt('ACTIVITIES_DISPATCH_LEASE_MS', ACTIVITY_REMINDER_LEASE_MS, 1_000, 24 * 60 * 60 * 1000);
  }

  private dispatchMaxAttempts(): number {
    return this.readPositiveInt('ACTIVITIES_DISPATCH_MAX_ATTEMPTS', ACTIVITY_REMINDER_MAX_ATTEMPTS, 1, 100);
  }

  private readPositiveInt(key: string, fallback: number, min: number, max: number): number {
    const raw = this.config.get<string | number>(key);
    const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
  }

  /** 链接去会话参数；非法 URL 返回 null（不把脏链接写进库）。 */
  private cleanUrl(value: string | null | undefined): string | null {
    const cleaned = this.cleanText(value, 2048);
    return cleaned === null ? null : sanitizeSourceUrl(cleaned);
  }
}

/** 手动创建没有抽取置信度：按字段完整度由服务端计算，客户端不能指定。 */
function scoreManualActivity(input: CreateManualActivityInput): number {
  let score = 0.6;
  if (input.startsAt !== undefined && input.startsAt !== null) score += 0.1;
  if (input.location !== undefined && input.location !== null) score += 0.05;
  if (input.organizer !== undefined && input.organizer !== null) score += 0.05;
  if (input.registrationDeadlineAt !== undefined && input.registrationDeadlineAt !== null) score += 0.1;
  if (input.registrationUrl !== undefined && input.registrationUrl !== null) score += 0.05;
  return Math.min(0.95, Math.round(score * 100) / 100);
}

function inferActivityKind(article: ActivityArticleLike): ActivityItem['kind'] {
  const text = `${article.title}\n${article.bodyLines.join('\n')}`;
  const detected = detectMailEventKind(text);
  if (detected !== null) return detected;
  if (/(?:运动|体育|比赛|健身|羽毛球|篮球|足球|排球|跑步|游泳)/.test(text)) return 'sports';
  if (/(?:社团|招新|俱乐部|club)/i.test(text)) return 'club';
  return 'other';
}

function splitBodyLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function firstLine(text: string): string | null {
  const line = text
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return line === undefined ? null : line.slice(0, 160);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function parseOptionalDate(value: string | null): Date | null {
  if (value === null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function validDate(value: Date | null | undefined): Date | null {
  if (value === undefined || value === null) return null;
  return Number.isNaN(value.getTime()) ? null : value;
}

/** 结束时刻不晚于开始 → 丢弃绝对时刻（不猜时长），但保留活动本身。 */
function dropInvalidEnd(startsAt: Date | null, endsAt: Date | null): Date | null {
  const end = validDate(endsAt);
  if (startsAt === null || end === null) return end;
  return end.getTime() <= startsAt.getTime() ? null : end;
}

/** 报名截止晚于开始 → 丢弃绝对时刻，原文仍保留（不把矛盾写进绝对时间）。 */
function dropInvalidDeadline(
  startsAt: Date | null,
  deadline: Date | null,
): Date | null {
  const value = validDate(deadline);
  if (startsAt === null || value === null) return value;
  return value.getTime() > startsAt.getTime() ? null : value;
}

interface ImportedCandidateFields {
  title: string;
  startsAt: Date | null;
  endsAt: Date | null;
  location: string | null;
  organizer: string | null;
  registrationDeadlineAt: Date | null;
  registrationDeadlineRaw: string | null;
  registrationUrl: string | null;
  evidenceText: string;
  confidence: number;
}

/**
 * 导入候选的落库前清洗。
 *
 * 抽取器已经保证「至少有一个时间」，但公众号/邮件原文仍可能写出
 * `结束早于开始` 或 `报名截止晚于开始`。这里**丢弃矛盾的绝对时刻**
 * （保留 raw），而不是把矛盾数据写进库，也不因此丢掉整条活动。
 */
function sanitizeImportedCandidate(candidate: ActivityCandidate): ImportedCandidateFields {
  const startsAt = validDate(candidate.startsAt === null ? null : new Date(candidate.startsAt));
  return {
    title: sanitizeActivityText(candidate.title, ACTIVITY_TEXT_MAX) ?? '未命名活动',
    startsAt,
    endsAt: dropInvalidEnd(startsAt, candidate.endsAt === null ? null : new Date(candidate.endsAt)),
    location: sanitizeActivityText(candidate.location, ACTIVITY_TEXT_MAX),
    organizer: sanitizeActivityText(candidate.organizer, ACTIVITY_TEXT_MAX),
    registrationDeadlineAt: dropInvalidDeadline(
      startsAt,
      candidate.registrationDeadlineAt === null
        ? null
        : new Date(candidate.registrationDeadlineAt),
    ),
    registrationDeadlineRaw: sanitizeActivityText(
      candidate.registrationDeadlineRaw,
      ACTIVITY_DEADLINE_RAW_MAX,
    ),
    registrationUrl:
      candidate.registrationUrl === null ? null : sanitizeSourceUrl(candidate.registrationUrl),
    evidenceText: clampEvidence(candidate.evidenceText),
    confidence: candidate.confidence,
  };
}

/** 同一篇文章里区分多场活动：只取稳定字段的哈希，重复导入得到同一个 sourceRef。 */
function candidateFingerprint(fields: ImportedCandidateFields): string {
  return sha256(
    [
      fields.title,
      fields.startsAt?.toISOString() ?? '',
      fields.endsAt?.toISOString() ?? '',
      fields.registrationDeadlineAt?.toISOString() ?? '',
      fields.registrationDeadlineRaw ?? '',
      fields.location ?? '',
    ].join('\u0000'),
  ).slice(0, 16);
}

/**
 * 公众号文章 URL 的稳定形式。
 *
 * `sanitizeSourceUrl` 只去会话参数；`mp.weixin.qq.com/s/<id>` 这种路径本身就
 * 唯一标识文章，`scene` / `utm_*` 只是分享来源 —— 一并去掉，sourceRef 才不会
 * 因为「谁转发」而变化。`/s?__biz=…` 形式的查询串是文章身份，保留。
 */
function canonicalArticleUrl(raw: string): string | null {
  const safe = sanitizeSourceUrl(raw);
  if (safe === null) return null;
  try {
    const url = new URL(safe);
    if (url.hostname === 'mp.weixin.qq.com' && /^\/s\/[^/]+$/.test(url.pathname)) {
      url.search = '';
      url.hash = '';
      return url.toString();
    }
    return safe;
  } catch {
    return null;
  }
}
