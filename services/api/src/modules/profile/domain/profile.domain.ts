/**
 * 我的 · profile（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import type { ResourceRepository } from '../../../common/crud/resource';

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface ProfileSettingModel {
  userId: string;
  showRealName: boolean;
  allowAiPortrait: boolean;
  allowWellbeing: boolean;
  allowDormHarmony: boolean;
  themeMode: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 创建输入。 * 归属字段 `userId` 在未登录时可由请求主体补全（见 service.create）。 */
export interface CreateProfileSettingInput {
  showRealName?: boolean;
  allowAiPortrait?: boolean;
  allowWellbeing?: boolean;
  allowDormHarmony?: boolean;
  themeMode?: string;
}

/** 更新输入（全部可选） */
export interface UpdateProfileSettingInput {
  showRealName?: boolean;
  allowAiPortrait?: boolean;
  allowWellbeing?: boolean;
  allowDormHarmony?: boolean;
  themeMode?: string;
}

/** 端口：service 只依赖本类型，实现见 data/profile.repository.ts */
export type ProfileSettingRepository = ResourceRepository<
  ProfileSettingModel,
  CreateProfileSettingInput,
  UpdateProfileSettingInput
> & {
  findByUserId(userId: string): Promise<ProfileSettingModel | null>;
  ensureForUser(userId: string): Promise<ProfileSettingModel>;
  patchForUser(userId: string, patch: UpdateProfileSettingInput): Promise<ProfileSettingModel>;
};

export const PROFILE_SETTING_REPOSITORY = Symbol('KEDAYA_PROFILE_SETTING_REPOSITORY');
