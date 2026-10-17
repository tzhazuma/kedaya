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
