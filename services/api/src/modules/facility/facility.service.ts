/**
 * 场馆预约 · facility（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 14 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { ValidationError } from '../../common/errors/app-error';
import { ConflictError, ForbiddenError } from '../../common/errors/app-error';
import {
  FACILITY_BOOKING_REPOSITORY,
  type CreateFacilityBookingInput,
  type FacilityBookingModel,
  type FacilityBookingRepository,
  type UpdateFacilityBookingInput,
} from './domain/facility.domain';

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class FacilityBookingService extends CrudService<FacilityBookingModel, CreateFacilityBookingInput, UpdateFacilityBookingInput> {
  constructor(
    @Inject(FACILITY_BOOKING_REPOSITORY) private readonly repo: FacilityBookingRepository,
  ) {
    super(repo, 'facility', '场馆预约');
  }

  /**
   * 创建预约。
   *
   * 与其余模块不同：除了归属补全，还必须在**写库前**做两件事：
   *   1. 金额一律**整数分**（契约 §6.1）—— 非整数直接 VALIDATION_FAILED，不静默截断；
   *   2. 同一场馆同一时段不可重复预约 —— 冲突返回 CONFLICT。
   */
  override async create(input: CreateFacilityBookingInput, actorId?: string): Promise<FacilityBookingModel> {
    const owner = input.ownerId ?? actorId;
    if (!owner) {
      throw new ValidationError('未登录时必须显式提供 ownerId', { field: 'ownerId' });
    }
    if (!Number.isInteger(input.feeFen) || input.feeFen < 0) {
      throw new ValidationError('feeFen 必须是非负整数分（契约 §6.1 禁止浮点金额）', { field: 'feeFen' });
    }

    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (!(endsAt > startsAt)) {
      throw new ValidationError('endsAt 必须晚于 startsAt', { field: 'endsAt' });
    }

    const conflict = await this.repo.findOverlapping({
      kind: input.kind,
      facilityName: input.facilityName ?? null,
      startsAt,
      endsAt,
    });
    if (conflict) {
      throw new ConflictError('该时段已被预约', { conflictId: conflict.id });
    }

    return super.create({ ...input, ownerId: owner });
  }

  /** 领域动作：取消预约（仅发起人；只有 booked 可取消） */
  async cancel(id: string, actorId?: string): Promise<FacilityBookingModel> {
    const booking = await this.detail(id);
    if (!actorId || booking.ownerId !== actorId) {
      throw new ForbiddenError('只有发起人可以取消该预约');
    }
    if (booking.status !== 'booked') {
      throw new ConflictError('该预约当前状态不可取消', { status: booking.status });
    }
    return this.repo.update(id, { status: 'cancelled' } as UpdateFacilityBookingInput);
  }}
