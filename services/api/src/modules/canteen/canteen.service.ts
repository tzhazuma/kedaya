/**
 * 营养管家 · canteen（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import { checkDishEnergyConsistency, validateDishInput } from '@kedaya/shared';
import { AuditService } from '../../common/compliance/audit.service';
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
 * 能量一致性容差：超过这个比例视为**录入错误**并拒绝（默认 35% 只告警）。
 * 0.6 = 热量与 4/4/9 推算值相差六成以上，基本只可能是少打/多打了一位。
 */
const ENERGY_HARD_LIMIT = 0.6;

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class CanteenDishService extends CrudService<CanteenDishModel, CreateCanteenDishInput, UpdateCanteenDishInput> {
  constructor(
    @Inject(CANTEEN_DISH_REPOSITORY) private readonly repo: CanteenDishRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    super(repo, 'canteen', '菜品');
  }

  /**
   * 创建菜品（管理员）。
   *
   * 校验在**服务端**再跑一次：`validateDishInput` 是小程序表单与 Web 后台的
   * 同一份规则（ADR 0006 §3.5），但客户端校验挡不住直接打接口的请求。
   * 写操作落审计（菜品库是所有营养结论的依据，改动必须可追溯）。
   */
  override async create(input: CreateCanteenDishInput, actorId?: string): Promise<CanteenDishModel> {
    const normalized = {
      ...input,
      servingG: input.servingG ?? 100,
      fiberG: input.fiberG ?? 0,
      sodiumMg: input.sodiumMg ?? 0,
    };
    this.assertDishValid(normalized);

    const dish = await super.create(normalized);
    await this.audit.recordQuietly({
      actorId: actorId ?? null,
      action: 'canteen.dish.create',
      resource: 'CanteenDish',
      resourceId: dish.id,
      module: 'canteen',
      metadata: { name: dish.name, caloriesKcal: dish.caloriesKcal },
    });
    return dish;
  }

  /** 更新菜品（管理员）：同样过一遍服务端校验与审计 */
  override async update(id: string, input: UpdateCanteenDishInput, actorId?: string): Promise<CanteenDishModel> {
    const existing = await this.detail(id);
    const merged = { ...existing, ...input };
    this.assertDishValid(merged);

    const dish = await super.update(id, input);
    await this.audit.recordQuietly({
      actorId: actorId ?? null,
      action: 'canteen.dish.update',
      resource: 'CanteenDish',
      resourceId: dish.id,
      module: 'canteen',
      metadata: { fields: Object.keys(input) },
    });
    return dish;
  }

  /** 下架菜品（软删除）：历史餐记录仍能回溯到这道菜 */
  override async remove(id: string, actorId?: string): Promise<void> {
    await this.detail(id);
    await super.remove(id);
    await this.audit.recordQuietly({
      actorId: actorId ?? null,
      action: 'canteen.dish.soft_delete',
      resource: 'CanteenDish',
      resourceId: id,
      module: 'canteen',
    });
  }

  /** 领域查询：某食堂的营养汇总 */
  calories(canteen: string) {
    return this.repo.summarizeByCanteen(canteen);
  }

  /** 菜品检索（营养管家园的菜品选择器） */
  searchDishes(query: { q?: string; category?: string; canteen?: string; cursor?: string; limit: number }) {
    return this.repo.searchDishes(query);
  }

  /** 按菜名精确取（记录当餐 / 识别回填用） */
  findByExactName(name: string): Promise<CanteenDishModel | null> {
    return this.repo.findByExactName(name);
  }

  /** 推荐候选池（未下架、最近维护优先） */
  listForRecommendation(limit: number): Promise<CanteenDishModel[]> {
    return this.repo.listForRecommendation(limit);
  }

  /** 未下架菜品总数（菜品覆盖率分母） */
  countActiveDishes(): Promise<number> {
    return this.repo.countActive();
  }

  /**
   * 菜品录入的领域校验（两份规则叠在一起）：
   *   1. `validateDishInput` —— 字段完整性与取值合法性（三端同一份）
   *   2. `checkDishEnergyConsistency` —— 热量与 4×蛋白+4×碳水+9×脂肪 是否自洽
   *
   * 第 2 条的意义：营养值全部是人工录入，少打一位数会让缺口与推荐全盘错掉，
   * 而用户完全察觉不到。轻微偏差（≤35%）是真实菜品的正常现象，只告警；
   * 超过 60% 基本是录错，直接拒绝并说清原因。
   */
  private assertDishValid(input: {
    name: string;
    canteen: string;
    category?: string;
    servingG?: number;
    caloriesKcal: number;
    proteinG: number;
    fatG: number;
    carbG: number;
    fiberG?: number;
    sodiumMg?: number;
    priceFen: number;
  }): void {
    const invalid = validateDishInput({
      name: input.name,
      canteen: input.canteen,
      category: input.category ?? '',
      servingG: input.servingG ?? 100,
      caloriesKcal: input.caloriesKcal,
      proteinG: input.proteinG,
      fatG: input.fatG,
      carbG: input.carbG,
      fiberG: input.fiberG ?? 0,
      sodiumMg: input.sodiumMg ?? 0,
      priceFen: input.priceFen,
    });
    if (invalid !== null) throw new ValidationError(invalid);

    const inconsistency = checkDishEnergyConsistency(input, ENERGY_HARD_LIMIT);
    if (inconsistency !== null) throw new ValidationError(inconsistency);
  }
}
