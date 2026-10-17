import { Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard, OptionalAuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser, OptionalCurrentUser } from '../../common/auth/current-user';
import { normalizeLimit, readCursor } from '../../common/pagination/cursor';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { GroupbuyOrderService } from './groupbuy.service';
import {
  GROUPBUY_CATEGORIES,
  GROUPBUY_MINE_ROLES,
  GROUPBUY_SORTS,
  type CreateGroupbuyOrderInput,
  type GroupbuyMineRole,
  type GroupbuySort,
  type UpdateGroupbuyOrderInput,
} from './domain/groupbuy.domain';

/**
 * 拼单 HTTP 层（契约 §6.1 统一形状）。
 *
 * 鉴权策略：
 *   · 读接口（列表 / 详情）挂 `OptionalAuthGuard` —— 未登录也能逛；
 *   · 写接口逐个挂 `AuthGuard` —— 必须登录，且**归属只来自 JWT**：
 *     请求体里不接受 `ownerId`（否则任何登录用户都能以别人名义发起拼单）。
 *   · `mine=1` 需要登录，且只可能列出自己的单（见 service 的 `normalizeMine`）。
 */

const joinSchema = z.object({
  quantity: z.number().int().positive().max(99).optional().default(1),
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(60),
  description: z.string().max(500).nullish(),
  category: z.enum(GROUPBUY_CATEGORIES),
  targetCount: z.number().int().min(2).max(99),
  unitPriceFen: z.number().int().min(0),
  /** 客户端传 ISO 字符串；`z.coerce.date()` 也接受时间戳 */
  deadline: z.coerce.date(),
  pickupSpot: z.string().max(60).nullish(),
});

const updateSchema = createSchema.partial();

/**
 * 编译期防漂移断言：Zod 推导出的类型必须兼容 domain 声明的输入类型。
 * 只改了一边就会直接编译失败。
 */
type AssertAssignable<Target, _Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<CreateGroupbuyOrderInput, z.infer<typeof createSchema>>;
export type UpdateSchemaMatchesDomain = AssertAssignable<UpdateGroupbuyOrderInput, z.infer<typeof updateSchema>>;

@ApiTags('groupbuy · 拼单')
@Controller(modulePath('groupbuy'))
@UseGuards(OptionalAuthGuard)
export class GroupbuyController {
  constructor(@Inject(GroupbuyOrderService) private readonly service: GroupbuyOrderService) {}

  @Get('items')
  @ApiOperation({
    summary: '列表（游标分页；category / keyword / sort / mine+role 筛选）',
    description:
      '`mine=1` 需登录：`role=owner` 只看我发起的，`role=member` 只看我参与的；' +
      '**不给 role 时按 `member`（我参与的）处理**，想两者都看请分别请求。' +
      '返回视图含成团进度与参团人（同一个形状也用于详情）。',
  })
  list(@OptionalCurrentUser() actorId: string | undefined, @Query() query: Record<string, unknown>) {
    return this.service.list({
      cursor: readCursor(query),
      limit: normalizeLimit(query.limit),
      sort: readSort(query.sort),
      category: readString(query.category),
      keyword: readString(query.q) ?? readString(query.keyword),
      mine: readMine(query.mine, query.role),
      actorId,
    });
  }

  @Post('items')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '发起拼单（归属来自 JWT）' })
  create(
    @CurrentUser() actorId: string,
    @ZodBody(createSchema) body: z.infer<typeof createSchema>,
  ) {
    return this.service.create(body, actorId);
  }

  @Get('items/:id')
  @ApiOperation({ summary: '详情' })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Patch('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改（仅发起人；已成团不可改）' })
  update(
    @CurrentUser() actorId: string,
    @Param('id') id: string,
    @ZodBody(updateSchema) body: UpdateGroupbuyOrderInput,
  ) {
    return this.service.update(id, body, actorId);
  }

  @Post('items/:id/join')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '参团（幂等；凑齐后状态自动推进为成团）' })
  join(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @ZodBody(joinSchema) body: z.infer<typeof joinSchema>,
  ) {
    return this.service.join(id, userId, body.quantity);
  }

  @Post('items/:id/cancel')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '取消拼单（仅发起人；保留历史不物理删除）' })
  cancel(@CurrentUser() actorId: string, @Param('id') id: string) {
    return this.service.cancel(id, actorId);
  }

  @Delete('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除（仅发起人）' })
  async remove(
    @CurrentUser() actorId: string,
    @Param('id') id: string,
  ): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id, actorId);
    return { id, deleted: true };
  }
}

function readString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function readSort(raw: unknown): GroupbuySort | undefined {
  return typeof raw === 'string' && (GROUPBUY_SORTS as readonly string[]).includes(raw)
    ? (raw as GroupbuySort)
    : undefined;
}

/**
 * `?mine=1&role=owner|member` → service 需要的入参。
 *
 * 只有 `mine` 明确为真值时才启用：`mine=0` / 不传都表示"不要筛选"，
 * 避免用户从"我的"切回"全部"时被误判成仍要看自己的。
 *
 * ⚠️ 缺省 `role` 落到 **`member`（我参与的）**，不是"两者都算"：
 * API 文档里曾写成"不给 role 时两者都算"，与实现不符，已按实现纠正 ——
 * 想要"我发起的 + 我参与的"必须由调用方**显式选一个 role**（小程序端「我的拼单」
 * 就是两个 chip 各查一次）。这样语义单一，不会出现"同样的 `mine=1`
 * 在不同端拿到不同集合"的坑。
 */
function readMine(
  mineRaw: unknown,
  roleRaw: unknown,
): { userId: string; role: GroupbuyMineRole } | undefined {
  const enabled = mineRaw === '1' || mineRaw === 'true' || mineRaw === true;
  if (!enabled) return undefined;

  const role: GroupbuyMineRole =
    typeof roleRaw === 'string' && (GROUPBUY_MINE_ROLES as readonly string[]).includes(roleRaw)
      ? (roleRaw as GroupbuyMineRole)
      : 'member';

  // userId 由 service 用登录主体覆盖，这里给空串只是占位（类型要求）。
  return { userId: '', role };
}
