import { Controller, Delete, Get, Headers, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user';
import { normalizeLimit, readCursor } from '../../common/pagination/cursor';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { GroupbuyOrderService } from './groupbuy.service';
import type { CreateGroupbuyOrderInput, UpdateGroupbuyOrderInput } from './domain/groupbuy.domain';

const createSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).nullish(),
  category: z.enum(['food', 'drink', 'supplies', 'ticket', 'other']),
  itemSpec: z.string().trim().max(200).nullish(),
  items: z.array(z.string().trim().min(1).max(100)).min(1).max(12).optional(),
  targetCount: z.number().int().min(1).max(999),
  unitPriceFen: z.number().int().min(0).max(10_000_000).optional(),
  pickupSpot: z.string().trim().min(1).max(100),
  kind: z.enum(['ordinary', 'membership']),
  merchantName: z.string().trim().max(100).nullish(),
  membershipDeclaration: z.boolean().optional(),
}).strict();

const updateSchema = createSchema.pick({
  title: true, description: true, category: true,
  targetCount: true, unitPriceFen: true, pickupSpot: true,
}).partial().strict();

const memberSchema = z.object({
  quantity: z.number().int().min(1).max(99),
  displayName: z.string().trim().min(1).max(40),
  note: z.string().trim().max(200).nullish(),
  selections: z.array(z.object({ item: z.string().trim().min(1).max(100), quantity: z.number().int().min(1).max(99) }).strict()).min(1).max(12).optional(),
}).strict();

const pickupNoticeSchema = z.object({ notice: z.string().trim().min(1).max(500) }).strict();
const receivedSchema = z.object({ received: z.boolean() }).strict();

@ApiTags('groupbuy · 校园拼单')
@Controller(modulePath('groupbuy'))
export class GroupbuyController {
  constructor(@Inject(GroupbuyOrderService) private readonly service: GroupbuyOrderService) {}

  @Get('items')
  @ApiOperation({ summary: '拼单列表，按总份数展示进度' })
  list(@Query() query: Record<string, unknown>) {
    return this.service.list({
      cursor: readCursor(query), limit: normalizeLimit(query.limit),
      category: typeof query.category === 'string' ? query.category : undefined,
      keyword: typeof query.keyword === 'string' ? query.keyword.trim() : undefined,
      kind: query.kind === 'ordinary' || query.kind === 'membership' ? query.kind : undefined,
    });
  }

  @Get('items/:id')
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Post('items')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  create(@CurrentUser() actorId: string, @Headers('idempotency-key') key: string | undefined, @ZodBody(createSchema) body: CreateGroupbuyOrderInput) {
    return this.service.create(body, actorId, key);
  }

  @Patch('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  update(@CurrentUser() actorId: string, @Param('id') id: string, @ZodBody(updateSchema) body: UpdateGroupbuyOrderInput) {
    return this.service.update(id, actorId, body);
  }

  @Delete('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  cancel(@CurrentUser() actorId: string, @Param('id') id: string) {
    return this.service.cancel(id, actorId);
  }

  @Post('items/:id/join')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '登记或修改自己的份数；达到目标总份数即成团' })
  join(@CurrentUser() userId: string, @Param('id') id: string, @ZodBody(memberSchema) body: z.infer<typeof memberSchema>) {
    return this.service.join(id, userId, body);
  }

  @Delete('items/:id/join')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  withdraw(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.withdraw(id, userId);
  }

  @Post('items/:id/pickup-notice')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  publishPickupNotice(@CurrentUser() actorId: string, @Param('id') id: string, @ZodBody(pickupNoticeSchema) body: z.infer<typeof pickupNoticeSchema>) {
    return this.service.publishPickupNotice(id, actorId, body.notice);
  }

  @Patch('items/:id/members/:userId/received')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  markReceived(@CurrentUser() actorId: string, @Param('id') id: string, @Param('userId') userId: string, @ZodBody(receivedSchema) body: z.infer<typeof receivedSchema>) {
    return this.service.markReceived(id, actorId, userId, body.received);
  }
}
