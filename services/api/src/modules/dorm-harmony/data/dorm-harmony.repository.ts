import { Inject, Injectable } from '@nestjs/common';
import type { DormHarmonyCase, DormHarmonyMessage } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  AppendDormHarmonyMessageData,
  CreateDormHarmonyCaseData,
  DormHarmonyCaseModel,
  DormHarmonyCaseRepository,
  DormHarmonyMessageModel,
  DormHarmonyStatus,
} from '../domain/dorm-harmony.domain';

/**
 * data 层 · 访问域 dorm-harmony（契约 §9：匿名、禁止进入通用画像）。
 *
 * 与其它模块不同，这里**没有 list / listAll**：本模块不提供公开列表
 * （列表会泄漏议题），读操作只允许"按 id + 追踪码"进行。
 * 行 → 模型全部走显式 `toCaseModel` / `toMessageModel`，不用 `as any` 绕过类型。
 */
@Injectable()
export class DormHarmonyCasePrismaRepository implements DormHarmonyCaseRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(data: CreateDormHarmonyCaseData): Promise<DormHarmonyCaseModel> {
    const row = await this.prisma.dormHarmonyCase.create({
      data: {
        id: data.id,
        anonHandle: data.anonHandle,
        trackCodeHash: data.trackCodeHash,
        building: data.building,
        topic: data.topic,
        detail: data.detail,
        expectation: data.expectation,
        status: 'submitted',
      },
    });
    return toCaseModel(row);
  }

  async findById(id: string): Promise<DormHarmonyCaseModel | null> {
    const row = await this.prisma.dormHarmonyCase.findUnique({ where: { id } });
    return row ? toCaseModel(row) : null;
  }

  async listMessages(caseId: string): Promise<DormHarmonyMessageModel[]> {
    const rows = await this.prisma.dormHarmonyMessage.findMany({
      where: { caseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toMessageModel);
  }

  async appendMessage(data: AppendDormHarmonyMessageData): Promise<DormHarmonyMessageModel> {
    const row = await this.prisma.dormHarmonyMessage.create({
      data: {
        caseId: data.caseId,
        fromRole: data.fromRole,
        anonHandle: data.anonHandle,
        body: data.body,
      },
    });
    return toMessageModel(row);
  }

  async updateStatus(id: string, status: DormHarmonyStatus): Promise<DormHarmonyCaseModel> {
    const row = await this.prisma.dormHarmonyCase.update({ where: { id }, data: { status } });
    return toCaseModel(row);
  }

  async setMediator(id: string, mediatorId: string): Promise<DormHarmonyCaseModel> {
    const row = await this.prisma.dormHarmonyCase.update({
      where: { id },
      data: { mediatorId, status: 'in-progress' },
    });
    return toCaseModel(row);
  }
}

function toCaseModel(row: DormHarmonyCase): DormHarmonyCaseModel {
  return {
    id: row.id,
    anonHandle: row.anonHandle,
    trackCodeHash: row.trackCodeHash,
    building: row.building,
    topic: row.topic,
    detail: row.detail,
    status: row.status,
    mediatorId: row.mediatorId,
    expectation: row.expectation,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMessageModel(row: DormHarmonyMessage): DormHarmonyMessageModel {
  return {
    id: row.id,
    caseId: row.caseId,
    fromRole: row.fromRole,
    anonHandle: row.anonHandle,
    body: row.body,
    createdAt: row.createdAt,
  };
}
