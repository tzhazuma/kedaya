/**
 * 食堂营养 · canteen（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '@kedaya/contracts';
import { CrudService } from '../../common/crud/crud.service';
import type { ListParams } from '../../common/crud/resource';
import {
  CANTEEN_DISH_REPOSITORY,
  type CreateCanteenDishInput,
  type CanteenDishModel,
  type CanteenDishRepository,
  type UpdateCanteenDishInput,
} from './domain/canteen.domain';

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class CanteenDishService extends CrudService<CanteenDishModel, CreateCanteenDishInput, UpdateCanteenDishInput> {
  constructor(
    @Inject(CANTEEN_DISH_REPOSITORY) private readonly repo: CanteenDishRepository,
  ) {
    super(repo, 'canteen', '食堂营养');
  }

  /** 本模块支持匿名，忽略请求主体（契约 §9：匿名与实名解耦） */
  override async create(input: CreateCanteenDishInput, _actorId?: string): Promise<CanteenDishModel> {
    return super.create(input);
  }

  /**
   * 列表：把 controller 组装好的 `filters`（`canteen` 精确 / `q` 模糊）**原样**透传给仓储。
   *
   * 基类本就透传整个 `ListParams`，这里显式覆写是把这条契约固定下来：
   * 以后若有人想在 service 层"顺手过滤"，必须先看到这段注释 ——
   * 筛选属于模块语义，只能走 `filters` → `buildWhere` 这条唯一通道。
   */
  override list(params: ListParams): Promise<Page<CanteenDishModel>> {
    return super.list(params);
  }

  /** 领域查询：某食堂的营养汇总 */
  calories(canteen: string) {
    return this.repo.summarizeByCanteen(canteen);
  }}
