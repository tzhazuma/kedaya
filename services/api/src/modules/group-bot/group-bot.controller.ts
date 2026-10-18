import { Controller, Get, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { AdminGuard } from '../../common/auth/admin.guard';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { GroupBotService } from './group-bot.service';
import { QQ_SIGNATURE_HEADER, QQ_TIMESTAMP_HEADER } from './domain/group-bot.domain';

const decideSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(500).optional(),
});

/**
 * 群机器人接入。
 *
 * ## 为什么不用 `modulePath()` 前缀
 * 它不是契约 §4 的 20 个用户可见模块之一，而是**基础设施**（与 contact-exchange 同理）。
 * 路由独立挂 `/group-bot`，不进 `MODULES`。
 *
 * ## 两个入口的权限完全不同
 * - `POST /group-bot/webhook/qq` —— **公开**（平台来调），安全性靠**Ed25519 验签**；
 * - `GET /group-bot/drafts`、`POST /group-bot/drafts/:id/decide` —— **管理员**（AdminGuard）。
 *   草稿里是群里的原始聊天文本，普通用户不能看。
 */
@ApiTags('group-bot · 群机器人接入（基础设施）')
@Controller('group-bot')
export class GroupBotController {
  constructor(private readonly service: GroupBotService) {}

  /**
   * QQ 机器人回调。
   *
   * ⚠️ 读取的是 **rawBody**（`main.ts` 里 `json({ verify })` 挂上去的原始字节），
   * 不是解析后的对象 —— JSON 重新序列化会改变字节（空格、键序），验签必然失败。
   */
  @Post('webhook/qq')
  @HttpCode(200)
  @ApiOperation({
    summary: 'QQ 机器人回调（公开，靠 Ed25519 验签）',
    description:
      '接收 `GROUP_MESSAGE_CREATE`「群消息（全量模式）」。验签失败 403；未启用 403；'
      + '不需要处理的事件返回 200 + accepted=false（避免平台无限重试）。',
  })
  async qqWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers(QQ_SIGNATURE_HEADER) signature: string | undefined,
    @Headers(QQ_TIMESTAMP_HEADER) timestamp: string | undefined,
  ) {
    const rawBody = request.rawBody?.toString('utf8') ?? '';
    return this.service.handleQqWebhook({
      rawBody,
      signature: signature ?? '',
      timestamp: timestamp ?? '',
    });
  }

  /** 待确认草稿列表（管理员） */
  @Get('drafts')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: '待确认草稿列表（管理员）' })
  listDrafts(@Query() query: Record<string, unknown>) {
    const status = typeof query.status === 'string' ? query.status : undefined;
    const limit = Number(query.limit ?? 20);
    const cursor = typeof query.cursor === 'string' && query.cursor.length > 0 ? query.cursor : null;
    return this.service.list({ cursor, limit: Number.isFinite(limit) ? Math.min(limit, 50) : 20, status });
  }

  /** 处理一条草稿（管理员） */
  @Post('drafts/:id/decide')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  @ApiOperation({
    summary: '确认或忽略一条草稿（管理员）',
    description:
      '只改状态，**不自动创建平台条目** —— 真正发布要显式调用对应模块的接口，'
      + '这样"确认"与"发布"是两个可审计的动作。',
  })
  async decide(@Param('id') id: string, @ZodBody(decideSchema) body: { decision: 'approved' | 'rejected'; note?: string }) {
    await this.service.decide({ id, decision: body.decision, note: body.note });
    return { id, decision: body.decision };
  }
}
