/**
 * wildlife 领域模型测试（规格 §2 / §5 / §6 / §8 / §9 的纯逻辑部分）。
 *
 * 覆盖的**硬要求**：
 * - 伦理守则 ≤5 条且每条 ≤20 字（规格 §8.2）；
 * - 置信度 < 0.60 **不预选**（验收 T44）；
 * - 保护物种 + 繁殖月 → 模糊半径 ×4（验收 T11）；
 * - 上报校验：伦理未勾选 / 时间越界 / 坐标出校园 / 照片超限（规格 §10.3）；
 * - 敏感区 / k-匿名不足的记录**不落点**（`sightingToMarker` 返回 null）；
 * - 审核队列疑似受伤优先；保护物种需要第二名审核员（规格 §2.10）。
 */
import { describe, expect, it } from 'vitest';

import { BASEMAP_PLACEHOLDER_NOTICE, WILDLIFE_BASEMAP } from '@/domain/models/wildlife/basemap';
import {
  ETHICS_ACK_LABEL,
  ETHICS_RULES,
  HEALTH_CONCERN_NOTICE,
  NO_ACCURACY_CLAIM_NOTICE,
  PRIVACY_FUZZ_NOTICE,
  SPOT_REALTIME_NOTICE,
} from '@/domain/models/wildlife/ethics';
import {
  INFERRED_TRACK_LABEL,
  K_ANONYMITY_MIN_REPORTERS,
  TRACK_FALLBACK_DISCLAIMER,
  isTrackDistanceConsistent,
  peakHoursLabel,
  spotMeetsKAnonymity,
  spotReporterNotice,
  trackSummaryLabel,
  validateIndividualName,
  type WildlifeTrack,
} from '@/domain/models/wildlife/tracks';
import {
  CLASSIFIER_MIN_CONFIDENCE,
  FEEDING_POLICY_COPY,
  FEEDING_POLICY_LABELS,
  FEEDING_POLICY_TONES,
  circleContainsPoint,
  classifySuggestion,
  effectiveFuzzRadiusM,
  forbiddenZoneWarning,
  isNestingSeason,
  monthInShanghai,
  seasonalFuzzMultiplier,
  speciesDisplayName,
  strictestFeedingPolicy,
  toSpeciesOption,
  type SpeciesTaxonomy,
  type WildlifeZone,
} from '@/domain/models/wildlife/species';
import {
  GEO_WITHHELD_LABELS,
  SIGHTING_LIMITS,
  countByStatus,
  createEmptySightingDraft,
  filterSightings,
  geoDisplayNotice,
  moderationPrecondition,
  reporterDisplayLabel,
  sightingStatusLabel,
  sortModerationQueue,
  sortSightingsByObservedDesc,
  toCreateSightingInput,
  validateSightingDraft,
  type SightingDraft,
  type WildlifeSighting,
} from '@/domain/models/wildlife/sightings';
import {
  radiusMetersToPixels,
  sightingToMarker,
  spotToOverlay,
  toPercentPosition,
  toSvgPolylinePoints,
  trackToOverlay,
  zoneToOverlay,
} from '@/domain/models/wildlife/geometry';

const NOW = new Date('2026-10-17T04:00:00.000Z');

const CAT: SpeciesTaxonomy = {
  id: 'sp-cat',
  scientificName: 'Felis catus',
  commonNameZh: '猫（家猫/流浪猫）',
  taxonRank: 'species',
  isProtected: false,
  isNestingSensitive: false,
  nestingMonths: [],
  defaultFeedingPolicy: 'discouraged',
  externalIds: {},
  isActive: true,
};

const SWAN: SpeciesTaxonomy = {
  id: 'sp-swan',
  scientificName: 'Cygnus atratus',
  commonNameZh: '黑天鹅',
  taxonRank: 'species',
  isProtected: true,
  isNestingSensitive: true,
  nestingMonths: [3, 4, 5, 6],
  defaultFeedingPolicy: 'forbidden',
  externalIds: {},
  isActive: true,
};

