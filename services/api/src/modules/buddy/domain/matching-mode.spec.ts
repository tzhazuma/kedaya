import { describe, expect, it } from 'vitest';
import { resolveMatchingMode, type BuddyCapabilities } from './matching-mode';

/**
 * 验收 T33 / T34（规格 §3.5 / §8.5）：
 *   T33 `vector` 模式下若 `pgvector` 扩展缺失，应用**启动成功**并自动降级为 `hash`
 *   T34 `hash` 模式下若 `embedding` 列缺失，自动降级为 `rule`
 *
 * 这里断言的是**纯函数**的解析结果（不需要真的起一个没有 pgvector 的数据库）。
 * 真正去查 `pg_extension` / `information_schema` 的探测在
 * `data/buddy-capability.probe.ts`，它的失败路径也返回"没有该能力"。
 *
 * 最要紧的一条：**本函数永不抛异常**。契约 §8 要求启动不阻塞，
 * 而 buddy 是低敏感模块 —— 它没有权力让整个 API 起不来。
 */

const CAPS = (overrides: Partial<BuddyCapabilities> = {}): BuddyCapabilities => ({
  hasPgvectorExtension: true,
  hasEmbeddingColumn: true,
  hasEmbeddingModel: true,
  ...overrides,
});

describe('resolveMatchingMode（规格 §3.5，验收 T33 / T34）', () => {
  it('能力齐全时 vector 不降级', () => {
    const result = resolveMatchingMode('vector', CAPS());
    expect(result).toMatchObject({ requested: 'vector', effective: 'vector', degraded: false, reason: null });
  });

  it('T33：vector + 无 pgvector 扩展 → 降级为 hash（**不抛异常**）', () => {
    const result = resolveMatchingMode('vector', CAPS({ hasPgvectorExtension: false }));
    expect(result.effective).toBe('hash');
    expect(result.degraded).toBe(true);
    expect(result.reason).toContain('pgvector');
  });

  it('vector + 无 embedding 列（迁移没跑）→ 直接降级为 rule（连 hash 都不成立）', () => {
    const result = resolveMatchingMode(
      'vector',
      CAPS({ hasPgvectorExtension: false, hasEmbeddingColumn: false }),
    );
    expect(result.effective).toBe('rule');
    expect(result.degraded).toBe(true);
  });

  it('vector + 无模型（BUDDY_EMBEDDING_MODEL 为空）→ 降级为 hash', () => {
    const result = resolveMatchingMode('vector', CAPS({ hasEmbeddingModel: false }));
    expect(result.effective).toBe('hash');
    expect(result.degraded).toBe(true);
    expect(result.reason).toContain('BUDDY_EMBEDDING_MODEL');
  });

  it('T34：hash + 无 embedding 列 → 降级为 rule', () => {
    const result = resolveMatchingMode('hash', CAPS({ hasEmbeddingColumn: false, hasPgvectorExtension: false }));
    expect(result.effective).toBe('rule');
    expect(result.degraded).toBe(true);
    expect(result.reason).toContain('embedding 列');
  });

  it('hash + 有列 → 不降级（无模型正是 hash 档的常态）', () => {
    const result = resolveMatchingMode('hash', CAPS({ hasEmbeddingModel: false }));
    expect(result).toMatchObject({ effective: 'hash', degraded: false });
  });

  it('rule 是最低档：无论能力如何都不降级', () => {
    for (const caps of [CAPS(), CAPS({ hasPgvectorExtension: false, hasEmbeddingColumn: false, hasEmbeddingModel: false })]) {
      const result = resolveMatchingMode('rule', caps);
      expect(result).toMatchObject({ effective: 'rule', degraded: false, reason: null });
    }
  });

  it('**绝不升级**：请求 rule 时即使 pgvector 与模型都可用也仍然是 rule', () => {
    // 显式配置必须被尊重，否则运维无法通过配置回退来定位问题
    expect(resolveMatchingMode('rule', CAPS()).effective).toBe('rule');
  });

  it('降级链是单向的 vector → hash → rule，不存在反向', () => {
    const chain = [
      resolveMatchingMode('vector', CAPS({ hasEmbeddingModel: false })).effective,
      resolveMatchingMode('hash', CAPS({ hasEmbeddingColumn: false })).effective,
    ];
    expect(chain).toEqual(['hash', 'rule']);
  });

  it('reason 是可直接进启动日志的中文，且列出了缺失项', () => {
    const result = resolveMatchingMode(
      'vector',
      CAPS({ hasPgvectorExtension: false, hasEmbeddingColumn: false, hasEmbeddingModel: false }),
    );
    expect(result.reason).toMatch(/pgvector 扩展未安装/);
    expect(result.reason).toMatch(/embedding 列不存在/);
    expect(result.reason).toMatch(/BUDDY_EMBEDDING_MODEL/);
    expect(result.reason).toMatch(/降级为 rule/);
  });

  it('所有 3×8 种能力组合都不抛异常（穷举，证明"降级而非崩溃"）', () => {
    const modes = ['vector', 'hash', 'rule'] as const;
    let count = 0;
    for (const requested of modes) {
      for (const hasPgvectorExtension of [true, false]) {
        for (const hasEmbeddingColumn of [true, false]) {
          for (const hasEmbeddingModel of [true, false]) {
            const result = resolveMatchingMode(requested, {
              hasPgvectorExtension,
              hasEmbeddingColumn,
              hasEmbeddingModel,
            });
            expect(modes).toContain(result.effective);
            count += 1;
          }
        }
      }
    }
    expect(count).toBe(24);
  });
});
