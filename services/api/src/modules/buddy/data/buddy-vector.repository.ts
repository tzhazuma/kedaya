/**
 * 找搭子 · data 层：pgvector 向量查询（规格 §4.4）
 *
 * ## 安全要点（本文件唯一需要被认真审查的地方）
 *
 * 向量通过 `$queryRaw` 的**模板参数绑定**（`$1`），**不是**字符串拼接：
 * `${literal}` 被 Prisma 转成绑定参数，`::vector` 是对**该参数**的类型转换，
 * 不是 SQL 注入点。这一点由 `test/buddy-db.spec.ts` 在**真实 pgvector** 上证明：
 * 绑定参数时恶意字面量只被当作数据（Postgres 报 `22P02 invalid input syntax`），
 * 而对照实验里字符串拼接的 `DROP TABLE` 真的执行了。
 *
 * 即便如此仍加 `toVectorLiteral` 的数值白名单 —— **纵深防御**。
 * "绑定参数就安全"这个信念，在有人改成 `Prisma.raw()` 的那一刻就会失效，
 * 而那个改动在 diff 里看起来很小。
 *
 * ## 为什么 `Unsupported` 字段只能走 raw
 *
 * Prisma Client **不暴露** `embedding` 给 `create` / `update` / `select`：
 * 写入必须 `$executeRaw`，读取必须 `$queryRaw`（规格 §4.2 限制 2）。
 * 所以本文件的每个方法都是 raw —— 这不是"偷懒绕过 ORM"，
 * 而是 Prisma 对 `Unsupported` 类型的硬限制。
 *
 * ## 为什么**不**建 HNSW 索引（规格 §4.3）
 *
 * 活跃 `BuddyProfile` 在几千量级，顺序扫描 + `ORDER BY <=> LIMIT 200`
 * 在 5ms 量级，**比 HNSW 更简单也更准**（HNSW 是近似检索，会漏真近邻）。
 * 门槛：行数 > 20,000 或推荐 P95 > 300ms 时才建。迁移文件里有届时用的 DDL。
 */

import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { parseVectorLiteral, toVectorLiteral } from '../domain/vector-literal';
import { readBuddyConfig } from '../../../config/buddy.config';
import { ConfigService } from '@nestjs/config';
import {
  type BuddyVectorRepository,
  type VectorCandidate,
} from '../domain/buddy.domain';

@Injectable()
export class BuddyVectorPrismaRepository implements BuddyVectorRepository {
  /**
   * 向量维度（`BUDDY_VECTOR_DIM`）。
   *
   * 维度写错会让 `<=>` **直接报错**（`expected 768 dimensions, not 384`），
   * 而不是静默算错相似度 —— 这就是为什么每次写入都带 `expectedDim` 校验。
   */
  private readonly dim: number;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.dim = readBuddyConfig(config).BUDDY_VECTOR_DIM;
  }

  /**
   * 余弦距离召回候选帖子。
   *
   * `<=>` 是 pgvector 的余弦**距离**算子（0 = 完全相同）。
   * `ORDER BY ... ASC` + `LIMIT` 让 Postgres 走顺序扫描（无索引时，规格 §4.3）。
   */
  async findSimilarPosts(
    embedding: readonly number[],
    activities: readonly string[],
    limit: number,
  ): Promise<VectorCandidate[]> {
    const literal = toVectorLiteral(embedding, this.dim);

    return this.prisma.$queryRaw<VectorCandidate[]>(Prisma.sql`
      SELECT p."id" AS "postId",
             (p."embedding" <=> ${literal}::vector) AS "distance"
      FROM "BuddyPost" p
      WHERE p."embedding" IS NOT NULL
        AND p."status" = 'OPEN'
        AND p."startsAt" > now()
        AND p."deletedAt" IS NULL
        AND p."activity" = ANY(${activities}::text[])
      ORDER BY p."embedding" <=> ${literal}::vector ASC
      LIMIT ${limit}
    `);
  }

  async findPostEmbeddings(postIds: readonly string[]): Promise<Map<string, number[]>> {
    if (postIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ postId: string; embedding: string | null }>>(Prisma.sql`
      SELECT "id" AS "postId", "embedding"::text AS "embedding"
      FROM "BuddyPost"
      WHERE "id" = ANY(${[...new Set(postIds)]}::text[]) AND "embedding" IS NOT NULL
    `);

    const out = new Map<string, number[]>();
    for (const row of rows) {
      const parsed = parseVectorLiteral(row.embedding, this.dim);
      if (parsed) out.set(row.postId, parsed);
    }
    return out;
  }

  async findProfileEmbedding(userId: string): Promise<number[] | null> {
    const rows = await this.prisma.$queryRaw<Array<{ embedding: string | null }>>(Prisma.sql`
      SELECT "embedding"::text AS "embedding"
      FROM "BuddyProfile"
      WHERE "userId" = ${userId} AND "deletedAt" IS NULL
    `);
    return parseVectorLiteral(rows[0]?.embedding, this.dim);
  }

  async setProfileEmbedding(
    userId: string,
    embedding: readonly number[],
    model: string | null,
  ): Promise<void> {
    const literal = toVectorLiteral(embedding, this.dim);
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "BuddyProfile"
      SET "embedding" = ${literal}::vector,
          "embeddingModel" = ${model},
          "updatedAt" = now()
      WHERE "userId" = ${userId}
    `);
  }

  async setPostEmbedding(postId: string, embedding: readonly number[], model: string | null): Promise<void> {
    const literal = toVectorLiteral(embedding, this.dim);
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "BuddyPost"
      SET "embedding" = ${literal}::vector,
          "embeddingModel" = ${model},
          "updatedAt" = now()
      WHERE "id" = ${postId}
    `);
  }

  async clearProfileEmbedding(userId: string): Promise<void> {
    // 撤回匹配资料时把向量置 NULL（验收 T30）。用 UPDATE 而不是依赖行删除，
    // 因为"资料行还在但不再参与匹配"也是一种合法状态。
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "BuddyProfile"
      SET "embedding" = NULL, "embeddingModel" = NULL, "updatedAt" = now()
      WHERE "userId" = ${userId}
    `);
  }
}