const DUCK: SpeciesTaxonomy = {
  ...CAT,
  id: 'sp-duck',
  commonNameZh: '绿头鸭',
  isNestingSensitive: true,
  nestingMonths: [3, 4, 5, 6],
  defaultFeedingPolicy: 'discouraged',
};

const LAKE_ZONE: WildlifeZone = {
  id: 'wz-lake',
  name: '人工湖',
  speciesIds: ['sp-swan'],
  geo: { lat: 31.177703, lng: 121.59205, radiusM: 120 },
  feedingPolicy: 'forbidden',
  fuzzRadiusM: 50,
  isSensitive: false,
  noticeText: '请勿投喂黑天鹅。',
  sortOrder: 20,
};

const DORM_ZONE: WildlifeZone = {
  ...LAKE_ZONE,
  id: 'wz-dorm',
  name: '宿舍区西侧',
  feedingPolicy: 'discouraged',
  fuzzRadiusM: 200,
  isSensitive: true,
  noticeText: null,
};

function sighting(overrides: Partial<WildlifeSighting> = {}): WildlifeSighting {
  return {
    id: 'ws-1',
    zoneId: 'wz-lake',
    species: 'sp-swan',
    speciesNameZh: '黑天鹅',
    status: 'PUBLISHED',
    geo: { lat: 31.1778, lng: 121.592 },
    geoWithheld: null,
    observedAt: '2026-10-17T00:30:00.000Z',
    observedAtFuzzed: '2026-10-17T00:00:00.000Z',
    classifiedBy: 'manual',
    isAnonymous: false,
    reporterLabel: '鸭鸭先冲',
    photoUrls: [],
    healthConcern: false,
    createdAt: '2026-10-17T01:00:00.000Z',
    ...overrides,
  };
}

describe('投喂政策（规格 §8.1 E1/E2）', () => {
  it('三值枚举各有中文标签与语义色调', () => {
    expect(Object.keys(FEEDING_POLICY_LABELS)).toEqual(['allowed', 'discouraged', 'forbidden']);
    expect(FEEDING_POLICY_LABELS.forbidden).toBe('禁止投喂');
    expect(FEEDING_POLICY_TONES.forbidden).toBe('danger');
    expect(FEEDING_POLICY_COPY.forbidden).toContain('禁止投喂');
  });

  it('区域政策与物种默认政策取较严者（E1 与 E2 同时生效）', () => {
    expect(strictestFeedingPolicy('allowed', 'discouraged')).toBe('discouraged');
    expect(strictestFeedingPolicy('forbidden', 'allowed')).toBe('forbidden');
    expect(strictestFeedingPolicy('discouraged', 'forbidden')).toBe('forbidden');
    expect(strictestFeedingPolicy('allowed', 'allowed')).toBe('allowed');
  });

  it('禁投喂警告条带区域名与物种名', () => {
    expect(forbiddenZoneWarning('人工湖', '黑天鹅')).toContain('人工湖');
    expect(forbiddenZoneWarning('人工湖', '黑天鹅')).toContain('黑天鹅');
    expect(forbiddenZoneWarning('人工湖')).toContain('禁止投喂');
  });
});

