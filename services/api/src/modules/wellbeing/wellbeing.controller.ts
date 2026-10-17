import { Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { WellbeingService } from './wellbeing.service';
import {
  WELLBEING_COUNSELOR_MAX,
  WELLBEING_MODES,
  WELLBEING_NOTE_MAX,
  WELLBEING_STATUSES,
  type UpdateWellbeingAppointmentInput,
  type WellbeingAppointmentDraft,
} from './domain/wellbeing.domain';

/**
 * 心理支持 HTTP 层（契约 §6.1 统一形状）。
 *
 * 这个控制器有一条贯穿所有路由的性质：**归属只从 JWT 取**。
 * 请求体里没有 `userId`（schema 里根本不存在这个 key），
 * 因此"替别人建一条预约"在协议层就不成立；伪造 `userId` 也只会被服务层覆盖。
 *
 * 端点形状：
 * ```
 * GET    /wellbeing/crisis-line             危机出口（**公开**：无登录、无同意；前端必须首屏渲染）
 * GET    /wellbeing/consents                我的同意记录（需登录）
 * POST   /wellbeing/consents                同意（需登录，幂等）
 * DELETE /wellbeing/consents                撤回同意（需登录，幂等）
 * GET    /wellbeing/items                   我的预约（需登录 + 已同意；游标分页 + status 白名单）
 * POST   /wellbeing/items                   创建预约（需登录 + 已同意）
 * GET    /wellbeing/items/:id               详情（仅本人；非本人 404）
 * PATCH  /wellbeing/items/:id               改时间 / 方式 / 摘要（不能改状态与归属）
 * DELETE /wellbeing/items/:id               删除（仅本人）
 * POST   /wellbeing/items/:id/cancel        领域动作：取消预约（requested / confirmed → cancelled）
 * POST   /wellbeing/items/:id/crisis        领域动作：危机干预（打标记 + 一并返回热线）
 * ```
 *
 * `DELETE /items/:id` 后端保留（用户的数据删除权，见「我的 → 隐私与数据」），
 * 但小程序端不提供入口 —— 预约记录是给用户自己看的凭证，删了就没法回溯。
 */

const createSchema = z.object({
  counselor: z.string().trim().min(1).max(WELLBEING_COUNSELOR_MAX),
  slotAt: z.coerce.date(),
  mode: z.enum(WELLBEING_MODES).optional(),
  // 最小化采集：只收用户主动填写的摘要，且限制长度
  note: z.string().max(WELLBEING_NOTE_MAX).nullish(),
});

/**
 * 只能改时间 / 方式 / 摘要。
 *
 * `status` / `crisisFlag` 刻意**不在** schema 里：状态只能经领域动作
 * （`/cancel`、`/crisis`）跃迁，否则任何 PATCH 都能把预约改成"已完成"。
 */
const updateSchema = z.object({
  slotAt: z.coerce.date().optional(),
  mode: z.enum(WELLBEING_MODES).optional(),
  note: z.string().max(WELLBEING_NOTE_MAX).nullish(),
});

/** 白名单：cursor / limit / status。多传的 key 会被 Zod 丢掉，不会进 where */
const listQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  /** 旧的自由字符串（例如遗留的 'crisis-escalated'）在这里就会被拒 */
  status: z.enum(WELLBEING_STATUSES).optional(),
});

type CreateBody = z.infer<typeof createSchema>;
type UpdateBody = z.infer<typeof updateSchema>;
type ListQuery = z.infer<typeof listQuerySchema>;

/**
 * 编译期防漂移断言：Zod 推导出的类型必须兼容 domain 声明的输入类型。
 * 请求体类型里**没有** `userId` / `status` / `crisisFlag`，
 * 若有人往 schema 里加回去，服务层仍会覆盖它们（见单测）。
 */
type AssertAssignable<Target, _Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<WellbeingAppointmentDraft, CreateBody>;
export type UpdateSchemaMatchesDomain = AssertAssignable<
  UpdateWellbeingAppointmentInput,
  UpdateBody
