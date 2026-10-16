/**
 * wildlife · 分类、投喂政策与内容校验验收（规格 §2.5 / §5 / §8 / §10.3）
 *
 * 覆盖：T42（server 模式但 provider 不可用 → 降级不崩溃）、T44（置信度 <0.60 不预选）、
 * 第三方标签映射"映射不上就丢弃"、敏感区多边形提取的健壮性、
 * 发现时间范围、伦理勾选（**表单校验**，不是同意门）。
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../common/errors/app-error';
import { ETHICS_HIGHLIGHTS, assertEthicsAcknowledged, assertNoteAcceptable, findBannedKeyword, parseKeywordList } from './content';
import {
  CLASSIFICATION_NOTICE,
  CLASSIFIED_BY_VALUES,
  FEEDING_POLICIES,
  TAXON_RANKS,
  assertObservedAtInRange,
  isHighConfidence,
  mapExternalLabels,
  normalizeClassifiedBy,
  normalizeFeedingPolicy,
  normalizeTaxonRank,
  resolveClassifierMode,
  shapeClassification,
  toSensitivePolygons,
} from './taxonomy';
import { MockClassifier, NullClassifier, ThirdPartyClassifier } from './ports/species-classifier.port';

function expectReason(fn: () => unknown, reason: string): void {
  try {
    fn();
    throw new Error('期望抛错');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).details).toMatchObject({ reason });
  }
}

describe('§2.5 枚举归一化（脏数据不炸接口）', () => {
  it('投喂政策只认三个值，其余落回 discouraged', () => {
    expect(FEEDING_POLICIES).toEqual(['allowed', 'discouraged', 'forbidden']);
    expect(normalizeFeedingPolicy('forbidden')).toBe('forbidden');
    expect(normalizeFeedingPolicy('banned')).toBe('discouraged');
    expect(normalizeFeedingPolicy(null)).toBe('discouraged');
  });

  it('分类层级与分类来源同理', () => {
    expect(TAXON_RANKS).toContain('species');
    expect(normalizeTaxonRank('genus')).toBe('genus');
    expect(normalizeTaxonRank('nope')).toBe('species');
    expect(CLASSIFIED_BY_VALUES).toEqual(['manual', 'vision_api', 'ondevice', 'fallback']);
    expect(normalizeClassifiedBy('vision_api')).toBe('vision_api');
    expect(normalizeClassifiedBy('magic')).toBe('manual');
  });
});

describe('§5.5 分类建议整形（T44）', () => {
  it('置信度 < 0.60 → 不预选，但建议仍然返回（让用户看到候选）', () => {
    const result = shapeClassification([
      { speciesId: 'sp-duck', confidence: 0.55 },
      { speciesId: 'sp-swan', confidence: 0.4 },
    ]);
    expect(result.preselected).toBe(false);
    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0]).toMatchObject({ speciesId: 'sp-duck', isSuggestion: true });
    expect(result.degraded).toBe(false);
    expect(result.notice).toBe(CLASSIFICATION_NOTICE);
  });

  it('置信度 ≥ 0.60 → 预选 top-1，按置信度降序', () => {
    const result = shapeClassification([
      { speciesId: 'a', confidence: 0.61 },
      { speciesId: 'b', confidence: 0.93 },
    ]);
    expect(result.preselected).toBe(true);
    expect(result.suggestions.map((s) => s.speciesId)).toEqual(['b', 'a']);
    expect(isHighConfidence(0.93)).toBe(true);
    expect(isHighConfidence(0.7)).toBe(false);
  });

  it('topK 生效；非法置信度被过滤', () => {
    const result = shapeClassification(
      [
        { speciesId: 'a', confidence: 0.9 },
        { speciesId: 'b', confidence: 0.8 },
        { speciesId: 'c', confidence: 0.7 },
        { speciesId: 'bad', confidence: Number.NaN },
        { speciesId: '', confidence: 0.99 },
        { speciesId: 'zero', confidence: 0 },
      ],
      { topK: 2 },
    );
    expect(result.suggestions.map((s) => s.speciesId)).toEqual(['a', 'b']);
  });

  it('无建议 → degraded=true（客户端据此落回手动选择）', () => {
    const result = shapeClassification([]);
    expect(result.suggestions).toEqual([]);
    expect(result.degraded).toBe(true);
    expect(result.preselected).toBe(false);
  });
});

describe('§5.3 第三方标签映射：**映射不上就丢弃**（猜错物种比不分类更糟）', () => {
  const species = [
    { id: 'sp-swan', externalIds: { inaturalist: 1234 } },
    { id: 'sp-cat', externalIds: { inaturalist: 'Felis catus' } },
    { id: 'sp-none', externalIds: {} },
  ];

  it('按 externalIds 映射，未命中的标签直接丢掉', () => {
    const mapped = mapExternalLabels(
      [
        { label: '1234', confidence: 0.9 },
        { label: 'felis catus', confidence: 0.8 },
        { label: 'unknown-species', confidence: 0.99 },
      ],
      species,
    );
    expect(mapped.map((p) => p.speciesId)).toEqual(['sp-swan', 'sp-cat']);
    expect(mapped.some((p) => p.speciesId === 'sp-none')).toBe(false);
  });

  it('全部映射不上 → 空数组（不猜）', () => {
    expect(mapExternalLabels([{ label: 'x', confidence: 1 }], species)).toEqual([]);
  });

  it('支持换一个映射键（如 baiduLabel）', () => {
    const mapped = mapExternalLabels(
      [{ label: '黑天鹅', confidence: 0.7 }],
      [{ id: 'sp-swan', externalIds: { baiduLabel: '黑天鹅' } }],
      'baiduLabel',
    );
    expect(mapped[0]).toMatchObject({ speciesId: 'sp-swan', confidence: 0.7 });
  });
});

describe('§5.4 分类模式解析（T42：不可用就降级，**不崩溃**）', () => {
  it('manual（默认）不变', () => {
    expect(resolveClassifierMode({ configured: 'manual', provider: 'none', hasApiKey: false, hasModelPath: false }))
      .toEqual({ mode: 'manual', degraded: false, reason: null });
  });

  it('off 完全关闭', () => {
    expect(resolveClassifierMode({ configured: 'off', provider: 'none', hasApiKey: false, hasModelPath: false }).mode).toBe('off');
  });

  it('server + local-onnx 但模型路径为空 → 降级 manual 并给出原因', () => {
    const result = resolveClassifierMode({
      configured: 'server',
      provider: 'local-onnx',
      hasApiKey: false,
      hasModelPath: false,
    });
    expect(result.mode).toBe('manual');
    expect(result.degraded).toBe(true);
    expect(result.reason).toContain('WILDLIFE_ONNX_MODEL_PATH');
  });

  it('server + third-party 但无 API key → 降级 manual', () => {
    const result = resolveClassifierMode({
      configured: 'server',
      provider: 'third-party',
      hasApiKey: false,
      hasModelPath: false,
    });
    expect(result.mode).toBe('manual');
    expect(result.reason).toContain('WILDLIFE_VISION_API_KEY');
  });

  it('server + 能力齐备 → 生效', () => {
    expect(
      resolveClassifierMode({ configured: 'server', provider: 'third-party', hasApiKey: true, hasModelPath: false }).mode,
    ).toBe('server');
    expect(
      resolveClassifierMode({ configured: 'server', provider: 'local-onnx', hasApiKey: false, hasModelPath: true }).mode,
    ).toBe('server');
  });
});

describe('分类器实现（规格 §5.3：**不抛异常**）', () => {
  it('NullClassifier 恒返回空数组（零配置下系统仍完整可用）', async () => {
    const classifier = new NullClassifier();
    expect(classifier.provider).toBe('none');
    expect(await classifier.classify(Buffer.from('x'), 3)).toEqual([]);
  });

  it('MockClassifier 返回 topK 并补上 provider', async () => {
    const classifier = new MockClassifier([
      { speciesId: 'a', confidence: 0.5 },
      { speciesId: 'b', confidence: 0.9 },
      { speciesId: 'c', confidence: 0.7 },
    ]);
    const result = await classifier.classify(Buffer.from('x'), 2);
    expect(result.map((p) => p.speciesId)).toEqual(['b', 'c']);
    expect(result[0]!.provider).toBe('third-party');
  });

  it('ThirdPartyClassifier 无 key 时不可用且返回空（不抛错）', async () => {
    const classifier = new ThirdPartyClassifier('');
    expect(classifier.available).toBe(false);
    expect(await classifier.classify(Buffer.from('x'), 3)).toEqual([]);
    expect(new ThirdPartyClassifier('k').available).toBe(true);
  });
});

describe('§9.3 ① 敏感区多边形提取的健壮性', () => {
  it('只取 isSensitive 且环合法的区域', () => {
    const polygons = toSensitivePolygons([
      { id: 'z1', isSensitive: true, sensitiveRing: [{ lat: 31.178, lng: 121.59 }, { lat: 31.179, lng: 121.59 }, { lat: 31.179, lng: 121.591 }] },
      { id: 'z2', isSensitive: false, sensitiveRing: [{ lat: 31.178, lng: 121.59 }, { lat: 31.179, lng: 121.59 }, { lat: 31.179, lng: 121.591 }] },
      { id: 'z3', isSensitive: true, sensitiveRing: null },
    ]);
    expect(polygons.map((p) => p.id)).toEqual(['z1']);
    expect(polygons[0]!.reason).toBe('sensitive-zone');
  });

  it('顶点不足 3 个 → **整块丢弃**（残缺的环会让本应命中的点漏出去）', () => {
    expect(
      toSensitivePolygons([
        { id: 'z', isSensitive: true, sensitiveRing: [{ lat: 31.178, lng: 121.59 }, { lat: 31.179, lng: 121.59 }] },
      ]),
    ).toEqual([]);
  });

  it('非法顶点被跳过，剩余顶点不足 3 个则丢弃', () => {
    expect(
      toSensitivePolygons([
        {
          id: 'z',
          isSensitive: true,
          sensitiveRing: [
            { lat: 31.178, lng: 121.59 },
            { lat: 'x', lng: 121.59 },
            { lat: Number.NaN, lng: 121.591 },
            { lat: 31.179, lng: 121.591 },
          ],
        },
      ]),
    ).toEqual([]);
    // 合法的 4 个顶点：保留
    expect(
      toSensitivePolygons([
        {
          id: 'z',
          isSensitive: true,
          sensitiveRing: [
            { lat: 31.178, lng: 121.59 },
            { lat: 31.178, lng: 121.591 },
            { lat: 31.179, lng: 121.591 },
            { lat: 31.179, lng: 121.59 },
          ],
        },
      ]),
    ).toHaveLength(1);
  });
});

describe('§10.3 发现时间范围', () => {
  const now = new Date('2026-10-17T12:00:00Z');

  it('过去 30 天内 + 未来 5 分钟内通过', () => {
    expect(() => assertObservedAtInRange(new Date('2026-10-17T11:00:00Z'), now)).not.toThrow();
    expect(() => assertObservedAtInRange(new Date('2026-09-20T12:00:00Z'), now)).not.toThrow();
    expect(() => assertObservedAtInRange(new Date('2026-10-17T12:04:00Z'), now)).not.toThrow();
  });

  it('31 天前 / 未来 6 分钟 / 非法时间被拒（OBSERVED_AT_OUT_OF_RANGE）', () => {
    expectReason(() => assertObservedAtInRange(new Date('2026-09-01T12:00:00Z'), now), 'OBSERVED_AT_OUT_OF_RANGE');
    expectReason(() => assertObservedAtInRange(new Date('2026-10-17T12:06:00Z'), now), 'OBSERVED_AT_OUT_OF_RANGE');
    expectReason(() => assertObservedAtInRange(new Date('nonsense'), now), 'OBSERVED_AT_OUT_OF_RANGE');
  });
});

describe('§8.2 伦理勾选是**表单校验**，不是同意门', () => {
  it('必须显式 true，缺省/其它值一律拒绝', () => {
    expect(() => assertEthicsAcknowledged(true)).not.toThrow();
    expectReason(() => assertEthicsAcknowledged(undefined), 'ETHICS_NOT_ACKNOWLEDGED');
    expectReason(() => assertEthicsAcknowledged(false), 'ETHICS_NOT_ACKNOWLEDGED');
    expectReason(() => assertEthicsAcknowledged('true'), 'ETHICS_NOT_ACKNOWLEDGED');
  });

  it('错误码是 VALIDATION_FAILED，**绝不是 CONSENT_REQUIRED**（规格 §10.6）', () => {
    try {
      assertEthicsAcknowledged(false);
    } catch (error) {
      expect((error as AppError).code).toBe('VALIDATION_FAILED');
      expect((error as AppError).code).not.toBe('CONSENT_REQUIRED');
    }
  });

  it('提示文案 ≤5 条、每条 ≤20 字', () => {
    expect(ETHICS_HIGHLIGHTS.length).toBeLessThanOrEqual(5);
    for (const line of ETHICS_HIGHLIGHTS) expect(line.length).toBeLessThanOrEqual(20);
  });
});

describe('§10.3 备注内容安全', () => {
  it('长度上限 200 字', () => {
    expect(() => assertNoteAcceptable('a'.repeat(200))).not.toThrow();
    expectReason(() => assertNoteAcceptable('a'.repeat(201)), 'NOTE_TOO_LONG');
  });

  it('命中违禁词 → CONTENT_REJECTED（词表由运维配置，代码不硬编码）', () => {
    expect(findBannedKeyword('这里有违禁词ABC', ['abc'])).toBe('abc');
    expect(findBannedKeyword('干净内容', ['abc'])).toBeNull();
    expect(() => assertNoteAcceptable('包含 abc 的备注', ['abc'])).toThrow();
    expectReason(() => assertNoteAcceptable('包含 abc 的备注', ['abc']), 'CONTENT_REJECTED');
  });

  it('null/undefined 视为"没有备注"，直接通过', () => {
    expect(() => assertNoteAcceptable(null)).not.toThrow();
    expect(() => assertNoteAcceptable(undefined)).not.toThrow();
  });

  it('parseKeywordList 去空去重', () => {
    expect(parseKeywordList(' a , b ,, a , ')).toEqual(['a', 'b']);
    expect(parseKeywordList(undefined)).toEqual([]);
  });
});