describe('物种与季节性加强模糊（规格 §9.4 / 验收 T11）', () => {
  it('保护物种 + 繁殖月 → ×4；仅繁殖敏感 → ×2；其余 ×1', () => {
    const may = new Date('2026-05-10T04:00:00.000Z');
    const october = new Date('2026-10-17T04:00:00.000Z');
    expect(seasonalFuzzMultiplier(SWAN, may)).toBe(4);
    expect(seasonalFuzzMultiplier(SWAN, october)).toBe(1);
    expect(seasonalFuzzMultiplier(DUCK, may)).toBe(2);
    expect(seasonalFuzzMultiplier(DUCK, october)).toBe(1);
    expect(seasonalFuzzMultiplier(CAT, may)).toBe(1);
  });

  it('effectiveFuzzRadiusM 把基准半径放大（50 m → 200 m）', () => {
    const may = new Date('2026-05-10T04:00:00.000Z');
    expect(effectiveFuzzRadiusM(50, SWAN, may)).toBe(200);
    expect(effectiveFuzzRadiusM(50, SWAN, new Date('2026-10-17T04:00:00.000Z'))).toBe(50);
    expect(effectiveFuzzRadiusM(50, null, may)).toBe(50);
  });

  it('繁殖期判定用**上海本地月份**（UTC+8），不是 UTC 月', () => {
    // UTC 2026-03-31T17:00Z = 上海 2026-04-01 01:00 → 属于 4 月（繁殖月）
    const boundary = new Date('2026-03-31T17:00:00.000Z');
    expect(monthInShanghai(boundary)).toBe(4);
    expect(isNestingSeason(SWAN, boundary)).toBe(true);
  });

  it('物种展示名优先中文名，缺失时退回学名而不是空串', () => {
    expect(speciesDisplayName([CAT, SWAN], 'sp-swan')).toBe('黑天鹅');
    expect(speciesDisplayName([CAT], 'sp-unknown')).toBe('未知物种');
    expect(speciesDisplayName([{ ...CAT, commonNameZh: '' }], 'sp-cat')).toBe('Felis catus');
  });

  it('物种选项带保护动物角标', () => {
    expect(toSpeciesOption(SWAN).protectedLabel).toBe('保护动物');
    expect(toSpeciesOption(CAT).protectedLabel).toBeUndefined();
  });

  it('圆形区域包含判定（校园尺度平面近似）', () => {
    expect(circleContainsPoint(LAKE_ZONE.geo, { lat: 31.1777, lng: 121.592 })).toBe(true);
    expect(circleContainsPoint(LAKE_ZONE.geo, { lat: 31.185, lng: 121.6 })).toBe(false);
  });
});

describe('置信度分档与预选（规格 §5.5 / 验收 T44）', () => {
  it('≥0.85 预选且"很确定"；0.60–0.85 预选但提示确认', () => {
    const high = classifySuggestion('sp-swan', 0.92, '黑天鹅');
    expect(high.preselected).toBe(true);
    expect(high.band).toBe('high');
    expect(high.label).toContain('很确定');

    const medium = classifySuggestion('sp-swan', 0.7, '黑天鹅');
    expect(medium.preselected).toBe(true);
    expect(medium.band).toBe('medium');
    expect(medium.label).toContain('请确认');
  });

  it('<0.60 **不预选**（禁止把"可能是"当成"就是"）', () => {
    const low = classifySuggestion('sp-swan', CLASSIFIER_MIN_CONFIDENCE - 0.01, '黑天鹅');
    expect(low.preselected).toBe(false);
    expect(low.band).toBe('low');
    expect(low.label).toContain('无法确定');
  });
});

describe('伦理与隐私文案（规格 §8.2 / §9）', () => {
  it('伦理守则恰好 ≤5 条，且每条 ≤20 字', () => {
    expect(ETHICS_RULES.length).toBeLessThanOrEqual(5);
    expect(ETHICS_RULES.length).toBeGreaterThanOrEqual(3);
    for (const rule of ETHICS_RULES) {
      expect(rule.text.length).toBeLessThanOrEqual(20);
      expect(rule.text.trim()).not.toBe('');
      expect(rule.id).toMatch(/^E\d+$/);
    }
  });

  it('勾选框文案明确"不是同意门"（否则会被误实现为授权状态）', () => {
    expect(ETHICS_ACK_LABEL).toContain('我已阅读');
    expect(INFERRED_TRACK_LABEL).toBe('推断轨迹，非实测路径');
  });

  it('隐私文案诚实说明强度（不声称"完全匿名"）', () => {
    expect(PRIVACY_FUZZ_NOTICE).toContain('完全匿名');
    expect(PRIVACY_FUZZ_NOTICE).toContain('片区');
    expect(NO_ACCURACY_CLAIM_NOTICE).toContain('没有实测数据');
    expect(SPOT_REALTIME_NOTICE).toContain('历史聚合');
    expect(HEALTH_CONCERN_NOTICE).toContain('社团');
  });
});

