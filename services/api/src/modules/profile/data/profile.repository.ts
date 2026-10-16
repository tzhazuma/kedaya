/**
 * 我的 · profile（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ProfileSetting } from '@prisma/client';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateProfileSettingInput,
  ProfileSettingModel,
  ProfileSettingRepository,
  UpdateProfileSettingInput,
} from '../domain/profile.domain';

/**
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 * 输入字段名与 Prisma 字段一一对应，因此直接复用基类的恒等映射。
 */
@Injectable()
export class ProfileSettingPrismaRepository
  extends PrismaCursorRepository<ProfileSetting, ProfileSettingModel, CreateProfileSettingInput, UpdateProfileSettingInput>
  implements ProfileSettingRepository
{
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super(prisma.profileSetting);
  }

  async findByUserId(userId: string): Promise<ProfileSettingModel | null> {
    return this.prisma.profileSetting.findUnique({ where: { userId } });
  }

  /** 首次访问时用全部默认值建档（契约 §9：默认全关，最小采集） */
  async ensureForUser(userId: string): Promise<ProfileSettingModel> {
    return this.prisma.profileSetting.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async patchForUser(userId: string, patch: UpdateProfileSettingInput): Promise<ProfileSettingModel> {
    return this.prisma.profileSetting.update({ where: { userId }, data: patch });
  }}
