/**
 * wildlife · 位置模糊化验收（规格 §9 / §11.2）
 *
 * 覆盖：T8（确定性，防平均攻击）、T10（敏感区无坐标）、T11（季节加强）、
 * T12（k-匿名降级）、T13（时间粗化粒度）、T14（密钥缺失即启动失败）、
 * 以及 Lead 修过的"snapToGrid 与 gridCellKey 必须同一套 floor 划分"回归。
 */
import { describe, expect, it } from 'vitest';
import { gridCellKey, pointInPolygon, snapToGrid, type SensitivePolygon } from '@kedaya/shared';
import {
  DEFAULT_FUZZ_RADIUS_M,
  K_ANONYMITY_MIN_REPORTERS,
  assertFuzzSecret,
  deterministicNoise,
  effectiveFuzzRadius,
  fuzzSighting,
  fuzzTime,
  isInSensitiveArea,
  monthInShanghai,
  needsNestingDelay,
  snapWithNoise,
  timeGranularityFor,
  type FuzzRequest,
  type FuzzSpeciesInput,
} from './fuzzing';

const SECRET = 'unit-test-fuzz-secret-at-least-32-bytes-long!!';
const POINT = { lat: 31.1782, lng: 121.5901 };
const OBSERVED_AT = new Date('2026-10-17T08:30:00+08:00');

/** 围住 POINT 的方形敏感区（边长约 44m） */
function sensitiveSquareAround(point: { lat: number; lng: number }): SensitivePolygon {
  const d = 0.0002;
  return {
    id: 'zone-dorm-1',
    reason: '宿舍区',
    ring: [
      { lat: point.lat - d, lng: point.lng - d },
      { lat: point.lat - d, lng: point.lng + d },
      { lat: point.lat + d, lng: point.lng + d },
      { lat: point.lat + d, lng: point.lng - d },
    ],
  };
}

function baseRequest(overrides: Partial<FuzzRequest> = {}): FuzzRequest {
  return {
    sightingId: '01JBXR8K7M3QZ9V0P2N4T6W8YA',
    point: POINT,
    observedAt: OBSERVED_AT,
    species: null,
    zone: null,
    sensitiveAreas: [],
    secret: SECRET,
    distinctReportersInCell: K_ANONYMITY_MIN_REPORTERS,
    ...overrides,
  };
}

describe('§9.3 ① 敏感区判定（最强保证）', () => {
  it('命中敏感区 → 只给 zoneId，**不输出任何坐标**（T10）', () => {
    const polygon = sensitiveSquareAround(POINT);
    const result = fuzzSighting(
      baseRequest({
        zone: { id: 'zone-lake', fuzzRadiusM: 50, isSensitive: false },
        sensitiveAreas: [polygon],
      }),
    );

    expect(result.level).toBe('zone-only');
    expect(result.geo).toBeNull();
    expect(result.sensitiveAreaId).toBe('zone-dorm-1');
    expect(result.sensitiveReason).toBe('宿舍区');
    expect(result.degradeReason).toBe('sensitive-area');
    // 降级时**连半径都不暗示**具体点位，但仍然要有时区安全的粗化时间
    expect(result.observedAtFuzzed).toBe('2026-10-17T00:00:00.000Z');
    // 没有任何坐标字段被"顺手补上"
    expect(JSON.stringify(result)).not.toContain('31.178');
  });

  it('敏感区外不受影响（射线法不误伤）', () => {
    const polygon = sensitiveSquareAround({ lat: 31.2, lng: 121.61 });
    const result = fuzzSighting(baseRequest({ sensitiveAreas: [polygon] }));
    expect(result.level).toBe('grid');
    expect(result.geo).not.toBeNull();
  });

  it('顶点不足 3 个的环被忽略（不产生"假命中"）', () => {
    const degenerate: SensitivePolygon = {
      id: 'bad',
      reason: '坏数据',
      ring: [
        { lat: 31.178, lng: 121.59 },
        { lat: 31.179, lng: 121.591 },
      ],
    };
    expect(isInSensitiveArea(POINT, [degenerate])).toBeNull();
  });

  it('判定与 shared 的 pointInPolygon 一致（不自己写一套射线法）', () => {
    const polygon = sensitiveSquareAround(POINT);
    expect(isInSensitiveArea(POINT, [polygon])?.id).toBe(polygon.id);
    expect(pointInPolygon(POINT, polygon.ring)).toBe(true);
  });
});

