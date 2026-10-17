import { Inject, Injectable } from '@nestjs/common';
import type { DormHarmonyCase } from '@prisma/client';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateDormHarmonyCaseInput,
  DormHarmonyCaseModel,
  DormHarmonyCaseRepository,
  UpdateDormHarmonyCaseInput,
} from '../domain/dorm-harmony.domain';

/** data 层 · 访问域 dorm-harmony（契约 §9：匿名、禁止进入通用画像） */
@Injectable()
export class DormHarmonyCasePrismaRepository
  extends PrismaCursorRepository<
    DormHarmonyCase,
    DormHarmonyCaseModel,
    CreateDormHarmonyCaseInput,
    UpdateDormHarmonyCaseInput
  >
  implements DormHarmonyCaseRepository
{
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super(prisma.dormHarmonyCase);
  }

  assignMediator(id: string, mediatorId: string): Promise<DormHarmonyCaseModel> {
    return this.prisma.dormHarmonyCase.update({
      where: { id },
      data: { mediatorId, status: 'in-mediation' },
    });
  }
}
