import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CAMPUS_POI_BOUNDS,
  CAMPUS_POI_CATEGORIES,
  CAMPUS_POI_CATEGORY_LABELS,
  CAMPUS_POI_CATEGORY_TONES,
  CAMPUS_POI_NEGATIVE_FLOOR_CATEGORIES,
  CAMPUS_POI_PHOTO_POLICY,
  CAMPUS_POI_SOURCES,
  createPoiDraft,
  findPoiSlotConflicts,
  findPoiSlotsAt,
  importPoiSupplement,
  isPoiWithinCampusBounds,
  nextSlotAt,
  poiToMapMarker,
  validatePoiSupplement,
  type CampusPoiCategory,
  type CampusPoiSupplement,
  type PoiTimeSlot,
} from './campus-poi';
import { CAMPUS_POI_BOUNDS as BOUNDS_FROM_INDEX } from './index';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const POI_SNAPSHOT = join(REPO_ROOT, 'apps', 'web', 'public', 'map', 'campus-poi.json');

/**
 * ⚠️ 以下全部是**演示数据，不是真实采集**。
 *
 * 坐标只是校园 WGS84 范围内的随手取点，**不对应任何真实的快递站 / 车库 /
 * 食堂 / 活动场地 / 自习室位置**；名称里的「示意」「演示」也是这个意思。
 * 照片 URL 使用 `.invalid` 保留域名，永远不会解析到真实图片，
 * 仅用于验证「有照片必须署名」这条规则。
 *
 * 真实数据只能来自 OSM、校方公开资料，或管理员/用户自己录入并声明授权的照片。
 */
const DEMO_POIS: readonly CampusPoiSupplement[] = [
  {
    id: 'demo-express-01',
    category: 'express-station',
    name: '示意快递站（演示数据）',
    lat: 31.1789,
    lng: 121.5902,
    floor: null,
    description: '演示数据，不是真实采集：不对应任何真实快递站。',
    openingHours: '09:00-20:00',
    photoUrls: [],
    photoCredit: null,
    verifiedAt: null,
    source: 'community',
  },
  {
    id: 'demo-garage-01',
    category: 'parking-garage',
    name: '示意地下车库（演示数据）',
    lat: 31.1802,
    lng: 121.5921,
    floor: -1,
    description: '演示数据，不是真实采集：不对应任何真实车库入口。',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: null,
    source: 'unknown',
  },
  {
    id: 'demo-canteen-01',
    category: 'canteen-menu',
    name: '示意食堂菜单点（演示数据）',
    lat: 31.1778,
    lng: 121.5932,
    floor: 1,
    description: '演示数据，不是真实采集：菜单应来自 canteen 菜品库，不靠照片。',
    openingHours: '11:00-13:30, 17:00-19:30',
    photoUrls: [],
    photoCredit: null,
    verifiedAt: null,
    source: 'community',
  },
  {
    id: 'demo-event-01',
    category: 'event-venue',
    name: '示意活动场地（演示数据）',
    lat: 31.1795,
    lng: 121.5898,
    floor: null,
    description: '演示数据，不是真实采集：不对应任何真实活动场地。',
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: null,
    source: 'official',
  },
  {
    id: 'demo-study-01',
    category: 'study-space',
    name: '示意自习空间（演示数据）',
    lat: 31.1769,
    lng: 121.5917,
    floor: 3,
    description: '演示数据，不是真实采集：照片仅用于验证署名规则。',
    openingHours: '08:00-22:00',
    photoUrls: ['https://example.invalid/demo/study-space.jpg'],
    photoCredit: '演示拍摄者（授权示例）',
    verifiedAt: '2026-10-18T00:00:00+08:00',
    source: 'official',
  },
];

function demo(category: CampusPoiCategory): CampusPoiSupplement {
  const poi = DEMO_POIS.find((candidate) => candidate.category === category);
  if (poi === undefined) throw new Error(`演示数据缺少分类：${category}`);
  return poi;
}

const STUDY = demo('study-space');
const EVENT = demo('event-venue');
const GARAGE = demo('parking-garage');

/**
 * 演示时间轴（2026-10-19 周一）。同样**不是真实课表**。
 * 左闭右开：09:00–10:30 的课与 10:30 开始的日程是「相邻」而不是冲突。
 */