describe('§9.3 ③ 确定性加噪（防平均攻击）', () => {
  it('同一 sightingId 调用 100 次，结果**逐元素完全相同**（T8）', () => {
    const request = baseRequest();
    const first = fuzzSighting(request);
    for (let i = 0; i < 100; i += 1) {
      expect(fuzzSighting(request)).toEqual(first);
    }
    // 逐元素（不只是深比较）
    expect(first.geo).not.toBeNull();
    for (let i = 0; i < 100; i += 1) {
      const again = fuzzSighting(request);
      expect(again.geo!.lat).toBe(first.geo!.lat);
      expect(again.geo!.lng).toBe(first.geo!.lng);
    }
  });

  it('不同 sightingId → 不同噪声（否则等于没加噪）', () => {
    const a = deterministicNoise('sighting-a', 16, SECRET);
    const b = deterministicNoise('sighting-b', 16, SECRET);
    expect(a).not.toEqual(b);
  });

  it('不同密钥 → 不同噪声（支持密钥轮换）', () => {
    const a = deterministicNoise('same-id', 16, SECRET);
    const b = deterministicNoise('same-id', 16, `${SECRET}-rotated`);
    expect(a).not.toEqual(b);
  });

  it('σ 线性：噪声幅度随 sigmaM 成比例（σ=grid/3 的语义）', () => {
    const small = deterministicNoise('id', 1, SECRET);
    const large = deterministicNoise('id', 10, SECRET);
    expect(large.dx).toBeCloseTo(small.dx * 10, 10);
    expect(large.dy).toBeCloseTo(small.dy * 10, 10);
  });

  it('密钥缺失时抛错，**绝不静默不加噪**', () => {
    expect(() => deterministicNoise('id', 10, '')).toThrow(/WILDLIFE_FUZZ_SECRET/);
  });
});

describe('§9.3 ② 网格吸附与 gridCellKey 必须同一套划分（Lead 修过的 bug 的回归）', () => {
  it('snapToGrid 的落点属于 gridCellKey 标识的同一格', () => {
    const gridM = 50;
    for (const point of [
      { lat: 31.1782, lng: 121.5901 },
      { lat: 31.1705, lng: 121.5821 },
      { lat: 31.1855, lng: 121.5975 },
      // 负方向（局部米制原点左侧/下方）也要正确
      { lat: 31.1795, lng: 121.591 },
      { lat: 31.179, lng: 121.5905 },
    ]) {
      const snapped = snapToGrid(point, gridM);
      expect(gridCellKey(snapped, gridM)).toBe(gridCellKey(point, gridM));
    }
  });

  it('加噪后的点同样落在某一格心（吸附与计数一致）', () => {
    const gridM = 50;
    const snapped = snapWithNoise(POINT, 'sighting-x', gridM, SECRET);
    const again = snapToGrid(snapped, gridM);
    expect(again.lat).toBeCloseTo(snapped.lat, 12);
    expect(again.lng).toBeCloseTo(snapped.lng, 12);
  });

  it('加噪确实把点移开了（不是恒等变换）', () => {
    const snapped = snapWithNoise(POINT, 'sighting-x', 50, SECRET);
    const distance = Math.hypot(snapped.lat - POINT.lat, snapped.lng - POINT.lng);
    expect(distance).toBeGreaterThan(0);
    // 3σ ≈ 1 格，加上吸附到格心：偏移量应在几格以内，而不是几百米
    expect(distance).toBeLessThan(0.003); // ≈ 300m
  });
});

describe('§9.3 ④ k-匿名（T12）', () => {
  it('同格内仅 1 人上报 → 不公开坐标，只给 zoneId', () => {
    const result = fuzzSighting(
      baseRequest({
        zone: { id: 'zone-lawn', fuzzRadiusM: 50, isSensitive: false },
        distinctReportersInCell: 1,
      }),
    );
    expect(result.level).toBe('coarsened');
    expect(result.geo).toBeNull();
    expect(result.zoneId).toBe('zone-lawn');
    expect(result.degradeReason).toBe('k-anonymity');
  });

  it('2 人仍然不足（阈值是 3）', () => {
    expect(fuzzSighting(baseRequest({ distinctReportersInCell: 2 })).level).toBe('coarsened');
    expect(fuzzSighting(baseRequest({ distinctReportersInCell: 3 })).level).toBe('grid');
  });

  it('k 不足时连 zone 都没有 → zoneId 为 null，但依然没有坐标', () => {
    const result = fuzzSighting(baseRequest({ distinctReportersInCell: 1 }));
    expect(result.zoneId).toBeNull();
    expect(result.geo).toBeNull();
  });
});

