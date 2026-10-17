import type { Page } from '@kedaya/contracts';

/**
 * 通用资源仓储端口（domain 层契约）。
 *
 * 这是「依赖倒置」的落点：service 只依赖本接口，
 * Prisma 实现放在各模块的 `data/` 目录。
 */
export interface ListParams {
  cursor?: string;
  limit: number;
  /**
   * 模块自定义筛选条件。
   *
   * 类型刻意保持"标量字典"而不是让通用层认识各模块的字段：筛选维度是各模块
   * 自己的事（食堂按食堂 + 菜名、FAQ 按分类 + 关键词），通用 CRUD 层不该膨胀。
   * controller 负责用 Zod 白名单校验、service 原样透传、**data 层**把它翻译成
   * Prisma `where`（见 `PrismaCursorRepository.buildWhere`）——Prisma 只出现在 data 层。
   */
  filters?: Readonly<Record<string, string | number | boolean | undefined>>;
}

export interface ResourceRepository<TModel, TCreate, TUpdate> {
  list(params: ListParams): Promise<Page<TModel>>;
  create(input: TCreate): Promise<TModel>;
  findById(id: string): Promise<TModel | null>;
  update(id: string, input: TUpdate): Promise<TModel>;
  remove(id: string): Promise<void>;
}

/**
 * Prisma delegate 的结构化视图。
 *
 * 刻意用**方法语法**（而非属性+函数类型）：TS 对方法参数是双变的
 * （`strictFunctionTypes` 不作用于方法），所以 Prisma 生成的
 * `GroupbuyOrderDelegate` 等可以**直接**赋给这个接口，无需类型断言。
 */
export interface PrismaCursorDelegate {
  findMany(args: any): Promise<any[]>;
  findUnique(args: any): Promise<any | null>;
  create(args: any): Promise<any>;
  update(args: any): Promise<any>;
  delete(args: any): Promise<any>;
}
