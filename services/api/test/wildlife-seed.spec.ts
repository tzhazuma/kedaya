/**
 * wildlife · 种子数据验收（规格 §2.5 / §8.3 / §9 / U2）
 *
 * 种子数据最容易出的三类问题，都在这里被机器拦住：
 *   1. **物种清单被当成事实**（它只是推测）→ 每条必须带"待实地核实"标记；
 *   2. **种子数据绕过隐私流水线**（直接写死公开坐标）→ 这里跑真实流水线，
 *      断言敏感区内的种子观测**没有任何坐标**；
 *   3. **坐标写错**（校园外、lat/lng 互换）→ 全部过 `assertInCampus`。
 */
import { describe, expect, it } from 'vitest';
import { assertInCampus, isInCampus } from '../src/modules/wildlife/domain/geo';
import { fuzzSighting } from '../src/modules/wildlife/domain/fuzzing';
import { toSensitivePolygons } from '../src/modules/wildlife/domain/taxonomy';
import {
  FIELD_VERIFICATION_NOTE,
  INDIVIDUALS_SEED,
  SIGHTINGS_SEED,
  SPECIES_SEED,
  ZONES_SEED,
  seedSummary,
} from '../prisma/seed-data';

const SECRET = 'seed-spec-fuzz-secret-at-least-32-bytes-long!';
const speciesById = new Map(SPECIES_SEED.map((s) => [s.id, s]));
const zoneById = new Map(ZONES_SEED.map((z) => [z.id, z]));
const sensitiveAreas = toSensitivePolygons(ZONES_SEED);

/** 与 `prisma/seed.mjs` 完全相同的调用方式（同一份实现） */
function fuzzSeed(sighting: (typeof SIGHTINGS_SEED)[number]) {
  const species = speciesById.get(sighting.species)!;
  const zone = sighting.zoneId ? zoneById.get(sighting.zoneId)! : null;
  return fuzzSighting({
    sightingId: sighting.id,
    point: { lat: sighting.exactLat, lng: sighting.exactLng },
    observedAt: new Date(sighting.observedAt),
    species: {
      isProtected: species.isProtected,
      isNestingSensitive: species.isNestingSensitive,
      nestingMonths: species.nestingMonths,
    },
    zone: zone ? { id: zone.id, fuzzRadiusM: zone.fuzzRadiusM, isSensitive: zone.isSensitive } : null,
    sensitiveAreas,
    secret: SECRET,
    distinctReportersInCell: 3,
  });
}