describe('§9.4 季节性加强（T11）', () => {
  const blackSwan: FuzzSpeciesInput = {
    isProtected: true,
    isNestingSensitive: true,
    nestingMonths: [3, 4, 5, 6],
  };

  it('保护物种 + 繁殖月 → 基准的 4 倍', () => {
    const april = new Date('2026-04-15T10:00:00+08:00');
    expect(effectiveFuzzRadius(blackSwan, { id: 'z', fuzzRadiusM: 50, isSensitive: false }, april)).toBe(200);
  });

  it('保护物种但非繁殖月 → 基准', () => {
    const november = new Date('2026-11-15T10:00:00+08:00');
    expect(effectiveFuzzRadius(blackSwan, { id: 'z', fuzzRadiusM: 50, isSensitive: false }, november)).toBe(50);
  });

  it('区域半径覆盖默认值；无物种时用默认网格', () => {
    const november = new Date('2026-11-15T10:00:00+08:00');
    expect(effectiveFuzzRadius(null, { id: 'z', fuzzRadiusM: 120, isSensitive: false }, november)).toBe(120);
    expect(effectiveFuzzRadius(null, null, november)).toBe(DEFAULT_FUZZ_RADIUS_M);
  });

  it('上海本地月份（UTC+8，无夏令时）：UTC 20:00 已是次日', () => {
    expect(monthInShanghai(new Date('2026-03-31T20:00:00Z'))).toBe(4);
    expect(monthInShanghai(new Date('2026-03-31T10:00:00Z'))).toBe(3);
  });

  it('保护物种 + 繁殖期 → 需要 7 天公开延迟（§9.5）', () => {
    expect(needsNestingDelay(blackSwan, new Date('2026-05-01T00:00:00+08:00'))).toBe(true);
    expect(needsNestingDelay(blackSwan, new Date('2026-05-01T00:00:00+08:00'))).toBe(true);
    expect(needsNestingDelay(blackSwan, new Date('2026-12-01T00:00:00+08:00'))).toBe(false);
    // 仅 isNestingSensitive、非保护物种 → 不加延迟
    expect(
      needsNestingDelay(
        { isProtected: false, isNestingSensitive: true, nestingMonths: [3, 4] },
        new Date('2026-04-01T00:00:00+08:00'),
      ),
    ).toBe(false);
  });
});

describe('§9.5 时间粗化（T13）', () => {
  const at = new Date('2026-10-17T08:30:45.123+08:00');

  it('普通区域普通物种 → 粗化到小时（分秒置 0）', () => {
    expect(fuzzTime(at, 'hour')).toBe('2026-10-17T00:00:00.000Z');
    expect(timeGranularityFor('grid', null, at)).toBe('hour');
  });

  it('敏感区 / k-匿名降级 → 粗化到天', () => {
    expect(fuzzTime(at, 'day')).toBe('2026-10-17T00:00:00.000Z');
    expect(timeGranularityFor('zone-only', null, at)).toBe('day');
    expect(timeGranularityFor('coarsened', null, at)).toBe('day');
  });

  it('保护物种 + 繁殖期 → 粗化到天', () => {
    const april = new Date('2026-04-15T08:30:00+08:00');
    expect(
      timeGranularityFor(
        'grid',
        { isProtected: true, isNestingSensitive: true, nestingMonths: [3, 4, 5, 6] },
        april,
      ),
    ).toBe('day');
  });

  it('粗化结果里的分钟/秒/毫秒恒为 0', () => {
    for (const iso of [fuzzTime(at, 'hour'), fuzzTime(at, 'day')]) {
      expect(new Date(iso).getUTCMinutes()).toBe(0);
      expect(new Date(iso).getUTCSeconds()).toBe(0);
      expect(new Date(iso).getUTCMilliseconds()).toBe(0);
    }
  });
});

describe('§9.7 密钥（T14：缺失即启动失败）', () => {
  it('缺失 / 空串 / 过短 → 抛错', () => {
    expect(() => assertFuzzSecret(undefined)).toThrow(/缺失/);
    expect(() => assertFuzzSecret('')).toThrow(/缺失/);
    expect(() => assertFuzzSecret('   ')).toThrow(/缺失/);
    expect(() => assertFuzzSecret('too-short')).toThrow(/32 字节/);
  });

  it('≥32 字节 → 通过并原样返回', () => {
    expect(assertFuzzSecret(SECRET)).toBe(SECRET);
  });
});

describe('整条流水线的 level 语义', () => {
  it('敏感区优先于 k-匿名（更强的保证先判定）', () => {
    const result = fuzzSighting(
      baseRequest({
        sensitiveAreas: [sensitiveSquareAround(POINT)],
        distinctReportersInCell: 1,
      }),
    );
    expect(result.level).toBe('zone-only');
    expect(result.degradeReason).toBe('sensitive-area');
  });

  it('未降级时公开坐标与 gridCellKey 都在，且半径写进结果', () => {
    const result = fuzzSighting(baseRequest({ zone: { id: 'z', fuzzRadiusM: 80, isSensitive: false } }));
    expect(result.level).toBe('grid');
    expect(result.fuzzRadiusM).toBe(80);
    expect(result.gridCellKey).toBe(gridCellKey(POINT, 80));
    expect(result.publishDelayDays).toBe(0);
  });
});
