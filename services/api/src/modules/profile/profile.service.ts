/**
 * 我的 · profile（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { ValidationError } from '../../common/errors/app-error';
import {
  PROFILE_SETTING_REPOSITORY,
  type CreateProfileSettingInput,
  type ProfileSettingModel,
  type ProfileSettingRepository,
  type UpdateProfileSettingInput,
} from './domain/profile.domain';

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class ProfileSettingService extends CrudService<ProfileSettingModel, CreateProfileSettingInput, UpdateProfileSettingInput> {
  constructor(
    @Inject(PROFILE_SETTING_REPOSITORY) private readonly repo: ProfileSettingRepository,
  ) {
    super(repo, 'profile', '我的');
  }

  /**
   * 创建。userId 是 readOnly（由账号决定，不接受请求体传入），
   * 因此必须已登录。
   */
  override async create(input: CreateProfileSettingInput, actorId?: string): Promise<ProfileSettingModel> {
    if (!actorId) {
      throw new ValidationError('该资源必须登录后创建', { field: 'userId' });
    }
    return super.create({ ...input, userId: actorId } as CreateProfileSettingInput);
  }
  /** 读取我的设置；不存在则按默认值建档（隐私开关默认全关） */
  me(userId: string): Promise<ProfileSettingModel> {
    return this.repo.ensureForUser(userId);
  }

  patchMine(userId: string, patch: UpdateProfileSettingInput): Promise<ProfileSettingModel> {
    return this.repo.patchForUser(userId, patch);
  }}
