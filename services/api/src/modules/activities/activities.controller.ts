/**
 * 校园活动 · 控制器
 *
 * | 方法 | 路径 | 权限 |
 * | --- | --- | --- |
 * | `GET` | `/activities/items` | 登录 |
 * | `POST` | `/activities/items` | 登录 |
 * | `GET` / `PATCH` | `/activities/items/:id` | 登录（仅本人活动） |
 * | `POST` | `/activities/items/:id/confirm` | 登录 |
 * | `POST` | `/activities/items/:id/dismiss` | 登录 |
 * | `POST` | `/activities/items/:id/archive` | 登录 |
 * | `POST` | `/activities/items/:id/restore` | 登录 |
 * | `POST` | `/activities/imports/wechat` | 登录（用户主动单篇链接/粘贴正文） |
 * | `POST` | `/activities/imports/mail` | 登录（提升自己的邮件归一结果） |
 * | `GET` | `/activities/reminders` | 登录 |
 * | `POST` | `/activities/items/:id/reminders` | 登录 |
 * | `DELETE` | `/activities/reminders/:id` | 登录 |
 * | `POST` | `/activities/reminders/dispatch` | **AdminGuard**（外部 cron） |
 *
 * 所有 POST 都过 `IdempotencyInterceptor`（契约 §11.3）：缺 `Idempotency-Key`
 * 直接 400。管理员派发不挂 `AuthGuard` —— 外部 cron 只带 `x-admin-key` 也能调用，
 * 这正是 AdminGuard 的两种放行方式之一。
 */

import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { modulePath } from "@kedaya/contracts";
import { z } from "zod";

import { AdminGuard, AdminGuardMessage } from "../../common/auth/admin.guard";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user";
import { IdempotencyInterceptor } from "../../common/idempotency/idempotency.interceptor";
import { normalizeLimit } from "../../common/pagination/cursor";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";
import { ActivitiesService } from "./application/activities.service";
import { OfficialSyncService } from "./application/official-sync.service";
import {
  ACTIVITY_KINDS,
  ACTIVITY_REMINDER_CHANNELS,
  ACTIVITY_REMINDER_KINDS,
  ACTIVITY_STATUSES,
  type CreateManualActivityInput,
  type CreateReminderInput,
  type UpdateActivityInput,
  type WechatImportCommand,
} from "./domain/activities.domain";

/**
 * 具体时刻的入参：**必须带时区**（`Z` 或 `±HH:MM`）。
 * 不接受 `YYYY-MM-DD` —— `new Date('2026-11-25')` 会按 UTC 解释，
 * 在上海时区就会漂成前一天 08:00。
 */
const instant = z
  .string()
  .datetime({ offset: true, message: "时间必须是带时区的 ISO-8601 时刻" })
  .transform((value) => new Date(value));

const optionalUrl = z.string().trim().url("必须是合法 URL").max(2048);

const createSchema = z
  .object({
    kind: z.enum(ACTIVITY_KINDS),
    title: z.string().trim().min(1).max(160),
    startsAt: instant.nullable().optional(),
    endsAt: instant.nullable().optional(),
    location: z.string().trim().max(160).nullable().optional(),
    organizer: z.string().trim().max(160).nullable().optional(),
    registrationDeadlineAt: instant.nullable().optional(),
    registrationDeadlineRaw: z.string().trim().max(200).nullable().optional(),
    registrationUrl: optionalUrl.nullable().optional(),
    evidenceText: z.string().max(200).nullable().optional(),
    sourceUrl: optionalUrl.nullable().optional(),
    sourceLabel: z.string().trim().max(160).nullable().optional(),
    publishedAt: instant.nullable().optional(),
  })
  .strict();

const updateSchema = z
  .object({
    kind: z.enum(ACTIVITY_KINDS).optional(),
    title: z.string().trim().min(1).max(160).optional(),
    startsAt: instant.nullable().optional(),
    endsAt: instant.nullable().optional(),
    location: z.string().trim().max(160).nullable().optional(),
    organizer: z.string().trim().max(160).nullable().optional(),
    registrationDeadlineAt: instant.nullable().optional(),
    registrationDeadlineRaw: z.string().trim().max(200).nullable().optional(),
    registrationUrl: optionalUrl.nullable().optional(),
    evidenceText: z.string().max(200).optional(),
    sourceUrl: optionalUrl.nullable().optional(),
    sourceLabel: z.string().trim().max(160).nullable().optional(),
    publishedAt: instant.nullable().optional(),
  })
  .strict();

const listQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(ACTIVITY_STATUSES).optional(),
  source: z.enum(["campus-mail", "wechat-mp", "manual"]).optional(),
  from: instant.optional(),
  to: instant.optional(),
});

const reminderListQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z
    .enum(["scheduled", "pending", "sending", "sent", "failed", "cancelled"])
    .optional(),
});

const wechatImportSchema = z
  .object({
    url: optionalUrl.optional(),
    text: z.string().trim().min(1).max(200_000).optional(),
    title: z.string().trim().min(1).max(160).optional(),
  })
  .strict()
  .refine(
    (value) => (value.url === undefined) !== (value.text === undefined),
    "必须且只能给 url 或 text 之一",
  );

const mailImportSchema = z
  .object({
    eventIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  })
  .strict();

const createReminderSchema = z
  .object({
    kind: z.enum(ACTIVITY_REMINDER_KINDS),
    remindAt: instant,
    channel: z.enum(ACTIVITY_REMINDER_CHANNELS).default("inapp"),
  })
  .strict();

const dispatchSchema = z
  .object({
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict()
  .optional();

const officialAccountSchema = z
  .object({
    accountKey: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/),
  })
  .strict();

@ApiTags("activities · 校园活动")
@ApiBearerAuth()
@Controller(modulePath("activities"))
export class ActivitiesController {
  constructor(
    @Inject(ActivitiesService) private readonly service: ActivitiesService,
    @Inject(OfficialSyncService) private readonly official: OfficialSyncService,
  ) {}

  @Get("official/accounts")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "已配置的学校公众号与我的订阅状态（不含密钥）" })
  officialAccounts(@CurrentUser() userId: string) {
    return this.official.subscriptions(userId);
  }

  @Post("official/subscriptions")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "订阅一个已配置的认证公众号" })
  subscribeOfficial(
    @CurrentUser() userId: string,
    @ZodBody(officialAccountSchema) body: { accountKey: string },
  ) {
    return this.official.subscribe(userId, body.accountKey);
  }

  @Post("official/unsubscribe")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "取消公众号订阅，不影响已确认的活动日程" })
  unsubscribeOfficial(
    @CurrentUser() userId: string,
    @ZodBody(officialAccountSchema) body: { accountKey: string },
  ) {
    return this.official.unsubscribe(userId, body.accountKey);
  }

  @Post("official/sync")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "立即同步当前用户选择的一个公众号，活动仍须确认" })
  syncOfficial(
    @CurrentUser() userId: string,
    @ZodBody(officialAccountSchema) body: { accountKey: string },
  ) {
    return this.official.syncUser(userId, body.accountKey);
  }

  @Get("items")
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: "我的活动（按开始时间升序；无开始时间时按报名截止兜底）",
  })
  list(
    @CurrentUser() userId: string,
    @ZodQuery(listQuerySchema) query: z.infer<typeof listQuerySchema>,
  ) {
    const filters = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.source === undefined ? {} : { source: query.source }),
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
    };
    return this.service.list(userId, filters, {
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      limit: normalizeLimit(query.limit),
    });
  }

  @Post("items")
  @HttpCode(201)
  @UseGuards(AuthGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary: "手动创建活动（固定 candidate，确认后才进日程/提醒）",
    description:
      "客户端不能指定 status/confidence/source。时间必须带时区（Z 或 ±HH:MM）。" +
      "确认后自动生成报名截止前 24h、开始前 1h 的站内信提醒。",
  })
  create(
    @CurrentUser() userId: string,
    @ZodBody(createSchema) body: z.infer<typeof createSchema>,
  ) {
    return this.service.createManual(userId, body as CreateManualActivityInput);
  }

  @Get("items/:id")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "活动详情（不属于自己按 404）" })
  detail(@CurrentUser() userId: string, @Param("id") id: string) {
    return this.service.detail(userId, id);
  }

  @Patch("items/:id")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "编辑活动事实字段（PATCH 不能改 status）" })
  update(
    @CurrentUser() userId: string,
    @Param("id") id: string,
    @ZodBody(updateSchema) body: z.infer<typeof updateSchema>,
  ) {
    return this.service.update(userId, id, body as UpdateActivityInput);
  }

  @Post("items/:id/confirm")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: "确认候选活动（幂等；确认后才创建默认提醒）" })
  confirm(@CurrentUser() userId: string, @Param("id") id: string) {
    return this.service.confirm(userId, id);
  }

  @Post("items/:id/dismiss")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: "忽略活动（取消待发提醒，保留已发送历史）" })
  dismiss(@CurrentUser() userId: string, @Param("id") id: string) {
    return this.service.dismiss(userId, id);
  }

  @Post("items/:id/archive")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: "归档活动（幂等；取消待发提醒，保留已发送历史）" })
  archive(@CurrentUser() userId: string, @Param("id") id: string) {
    return this.service.archive(userId, id);
  }

  @Post("items/:id/restore")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: "从归档恢复为待确认（幂等；不自动重建提醒）" })
  restore(@CurrentUser() userId: string, @Param("id") id: string) {
    return this.service.restore(userId, id);
  }

  @Post("imports/wechat")
  @HttpCode(201)
  @UseGuards(AuthGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary: "单篇公众号导入（用户主动给链接或粘贴正文）",
    description:
      "不做自动发现、不批量抓历史、不绕过验证。只保存活动字段与 ≤200 字证据片段，不保存全文。",
  })
  importWechat(
    @CurrentUser() userId: string,
    @ZodBody(wechatImportSchema) body: z.infer<typeof wechatImportSchema>,
  ) {
    return this.service.importWechat(userId, body as WechatImportCommand);
  }

  @Post("imports/mail")
  @HttpCode(201)
  @UseGuards(AuthGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary: "把校园邮箱归一出的邮件提升为活动（candidate）",
    description:
      "必须显式传用户勾选的 eventIds（不做全箱扫描）；不读/不存邮件正文，只提升当前用户的邮件。",
  })
  importMail(
    @CurrentUser() userId: string,
    @ZodBody(mailImportSchema) body: z.infer<typeof mailImportSchema>,
  ) {
    return this.service.importMail(userId, body);
  }

  @Get("reminders")
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: "我的活动提醒（按提醒时刻升序；scheduled=pending+sending）",
  })
  reminders(
    @CurrentUser() userId: string,
    @ZodQuery(reminderListQuerySchema)
    query: z.infer<typeof reminderListQuerySchema>,
  ) {
    return this.service.listReminders(userId, {
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      limit: normalizeLimit(query.limit),
      ...(query.status === undefined ? {} : { status: query.status }),
    });
  }

  @Post("items/:id/reminders")
  @HttpCode(201)
  @UseGuards(AuthGuard)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary: "给已确认活动加自定义提醒（目前只支持站内信）",
    description:
      "微信订阅消息尚未接通：channel=wechat-subscribe 会被 422 拒绝，不会假装已发送。",
  })
  createReminder(
    @CurrentUser() userId: string,
    @Param("id") id: string,
    @ZodBody(createReminderSchema) body: z.infer<typeof createReminderSchema>,
  ) {
    return this.service.createReminder(userId, id, body as CreateReminderInput);
  }

  @Delete("reminders/:id")
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: "删除提醒（不属于自己按 404）" })
  deleteReminder(@CurrentUser() userId: string, @Param("id") id: string) {
    return this.service.deleteReminder(userId, id);
  }

  @Post("reminders/dispatch")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @AdminGuardMessage(
    "活动提醒派发是管理员操作：请由外部 cron 携带 x-admin-key，或使用管理员账号登录。",
  )
  @ApiOperation({
    summary: "管理员派发到期提醒（外部 cron 调用；原子抢占，多副本不重复）",
    description:
      "带 `x-admin-key` 或管理员用户 JWT 均可。只发站内信；单条失败会回退 pending 供下次重试。",
  })
  dispatch(@ZodBody(dispatchSchema) body: z.infer<typeof dispatchSchema>) {
    return this.service.dispatchDue(body?.limit ?? 50);
  }
}
