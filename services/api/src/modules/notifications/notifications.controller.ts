import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { modulePath } from "@kedaya/contracts";
import { z } from "zod";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user";
import { normalizeLimit, readCursor } from "../../common/pagination/cursor";
import { NotificationService } from "./notifications.service";
import { PushService } from "./push/push.service";

/**
 * 通知 HTTP 层。
 *
 * 与脚手架生成的模块不同，这里**整个控制器**都要登录（`@UseGuards(AuthGuard)`）：
 *   通知天然是"我的"，没有任何公开可读的部分。
 *
 * 也没有公开放到 `POST /items`：那等于让任何登录用户给任意 userId 写通知
 * （可以伪造"你中奖了"）。写通知只走内部的 `NotificationPort`。
 */
@ApiTags("notifications · 通知")
@ApiBearerAuth()
@Controller(modulePath("notifications"))
@UseGuards(AuthGuard)
export class NotificationController {
  constructor(
    @Inject(NotificationService) private readonly service: NotificationService,
    @Inject(PushService) private readonly push: PushService,
  ) {}

  @Get("items")
  @ApiOperation({ summary: "我的通知（游标分页，倒序；unread=1 只看未读）" })
  list(@CurrentUser() userId: string, @Query() query: Record<string, unknown>) {
    return this.service.list(userId, {
      cursor: readCursor(query),
      limit: normalizeLimit(query.limit),
      unreadOnly: readUnreadFlag(query.unread),
    });
  }

  @Get('unread-count')
  @ApiOperation({ summary: '未读数（小程序 tabBar 红点用）' })
  async unreadCount(@CurrentUser() userId: string): Promise<{ count: number }> {
    return { count: await this.service.unreadCount(userId) };
  }

  @Post('items/:id/read')
  @ApiOperation({ summary: '标记单条已读（幂等；不属于自己则 404）' })
  markRead(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.markRead(userId, id);
  }

  @Post('read-all')
  @ApiOperation({ summary: '全部标记已读，返回本次标记条数' })
  async markAllRead(@CurrentUser() userId: string): Promise<{ updated: number }> {
    return { updated: await this.service.markAllRead(userId) };
  }

  @Get('push/status')
  @ApiOperation({ summary: '我的推送渠道状态（不返回设备 token 或 openid）' })
  async pushStatus(@CurrentUser() userId: string) {
    return {
      configured: this.push.configuredChannels(),
      targets: await this.push.targetViews(userId),
    };
  }

  @Post('push/targets')
  @ApiOperation({ summary: '登记当前用户的 APNs / FCM / HMS 设备令牌' })
  async registerTarget(@CurrentUser() userId: string, @Body() body: unknown) {
    const input = pushTargetSchema.parse(body);
    const target = await this.push.registerTarget(userId, input.channel, input.token);
    return { channel: target.channel, status: target.status };
  }

  @Post('push/targets/revoke')
  @ApiOperation({ summary: '撤销当前用户的设备令牌' })
  async revokeTarget(@CurrentUser() userId: string, @Body() body: unknown) {
    const input = pushTargetSchema.parse(body);
    return { revoked: await this.push.revokeTarget(userId, input.channel, input.token) };
  }

  @Post('push/wechat-subscriptions')
  @ApiOperation({ summary: '登记当前用户刚同意的一次性微信订阅模板' })
  async subscribeWechat(@CurrentUser() userId: string, @Body() body: unknown) {
    const input = wechatSubscriptionSchema.parse(body);
    const target = await this.push.subscribeWechat(userId, input.templateId);
    return { channel: target.channel, templateId: target.templateId, status: target.status };
  }
}

const pushTargetSchema = z.object({
  channel: z.enum(['apns', 'fcm', 'hms']),
  token: z.string().trim().min(1).max(4096),
}).strict();

const wechatSubscriptionSchema = z.object({
  templateId: z.string().trim().min(1).max(128),
}).strict();

/**
 * `?unread=1` / `?unread=true` 视为"只看未读"。
 *
 * 不写 `z.coerce.boolean()`：它会把字符串 `"false"` 也当成 true（非空字符串即真值），
 * 是个很容易踩的坑。这里显式枚举允许的真值。
 */
function readUnreadFlag(raw: unknown): boolean {
  return raw === "1" || raw === "true" || raw === true;
}
