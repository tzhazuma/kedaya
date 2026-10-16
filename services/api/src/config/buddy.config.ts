/**
 * 找搭子 · 配置（规格 §3.5）
 *
 * ## 配置哲学：**降级而非崩溃**
 *
 * 与 `wildlife.config.ts` 刻意相反：wildlife 的加噪密钥缺失时**启动失败**
 * （隐私防线静默降级等于静默泄漏），而 buddy 的匹配能力缺失时**降级 + WARN**。
 * 理由：`buddy` 是低敏感模块（契约 §9），
 * 绝不能因为 pgvector 没装导致整个 API（20 个模块）起不来（契约 §8 启动不阻塞）。
 *
 * ## 三档降级的配置面
 *
 * | `BUDDY_MATCHING_MODE` | 前置条件 | 缺什么会降级 |
 * | --- | --- | --- |
 * | `vector` | pgvector + embedding 列 + 模型 | 缺任一 → `hash`；连列都没有 → `rule` |
 * | `hash` | embedding 列 | 缺列 → `rule` |
 * | `rule` | 无 | 不会降级（它是最低档） |
 *
 * 实际生效的模式由 `resolveMatchingMode`（domain 纯函数）算出，
 * 能力探测结果由 `BuddyCapabilityProbe` 在启动时提供。
 */

import { z } from 'zod';
import type { ConfigService } from '@nestjs/config';
import type { MatchMode } from '@kedaya/shared';

/** 默认向量维度：768（bge-base-zh-v1.5）。**建库后不可改**（规格 D7 / U5） */
export const DEFAULT_VECTOR_DIM = 768;

export const BuddyMatchingModeSchema = z.enum(['vector', 'hash', 'rule']);

export const buddyConfigSchema = z.object({
  /**
   * 请求的匹配模式。**默认 `hash`**（规格 U4：本规格未实测本地中文 embedding 模型，
   * 因此默认不用 `vector`）。
   */
  BUDDY_MATCHING_MODE: BuddyMatchingModeSchema.default('hash'),
  /** 空 = 不加载模型（此时 `vector` 会降级到 `hash`） */
  BUDDY_EMBEDDING_MODEL: z.string().default(''),
  /** 向量维度。必须与迁移里的 `vector(768)` 一致，否则 `<=>` 直接报错 */
  BUDDY_VECTOR_DIM: z.coerce.number().int().positive().default(DEFAULT_VECTOR_DIM),
  /** MMR 多样性系数 λ（`matching.py` 的 `config.py:103` 默认 0.7） */
  BUDDY_MMR_LAMBDA: z.coerce.number().min(0).max(1).default(0.7),
  /** 候选池大小（`matching.py:423` 的 200） */
  BUDDY_CANDIDATE_POOL: z.coerce.number().int().positive().max(2000).default(200),
  /**
   * 反馈衰减的**时间常数**（天）。
   *
   * ⚠️ 命名诚实性：规格与 STUMatch 都叫它 `halflife`，但公式是 `exp(-days/30)` ——
   * 这是时间常数，不是半衰期（真正的 30 天半衰期是 `exp(-ln2·days/30)`，
   * 而 `exp(-1) ≈ 0.368 ≠ 0.5`）。共享包里已改名为
   * `DECAY_TIME_CONSTANT_DAYS` 并记录了这个差异。配置键保留规格的名字以便对齐文档。
   */
  BUDDY_FEEDBACK_HALFLIFE_DAYS: z.coerce.number().positive().default(30),
  /** 推荐列表默认条数（规格 §5.7：1–50，默认 10） */
  BUDDY_RECOMMEND_LIMIT: z.coerce.number().int().min(1).max(50).default(10),
});

export type BuddyConfig = z.infer<typeof buddyConfigSchema>;

/**
 * 从 `ConfigService` 读取配置。
 *
 * 刻意**不在 import 期读环境变量**：那样测试无法注入，
 * 且 `process.env` 的读取时机与 Nest 的 ConfigModule 加载顺序耦合。
 */
export function readBuddyConfig(config: ConfigService): BuddyConfig {
  const raw = {
    BUDDY_MATCHING_MODE: config.get<string>('BUDDY_MATCHING_MODE') ?? undefined,
    BUDDY_EMBEDDING_MODEL: config.get<string>('BUDDY_EMBEDDING_MODEL') ?? '',
    BUDDY_VECTOR_DIM: config.get<string>('BUDDY_VECTOR_DIM') ?? undefined,
    BUDDY_MMR_LAMBDA: config.get<string>('BUDDY_MMR_LAMBDA') ?? undefined,
    BUDDY_CANDIDATE_POOL: config.get<string>('BUDDY_CANDIDATE_POOL') ?? undefined,
    BUDDY_FEEDBACK_HALFLIFE_DAYS: config.get<string>('BUDDY_FEEDBACK_HALFLIFE_DAYS') ?? undefined,
    BUDDY_RECOMMEND_LIMIT: config.get<string>('BUDDY_RECOMMEND_LIMIT') ?? undefined,
  };

  // 配置非法时**不抛**：buddy 是低敏感模块，一个打错的 λ 不该让 API 起不来。
  const parsed = buddyConfigSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return buddyConfigSchema.parse({});
}

/** 请求的模式（`MatchMode` 与 zod enum 同构，这里只做一次收敛） */
export function requestedModeOf(config: BuddyConfig): MatchMode {
  return config.BUDDY_MATCHING_MODE;
}
