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
    const isProduction = config.get<string>('NODE_ENV') === 'production';
    const missingUrl = connectionString.trim() === '';

    /**
     * 生产环境**不允许**空连接串启动。
     *
     * 空串不会立刻报错，而是让每个请求在超时后返回 500 —— 症状是"服务是活的、
     * 但什么都不能用"，排查成本极高。缺 `DATABASE_URL` 属于**配置错误**，
     * 应该在启动时就说清楚，而不是拖到第一次查询。
     * 开发环境保留宽松模式，免得本地只想跑接口时被迫起数据库。
     *
     * 注意：这段判断必须在 `super()` **之前**，否则 TS 会因"派生类构造函数
     * 中访问 this 早于 super"而报错（这里只用到参数，不碰 this）。
     */
    if (missingUrl && isProduction) {
      throw new Error(
        'DATABASE_URL 未配置：生产环境必须显式提供数据库连接串（见 docs/deploy.md「环境变量」）。',
      );
    }

    super({ adapter: new PrismaPg({ connectionString }) });

    if (missingUrl) this.logger.warn('DATABASE_URL 未配置，将以空连接串启动（仅开发环境允许）');
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (error) {
      /**
       * 连接失败**不退出**进程，这是刻意的：
       *   · 数据库是外部托管实例，容器重启并不能让它恢复；
       *   · 反复重启只会制造重启风暴，还让 `/health` 一直红着，
       *     平台永远不知道何时该把流量放进来；
       *   · 保持存活 + 记录错误，数据库恢复后无需重启即可继续服务。
       * 探活（`/health`）刻意只探进程存活，正是为了配合这个策略，
       * 详见 `services/api/src/main.ts` 的 health 注释。
       */
      this.logger.error(
        `数据库连接失败，服务继续运行但业务请求会返回 5xx：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
