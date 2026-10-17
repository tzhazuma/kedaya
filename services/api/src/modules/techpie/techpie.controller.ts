/**
 * TechPie 整合 · techpie（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 *
 * ── 本轮手工增量 ──────────────────────────────────────────────────
 * 加 `listQuerySchema`：列表从「只能整表翻页」变成「按分类筛 + 按关键词搜」，
 * 这是它作为**校园技术服务目录**能被用的下限。其余端点维持脚手架形状。
 */
import { Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { OptionalAuthGuard } from '../../common/auth/auth.guard';
import { OptionalCurrentUser } from '../../common/auth/current-user';
import { normalizeLimit } from '../../common/pagination/cursor';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { TechpieLinkService } from './techpie.service';
import type {
  CreateTechpieLinkInput,
  TechpieLinkListFilters,
  UpdateTechpieLinkInput,
} from './domain/techpie.domain';

const createSchema = z.object({
  key: z.string().min(1).max(500),
  name: z.string().min(1).max(500),
  category: z.string().min(1).max(500),
  url: z.string().min(1).max(500),
  status: z.string().min(1).max(500).optional(),
});

const updateSchema = createSchema.partial();

/**
 * 列表查询参数（Zod 白名单）。
 *
 * 与 `@Query()` 直接吞任意键不同，这里只放行已知的两个筛选维度：
 *   · `category` —— 分类短码，**精确**匹配（列表页 chip 只产出白名单值）；
 *   · `q`        —— 关键词，**模糊**匹配（`contains` + `mode: 'insensitive'`）。
 * 其余字段一律被 `z.object` 剥掉，不会流到 data 层。
 *
 * ⚠️ 任务书写的 `q` 是「名称 / 说明」模糊，但 Prisma 的 `TechpieLink` **没有说明列**
 * （见 `domain/techpie.domain.ts` 文件头）。所以 `q` 落在真实存在的 `name` + `url`
 * 上：地址里常含 `vpn` / `library` / `print` 这类词，搜得到，且不假装有说明字段。
 */
const listQuerySchema = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  q: z.string().trim().min(1).max(80).optional(),
});

type ListQuery = z.infer<typeof listQuerySchema>;

/**
 * 编译期防漂移断言：Zod 推导出的类型必须兼容 domain 声明的输入类型。
 * 只改了一边就会直接编译失败。
 */
type AssertAssignable<Target, _Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<CreateTechpieLinkInput, z.infer<typeof createSchema>>;
export type UpdateSchemaMatchesDomain = AssertAssignable<UpdateTechpieLinkInput, z.infer<typeof updateSchema>>;

/**
 * 契约 §6.1 的统一 CRUD 形状：
 *   GET/POST /items, GET/PATCH/DELETE /items/:id, POST /items/:id/<action>
 */
@ApiTags('techpie · TechPie 整合')
@Controller(modulePath('techpie'))
@UseGuards(OptionalAuthGuard)
export class TechpieController {
  constructor(@Inject(TechpieLinkService) private readonly service: TechpieLinkService) {}

  @Get('items')
  @ApiOperation({
    summary: '列表（游标分页 + 分类精确 / 关键词模糊筛选，最新在前）',
    description:
      '公开可读。筛选与排序都在数据库完成，最新在前（createdAt desc + id desc）。' +
      '条目由同学共建，status 是人工核对结果，不是系统探测结果。',
  })
  list(@ZodQuery(listQuerySchema) query: ListQuery) {
    // 只把白名单内的键放进 filters；data 层再用同样的字段名翻成 Prisma `where`
    const filters: TechpieLinkListFilters = {
      ...(query.category === undefined ? {} : { category: query.category }),
      ...(query.q === undefined ? {} : { q: query.q }),
    };

    return this.service.list({
      limit: normalizeLimit(query.limit),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(Object.keys(filters).length === 0 ? {} : { filters }),
    });
  }

  @Post('items')
  @ApiOperation({ summary: '创建（匿名共建，不需要登录）' })
  create(
    @OptionalCurrentUser() actorId: string | undefined,
    @ZodBody(createSchema) body: CreateTechpieLinkInput,
  ) {
    return this.service.create(body, actorId);
  }

  @Get('items/:id')
  @ApiOperation({ summary: '详情' })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: '更新' })
  update(@Param('id') id: string, @ZodBody(updateSchema) body: UpdateTechpieLinkInput) {
    return this.service.update(id, body);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: '删除/下架' })
  async remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id);
    return { id, deleted: true };
  }

  @Post('items/:id/sync')
  @ApiOperation({
    summary: '领域动作：标记一次人工核对',
    description:
      '⚠️ 不会去对端系统拉取任何数据。它只是把这条记录的 status 写成 `synced`，' +
      '并靠 Prisma 的 @updatedAt 推进 updatedAt（客户端把 updatedAt 显示成「最后核对」）。' +
      '真实的自动化同步要等 GeekPie 侧给出协议与凭据。',
  })
  sync(@Param('id') id: string) {
    return this.service.sync(id);
  }
}
