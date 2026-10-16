import type { ResourceRepository } from '../../../common/crud/resource';

/**
 * 宿舍矛盾 · dorm-harmony（契约 §4.1，敏感级 **high**）
 *
 * 契约 §9「匿名可用」的落点：
 *   本模块的实体**没有** userId 外键 —— 匿名不是"运行时过滤"，
 *   而是**数据模型层面**的解耦（存储上就无法把案件关联回实名用户）。
 *   审计日志仍然记录真实 actorId（合规需要），但审计与业务数据分离。
 */

export const DORM_HARMONY_MODULE_ID = 'dorm-harmony';

export interface DormHarmonyCaseModel {
  id: string;
  /** 与实名身份解耦的匿名 handle */
  anonHandle: string;
  building: string;
  topic: string;
  detail: string | null;
  status: string;
  mediatorId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 列表用摘要：**刻意不含 detail**（列表页不需要细节，减少暴露面） */
export interface DormHarmonyCaseSummary {
  id: string;
  anonHandle: string;
  building: string;
  topic: string;
  status: string;
  createdAt: Date;
}

export interface CreateDormHarmonyCaseInput {
  /** 不传则服务端生成不可关联的匿名 handle */
  anonHandle?: string;
  building: string;
  topic: string;
  detail?: string | null;
}

export interface UpdateDormHarmonyCaseInput {
  topic?: string;
  detail?: string | null;
  status?: string;
  mediatorId?: string | null;
}

export type DormHarmonyCaseRepository = ResourceRepository<
  DormHarmonyCaseModel,
  CreateDormHarmonyCaseInput,
  UpdateDormHarmonyCaseInput
> & {
  assignMediator(id: string, mediatorId: string): Promise<DormHarmonyCaseModel>;
};

export const DORM_HARMONY_CASE_REPOSITORY = Symbol('KEDAYA_DORM_HARMONY_CASE_REPOSITORY');

/** 列表投影：丢掉 detail */
export function toSummary(row: DormHarmonyCaseModel): DormHarmonyCaseSummary {
  return {
    id: row.id,
    anonHandle: row.anonHandle,
    building: row.building,
    topic: row.topic,
    status: row.status,
    createdAt: row.createdAt,
  };
}