>;

@ApiTags('wellbeing · 心理支持（最高敏感）')
@Controller(modulePath('wellbeing'))
export class WellbeingController {
  constructor(@Inject(WellbeingService) private readonly service: WellbeingService) {}

  @Get('crisis-line')
  @ApiOperation({
    summary: '危机出口（公开：无需登录、无需同意，前端必须首屏可见）',
    description:
      '契约 §9：不可被埋进二级菜单。返回 prominence=primary 供前端强制渲染；' +
      'hotlines 是可拨打的号码，channels 是打不了电话时的下一步（辅导员 / 保卫处）。' +
      '号码由 WELLBEING_CRISIS_* 环境变量覆盖，上线前必须逐个拨通核实。',
  })
  crisisLine() {
    return this.service.crisisLine();
  }

  @Get('consents')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '我的同意记录',
    description:
      '返回当前用户的**全部**同意记录（含宿舍矛盾 / AI 画像等其它模块），每条带 module 与 revokedAt。' +
      '客户端用它判断"哪些还没授权"，并在本地留痕丢失（换设备）时与服务端重新对齐。',
  })
  listConsents(@CurrentUser() userId: string) {
    return this.service.listConsents(userId);
  }

  @Post('consents')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '二次同意（契约 §9：敏感模块独立同意）',
    description: '幂等：已有记录会刷新 grantedAt 并清空 revokedAt。无请求体。',
  })
  grantConsent(@CurrentUser() userId: string) {
    return this.service.grantConsent(userId);
  }

  @Delete('consents')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '撤回同意（契约 §9：可随时撤回）',
    description:
      '撤回后本模块读写立刻回到 CONSENT_REQUIRED；已存在的预约数据不删（删除是另一条独立权利）。',
  })
  revokeConsent(@CurrentUser() userId: string) {
    return this.service.revokeConsent(userId);
  }

  @Get('items')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '我的预约列表（无同意 → CONSENT_REQUIRED；写审计）',
    description:
      '**只返回当前登录用户的预约**（强制 userId = 主体，没有 mine 开关）。' +
      '筛选只有 status（白名单），排序为预约时间新 → 旧。',
  })
  list(@CurrentUser() userId: string, @ZodQuery(listQuerySchema) query: ListQuery) {
    return this.service.list(userId, {
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.status === undefined ? {} : { status: query.status }),
    });
  }

  @Post('items')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '创建预约（无同意 → CONSENT_REQUIRED；写审计）',
    description:
      '归属与初始状态（requested）由服务端决定，请求体里没有 userId / status / crisisFlag。',
  })
  create(@CurrentUser() userId: string, @ZodBody(createSchema) body: CreateBody) {
    return this.service.create(userId, body);
  }

  @Get('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '预约详情（仅本人可见；非本人 404；写审计）' })
  detail(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.detail(userId, id);
  }

  @Patch('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '改时间 / 方式 / 摘要（仅本人；不能改状态与归属；写审计）',
    description: '状态请走 POST /items/:id/cancel 或 /items/:id/crisis。',
  })
  update(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @ZodBody(updateSchema) body: UpdateBody,
  ) {
    return this.service.update(userId, id, body);
  }

  @Delete('items/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除预约（仅本人，写审计）' })
  async remove(@CurrentUser() userId: string, @Param('id') id: string) {
    await this.service.remove(userId, id);
    return { id, deleted: true };
  }

  @Post('items/:id/cancel')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '领域动作：取消预约（仅本人，requested / confirmed → cancelled）',
    description: '已取消 / 已完成 → CONFLICT；非本人 → 404。',
  })
  cancel(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.cancel(userId, id);
  }

  @Post('items/:id/crisis')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '触发危机干预：标记 + 一并返回热线（契约 §9）',
    description: '只打 crisisFlag，不改 status —— 用户是否继续这次预约由用户自己决定。',
  })
  escalateCrisis(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.escalateCrisis(userId, id);
  }
}
