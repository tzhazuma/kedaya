/**
 * 常见问题 · faq（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { z } from 'zod';
import { OptionalAuthGuard } from '../../common/auth/auth.guard';
import { OptionalCurrentUser } from '../../common/auth/current-user';
import { normalizeLimit } from '../../common/pagination/cursor';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { FaqEntryService } from './faq.service';
import type { CreateFaqEntryInput, UpdateFaqEntryInput } from './domain/faq.domain';

const createSchema = z.object({
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(500),
  /**
   * 分类是**短代码**（客户端白名单里的键，例如 `campus-card`），不是正文。
   * 脚手架给所有字段都铺了 500，套在分类上会让「筛选白名单」失去意义：
   * 一个 500 字的分类既没法做 chip，也没法作为查询条件收敛。
   */
  category: z.string().trim().min(1).max(40),
  tags: z.array(z.string().min(1).max(64)).max(20).optional(),
  /**
   * 刻意**不**收 `helpfulCount`：它是服务端自增的计数（`@default(0)` +
   * `POST /items/:id/helpful` 原子自增）。让请求体直接写它等于把「有多少人
   * 觉得有用」交给调用方伪造。domain 里仍保留该字段（脚手架形状），
   * 少一个可选字段不影响编译期防漂移断言。
   */
});

const updateSchema = createSchema.partial();

/**
 * 列表查询白名单（契约 §6.1：筛选维度由 controller 用 Zod 收敛成标量字典）。
 *
 * 只有两个维度，且都从**真实用例**倒推出来的：
 *   · `category` —— 列表页的分类 chip（精确匹配，走 `FaqEntry.category` 索引）；
 *   · `q` —— 搜索框，命中 question **或** answer（用户记得的往往是答案里那句话）。
 * 长度上限不是形式：它会成为 `contains` 的参数，越界的长字符串只会拖慢全表扫描。
 */
const listQuerySchema = z.object({
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  category: z.string().trim().min(1).max(40).optional(),
  q: z.string().trim().min(1).max(60).optional(),
});

/**
 * 编译期防漂移断言：Zod 推导出的类型必须兼容 domain 声明的输入类型。
 * 只改了一边就会直接编译失败。
 */
type AssertAssignable<Target, _Actual extends Target> = true;
export type CreateSchemaMatchesDomain = AssertAssignable<CreateFaqEntryInput, z.infer<typeof createSchema>>;
export type UpdateSchemaMatchesDomain = AssertAssignable<UpdateFaqEntryInput, z.infer<typeof updateSchema>>;

type ListQuery = z.infer<typeof listQuerySchema>;

/**
 * 契约 §6.1 的统一 CRUD 形状：
 *   GET/POST /items, GET/PATCH/DELETE /items/:id, POST /items/:id/<action>
 */
@ApiTags('faq · 常见问题')
@Controller(modulePath('faq'))
@UseGuards(OptionalAuthGuard)
export class FaqController {
  constructor(@Inject(FaqEntryService) private readonly service: FaqEntryService) {}

  @Get('items')
  @ApiOperation({
    summary: '常见问题列表（分类精确筛选 + 关键词模糊搜索，最新在前）',
    description:
      '公开可读。`category` 精确匹配分类；`q` 同时模糊匹配 question 与 answer（大小写不敏感）。',
  })
  list(@ZodQuery(listQuerySchema) query: ListQuery) {
    return this.service.list({
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      limit: normalizeLimit(query.limit),
      /**
       * 只把**白名单里声明过**的字段放进 filters；未选中的条件直接不出现，
       * 而不是填 `undefined` —— 后者会让 data 层的字段白名单多出一堆无意义的
       * 分支判断（见 `data/faq.repository.ts` 的 buildWhere）。
       */
      filters: {
        ...(query.category === undefined ? {} : { category: query.category }),
        ...(query.q === undefined ? {} : { q: query.q }),
      },
    });
  }

  @Post('items')
  @ApiOperation({
    summary: '新增常见问题条目',
    description:
      '无需登录（本模块低敏感、面向同学共建，契约 §9）。`helpfulCount` 不接受请求体写入，新建一律从 0 开始。',
  })
  create(
    @OptionalCurrentUser() actorId: string | undefined,
    @ZodBody(createSchema) body: CreateFaqEntryInput,
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
  update(@Param('id') id: string, @ZodBody(updateSchema) body: UpdateFaqEntryInput) {
    return this.service.update(id, body);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: '删除/下架' })
  async remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    await this.service.remove(id);
    return { id, deleted: true };
  }

  /**
   * 「有帮助」——刻意是**无脑 +1**，不是幂等票。
   *
   * 与 `lost-found` 的 resolve 不同，这里没有"一人一票"的实体可以查重：
   * 没有登录主体、没有投票表，`helpfulCount` 只是一个展示用的热度信号。
   * 语义因此固定为「每调用一次 +1」，改成幂等反而会撒谎
   * （同一请求重放 5 次到底算不算 5 个人？服务端无从判断）。
   * 去重责任在客户端：本地记录"我标记过哪几条"，不去重发（见小程序端
   * `application/faq/faqUseCases.ts`）。找不到条目时先由 `detail` 抛 404。
   */
  @Post('items/:id/helpful')
  @ApiOperation({
    summary: '标记该条目有用（原子自增，**非幂等**：每次调用 +1）',
    description: '条目不存在时返回 404（不会凭空造出一条计数）。',
  })
  markHelpful(@Param('id') id: string) {
    return this.service.markHelpful(id);
  }
}
