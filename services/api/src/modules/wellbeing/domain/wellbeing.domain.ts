import type { Page } from '@kedaya/contracts';
import type { ListParams, ResourceRepository } from '../../../common/crud/resource';

/**
 * 心理治疗 · wellbeing（契约 §4.1，敏感级 **critical**）
 *
 * 纯领域：零框架依赖。
 */

/** 契约 §4 模块 id —— 与 @kedaya/contracts 的 MODULES 保持一致 */
export const WELLBEING_MODULE_ID = 'wellbeing';

export interface WellbeingAppointmentModel {
  id: string;
  userId: string;
  counselor: string;
  slotAt: Date;
  /** online | onsite */
  mode: string;
  status: string;
  /** 最小化采集：仅存用户主动填写的诉求摘要（契约 §9） */
  note: string | null;
  crisisFlag: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWellbeingAppointmentInput {
  /** 由服务层从登录主体注入，不接受请求体传入 */
  userId: string;
  counselor: string;
  slotAt: Date;
  mode?: string;
  note?: string | null;
}

/**
 * 请求体形状：userId 由服务层从登录主体注入，**不接受**客户端传入
 * （否则用户可以替别人建预约）。
 */
export type WellbeingAppointmentDraft = Omit<CreateWellbeingAppointmentInput, 'userId'>;

export interface UpdateWellbeingAppointmentInput {
  slotAt?: Date;
  mode?: string;
  status?: string;
  note?: string | null;
  crisisFlag?: boolean;
}

export type WellbeingAppointmentRepository = ResourceRepository<
  WellbeingAppointmentModel,
  CreateWellbeingAppointmentInput,
  UpdateWellbeingAppointmentInput
> & {
  /** 必须按用户过滤：敏感数据绝不能跨用户列出 */
  listByUser(userId: string, params: ListParams): Promise<Page<WellbeingAppointmentModel>>;
};

export const WELLBEING_APPOINTMENT_REPOSITORY = Symbol(
  'KEDAYA_WELLBEING_APPOINTMENT_REPOSITORY',
);

/** 危机干预出口（契约 §9：必须提供，且不可被埋进二级菜单） */
export interface CrisisLine {
  module: string;
  title: string;
  message: string;
  hotlines: Array<{ name: string; number: string }>;
  /** 前端必须首屏可见，禁止折叠/二级菜单 */
  prominence: 'primary';
  requiresLogin: false;
  requiresConsent: false;
}
