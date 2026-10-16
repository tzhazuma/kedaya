/**
 * 找搭子 · 三档降级模式的解析（规格 §3.5，验收 T32 / T33 / T34）
 *
 * | 模式 | 前置条件 | `baseScore` 来源 |
 * | --- | --- | --- |
 * | `vector` | pgvector 已装 **且** embedding 列存在 **且** 模型可加载 | 真 embedding 余弦 |
 * | `hash` | 仅需 embedding 列存在（无模型） | 哈希向量余弦 |
 * | `rule` | 无 | 无（权重归零，规则分占满） |
 *
 * ## 硬要求：**降级而非崩溃**
 *
 * 契约 §8 要求启动不阻塞，且 `buddy` 是**低敏感**模块 ——
 * 绝不能因为 pgvector 没装导致整个 API 起不来（那会把 20 个模块一起拖下水）。
 * 所以本函数**永不抛异常**，只返回"请求的模式 + 实际生效的模式 + 原因"。
 *
 * ## 为什么单独做成纯函数
 *
 * 这样 T33/T34 的"启动测试"不需要真的起一个没有 pgvector 的数据库：
 * 把能力探测结果喂进来，断言解析结果即可。能力探测（真的去查
 * `pg_extension` / `information_schema`）在 `data/buddy-capability.probe.ts`。
 */

import type { MatchMode } from '@kedaya/shared';

export type { MatchMode };

/** 数据库能力探测结果（由 data 层产出，这里只消费） */
export interface BuddyCapabilities {
  /** `SELECT 1 FROM pg_extension WHERE extname='vector'` 是否命中 */
  hasPgvectorExtension: boolean;
  /** `information_schema.columns` 里是否有 `BuddyProfile.embedding` */
  hasEmbeddingColumn: boolean;
  /** `BUDDY_EMBEDDING_MODEL` 非空（且模型可加载 —— 加载失败由配置层折算成 false） */
  hasEmbeddingModel: boolean;
}

export interface ResolvedMatchingMode {
  /** 请求的模式（配置值） */
  requested: MatchMode;
  /** 实际生效的模式 */
  effective: MatchMode;
  /** 是否发生了降级 */
  degraded: boolean;
  /** 降级原因（中文，直接进启动日志的 WARN）；未降级为 null */
  reason: string | null;
}

/**
 * 解析实际生效的匹配模式。
 *
 * 降级链是**单向**的：`vector → hash → rule`。
 * 绝不"升级"（请求 `rule` 时就算 pgvector 可用也仍然用 `rule` ——
 * 显式配置必须被尊重，否则运维无法通过配置回退来定位问题）。
 */
export function resolveMatchingMode(
  requested: MatchMode,
  caps: BuddyCapabilities,
): ResolvedMatchingMode {
  const canHash = caps.hasEmbeddingColumn;

  if (requested === 'rule') {
    return { requested, effective: 'rule', degraded: false, reason: null };
  }

  if (requested === 'hash') {
    if (canHash) return { requested, effective: 'hash', degraded: false, reason: null };
    return {
      requested,
      effective: 'rule',
      degraded: true,
      reason: 'embedding 列不存在（pgvector 扩展未安装或迁移未执行），已降级为 rule',
    };
  }

  // requested === 'vector'
  if (caps.hasPgvectorExtension && canHash && caps.hasEmbeddingModel) {
    return { requested, effective: 'vector', degraded: false, reason: null };
  }

  const missing: string[] = [];
  if (!caps.hasPgvectorExtension) missing.push('pgvector 扩展未安装');
  if (!canHash) missing.push('embedding 列不存在');
  if (!caps.hasEmbeddingModel) missing.push('BUDDY_EMBEDDING_MODEL 为空或模型不可加载');

  // 有 embedding 列就能退到 hash；否则只能退到 rule
  const effective: MatchMode = canHash ? 'hash' : 'rule';
  return {
    requested,
    effective,
    degraded: true,
    reason: `${missing.join('；')}，已降级为 ${effective}`,
  };
}