const DEMO_SLOTS: readonly PoiTimeSlot[] = [
  {
    poiId: STUDY.id,
    startsAt: '2026-10-19T09:00:00+08:00',
    endsAt: '2026-10-19T10:30:00+08:00',
    kind: 'course',
    title: '演示课：高等数学',
    sourceRef: 'course-demo-001',
  },
  {
    poiId: STUDY.id,
    startsAt: '2026-10-19T10:30:00+08:00',
    endsAt: '2026-10-19T12:00:00+08:00',
    kind: 'personal',
    title: '演示日程：自习',
    sourceRef: null,
  },
  {
    poiId: EVENT.id,
    startsAt: '2026-10-19T14:00:00+08:00',
    endsAt: '2026-10-19T16:00:00+08:00',
    kind: 'event',
    title: '演示活动：社团招新',
    sourceRef: 'event-demo-001',
  },
  {
    poiId: STUDY.id,
    startsAt: '2026-10-20T09:00:00+08:00',
    endsAt: '2026-10-20T11:00:00+08:00',
    kind: 'exam',
    title: '演示考试：期中',
    sourceRef: 'exam-demo-001',
  },
];

/* ------------------------------------------------------------------ *
 * 形状 / 分类 / 边界
 * ------------------------------------------------------------------ */

