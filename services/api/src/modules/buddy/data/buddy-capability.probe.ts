/**
 * 找搭子 · 启动自检：数据库能力探测（规格 §3.5，验收 T33 / T34）
 *
 * ## 硬要求：**降级而非崩溃**
 *
 * 契约 §8 要求启动不阻塞，且 `buddy` 是低敏感模块 —— 绝不能因为
 * pgvector 没装导致整个 API 起不来（那会把 20 个模块一起拖下水）。
 * 因此：
 *   - 探测失败（连不上库、权限不足、表还没建）→ 一律当成"没有该能力"；
 *   - 结果交给 `resolveMatchingMode` 决定降级档，由 module 打一条 WARN。
 *
 * ## 两个探测分别查什么
 *
 * | 能力 | 查询 |
 * | --- | --- |
 * | pgvector 扩展 | `SELECT 1 FROM pg_extension WHERE extname='vector'` |
 * | embedding 列 | `SELECT 1 FROM information_schema.columns WHERE table_name='BuddyProfile' AND column_name='embedding'` |
 *
 * 第二个是"迁移跑没跑"的可靠信号：`vector(768)` 列**只能**由手写迁移创建
 * （Prisma 不为 `Unsupported` 生成 DDL），所以"列在不在"等价于
 * "pgvector 迁移是否执行过"。
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  type BuddyCapabilityProbePort,
} from '../domain/buddy.domain';

@Injectable()
export class BuddyCapabilityProbe implements BuddyCapabilityProbePort {
  private readonly logger = new Logger(BuddyCapabilityProbe.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * 探测两项能力。
   *
   * ⚠️ **必须串行**，不能 `Promise.all`。
   *
   * 这不是风格问题：在只有一条底层连接的部署里（PGlite 的 socket 服务端就是
   * 全局串行化查询的），两个并发的 `$queryRaw` 会让其中一个以**连接级错误**
   * 失败 —— 于是 `hasEmbeddingColumn` 被误判成 `false`，整个模块静默降级到
   * `rule` 档，而且那条被关掉的连接还会让**紧接着的下一条业务查询**
   * 报 `P1017 数据库连接已断开`。
   *
   * 这个缺陷是被 `test/buddy-http.spec.ts` 抓出来的：它当时表现为
   * "推荐接口偶发 500"，而根因是启动时的探测。串行化把启动期的不确定性
   * 彻底去掉，代价是两次往返（启动一次，可忽略）。
   */
  async probe(): Promise<{ hasPgvectorExtension: boolean; hasEmbeddingColumn: boolean }> {
    const hasPgvectorExtension = await this.hasPgvector();
    const hasEmbeddingColumn = await this.hasEmbeddingColumn();
    return { hasPgvectorExtension, hasEmbeddingColumn };
  }

  private async hasPgvector(): Promise<boolean> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ ok: number }>>(Prisma.sql`
        SELECT 1 AS ok FROM pg_extension WHERE extname = 'vector' LIMIT 1
      `);
      return rows.length > 0;
    } catch (error) {
      // 连不上库 / 权限不足 → 当作没有该能力（降级，不抛）
      this.logger.warn(
        `pgvector 扩展探测失败，按"未安装"处理：${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private async hasEmbeddingColumn(): Promise<boolean> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ ok: number }>>(Prisma.sql`
        SELECT 1 AS ok
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'BuddyProfile'
          AND column_name = 'embedding'
        LIMIT 1
      `);
      return rows.length > 0;
    } catch (error) {
      this.logger.warn(
        `embedding 列探测失败，按"列不存在"处理：${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
