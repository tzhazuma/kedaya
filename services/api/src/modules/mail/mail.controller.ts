/**
 * 校园邮箱 · 控制器（**不注册到 AppModule**，由 Lead 统一装配）
 *
 * | 方法 | 路径 | 说明 |
 * | --- | --- | --- |
 * | `POST` | `/mail/account` | 绑定校园邮箱（先真连一次 IMAP 验证） |
 * | `DELETE` | `/mail/account` | 解绑（**硬删**凭证） |
 * | `POST` | `/mail/sync` | 同步最近邮件 → 归一活动 |
 * | `GET` | `/mail/events` | 归一后的活动列表 |
 *
 * ## 身份层级
 *
 * 全部端点只要**一级身份**（`AuthGuard`）。邮件是用户自己的能力，
 * 不需要第二级校园系统绑定（`CampusBindingGuard`）—— 邮箱本身就是一级入口。
 *
 * ## 响应形状
 *
 * 绑定/同步/活动响应**绝不含** `password` / `passwordCipher` / `cipherKeyId` /
 * `cookie` / `session` 等键名；由 domain 的 `assertNoMailCredentialKeys()`
 * 在测试里对真实返回对象做递归扫描。
 */

import { Controller, Delete, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { MailService } from './application/mail.service';
import type { LinkMailAccountCommand } from './domain/mail.domain';

/**
 * `POST /mail/account` 的入参。
 *
 * `.strict()`：客户端多塞 `passwordCipher` / `cookie` 等字段会被结构性拒绝，
 * 不会"悄悄忽略"后让调用方以为写进去了。
 */
const linkAccountSchema = z
  .object({
    email: z
      .string()
      .trim()
      .min(3)
      .max(320)
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, '邮箱格式不正确'),
    // 只接受 DNS 主机名（不允许 `127.0.0.1` / `[::1]` / 带端口的写法）；
    // 校区域白名单在 service 里做，因为那里才知道"校园邮箱"的边界。
    imapHost: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i, 'IMAP 主机名格式不正确'),
    imapPort: z.number().int().min(1).max(65535).default(993),
    password: z.string().min(1).max(1024),
  })
  .strict();

/** 编译期防漂移：Zod 输出必须兼容 application 的 command 类型。 */
type AssertAssignable<Target, _Actual extends Target> = true;
export type LinkAccountSchemaMatchesDomain = AssertAssignable<
  LinkMailAccountCommand,
  z.infer<typeof linkAccountSchema>
>;

@ApiTags('mail · 校园邮箱')
@Controller(modulePath('mail'))
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class MailController {
  constructor(@Inject(MailService) private readonly service: MailService) {}

  @Post('account')
  @ApiOperation({
    summary: '绑定校园邮箱（先真连一次 IMAP 验证，坏凭证不落库）',
    description:
      '入参 `{email, imapHost, imapPort?, password}`。密码只用于一次 IMAP 验证，' +
      '随后立即 AES-256-GCM 加密落库；响应**不会**回显密码、密文或密钥版本。',
  })
  link(
    @CurrentUser() userId: string,
    @ZodBody(linkAccountSchema) body: z.infer<typeof linkAccountSchema>,
  ) {
    return this.service.link(userId, body);
  }

  @Delete('account')
  @ApiOperation({
    summary: '解绑（**硬删**凭证与由该邮箱归一出的活动）',
    description: '幂等：本来就没绑定也返回成功。',
  })
  unlink(@CurrentUser() userId: string) {
    return this.service.unlink(userId);
  }

  @Post('sync')
  @ApiOperation({
    summary: '同步最近邮件 → 归一活动（只读收信，不发信）',
    description:
      '失败时**保留上次结果**并标 `stale`，不会清空活动；客户端应提示"上次同步失败"。' +
      '只落库归一后的活动，不存邮件正文与附件。',
  })
  sync(@CurrentUser() userId: string) {
    return this.service.sync(userId);
  }

  @Get('events')
  @ApiOperation({
    summary: '归一后的活动列表（按开始时间升序）',
    description:
      '元素字段：`{id, title, startsAt, location, organizer, confidence, matchedText, receivedAt, stale}`。' +
      '`stale = true` 表示上次同步失败、这是上次结果。',
  })
  events(@CurrentUser() userId: string) {
    return this.service.listEvents(userId);
  }
}
