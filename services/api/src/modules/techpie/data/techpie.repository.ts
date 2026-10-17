/**
 * TechPie 整合 · techpie（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { TechpieLink } from '@prisma/client';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateTechpieLinkInput,
  TechpieLinkModel,
  TechpieLinkRepository,
  UpdateTechpieLinkInput,
} from '../domain/techpie.domain';

/**
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 * 输入字段名与 Prisma 字段一一对应，因此直接复用基类的恒等映射。
 */
@Injectable()
export class TechpieLinkPrismaRepository
  extends PrismaCursorRepository<TechpieLink, TechpieLinkModel, CreateTechpieLinkInput, UpdateTechpieLinkInput>
  implements TechpieLinkRepository
{
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super(prisma.techpieLink);
  }
}
