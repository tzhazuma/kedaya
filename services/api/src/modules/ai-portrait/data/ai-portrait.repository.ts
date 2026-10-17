import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  AiPortraitProfileModel,
  AiPortraitProfileRepository,
  CreateAiPortraitProfileInput,
  UpdateAiPortraitProfileInput,
} from '../domain/ai-portrait.domain';
import type { AiPortraitProfile } from '@prisma/client';

/** data 层 · 访问域 ai-portrait（契约 §9：可关闭、可解释） */
@Injectable()
export class AiPortraitProfilePrismaRepository
  extends PrismaCursorRepository<
    AiPortraitProfile,
    AiPortraitProfileModel,
    CreateAiPortraitProfileInput,
    UpdateAiPortraitProfileInput
  >
  implements AiPortraitProfileRepository
{
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super(prisma.aiPortraitProfile);
  }

  findByUserId(userId: string): Promise<AiPortraitProfileModel | null> {
    return this.prisma.aiPortraitProfile.findUnique({ where: { userId } });
  }

  upsertForUser(
    userId: string,
    input: { traits: unknown; explain: unknown; enabled: boolean },
  ): Promise<AiPortraitProfileModel> {
    const data = {
      traits: input.traits as Prisma.InputJsonValue,
      explain: input.explain as Prisma.InputJsonValue,
      enabled: input.enabled,
    };
    return this.prisma.aiPortraitProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }
}
