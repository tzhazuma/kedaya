import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma 客户端（Prisma 7）。
 *
 * ⚠️ Prisma 7 的破坏性变更：`PrismaClient` **必须**通过 driver adapter 连接
 * （除非走 Prisma Accelerate）。生成客户端自己的文档里写得很明确：
 *   "A driver adapter is **required** unless you connect to your database
 *    through Prisma Accelerate (in which case use `accelerateUrl` instead)."
 * 因此 `@prisma/adapter-pg` 是**必需依赖**，而不是可选项。
 * 这也解释了为什么 schema 里的 `datasource.url` 被移除了（见 prisma.config.ts）。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(ConfigService) config: ConfigService) {
    const connectionString = config.get<string>('DATABASE_URL') ?? '';
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (error) {
      // 骨架阶段允许"无数据库启动"：不阻塞进程，只告警。
      // 生产环境应改为 fail-fast（见 README「未实现项」）。
      this.logger.warn(
        `数据库连接失败，服务将以降级模式启动：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