describe('上报校验（规格 §10.3）', () => {
  const validDraft = (): SightingDraft => ({
    ...createEmptySightingDraft(NOW),
    speciesId: 'sp-cat',
    observedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    geo: { lat: 31.1795, lng: 121.591 },
    ethicsAcknowledged: true,
  });

  it('完整草稿通过校验，并能转成请求体', () => {
    const draft = validDraft();
    const validation = validateSightingDraft(draft, NOW, { knownSpeciesIds: ['sp-cat'] });
    expect(validation.ok).toBe(true);
    expect(validation.problems).toEqual([]);

    const input = toCreateSightingInput(draft, NOW, { knownSpeciesIds: ['sp-cat'] });
    expect(input.ok).toBe(true);
    if (input.ok) {
      expect(input.value.ethicsAcknowledged).toBe(true);
      expect(input.value.species).toBe('sp-cat');
      expect(input.value.note).toBeNull();
    }
  });

  it('未勾选伦理守则 → ETHICS_NOT_ACKNOWLEDGED（**只影响本次提交**）', () => {
    const draft = { ...validDraft(), ethicsAcknowledged: false };
    const validation = validateSightingDraft(draft, NOW);
    expect(validation.ok).toBe(false);
    expect(validation.problems.map((p) => p.reason)).toContain('ETHICS_NOT_ACKNOWLEDGED');
  });

  it('未选物种 / 未知物种 → UNKNOWN_SPECIES', () => {
    expect(validateSightingDraft({ ...validDraft(), speciesId: '' }, NOW).problems[0]?.reason).toBe(
      'UNKNOWN_SPECIES',
    );
    expect(
      validateSightingDraft({ ...validDraft(), speciesId: 'sp-x' }, NOW, { knownSpeciesIds: ['sp-cat'] })
        .problems[0]?.reason,
    ).toBe('UNKNOWN_SPECIES');
  });

  it('发现时间超过 30 天前、或晚于当前时间 5 分钟以上 → OBSERVED_AT_OUT_OF_RANGE', () => {
    const tooOld = {
      ...validDraft(),
      observedAt: new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString(),
    };
    expect(validateSightingDraft(tooOld, NOW).problems.map((p) => p.reason)).toContain(
      'OBSERVED_AT_OUT_OF_RANGE',
    );
    const future = {
      ...validDraft(),
      observedAt: new Date(NOW.getTime() + 30 * 60 * 1000).toISOString(),
    };
    expect(validateSightingDraft(future, NOW).problems.map((p) => p.reason)).toContain(
      'OBSERVED_AT_OUT_OF_RANGE',
    );
    // 5 分钟内的时钟漂移被容忍
    const drift = { ...validDraft(), observedAt: new Date(NOW.getTime() + 2 * 60 * 1000).toISOString() };
    expect(validateSightingDraft(drift, NOW).ok).toBe(true);
  });

  it('未点选地点 → GEO_REQUIRED；校园外 → COORDINATE_OUT_OF_CAMPUS', () => {
    expect(validateSightingDraft({ ...validDraft(), geo: null }, NOW).problems.map((p) => p.reason)).toContain(
      'GEO_REQUIRED',
    );
    expect(
      validateSightingDraft({ ...validDraft(), geo: { lat: 121.591, lng: 31.1795 } }, NOW).problems.map(
        (p) => p.reason,
      ),
    ).toContain('COORDINATE_OUT_OF_CAMPUS');
  });

  it('照片超过 3 张 → MEDIA_TOO_MANY；备注超 200 字 → NOTE_TOO_LONG', () => {
    const manyPhotos = { ...validDraft(), mediaIds: ['a', 'b', 'c', 'd'] };
    expect(validateSightingDraft(manyPhotos, NOW).problems.map((p) => p.reason)).toContain('MEDIA_TOO_MANY');
    const longNote = { ...validDraft(), note: 'x'.repeat(SIGHTING_LIMITS.noteMax + 1) };
    expect(validateSightingDraft(longNote, NOW).problems.map((p) => p.reason)).toContain('NOTE_TOO_LONG');
  });

  it('疑似受伤与自动分类会产生非阻塞提醒（不阻塞提交）', () => {
    const validation = validateSightingDraft(
      { ...validDraft(), healthConcern: true, classifiedBy: 'vision_api' },
      NOW,
    );
    expect(validation.ok).toBe(true);
    expect(validation.hints.join('|')).toContain('请勿自行处理');
    expect(validation.hints.join('|')).toContain('仅供参考');
  });

  it('校验未通过时 toCreateSightingInput 返回 VALIDATION_FAILED（不构造请求体）', () => {
    const result = toCreateSightingInput({ ...validDraft(), ethicsAcknowledged: false }, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect((result.error.details as { reasons: string[] }).reasons).toContain(
        'ETHICS_NOT_ACKNOWLEDGED',
      );
    }
  });
});