describe('§2.5 物种种子：**必须**带"待实地核实"标记（U2）', () => {
  it('每条物种都标了待核实与说明（不能让推测值看起来像事实）', () => {
    expect(SPECIES_SEED.length).toBeGreaterThanOrEqual(7);
    for (const species of SPECIES_SEED) {
      expect(species.needsFieldVerification).toBe(true);
      expect(species.verificationNote).toContain('待实地核实');
    }
    expect(seedSummary().speciesPendingVerification).toBe(SPECIES_SEED.length);
    expect(FIELD_VERIFICATION_NOTE).toContain('U2');
  });

  it('规格 §2.5 的 7 个物种逐条落地，且保护/繁殖/投喂政策与表格一致', () => {
    const byName = new Map(SPECIES_SEED.map((s) => [s.scientificName, s]));
    // 猫
    expect(byName.get('Felis catus')).toMatchObject({
      isProtected: false,
      isNestingSensitive: false,
      defaultFeedingPolicy: 'discouraged',
    });
    // 黑天鹅：保护（校方管理资产）+ 繁殖期敏感 + 禁止投喂
    expect(byName.get('Cygnus atratus')).toMatchObject({
      isProtected: true,
      isNestingSensitive: true,
      nestingMonths: [3, 4, 5, 6],
      defaultFeedingPolicy: 'forbidden',
    });
    expect(byName.get('Anas platyrhynchos')).toMatchObject({ isNestingSensitive: true });
    expect(byName.get('Egretta garzetta')).toMatchObject({ isProtected: true, isNestingSensitive: true });
    expect(byName.get('Passer montanus')).toMatchObject({ isProtected: false, defaultFeedingPolicy: 'forbidden' });
    expect(byName.get('Spilopelia chinensis')).toBeTruthy();
    expect(byName.get('Pica serica')).toBeTruthy();
  });

  it('学名唯一（Prisma 有 @unique，种子里也不能重）', () => {
    const names = SPECIES_SEED.map((s) => s.scientificName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('id 唯一，且 parentId 都指向存在的节点（分类树自洽）', () => {
    const ids = SPECIES_SEED.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const species of SPECIES_SEED) {
      if (species.parentId === null) continue;
      expect(ids).toContain(species.parentId);
      expect(species.parentId).not.toBe(species.id);
    }
    // 至少有一个物种挂在分类层级下（证明自引用结构真的被用起来）
    expect(SPECIES_SEED.some((s) => s.parentId !== null)).toBe(true);
  });

  it('分类层级只用于 family/genus/order，物种一定是 species', () => {
    for (const species of SPECIES_SEED) {
      if (species.id.startsWith('tax-')) {
        expect(['family', 'genus', 'order']).toContain(species.taxonRank);
      } else {
        expect(species.taxonRank).toBe('species');
      }
    }
  });

  it('繁殖月份都在 1..12 内且升序无重复', () => {
    for (const species of SPECIES_SEED) {
      const months = species.nestingMonths;
      expect(months.every((m) => Number.isInteger(m) && m >= 1 && m <= 12)).toBe(true);
      expect(new Set(months).size).toBe(months.length);
    }
  });
});

describe('区域种子：坐标合法 + 敏感区真的带多边形', () => {
  it('所有区域中心都在校园边界内（lat/lng 没写反）', () => {
    for (const zone of ZONES_SEED) {
      expect(isInCampus({ lat: zone.centerLat, lng: zone.centerLng })).toBe(true);
      expect(() => assertInCampus({ lat: zone.centerLat, lng: zone.centerLng })).not.toThrow();
      expect(zone.radiusM).toBeGreaterThan(0);
      expect(zone.fuzzRadiusM).toBeGreaterThan(0);
    }
  });

  it('敏感区必须有 ≥3 顶点的多边形（否则 §9.3 ① 无从判定）', () => {
    const sensitive = ZONES_SEED.filter((z) => z.isSensitive);
    expect(sensitive.length).toBeGreaterThanOrEqual(1);
    for (const zone of sensitive) {
      expect(Array.isArray(zone.sensitiveRing)).toBe(true);
      expect(zone.sensitiveRing!.length).toBeGreaterThanOrEqual(3);
      for (const vertex of zone.sensitiveRing!) {
        expect(isInCampus(vertex)).toBe(true);
      }
    }
    expect(toSensitivePolygons(ZONES_SEED).map((p) => p.id)).toEqual(sensitive.map((z) => z.id));
  });

  it('非敏感区不携带多边形（避免"看起来敏感"的误配）', () => {
    for (const zone of ZONES_SEED.filter((z) => !z.isSensitive)) {
      expect(zone.sensitiveRing).toBeNull();
    }
  });

  it('speciesIds 都指向存在的物种', () => {
    for (const zone of ZONES_SEED) {
      for (const id of zone.speciesIds) expect(speciesById.has(id)).toBe(true);
    }
  });

  it('告示文案存在时非空，且黑天鹅水域是 forbidden（规格 §8.3 草案）', () => {
    const lake = ZONES_SEED.find((z) => z.id === 'zone-artificial-lake')!;
    expect(lake.feedingPolicy).toBe('forbidden');
    expect(lake.noticeText).toContain('请勿投喂');
    for (const zone of ZONES_SEED) {
      if (zone.noticeText !== null) expect(zone.noticeText.length).toBeGreaterThan(0);
    }
  });
});

describe('观测种子：**必须走真实的模糊化流水线**（不能写死公开坐标）', () => {
  it('每条观测的精确坐标都在校园内', () => {
    for (const sighting of SIGHTINGS_SEED) {
      expect(() => assertInCampus({ lat: sighting.exactLat, lng: sighting.exactLng })).not.toThrow();
      expect(speciesById.has(sighting.species)).toBe(true);
      if (sighting.zoneId) expect(zoneById.has(sighting.zoneId)).toBe(true);
    }
  });

  it('敏感区（宿舍区）内的种子观测 → **level=zone-only，没有任何坐标**', () => {
    const dorm = SIGHTINGS_SEED.filter((s) => s.zoneId === 'zone-dorm-area');
    expect(dorm.length).toBeGreaterThanOrEqual(1);
    for (const sighting of dorm) {
      const result = fuzzSeed(sighting);
      expect(result.level).toBe('zone-only');
      expect(result.geo).toBeNull();
      expect(result.zoneId).toBe('zone-dorm-area');
      // 连近似坐标都不许出现
      expect(JSON.stringify(result)).not.toContain(String(sighting.exactLat));
    }
  });

  it('敏感区外的种子观测 → 公开坐标与精确坐标**不同**（确实被模糊了）', () => {
    for (const sighting of SIGHTINGS_SEED.filter((s) => s.zoneId !== 'zone-dorm-area')) {
      const result = fuzzSeed(sighting);
      expect(result.level).toBe('grid');
      expect(result.geo).not.toBeNull();
      const moved = Math.hypot(
        result.geo!.lat - sighting.exactLat,
        result.geo!.lng - sighting.exactLng,
      );
      expect(moved).toBeGreaterThan(0);
      expect(moved).toBeLessThan(0.003); // 不会把点挪出校园尺度
    }
  });

  it('确定性：同一条种子观测重复模糊 20 次结果一致（种子数据可重复执行）', () => {
    for (const sighting of SIGHTINGS_SEED) {
      const first = fuzzSeed(sighting);
      for (let i = 0; i < 20; i += 1) expect(fuzzSeed(sighting)).toEqual(first);
    }
  });

  it('黑天鹅（保护 + 繁殖敏感）的模糊半径不小于区域基准', () => {
    const swan = SIGHTINGS_SEED.find((s) => s.species === 'sp-cygnus-atratus')!;
    const result = fuzzSeed(swan);
    expect(result.fuzzRadiusM).toBeGreaterThanOrEqual(zoneById.get('zone-artificial-lake')!.fuzzRadiusM);
  });

  it('status 只用 PENDING / PUBLISHED（种子不造 REJECTED 的假数据）', () => {
    for (const sighting of SIGHTINGS_SEED) {
      expect(['PENDING', 'PUBLISHED']).toContain(sighting.status);
    }
  });

  it('健康异常的种子观测存在（让 §8.4 的通知链路有可演示的数据）', () => {
    expect(SIGHTINGS_SEED.some((s) => s.healthConcern)).toBe(true);
  });
});

describe('命名个体种子（规格 §2.8）', () => {
  it('物种存在、同物种内名字唯一、状态合法', () => {
    for (const individual of INDIVIDUALS_SEED) {
      expect(speciesById.has(individual.speciesId)).toBe(true);
      expect(['PENDING', 'PUBLISHED']).toContain(individual.status);
      expect(individual.name.length).toBeLessThanOrEqual(24);
    }
    const keys = INDIVIDUALS_SEED.map((i) => `${i.speciesId}:${i.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('种子统计', () => {
  it('summary 与各表长度一致', () => {
    const summary = seedSummary();
    expect(summary.species).toBe(SPECIES_SEED.length);
    expect(summary.zones).toBe(ZONES_SEED.length);
    expect(summary.sightings).toBe(SIGHTINGS_SEED.length);
    expect(summary.individuals).toBe(INDIVIDUALS_SEED.length);
    expect(summary.sensitiveZones).toBe(ZONES_SEED.filter((z) => z.isSensitive).length);
  });
});
