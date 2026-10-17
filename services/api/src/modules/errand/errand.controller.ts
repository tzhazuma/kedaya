import { Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard, OptionalAuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser, OptionalCurrentUser } from '../../common/auth/current-user';
import { UnauthenticatedError } from '../../common/errors/app-error';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { ErrandTaskService } from './errand.service';
import {
  ERRAND_MAX_REWARD_FEN,
  ERRAND_SORTS,
  ERRAND_STATUSES,
  type CreateErrandTaskInput,
  type UpdateErrandTaskInput,
} from './domain/errand.domain';

/**
 * 跑腿 HTTP 层（契约 §6.1 统一形状）。
 *
 * 鉴权策略：
 *   · 读接口（列表 / 详情）挂 `OptionalAuthGuard` —— 未登录也能浏览；
 *   · 写接口逐个挂 `AuthGuard` —— 必须登录，且主体只能来自 JWT；
 *   · `mine=1` / `role=` 需要登录：它们把 `requesterId` / `runnerId`
 *     强制设为当前用户，因此不可能用来列出别人的任务。
 *
 * 本模块**不接受**请求体里的 `requesterId`：发布者只能是自己。
 */

const createSchema = z.object({
  title: z.string().trim().min(1).max(60),
  detail: z.string().max(2000).nullish(),
  /** 单位：分。上限与 domain 的 ERRAND_MAX_REWARD_FEN 保持一致 */
  rewardFen: z.number().int().min(0).max(ERRAND_MAX_REWARD_FEN),
  fromPlace: z.string().trim().min(1).max(60),
  toPlace: z.string().trim().min(1).max(60),
  deadline: z.coerce.date(),
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(60).optional(),
  detail: z.string().max(2000).nullish(),
  rewardFen: z.number().int().min(0).max(ERRAND_MAX_REWARD_FEN).optional(),
  fromPlace: z.string().trim().min(1).max(60).optional(),
  toPlace: z.string().trim().min(1).max(60).optional(),
  deadline: z.coerce.date().optional(),
});

const listQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  status: z.enum(ERRAND_STATUSES).optional(),
  q: z.string().trim().min(1).max(60).optional(),
  fromPlace: z.string().trim().min(1).max(60).optional(),
  toPlace: z.string().trim().min(1).max(60).optional(),
  /** `mine=1` → 只看自己发布的（需要登录） */
  mine: z.union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')]).optional(),
  /** `role=requester` 等价于 mine；`role=runner` 列出我接的单（都需要登录） */
  role: z.enum(['requester', 'runner']).optional(),
  sort: z.enum(ERRAND_SORTS).optional(),
});

type CreateBody = z.infer<typeof createSchema>;
type UpdateBody = z.infer<typeof updateSchema>;
type ListQuery = z.infer<typeof listQuerySchema>;

/** 编译期防漂移：Zod schema 必须与 domain 的输入类型兼容 */
type AssertAssignable<Target, __Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<CreateErrandTaskInput, CreateBody>;
export type UpdateSchemaMatchesDomain = AssertAssignable<UpdateErrandTaskInput, UpdateBody>;

@ApiTags('errand · 跑腿')
@Controller(modulePath('errand'))
@UseGuards(OptionalAuthGuard)
export class ErrandController {
  constructor(@Inject(ErrandTaskService) private readonly service: ErrandTaskService) {}

  @Get('items')
  @ApiOperation({
    summary: '任务列表（状态/关键词/地点筛选 + 排序）',
    description: '公开可读。`mine=1`、`role=requester|runner` 需要登录。',
  })
  list(@OptionalCurrentUser() viewerId: string | undefined, @ZodQuery(listQuerySchema) query: ListQuery) {
    const onlyMine = query.mine === '1' || query.mine === 'true';
    const wantsRequester = onlyMine || query.role === 'requester';
    const wantsRunner = query.role === 'runner';

    if ((wantsRequester || wantsRunner) && !viewerId) {
      throw new UnauthenticatedError('查看「我的跑腿」需要先登录');
    }

    return this.service.list({
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.q === undefined ? {} : { keyword: query.q }),
      ...(query.fromPlace === undefined ? {} : { fromPlace: query.fromPlace }),
      ...(query.toPlace === undefined ? {} : { toPlace: query.toPlace }),
      ...(wantsRequester && viewerId ? { requesterId: viewerId } : {}),
      ...(wantsRunner && viewerId ? { runnerId: viewerId } : {}),
      ...(query.sort === undefined ? {} : { sort: query.sort }),
    });
  }

  @Post('items')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '发布跑腿任务（登录用户）' })
  create(@CurrentUser() actorId: string, @ZodBody(createSchema) body: CreateBody) {
    return this.service.create(body, actorId);
  }

  @Get('items/:id')
  @ApiOperation({ summary: '任务详情' })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Patch('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改任务（仅发布者）' })
  update(@CurrentUser() actorId: string, @Param('id') id: string, @ZodBody(updateSchema) body: UpdateBody) {
    return this.service.update(id, body, actorId);
  }

  @Delete('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除任务（仅发布者）' })
  async remove(
    @CurrentUser() actorId: string,
    @Param('id') id: string,
  ): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id, actorId);
    return { id, deleted: true };
  }

  @Post('items/:id/accept')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '领域动作：接单（不能接自己的单）' })
  accept(@CurrentUser() actorId: string, @Param('id') id: string) {
    return this.service.accept(id, actorId);
  }

  @Post('items/:id/deliver')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '领域动作：接单者确认送达' })
  deliver(@CurrentUser() actorId: string, @Param('id') id: string) {
    return this.service.deliver(id, actorId);
  }

  @Post('items/:id/complete')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '领域动作：发布者确认完成' })
  complete(@CurrentUser() actorId: string, @Param('id') id: string) {
    return this.service.complete(id, actorId);
  }

  @Post('items/:id/cancel')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '领域动作：发布者取消任务' })
  cancel(@CurrentUser() actorId: string, @Param('id') id: string) {
    return this.service.cancel(id, actorId);
  }
}
