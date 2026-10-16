/**
 * 食堂营养 · canteen（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { ValidationError } from '../../common/errors/app-error';
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
  /** 领域查询：某食堂的营养汇总 */
  calories(canteen: string) {
    return this.repo.summarizeByCanteen(canteen);
  }}
