/**
 * 宿舍矛盾 · dorm-harmony（契约 §4.1，敏感级 **high**）
 *
 * ⚠️ 本模块**不再是脚手架生成的占位实现**，也**不是**普通的"登录 + 同意"敏感模块：
 *
 * 隐私设计（契约 §9「匿名可用」的落点）：
 *   · `DormHarmonyCase` **没有任何指向实名 `User` 的外键** —— 匿名不是"运行时过滤"，
 *     而是数据模型层面的解耦（存储上就无法把案件关联回实名用户）；
 *   · 提交时生成一次性**追踪码明文**，只在响应里返回一次；库里只存
 *     `sha256(trackCode)`。后续所有读写都必须出示追踪码且哈希匹配，否则 FORBIDDEN；
 *   · 读写接口因此**全部公开、不需要登录** —— 一旦要求登录，实名身份就会与
 *     案件在同一请求里相遇，违背匿名承诺；
 *   · `anonHandle` 由 `anonymousHandle(案子 id + 随机数)` 派生，不含任何实名信息；
 *   · 审计日志照常记录（合规要求），但匿名操作只记 `anonymous`，不记实名。
 */

export const DORM_HARMONY_MODULE_ID = 'dorm-harmony';

/** 状态机：submitted → in-progress → closed */
export const DORM_HARMONY_STATUS = {
  submitted: 'submitted',
  inProgress: 'in-progress',
  closed: 'closed',
} as const;
export type DormHarmonyStatus = (typeof DORM_HARMONY_STATUS)[keyof typeof DORM_HARMONY_STATUS];

/** 期望的解决方式白名单 */
export const DORM_HARMONY_EXPECTATIONS = ['talk', 'mediation', 'rule', 'other'] as const;
export type DormHarmonyExpectation = (typeof DORM_HARMONY_EXPECTATIONS)[number];

/** 留言角色：学生本人 / 调解员 */
export const DORM_HARMONY_FROM_ROLES = {
  student: 'student',
  mediator: 'mediator',
} as const;
export type DormHarmonyFromRole =
  (typeof DORM_HARMONY_FROM_ROLES)[keyof typeof DORM_HARMONY_FROM_ROLES];

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface DormHarmonyCaseModel {
  id: string;
  /** 与实名身份解耦的匿名 handle */
  anonHandle: string;
  /** 追踪码的 sha256 哈希；明文只在提交响应里出现一次 */
  trackCodeHash: string | null;
  building: string;
  topic: string;
  detail: string | null;
  status: string;
  /** 调解员（宿管 / 辅导员），未介入时为 null */
  mediatorId: string | null;
  expectation: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 对外视图：**绝不返回 `trackCodeHash`**。
 * 即便哈希本身难以反推，也没有任何让客户端拿到它的理由。
 */
export type DormHarmonyCaseView = Omit<DormHarmonyCaseModel, 'trackCodeHash'>;

export interface DormHarmonyMessageModel {
  id: string;
  caseId: string;
  fromRole: string;
  anonHandle: string | null;
  body: string;
  createdAt: Date;
}

export interface DormHarmonyCaseDetail extends DormHarmonyCaseView {
  messages: DormHarmonyMessageModel[];
}

/** 提交入参（全部来自请求体；不涉及任何身份字段） */
export interface SubmitDormHarmonyCaseInput {
  building: string;
  topic: string;
  detail?: string | null;
  expectation?: string | null;
}

/**
 * 落库数据。`id` / `anonHandle` / `trackCodeHash` 由服务层生成：
 *   · `id` 先于写入生成，才能用它派生不含实名的 `anonHandle`；
 *   · `trackCodeHash` 只能是哈希，明文绝不落库。
 */
export interface CreateDormHarmonyCaseData {
  id: string;
  anonHandle: string;
  trackCodeHash: string;
  building: string;
  topic: string;
  detail: string | null;
  expectation: string | null;
}

export interface AppendDormHarmonyMessageData {
  caseId: string;
  fromRole: DormHarmonyFromRole;
  anonHandle: string | null;
  body: string;
}

/**
 * 端口：service 只依赖本类型，实现见 data/dorm-harmony.repository.ts。
 *
 * 这里**刻意不用通用的 `ResourceRepository`**：本模块没有"列出全部案子"的需求
 * （那是隐私事故），读操作只按 id + 追踪码进行。
 */
export interface DormHarmonyCaseRepository {
  create(data: CreateDormHarmonyCaseData): Promise<DormHarmonyCaseModel>;
  findById(id: string): Promise<DormHarmonyCaseModel | null>;
  listMessages(caseId: string): Promise<DormHarmonyMessageModel[]>;
  appendMessage(data: AppendDormHarmonyMessageData): Promise<DormHarmonyMessageModel>;
  updateStatus(id: string, status: DormHarmonyStatus): Promise<DormHarmonyCaseModel>;
  setMediator(id: string, mediatorId: string): Promise<DormHarmonyCaseModel>;
}

export const DORM_HARMONY_CASE_REPOSITORY = Symbol('KEDAYA_DORM_HARMONY_CASE_REPOSITORY');