describe('campus POI 补充层：形状与分类', () => {
  it('冻结六个分类与四个来源', () => {
    expect(CAMPUS_POI_CATEGORIES).toEqual([
      'express-station',
      'parking-garage',
      'canteen-menu',
      'event-venue',
      'study-space',
      'other',
    ]);
    expect(CAMPUS_POI_SOURCES).toEqual(['osm', 'official', 'community', 'unknown']);
  });

  it('每个分类都有中文名和语义色调，且色调不是硬编码色值', () => {
    const allowedTones = ['neutral', 'brand', 'info', 'success', 'warning', 'danger'];
    for (const category of CAMPUS_POI_CATEGORIES) {
      expect(CAMPUS_POI_CATEGORY_LABELS[category], `${category} 缺中文名`).toBeTruthy();
      expect(allowedTones, `${category} 的 tone 非法`).toContain(
        CAMPUS_POI_CATEGORY_TONES[category],
      );
    }
    expect(JSON.stringify(CAMPUS_POI_CATEGORY_TONES)).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it('从包入口 `@kedaya/contracts` 可导入（index.ts 只加一行 export）', () => {
    expect(BOUNDS_FROM_INDEX).toBe(CAMPUS_POI_BOUNDS);
  });

  it('校园 WGS84 bounds 与 OSM 快照逐字一致（防止悄悄漂移）', () => {
    type Snapshot = {
      campus: {
        bounds: { minlat: number; minlon: number; maxlat: number; maxlon: number };
      };
    };
    const snapshot = JSON.parse(readFileSync(POI_SNAPSHOT, 'utf8')) as Snapshot;

    expect(CAMPUS_POI_BOUNDS.south).toBe(snapshot.campus.bounds.minlat);
    expect(CAMPUS_POI_BOUNDS.north).toBe(snapshot.campus.bounds.maxlat);
    expect(CAMPUS_POI_BOUNDS.west).toBe(snapshot.campus.bounds.minlon);
    expect(CAMPUS_POI_BOUNDS.east).toBe(snapshot.campus.bounds.maxlon);
  });

  it('边界判定包含四角、拒绝市中心与非有限值', () => {
    expect(isPoiWithinCampusBounds(CAMPUS_POI_BOUNDS.south, CAMPUS_POI_BOUNDS.west)).toBe(true);
    expect(isPoiWithinCampusBounds(CAMPUS_POI_BOUNDS.north, CAMPUS_POI_BOUNDS.east)).toBe(true);
    expect(isPoiWithinCampusBounds(31.2304, 121.4737)).toBe(false); // 人民广场
    expect(isPoiWithinCampusBounds(Number.NaN, 121.591)).toBe(false);
    expect(isPoiWithinCampusBounds(31.1795, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 校验（重点：照片署名）
 * ------------------------------------------------------------------ */

describe('validatePoiSupplement', () => {
  it('演示数据全部合法（3–5 条，且明确标注为假）', () => {
    expect(DEMO_POIS.length).toBeGreaterThanOrEqual(3);
    expect(DEMO_POIS.length).toBeLessThanOrEqual(5);

    for (const poi of DEMO_POIS) {
      // 假数据必须在名字里自曝，避免被当成真实采集
      expect(poi.name).toContain('演示数据');
      expect(validatePoiSupplement(poi), `${poi.id} 应通过校验`).toEqual([]);
    }
  });

  it('⚠️ 有照片但没有署名 → 校验失败（版权硬要求）', () => {
    expect(STUDY.photoUrls.length).toBeGreaterThan(0);

    const withoutCredit: CampusPoiSupplement = { ...STUDY, photoCredit: null };
    expect(validatePoiSupplement(withoutCredit)).toContainEqual(
      expect.objectContaining({ code: 'photo-credit-required', field: 'photoCredit' }),
    );

    const blankCredit: CampusPoiSupplement = { ...STUDY, photoCredit: '   ' };
    expect(validatePoiSupplement(blankCredit).map((item) => item.code)).toContain(
      'photo-credit-required',
    );
  });

  it('没有照片时不要求署名（空模型可以直接通过）', () => {
    const express = demo('express-station');
    expect(express.photoUrls).toEqual([]);
    expect(express.photoCredit).toBeNull();
    expect(validatePoiSupplement(express)).toEqual([]);
  });

  it('空照片 URL 也会被拒绝', () => {
    const poi: CampusPoiSupplement = { ...STUDY, photoUrls: [''] };
    expect(validatePoiSupplement(poi).map((item) => item.code)).toContain('photo-url-empty');
  });

  it('明令禁止的来源即使写了署名也拒收（版权不在录入者手里）', () => {
    const scraped: CampusPoiSupplement = {
      ...STUDY,
      photoUrls: ['https://map.niyiwei.com/uploads/garage-1.jpg'],
      photoCredit: '某同学（未获授权）',
    };
    expect(validatePoiSupplement(scraped).map((item) => item.code)).toContain(
      'photo-url-forbidden-origin',
    );
    expect(importPoiSupplement(scraped).ok).toBe(false);
  });

  it('禁止来源的子域 / userinfo 变体也被识别；相似域名与相对路径放行', () => {
    const codes = (url: string): string[] =>
      validatePoiSupplement({ ...STUDY, photoUrls: [url] }).map((item) => item.code);

    expect(codes('https://sub.map.niyiwei.com/a.jpg')).toContain('photo-url-forbidden-origin');
    expect(codes('https://evil.com@map.niyiwei.com/a.jpg')).toContain(
      'photo-url-forbidden-origin',
    );
    expect(codes('https://map.niyiwei.com.evil.com/a.jpg')).not.toContain(
      'photo-url-forbidden-origin',
    );
    expect(codes('/uploads/local-study-room.jpg')).not.toContain('photo-url-forbidden-origin');
  });

  it('坐标越界 → 校验失败；NaN → 非有限值失败', () => {
    const cityCenter: CampusPoiSupplement = {
      ...demo('express-station'),
      lat: 31.2304,
      lng: 121.4737,
    };
    expect(validatePoiSupplement(cityCenter).map((item) => item.code)).toContain(
      'coordinate-outside-campus',
    );

    const notFinite: CampusPoiSupplement = { ...demo('express-station'), lat: Number.NaN };
    expect(validatePoiSupplement(notFinite).map((item) => item.code)).toContain(
      'coordinate-not-finite',
    );
  });

  it('负楼层只允许地下车库；非整数楼层一律失败', () => {
    expect(CAMPUS_POI_NEGATIVE_FLOOR_CATEGORIES).toEqual(['parking-garage']);
    expect(GARAGE.floor).toBe(-1);
    expect(validatePoiSupplement(GARAGE)).toEqual([]);

    const mislabeled: CampusPoiSupplement = { ...GARAGE, category: 'study-space' };
    expect(validatePoiSupplement(mislabeled).map((item) => item.code)).toContain(
      'floor-negative-category',
    );

    const fractional: CampusPoiSupplement = { ...GARAGE, floor: -1.5 };
    expect(validatePoiSupplement(fractional).map((item) => item.code)).toContain(
      'floor-not-integer',
    );
  });

  it('createPoiDraft 产出可录入的空模型：无照片、未核实、来源未知', () => {
    const draft = createPoiDraft({
      id: 'draft-demo-01',
      category: 'express-station',
      name: '待录入快递站（演示）',
      lat: 31.1785,
      lng: 121.5915,
    });

    expect(draft.photoUrls).toEqual([]);
    expect(draft.photoCredit).toBeNull();
    expect(draft.verifiedAt).toBeNull();
    expect(draft.source).toBe('unknown');
    expect(draft.floor).toBeNull();
    expect(validatePoiSupplement(draft)).toEqual([]);
  });

  it('外部录入闸门：合法数据放行，缺署名直接拒收（不会先入库再补）', () => {
    expect(importPoiSupplement(STUDY)).toEqual({ ok: true, poi: STUDY });

    const rejected = importPoiSupplement({ ...STUDY, photoCredit: null });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.issues.map((item) => item.code)).toContain('photo-credit-required');
    }
  });

  it('照片版权策略常量锁死「有图必署名」并点名禁止抓取的来源', () => {
    expect(CAMPUS_POI_PHOTO_POLICY.creditRequired).toBe(true);
    expect(CAMPUS_POI_PHOTO_POLICY.forbiddenOrigins).toContain('https://map.niyiwei.com');
  });
});

/* ------------------------------------------------------------------ *
 * 地图叠加层投影
 * ------------------------------------------------------------------ */

describe('poiToMapMarker', () => {
  it('保留 id / 名称 / WGS84 坐标，并给出分类名与语义 tone', () => {
    for (const poi of DEMO_POIS) {
      const marker = poiToMapMarker(poi);
      expect(marker.id).toBe(poi.id);
      expect(marker.label).toBe(poi.name);
      expect(marker.lat).toBe(poi.lat);
      expect(marker.lng).toBe(poi.lng);
      expect(marker.category).toBe(poi.category);
      expect(marker.categoryLabel).toBe(CAMPUS_POI_CATEGORY_LABELS[poi.category]);
      expect(marker.tone).toBe(CAMPUS_POI_CATEGORY_TONES[poi.category]);
    }
  });

  it('只有带授权照片的 POI 才打开相册入口并带署名', () => {
    const studyMarker = poiToMapMarker(STUDY);
    expect(studyMarker.hasPhotos).toBe(true);
    expect(studyMarker.photoCredit).toBe(STUDY.photoCredit);

    const expressMarker = poiToMapMarker(demo('express-station'));
    expect(expressMarker.hasPhotos).toBe(false);
    expect(expressMarker.photoCredit).toBeNull();
  });

  it('投影结果不含任何十六进制色值（色值只能来自 design-tokens）', () => {
    const serialized = JSON.stringify(DEMO_POIS.map(poiToMapMarker));
    expect(serialized).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it('运行时脏分类归一到 other，而不是画出 undefined', () => {
    const dirty: CampusPoiSupplement = {
      ...demo('express-station'),
      category: 'not-a-category' as CampusPoiCategory,
    };
    const marker = poiToMapMarker(dirty);
    expect(marker.category).toBe('other');
    expect(marker.categoryLabel).toBe('其他');
    expect(marker.tone).toBe('neutral');
  });
});

/* ------------------------------------------------------------------ *
 * 时间关联
 * ------------------------------------------------------------------ */

describe('findPoiSlotsAt / nextSlotAt', () => {
  it('找出某一刻正在进行中的安排（左闭右开）', () => {
    const atCourse = findPoiSlotsAt(DEMO_POIS, DEMO_SLOTS, '2026-10-19T09:15:00+08:00');
    expect(atCourse).toHaveLength(1);
    expect(atCourse[0]?.poiId).toBe(STUDY.id);
    expect(atCourse[0]?.slots.map((slot) => slot.title)).toEqual(['演示课：高等数学']);

    const atPersonal = findPoiSlotsAt(DEMO_POIS, DEMO_SLOTS, '2026-10-19T11:00:00+08:00');
    expect(atPersonal[0]?.slots.map((slot) => slot.kind)).toEqual(['personal']);

    const atEvent = findPoiSlotsAt(DEMO_POIS, DEMO_SLOTS, '2026-10-19T14:30:00+08:00');
    expect(atEvent[0]?.poiId).toBe(EVENT.id);

    // 10:30 是上一段结束、下一段开始：只命中新的那段，不会两段都算
    const atBoundary = findPoiSlotsAt(DEMO_POIS, DEMO_SLOTS, '2026-10-19T10:30:00+08:00');
    expect(atBoundary[0]?.slots.map((slot) => slot.title)).toEqual(['演示日程：自习']);

    // 12:00 两段都结束，当天没有别的安排
    expect(findPoiSlotsAt(DEMO_POIS, DEMO_SLOTS, '2026-10-19T12:00:00+08:00')).toEqual([]);
  });

  it('同一时刻多个 POI 都有安排时按 pois 顺序分组返回', () => {
    const simultaneous: readonly PoiTimeSlot[] = [
      DEMO_SLOTS[0]!,
      {
        ...DEMO_SLOTS[2]!,
        startsAt: '2026-10-19T09:30:00+08:00',
        endsAt: '2026-10-19T10:00:00+08:00',
      },
    ];

    const active = findPoiSlotsAt(DEMO_POIS, simultaneous, '2026-10-19T09:45:00+08:00');
    expect(active.map((entry) => entry.poiId)).toEqual([EVENT.id, STUDY.id]);
    expect(active.every((entry) => entry.slots.length === 1)).toBe(true);
  });

  it('接受 Date 入参；非法时刻 / 不存在的 POI 会被忽略而不是抛错', () => {
    const at = new Date('2026-10-19T09:15:00+08:00');
    expect(findPoiSlotsAt(DEMO_POIS, DEMO_SLOTS, at)[0]?.poiId).toBe(STUDY.id);

    expect(findPoiSlotsAt(DEMO_POIS, DEMO_SLOTS, 'not-a-time')).toEqual([]);

    const ghost: PoiTimeSlot = { ...DEMO_SLOTS[0]!, poiId: 'demo-ghost' };
    expect(findPoiSlotsAt(DEMO_POIS, [ghost], '2026-10-19T09:15:00+08:00')).toEqual([]);
  });

  it('「下一站」返回最早一段；进行中的课不会被跳过', () => {
    expect(nextSlotAt(STUDY, DEMO_SLOTS, '2026-10-19T08:00:00+08:00')?.title).toBe(
      '演示课：高等数学',
    );
    // 09:15 这门课正在进行 —— 下一站就是它
    expect(nextSlotAt(STUDY, DEMO_SLOTS, '2026-10-19T09:15:00+08:00')?.title).toBe(
      '演示课：高等数学',
    );
    // 10:30 边界之后是自习
    expect(nextSlotAt(STUDY, DEMO_SLOTS, '2026-10-19T10:30:00+08:00')?.title).toBe(
      '演示日程：自习',
    );
    // 当天 12:00 之后只剩第二天的考试
    expect(nextSlotAt(STUDY, DEMO_SLOTS, '2026-10-19T12:00:00+08:00')?.title).toBe(
      '演示考试：期中',
    );
    // 最后一场结束
    expect(nextSlotAt(STUDY, DEMO_SLOTS, '2026-10-20T11:00:00+08:00')).toBeNull();
  });

  it('别的 POI、非法时刻都返回 null', () => {
    expect(nextSlotAt(GARAGE, DEMO_SLOTS, '2026-10-19T08:00:00+08:00')).toBeNull();
    expect(nextSlotAt(STUDY, DEMO_SLOTS, 'not-a-time')).toBeNull();
  });
});

describe('findPoiSlotConflicts：时间冲突判定', () => {
  const base: PoiTimeSlot = {
    poiId: STUDY.id,
    startsAt: '2026-10-21T09:00:00+08:00',
    endsAt: '2026-10-21T10:30:00+08:00',
    kind: 'course',
    title: '演示课 A',
    sourceRef: null,
  };

  it('同一 POI 上重叠 → 冲突，并给出重叠时长', () => {
    const overlapping: PoiTimeSlot = {
      ...base,
      title: '演示日程 B',
      startsAt: '2026-10-21T10:00:00+08:00',
      endsAt: '2026-10-21T11:00:00+08:00',
    };

    const conflicts = findPoiSlotConflicts([base, overlapping]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.poiId).toBe(STUDY.id);
    expect(conflicts[0]?.earlier.title).toBe('演示课 A');
    expect(conflicts[0]?.later.title).toBe('演示日程 B');
    expect(conflicts[0]?.overlapMs).toBe(30 * 60 * 1000);
  });

  it('首尾相接（10:30 结束 → 10:30 开始）不算冲突', () => {
    const adjacent: PoiTimeSlot = {
      ...base,
      title: '演示日程 C',
      startsAt: '2026-10-21T10:30:00+08:00',
      endsAt: '2026-10-21T12:00:00+08:00',
    };
    expect(findPoiSlotConflicts([base, adjacent])).toEqual([]);
  });

  it('不同 POI 同一时刻不算冲突；非法时间窗被忽略', () => {
    const otherPoi: PoiTimeSlot = {
      ...base,
      poiId: EVENT.id,
      title: '演示活动 D',
      startsAt: '2026-10-21T09:15:00+08:00',
      endsAt: '2026-10-21T09:45:00+08:00',
    };
    expect(findPoiSlotConflicts([base, otherPoi])).toEqual([]);

    const reversed: PoiTimeSlot = {
      ...base,
      title: '演示错误时间 E',
      startsAt: '2026-10-21T11:00:00+08:00',
      endsAt: '2026-10-21T10:00:00+08:00',
    };
    expect(findPoiSlotConflicts([base, reversed])).toEqual([]);
  });
});
