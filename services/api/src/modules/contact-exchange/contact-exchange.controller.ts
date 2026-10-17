/**
 * 联系方式交换（U8）· HTTP 层
 *
 * ## 端点总表（12 个）
 *
 * | # | 方法 | 路径 | 幂等键 | 说明 |
 * | --- | --- | --- | --- | --- |
 * | 1 | GET | `/contacts` | — | 我的联系方式（游标分页） |
 * | 2 | POST | `/contacts` | **必需** | 新增（默认不授权） |
 * | 3 | PATCH | `/contacts/:id` | 可选 | 修改值 / 标签 / 授权开关 |
 * | 4 | DELETE | `/contacts/:id` | 可选 | 删除（硬删） |
 * | 5 | POST | `/requests` | **必需** | 发起交换申请（24h 限流） |
 * | 6 | GET | `/requests` | — | 我的申请（进出方向 / 状态过滤） |
 * | 7 | GET | `/requests/:id` | — | 申请详情（**不含任何联系方式**） |
 * | 8 | POST | `/requests/:id/approve` | **必需** | 被申请人同意 |
 * | 9 | POST | `/requests/:id/reject` | **必需** | 被申请人拒绝 |
 * | 10 | POST | `/requests/:id/revoke` | **必需** | 任一方撤销（立即失效） |
 * | 11 | GET | `/requests/:id/contacts` | — | 查看对方**已授权**条目（写审计） |
 * | 12 | GET | `/audit` | — | 审计查询（谁看过我 / 我看过谁） |
 *
 * ## 全部端点要求登录
 *
 * 守卫挂在**控制器**上，新增端点默认受保护 —— 逐个方法加守卫漏一个就是匿名端点。
 *
 * ## 幂等
 *
 * 控制器级 `IdempotencyInterceptor`：只对 POST 生效，缺 `Idempotency-Key`
 * 直接 `VALIDATION_FAILED`（契约 §11.3）。GET / PATCH / DELETE 放行。
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
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CONTACT_EXCHANGE_ROUTE,
  type ContactKind,
  type ContactExchangeStatus,
} from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { normalizeLimit, readCursor } from '../../common/pagination/cursor';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { ContactEntryService } from './application/contact-entry.service';
import { ContactExchangeService } from './application/contact-exchange.service';
import { ContactAuditService } from './application/contact-audit.service';

const contactKindSchema = z.enum(['wechat', 'phone', 'email', 'qq']);
const contactStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'REVOKED', 'EXPIRED']);

const createContactSchema = z.object({
  kind: contactKindSchema,
  value: z.string().min(1).max(254),
  label: z.string().max(40).nullish(),
  shared: z.boolean().optional(),
});

const patchContactSchema = z
  .object({
    // Merge Patch（RFC 7396）：`null` 表示清空 label；value/shared 不允许 null。
    value: z.string().min(1).max(254).optional(),
    label: z.string().max(40).nullish(),
    shared: z.boolean().optional(),
  })
  .refine((body) => body.value !== undefined || body.label !== undefined || body.shared !== undefined, {
    message: '至少需要提供一个要修改的字段',
    path: ['value'],
  });

const applySchema = z.object({
  addresseeId: z.string().min(1).max(64),
  contextModule: z.string().min(1).max(64),
  contextId: z.string().max(64).nullish(),
  message: z.string().max(200).nullish(),
});

const pageQueryShape = {
  cursor: z.string().max(500).optional(),
  limit: z.union([z.string(), z.number()]).optional(),
};

const listContactsQuerySchema = z.object(pageQueryShape);

const listRequestsQuerySchema = z.object({
  direction: z.enum(['incoming', 'outgoing', 'all']).optional(),
  status: contactStatusSchema.optional(),
  ...pageQueryShape,
});

const listAuditQuerySchema = z.object({
  direction: z.enum(['inbound', 'outbound']).optional(),
  ...pageQueryShape,
});

@ApiTags('contact-exchange · 联系方式交换')
@Controller(CONTACT_EXCHANGE_ROUTE)
@UseGuards(AuthGuard)
@ApiBearerAuth()
@UseInterceptors(IdempotencyInterceptor)
export class ContactExchangeController {
  constructor(
    @Inject(ContactEntryService) private readonly entries: ContactEntryService,
    @Inject(ContactExchangeService) private readonly exchange: ContactExchangeService,
    @Inject(ContactAuditService) private readonly audit: ContactAuditService,
  ) {}

  /* ---------------- 我的联系方式 ---------------- */

  @Get('contacts')
  @ApiOperation({ summary: '我的联系方式条目（游标分页；含明文，仅本人可见）' })
  listContacts(
    @CurrentUser() userId: string,
    @ZodQuery(listContactsQuerySchema) query: z.infer<typeof listContactsQuerySchema>,
  ) {
    return this.entries.list(userId, {
      cursor: readCursor(query as unknown as Record<string, unknown>),
      limit: normalizeLimit(query.limit),
    });
  }

  @Post('contacts')
  @ApiOperation({ summary: '新增联系方式（默认 shared=false，不参与交换）' })
  createContact(
    @CurrentUser() userId: string,
    @ZodBody(createContactSchema) body: z.infer<typeof createContactSchema>,
  ) {
    return this.entries.create(userId, {
      kind: body.kind as ContactKind,
      value: body.value,
      label: body.label,
      shared: body.shared,
    });
  }

  @Patch('contacts/:id')
  @ApiOperation({ summary: '修改联系方式 / 标签 / 授权开关（Merge Patch）' })
  patchContact(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @ZodBody(patchContactSchema) body: z.infer<typeof patchContactSchema>,
  ) {
    return this.entries.update(userId, id, {
      ...(body.value !== undefined ? { value: body.value } : {}),
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.shared !== undefined ? { shared: body.shared } : {}),
    });
  }

  @Delete('contacts/:id')
  @ApiOperation({ summary: '删除联系方式（硬删；对方立即不可见）' })
  removeContact(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.entries.remove(userId, id);
  }

  /* ---------------- 交换申请 ---------------- */

  @Post('requests')
  @ApiOperation({ summary: '发起联系方式交换申请（双方同意后才可读取；24h 限流）' })
  apply(
    @CurrentUser() userId: string,
    @ZodBody(applySchema) body: z.infer<typeof applySchema>,
  ) {
    return this.exchange.apply(userId, {
      addresseeId: body.addresseeId,
      contextModule: body.contextModule,
      contextId: body.contextId,
      message: body.message,
    });
  }

  @Get('requests')
  @ApiOperation({ summary: '我的交换申请列表（游标分页；可按方向 / 状态过滤）' })
  listRequests(
    @CurrentUser() userId: string,
    @ZodQuery(listRequestsQuerySchema) query: z.infer<typeof listRequestsQuerySchema>,
  ) {
    return this.exchange.list(userId, {
      direction: query.direction ?? 'all',
      ...(query.status ? { status: query.status as ContactExchangeStatus } : {}),
      cursor: readCursor(query as unknown as Record<string, unknown>),
      limit: normalizeLimit(query.limit),
    });
  }

  @Get('requests/:id')
  @ApiOperation({ summary: '申请详情（只有关系元数据，绝不含联系方式）' })
  detail(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.exchange.detail(userId, id);
  }

  @Post('requests/:id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: '同意申请（仅被申请人）' })
  approve(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.exchange.approve(userId, id);
  }

  @Post('requests/:id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: '拒绝申请（仅被申请人）' })
  reject(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.exchange.reject(userId, id);
  }

  @Post('requests/:id/revoke')
  @HttpCode(200)
  @ApiOperation({ summary: '撤销申请 / 解除交换（任一方；撤销后对方立即不可见）' })
  revoke(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.exchange.revoke(userId, id);
  }

  @Get('requests/:id/contacts')
  @ApiOperation({
    summary: '查看对方**已授权**的联系方式（仅 ACCEPTED；本次读取写审计）',
    description:
      '未同意 / 已拒绝 / 已撤销 / 已过期一律返回 CONSENT_REQUIRED。' +
      '响应只含 shared=true 的条目；不返回任何脱敏预览。',
  })
  viewContacts(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.exchange.viewContacts(userId, id);
  }

  /* ---------------- 审计 ---------------- */

  @Get('audit')
  @ApiOperation({ summary: '审计查询：谁看过我的联系方式 / 我看过谁（不含明文）' })
  listAudit(
    @CurrentUser() userId: string,
    @ZodQuery(listAuditQuerySchema) query: z.infer<typeof listAuditQuerySchema>,
  ) {
    return this.audit.list(userId, {
      direction: query.direction ?? 'inbound',
      cursor: readCursor(query as unknown as Record<string, unknown>),
      limit: normalizeLimit(query.limit),
    });
  }
}