describe('隐私展示与筛选（规格 §9.3 / §9.6）', () => {
  it('坐标被扣留时给出原因说明，正常时说明"已模糊化"', () => {
    expect(geoDisplayNotice(sighting())).toContain('已模糊化');
    const withheld = sighting({ geo: null, geoWithheld: 'sensitive-zone' });
    expect(geoDisplayNotice(withheld, '宿舍区西侧')).toContain('敏感区');
    expect(geoDisplayNotice(withheld, '宿舍区西侧')).toContain('宿舍区西侧');
    expect(GEO_WITHHELD_LABELS['k-anonymity']).toContain('3 人');
  });

  it('匿名上报显示为「匿名同学」，且不出现上报人标识', () => {
    expect(reporterDisplayLabel(sighting({ isAnonymous: true, reporterLabel: 'u_1024' }))).toBe('匿名同学');
    expect(reporterDisplayLabel(sighting())).toBe('鸭鸭先冲');
  });

  it('状态标签与状态统计', () => {
    expect(sightingStatusLabel('PENDING')).toBe('待审核');
    expect(
      countByStatus([sighting(), sighting({ id: 'b', status: 'PENDING' }), sighting({ id: 'c', status: 'REJECTED' })]),
    ).toEqual({ PENDING: 1, PUBLISHED: 1, REJECTED: 1 });
  });

  it('筛选与排序：按物种 / 区域 / 状态 / 疑似受伤；发现时间倒序', () => {
    const items = [
      sighting({ id: 'a', species: 'sp-cat', zoneId: 'wz-1', observedAt: '2026-10-15T00:00:00.000Z' }),
      sighting({ id: 'b', species: 'sp-swan', zoneId: 'wz-2', observedAt: '2026-10-16T00:00:00.000Z' }),
      sighting({ id: 'c', species: 'sp-swan', zoneId: 'wz-2', healthConcern: true, observedAt: '2026-10-14T00:00:00.000Z' }),
    ];
    expect(filterSightings(items, { species: 'sp-swan' }).map((s) => s.id)).toEqual(['b', 'c']);
    expect(filterSightings(items, { zoneId: 'wz-1' }).map((s) => s.id)).toEqual(['a']);
    expect(filterSightings(items, { healthConcernOnly: true }).map((s) => s.id)).toEqual(['c']);
    expect(sortSightingsByObservedDesc(items).map((s) => s.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('审核规则（规格 §2.10）', () => {
  it('保护物种需要第二名审核员；同一人不能二次确认', () => {
    const pending = sighting({ status: 'PENDING' });
    const first = moderationPrecondition(pending, SWAN, 'u_admin_01');
    expect(first.allowed).toBe(true);
    expect(first.requiresSecondModerator).toBe(true);

    const afterFirstVote = sighting({ status: 'PENDING', moderatedBy: 'u_admin_01' });
    expect(moderationPrecondition(afterFirstVote, SWAN, 'u_admin_02').allowed).toBe(true);
    const samePerson = moderationPrecondition(
      sighting({ status: 'PUBLISHED', moderatedBy: 'u_admin_01' }),
      SWAN,
      'u_admin_01',
    );
    expect(samePerson.allowed).toBe(false);
  });

  it('非保护物种不需要双人复核', () => {
    expect(moderationPrecondition(sighting({ status: 'PENDING' }), CAT, 'u_admin_01').requiresSecondModerator).toBe(
      false,
    );
  });

  it('已拒绝的记录不可再次审核', () => {
    expect(moderationPrecondition(sighting({ status: 'REJECTED' }), CAT, 'u_admin_01').allowed).toBe(false);
  });

  it('审核队列：疑似受伤优先，其次上报时间倒序', () => {
    const queue = sortModerationQueue([
      sighting({ id: 'a', healthConcern: false, createdAt: '2026-10-17T03:00:00.000Z' }),
      sighting({ id: 'b', healthConcern: true, createdAt: '2026-10-17T01:00:00.000Z' }),
      sighting({ id: 'c', healthConcern: false, createdAt: '2026-10-17T02:00:00.000Z' }),
    ]);
    expect(queue.map((s) => s.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('热点与推断轨迹（规格 §2.3 / §2.4 / §6）', () => {
  const track: WildlifeTrack = {
    id: 'wt-1',
    speciesId: 'sp-swan',
    speciesNameZh: '黑天鹅',
    spotIds: ['wsp-1'],
    path: {
      type: 'LineString',
      coordinates: [
        [121.591945, 31.177838],
        [121.592207, 31.177596],
      ],
    },
    totalDistanceM: 37,
    spanStartAt: '2026-10-01T00:00:00.000Z',
    spanEndAt: '2026-10-10T00:00:00.000Z',
    sightingCount: 31,
    method: 'dbscan-chain',
    confidence: 0.58,
    isInferred: true,
    disclaimer: '本轨迹由 31 次同学上报推断得出，并非实测运动路径。',
    computedAt: '2026-10-16T03:00:00.000Z',
  };

  it('轨迹文案永远带"推断"（禁止写成"这只动物的路线"）', () => {
    expect(INFERRED_TRACK_LABEL).toBe('推断轨迹，非实测路径');
    expect(trackSummaryLabel(track)).toBe('基于 31 次上报推断的活动范围');
    expect(TRACK_FALLBACK_DISCLAIMER).toContain('并非实测运动路径');
  });

  it('折线长度与 totalDistanceM 的一致性检查（差异 > 20% 视为可疑）', () => {
    expect(isTrackDistanceConsistent(track)).toBe(true);
    expect(isTrackDistanceConsistent({ ...track, totalDistanceM: 500 })).toBe(false);
  });

  it('k-匿名：不足 3 位不同上报人的热点不满足公开条件', () => {
    expect(K_ANONYMITY_MIN_REPORTERS).toBe(3);
    expect(spotMeetsKAnonymity({ distinctReporters: 2 })).toBe(false);
    expect(spotMeetsKAnonymity({ distinctReporters: 3 })).toBe(true);
  });

  it('热点文案强调"人数"而不是"次数"（反作弊）', () => {
    expect(spotReporterNotice({ sightingCount: 10, distinctReporters: 1 })).toContain('1 位不同同学');
    expect(spotReporterNotice({ sightingCount: 10, distinctReporters: 1 })).toContain('只计 1 次');
  });

  it('高峰时段从 24 桶直方图取前 N（数据不足时明确说"数据不足"）', () => {
    const histogram = Array.from({ length: 24 }, () => 0);
    histogram[8] = 5;
    histogram[9] = 8;
    histogram[17] = 3;
    expect(peakHoursLabel(histogram, 2)).toBe('常见出没时段：09:00、08:00');
    expect(peakHoursLabel(Array.from({ length: 24 }, () => 0))).toBe('出没时段数据不足');
    expect(peakHoursLabel([1, 2])).toBe('出没时段数据不足');
  });

  it('个体名校验：非空且 ≤24 字', () => {
    expect(validateIndividualName('')).toContain('个体名不能为空');
    expect(validateIndividualName('x'.repeat(25))).toHaveLength(1);
    expect(validateIndividualName('大橘')).toEqual([]);
  });
});

describe('叠加层几何（像素空间）', () => {
  it('区域半径按 1 m ≈ 1 px 换算', () => {
    const px = radiusMetersToPixels(100);
    expect(px).toBeGreaterThan(95);
    expect(px).toBeLessThan(105);
    const overlay = zoneToOverlay(LAKE_ZONE);
    expect(overlay.radiusPx).toBeCloseTo(LAKE_ZONE.geo.radiusM, 0);
    expect(overlay.feedingPolicy).toBe('forbidden');
  });

  it('**坐标被扣留的观测不落点**（敏感区 / k-匿名不足 → sightingToMarker 返回 null）', () => {
    expect(sightingToMarker(sighting())).not.toBeNull();
    expect(sightingToMarker(sighting({ geo: null, geoWithheld: 'sensitive-zone' }))).toBeNull();
    expect(sightingToMarker(sighting({ geo: null, geoWithheld: 'k-anonymity' }))).toBeNull();
  });

  it('轨迹折线转成像素点串；坐标点按 [lng, lat] 解析', () => {
    const overlay = trackToOverlay({
      id: 'wt-1',
      speciesId: 'sp-swan',
      speciesNameZh: '黑天鹅',
      spotIds: [],
      path: {
        type: 'LineString',
        coordinates: [
          [121.591945, 31.177838],
          [121.592207, 31.177596],
        ],
      },
      totalDistanceM: 40,
      spanStartAt: '2026-10-01T00:00:00.000Z',
      spanEndAt: '2026-10-02T00:00:00.000Z',
      sightingCount: 5,
      method: 'dbscan-chain',
      confidence: 0.5,
      isInferred: true,
      disclaimer: '推断',
      computedAt: '2026-10-16T03:00:00.000Z',
    });
    expect(overlay.points).toHaveLength(2);
    expect(overlay.isInferred).toBe(true);
    expect(toSvgPolylinePoints(overlay.points)).toMatch(/^[\d.,-]+ [\d.,-]+$/);
  });

  it('热点叠加层标记为"历史聚合"且半径与置信度可读', () => {
    const overlay = spotToOverlay({
      id: 'wsp-1',
      speciesId: 'sp-swan',
      speciesNameZh: '黑天鹅',
      centroid: { lat: 31.177703, lng: 121.59205 },
      radiusM: 50,
      sightingCount: 24,
      distinctReporters: 9,
      firstSeenAt: '2026-10-01T00:00:00.000Z',
      lastSeenAt: '2026-10-15T00:00:00.000Z',
      hourHistogram: Array.from({ length: 24 }, () => 0),
      confidence: 0.72,
      computedAt: '2026-10-16T03:00:00.000Z',
      isAggregated: true,
      aggregationDelayHours: 24,
    });
    expect(overlay.aggregated).toBe(true);
    expect(overlay.kAnonymous).toBe(true);
    expect(Number.isFinite(overlay.center.px)).toBe(true);
    expect(Number.isFinite(overlay.center.py)).toBe(true);
  });

  it('百分比定位与底图尺寸一致', () => {
    expect(toPercentPosition({ px: 600, py: 400 })).toEqual({ left: '50%', top: '50%' });
    expect(toPercentPosition({ px: 0, py: 800 })).toEqual({ left: '0%', top: '100%' });
    expect(WILDLIFE_BASEMAP.widthPx).toBe(1200);
    expect(BASEMAP_PLACEHOLDER_NOTICE).toContain('占位底图');
  });
});
