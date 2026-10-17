import type { Page } from '@kedaya/contracts';
import { NotFoundError } from '../errors/app-error';
import type { ListParams, ResourceRepository } from './resource';

/**
 * 通用 CRUD 用例基类。
 *
 * 分层（契约 §7）：controller → service → repository(port)。
 * 这里只做编排与领域语义（"不存在"是领域概念，所以由 service 抛 NotFoundError，
 * 仓储只负责返回 null）。
 */
export abstract class CrudService<TModel, TCreate, TUpdate> {
  protected constructor(
    protected readonly repository: ResourceRepository<TModel, TCreate, TUpdate>,
    /** 契约 §4 模块 id */
    protected readonly moduleId: string,
    /** 面向用户的中文资源名，用于错误文案 */
    protected readonly resourceName: string,
  ) {}

  list(params: ListParams): Promise<Page<TModel>> {
    return this.repository.list(params);
  }

  create(input: TCreate): Promise<TModel> {
    return this.repository.create(input);
  }

  async detail(id: string): Promise<TModel> {
    const found = await this.repository.findById(id);
    if (!found) throw new NotFoundError(`${this.resourceName}不存在或已被删除`);
    return found;
  }

  async update(id: string, input: TUpdate): Promise<TModel> {
    await this.detail(id);
    return this.repository.update(id, input);
  }

  async remove(id: string): Promise<void> {
    await this.detail(id);
    await this.repository.remove(id);
  }
}
