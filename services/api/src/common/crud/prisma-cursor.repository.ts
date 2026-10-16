import type { Page } from '@kedaya/contracts';
import { decodeCursor, encodeCursor } from '../pagination/cursor';
import type { ListParams, PrismaCursorDelegate, ResourceRepository } from './resource';

/**
 * 默认映射：输入对象字段名与 Prisma 字段一一对应，直接透传给 `data`。
 * 用双断言是因为接口类型没有隐式索引签名，而 Prisma 的 data 参数是结构化类型。
 */
function defaultData<T>(input: T): Record<string, unknown> {
  return input as unknown as Record<string, unknown>;
}

/**
 * 基于 Prisma 的游标分页仓储基类。
 *
 * 分页实现（契约 §6.1）：`orderBy id asc` + `take limit+1` + `cursor/skip 1`。
 * 多取一条用来判断"还有没有下一页"，避免额外 count 查询。
 */
export abstract class PrismaCursorRepository<TRow extends { id: string }, TModel, TCreate, TUpdate>
  implements ResourceRepository<TModel, TCreate, TUpdate>
{
  protected constructor(
    private readonly delegate: PrismaCursorDelegate,
    /**
     * 输入 → Prisma data。默认恒等：各模块的 Create/Update 输入字段名
     * 与 Prisma 字段**逐一对应**（Zod schema 即真相），因此无需手工映射。
     * 需要改名/派生时由子类传入。
     */
    private readonly toCreateData: (input: TCreate) => Record<string, unknown> = defaultData,
    private readonly toUpdateData: (input: TUpdate) => Record<string, unknown> = defaultData,
  ) {}

  /**
   * 行 → 领域模型。默认直接透传：各模块的领域模型字段是 Prisma 行字段的
   * 子集，结构上可直接赋值，因此 domain 层无需 import Prisma 类型。
   */
  protected toModel(row: TRow): TModel {
    return row as unknown as TModel;
  }

  async list({ cursor, limit }: ListParams): Promise<Page<TModel>> {
    const id = decodeCursor(cursor);
    const rows = (await this.delegate.findMany({
      take: limit + 1,
      orderBy: { id: 'asc' },
      ...(id ? { cursor: { id }, skip: 1 } : {}),
    })) as TRow[];

    const hasMore = rows.length > limit;
    const visible = hasMore ? rows.slice(0, limit) : rows;
    const last = visible.at(-1);

    return {
      items: visible.map((row) => this.toModel(row)),
      nextCursor: hasMore && last ? encodeCursor(last.id) : null,
    };
  }

  async create(input: TCreate): Promise<TModel> {
    const row = (await this.delegate.create({ data: this.toCreateData(input) })) as TRow;
    return this.toModel(row);
  }

  async findById(id: string): Promise<TModel | null> {
    const row = (await this.delegate.findUnique({ where: { id } })) as TRow | null;
    return row ? this.toModel(row) : null;
  }

  async update(id: string, input: TUpdate): Promise<TModel> {
    const row = (await this.delegate.update({
      where: { id },
      data: this.toUpdateData(input),
    })) as TRow;
    return this.toModel(row);
  }

  async remove(id: string): Promise<void> {
    await this.delegate.delete({ where: { id } });
  }
}
