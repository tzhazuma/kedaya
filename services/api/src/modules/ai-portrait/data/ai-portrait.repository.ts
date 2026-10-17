import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import type { ListParams } from '../../../common/crud/resource';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  AiPortraitProfileModel,
  AiPortraitProfileRepository,
  CreateAiPortraitProfileInput,
  UpdateAiPortraitProfileInput,
} from '../domain/ai-portrait.domain';
import type { AiPortraitProfile } from '@prisma/client';

/**
 * data 层 · 访问域 ai-portrait（契约 §9：可关闭、可解释、归属只认主体）。
 *
 * 本模块**没有列表端点**（`GET /ai-portrait/items` 不存在，也不该存在：
 * 谁的画像都是私事，把所有人的画像摆在一个可分页的接口后面本身就是错的）。
 * 但仍然显式覆写 `buildWhere` / `buildOrderBy`：通用基类的 `list()` 是继承来的，
 * 一旦将来有人顺手加了列表端点，筛选与排序的形状必须预先收窄好 ——
 * 默认"把 filters 透传给 Prisma"会变成任意字段查询。
 */
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

  /**
   * 筛选**逐字段白名单**：只认 `userId`（精确）与 `enabled`（布尔）。
   *
   * 刻意不把 `filters` 直接展开成 `{ [k]: v }`：那个对象的 key 来自外部输入。
   * 画像没有任何"按行为标签模糊搜索"的合法需求，所以这里只有一个维度 ——
   * 归属。服务层会把它填成当前登录主体。
   */
  protected override buildWhere(
    filters?: ListParams['filters'],
  ): Record<string, unknown> | undefined {
    if (filters === undefined) return undefined;

    const where: Record<string, unknown> = {};

    const userId = filters.userId;
    if (typeof userId === 'string' && userId !== '') where.userId = userId;

    const enabled = filters.enabled;
    if (typeof enabled === 'boolean') where.enabled = enabled;

    return Object.keys(where).length === 0 ? undefined : where;
  }

  /**
   * 新→旧：`createdAt desc` + **`id desc` 兜底**。
   *
   * 游标分页要求全序：同一毫秒落库的两行只按 `createdAt` 排会漏读 / 重读。
   */
  protected override buildOrderBy(): Record<string, unknown>[] {
    return [{ createdAt: 'desc' }, { id: 'desc' }];
  }

  /** 画像按主体寻址（`userId` 上有唯一索引）：只可能有一条，因此不用分页 */
  findByUserId(userId: string): Promise<AiPortraitProfileModel | null> {
    return this.prisma.aiPortraitProfile.findUnique({ where: { userId } });
  }

  /**
   * 按主体的 upsert —— 归属**只**认这个参数（服务层用登录主体传进来）。
   *
   * 用 `upsert` 而不是"先查再写"：`userId` 上有唯一索引，一次原子写入
   * 既避免了并发下的重复行，也让"一个人只有一份画像"成为数据库约束。
   */
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
