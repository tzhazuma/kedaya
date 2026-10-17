import { Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard, OptionalAuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser, OptionalCurrentUser } from '../../common/auth/current-user';
import { UnauthenticatedError } from '../../common/errors/app-error';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { BuddyGroupService } from './buddy.service';
import {
  BUDDY_ACTIVITIES,
  BUDDY_MAX_CAPACITY,
  BUDDY_MIN_CAPACITY,
  BUDDY_SORTS,
  BUDDY_STATUSES,
  type CreateBuddyGroupInput,
} from './domain/buddy.domain';

/**
 * 找搭子 HTTP 层（契约 §6.1 统一形状）。
 *
 * 鉴权策略：
 *   · 读接口（列表 / 详情）挂 `OptionalAuthGuard` —— 未登录也能浏览；
 *   · 写接口逐个挂 `AuthGuard` —— 必须登录，且主体只能来自 JWT；
 *   · `mine=1` / `joined=1` 需要登录：它们把筛选条件钉在当前用户上。
 *
 * 本模块**不接受**请求体里的 `ownerId`：组长只能是自己。
 */

const createSchema = z.object({
  activity: z.enum(BUDDY_ACTIVITIES),
  title: z.string().trim().min(1).max(60),
  description: z.string().max(2000).nullish(),
  campusSpot: z.string().trim().min(1).max(60),
  startsAt: z.coerce.date(),
  capacity: z.number().int().min(BUDDY_MIN_CAPACITY).max(BUDDY_MAX_CAPACITY),
});

const listQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  activity: z.enum(BUDDY_ACTIVITIES).optional(),
  status: z.enum(BUDDY_STATUSES).optional(),
  q: z.string().trim().min(1).max(60).optional(),
  sort: z.enum(BUDDY_SORTS).optional(),
  /** `mine=1` → 我创建的（需要登录） */
  mine: z.union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')]).optional(),
  /** `joined=1` → 我加入的（需要登录） */
  joined: z.union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')]).optional(),
  /** `upcoming=1` → 只看未开始 */
  upcoming: z.union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')]).optional(),
});

type CreateBody = z.infer<typeof createSchema>;
type ListQuery = z.infer<typeof listQuerySchema>;

/** 编译期防漂移：Zod schema 必须与 domain 的输入类型兼容 */
type AssertAssignable<Target, __Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<CreateBuddyGroupInput, CreateBody>;

function truthy(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

@ApiTags('buddy · 找搭子')
@Controller(modulePath('buddy'))
@UseGuards(OptionalAuthGuard)
export class BuddyController {
  constructor(@Inject(BuddyGroupService) private readonly service: BuddyGroupService) {}

  @Get('groups')
  @ApiOperation({
    summary: '搭子列表（活动/状态/关键词筛选 + 我创建/我加入 + 排序）',
    description: '公开可读。`mine=1`、`joined=1` 需要登录。',
  })
  list(@OptionalCurrentUser() viewerId: string | undefined, @ZodQuery(listQuerySchema) query: ListQuery) {
    const onlyMine = truthy(query.mine);
    const onlyJoined = truthy(query.joined);
    if ((onlyMine || onlyJoined) && !viewerId) {
      throw new UnauthenticatedError('查看「我的搭子」需要先登录');
    }

    return this.service.list({
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.activity === undefined ? {} : { activity: query.activity }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.q === undefined ? {} : { keyword: query.q }),
      ...(query.sort === undefined ? {} : { sort: query.sort }),
      ...(onlyMine && viewerId ? { ownerId: viewerId } : {}),
      ...(onlyJoined && viewerId ? { joinedUserId: viewerId } : {}),
      ...(query.upcoming === undefined ? {} : { onlyUpcoming: truthy(query.upcoming) }),
    });
  }

  @Post('groups')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '发起搭子招募（登录用户，自动成为组长）' })
  create(@CurrentUser() actorId: string, @ZodBody(createSchema) body: CreateBody) {
    return this.service.create(body, actorId);
  }

  @Get('groups/:id')
  @ApiOperation({ summary: '搭子详情（含成员列表）' })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Post('groups/:id/join')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '加入搭子（满员自动推进为 full）' })
  join(@CurrentUser() actorId: string, @Param('id') id: string) {
    return this.service.join(id, actorId);
  }

  @Post('groups/:id/leave')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '退出搭子（组长需改用 cancel）' })
  leave(@CurrentUser() actorId: string, @Param('id') id: string) {
    return this.service.leave(id, actorId);
  }

  @Post('groups/:id/close')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '领域动作：组长停止招募' })
  close(@CurrentUser() actorId: string, @Param('id') id: string) {
    return this.service.close(id, actorId);
  }

  @Post('groups/:id/cancel')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '领域动作：组长取消搭子（终态）' })
  cancel(@CurrentUser() actorId: string, @Param('id') id: string) {
    return this.service.cancel(id, actorId);
  }
}
