/**
 * 校园地图 · 资产一致性测试
 * =====================================================================
 *
 * 这些断言锁的不是"代码能跑"，而是**页面上的说法能不能被文件验证**：
 *
 * 1. 应用里的 25 个地点 = `CAMPUS_LOCATION_DEFS` 的 key/label = `campus-poi.json` 的副本；
 * 2. 底图 SVG 真的把 25 个地点名都画进去了，且带 ODbL 署名；
 * 3. SVG 里每个 hex 都来自 `design-tokens`（静态资源也不许发明颜色）；
 * 4. `campusBasemap.ts` 的 affine / 尺寸与生成器输出逐字一致（防止手改漂移）；
 * 5. 数据文件声明了 ODbL + 快照时间 + 查询语句（许可与可追溯性不是口头承诺）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CAMPUS_LOCATION_DEFS } from '@kedaya/contracts';
import { describe, expect, it } from 'vitest';

import { CAMPUS_BASEMAP, campusPixelToWgs84, campusWgs84ToPixel } from './campusBasemap';
import {
  CAMPUS_MAP_LOCATIONS,
  campusLocationConfidenceCounts,
} from './campusLocations';
import { CAMPUS_POI_META } from './campusPoiMeta';

const HERE = fileURLToPath(new URL('.', import.meta.url));
/** apps/web */
const APP = join(HERE, '..', '..', '..');
const PUBLIC_MAP = join(APP, 'public', 'map');
const TOKENS_CSS = join(APP, '..', '..', 'packages', 'design-tokens', 'dist', 'tokens.css');

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b/g;

interface PoiLocation {
  key: string;
  label: string;
  lat: number;
  lng: number;
  confidence: string;
  evidenceKind: string;
  osmIds: number[];
  evidence: string;
}

interface PoiJson {
  _meta: {
    crs: string;
    source: string;
    attribution: string;
    license: string;
    osmBaseTimestamp: string;
    fetchedAt: string;
    queries: Array<{ name: string; overpassQL: string }>;
    precision: Record<string, string>;
    caveats: string[];
  };
  campus: { osmId: number; areaM2: number; bounds: Record<string, number> };
  features: Array<{ category: string }>;
  locations: PoiLocation[];
  counts: Record<string, number>;
}

interface GeometryJson {
  widthPx: number;
  heightPx: number;
  affine: number[];
  pixelsPerMeter: number;
  imageLight: string;
  imageDark: string;
  attribution: string;
  license: string;
}

const poi = JSON.parse(readFileSync(join(PUBLIC_MAP, 'campus-poi.json'), 'utf8')) as PoiJson;
const geometry = JSON.parse(
  readFileSync(join(PUBLIC_MAP, 'campus-basemap.geometry.json'), 'utf8'),
) as GeometryJson;
const svgLight = readFileSync(join(PUBLIC_MAP, 'campus-basemap.svg'), 'utf8');
const svgDark = readFileSync(join(PUBLIC_MAP, 'campus-basemap-dark.svg'), 'utf8');
const geojson = JSON.parse(
  readFileSync(join(PUBLIC_MAP, 'campus-basemap.geojson'), 'utf8'),
) as { type: string; features: unknown[]; metadata: { license: string; attribution: string } };

describe('25 个地点：应用层 / 契约 / 数据文件三处一致', () => {
  it('key 与 label 与 CAMPUS_LOCATION_DEFS 完全一致（顺序也一致）', () => {
    expect(CAMPUS_MAP_LOCATIONS.map((l) => l.key)).toEqual(
      CAMPUS_LOCATION_DEFS.map((l) => l.key),
    );
    expect(CAMPUS_MAP_LOCATIONS.map((l) => l.label)).toEqual(
      CAMPUS_LOCATION_DEFS.map((l) => l.label),
    );
  });

  it('public/map/campus-poi.json 是同一批数据的副本（逐项相等）', () => {
    expect(poi.locations).toHaveLength(CAMPUS_MAP_LOCATIONS.length);
    for (const [index, location] of CAMPUS_MAP_LOCATIONS.entries()) {
      const fromFile = poi.locations[index] as PoiLocation;
      expect(fromFile.key).toBe(location.key);
      expect(fromFile.label).toBe(location.label);
      expect(fromFile.lat).toBe(location.lat);
      expect(fromFile.lng).toBe(location.lng);
      expect(fromFile.confidence).toBe(location.confidence);
      expect(fromFile.evidenceKind).toBe(location.evidenceKind);
      expect(fromFile.osmIds).toEqual([...location.osmIds]);
      expect(fromFile.evidence).toBe(location.evidence);
    }
  });

  it('可信度统计是 10 已确证 / 7 推断 / 8 近似（页面与文档引用同一组数）', () => {
    expect(campusLocationConfidenceCounts()).toEqual({ high: 10, medium: 7, low: 8 });
  });

  it('每个地点都有一句能解释"凭什么"的依据，且没有空依据', () => {
    for (const location of CAMPUS_MAP_LOCATIONS) {
      expect(location.evidence.trim().length).toBeGreaterThan(10);
      expect(['high', 'medium', 'low']).toContain(location.confidence);
      expect([
        'osm-named',
        'osm-inferred',
        'osm-derived',
        'approximate',
        'off-campus-inferred',
      ]).toContain(location.evidenceKind);
    }
  });

  it('除地铁站外，地点都落在校园 bbox 内（地铁站允许在校园外）', () => {
    const { minlat: minLat, maxlat: maxLat, minlon: minLng, maxlon: maxLng } =
      poi.campus.bounds as unknown as {
        minlat: number;
        maxlat: number;
        minlon: number;
        maxlon: number;
      };
    for (const location of CAMPUS_MAP_LOCATIONS) {
      if (location.key === 'zhangjiang-metro') {
        // 地铁站在校园 polygon 以东、但仍在同一 bbox 的经度范围之外（图上单独标注）
        expect(location.lng).toBeGreaterThan(maxLng);
        continue;
      }
      expect(location.lat).toBeGreaterThanOrEqual(minLat);
      expect(location.lat).toBeLessThanOrEqual(maxLat);
      expect(location.lng).toBeGreaterThanOrEqual(minLng);
      expect(location.lng).toBeLessThanOrEqual(maxLng);
    }
  });
});

describe('底图资产：SVG / GeoJSON / 仿射矩阵', () => {
  it('仿射矩阵与尺寸与生成器输出逐字一致', () => {
    expect(geometry.widthPx).toBe(CAMPUS_BASEMAP.widthPx);
    expect(geometry.heightPx).toBe(CAMPUS_BASEMAP.heightPx);
    expect(geometry.pixelsPerMeter).toBeCloseTo(CAMPUS_BASEMAP.pixelsPerMeter, 9);
    expect(CAMPUS_BASEMAP.affine).toHaveLength(6);
    for (const [index, value] of geometry.affine.entries()) {
      expect(value).toBeCloseTo(CAMPUS_BASEMAP.affine[index] as number, 9);
    }
    expect(geometry.imageLight).toBe(CAMPUS_BASEMAP.imageLight);
    expect(geometry.imageDark).toBe(CAMPUS_BASEMAP.imageDark);
    expect(geometry.license).toBe('odbl');
  });

  it('浅色与深色底图都包含全部 25 个地点名与 ODbL 署名', () => {
    for (const [name, svg] of [
      ['light', svgLight],
      ['dark', svgDark],
    ] as const) {
      for (const location of CAMPUS_MAP_LOCATIONS) {
        expect(svg, `${name} 缺少地点 ${location.label}`).toContain(`>${location.label}</text>`);
      }
      expect(svg, `${name} 缺少 OSM 署名`).toContain('© OpenStreetMap contributors');
      expect(svg, `${name} 缺少许可`).toContain('ODbL 1.0');
      expect(svg, `${name} 未标注非测绘成果`).toContain('非测绘成果');
      // 每个地点都有 data-location，便于机器核对/高亮
      for (const location of CAMPUS_MAP_LOCATIONS) {
        expect(svg).toContain(`data-location="${location.key}"`);
      }
    }
  });

  it('底图 SVG 的每一个 hex 都来自 design-tokens（静态资源也不许发明颜色）', () => {
    const tokens = readFileSync(TOKENS_CSS, 'utf8');
    const tokenHex = new Set(
      (tokens.match(COLOR_LITERAL) ?? []).map((value) => value.toLowerCase()),
    );
    expect(tokenHex.size).toBeGreaterThan(16);
    for (const [name, svg] of [
      ['light', svgLight],
      ['dark', svgDark],
    ] as const) {
      const svgHex = (svg.match(COLOR_LITERAL) ?? []).map((value) => value.toLowerCase());
      expect(svgHex.length, `${name} 图里的 hex 太少，可能没画东西`).toBeGreaterThan(5);
      const invented = [...new Set(svgHex)].filter((value) => !tokenHex.has(value));
      expect(invented, `${name} 图里出现非令牌颜色`).toEqual([]);
    }
  });

  it('GeoJSON 是 WGS84（CRS84）且声明了 ODbL', () => {
    expect(geojson.type).toBe('FeatureCollection');
    expect(geojson.features.length).toBeGreaterThan(100);
    expect(geojson.metadata.license).toBe('ODbL-1.0');
    expect(geojson.metadata.attribution).toContain('OpenStreetMap');
  });
});

describe('数据文件：许可 / 来源 / 可追溯性', () => {
  it('campus-poi.json 的文件头声明了来源、许可、快照时间与查询语句', () => {
    expect(poi._meta.source).toBe('OpenStreetMap');
    expect(poi._meta.attribution).toBe('© OpenStreetMap contributors');
    expect(poi._meta.license).toBe('ODbL-1.0');
    expect(poi._meta.crs).toContain('WGS84');
    expect(poi._meta.osmBaseTimestamp.length).toBeGreaterThan(10);
    expect(poi._meta.fetchedAt.length).toBeGreaterThan(10);
    expect(poi._meta.queries.length).toBeGreaterThanOrEqual(8);
    for (const query of poi._meta.queries) {
      expect(query.overpassQL).toContain('out');
      expect(query.overpassQL.length).toBeGreaterThan(20);
    }
  });

  it('页面引用的计数与数据文件一致（不允许写"大约几百个"）', () => {
    expect(poi.features.length).toBe(CAMPUS_POI_META.featureCount);
    for (const [category, count] of Object.entries(CAMPUS_POI_META.featureCounts)) {
      expect(poi.counts[category], `分类 ${category} 计数漂移`).toBe(count);
    }
    expect(poi.campus.osmId).toBe(5390610);
    expect(poi.campus.areaM2).toBe(CAMPUS_POI_META.campusAreaM2);
  });

  it('精度与"哪些是推测的"写进了数据文件（不是只在 UI 上说）', () => {
    expect(Object.keys(poi._meta.precision).length).toBeGreaterThanOrEqual(4);
    expect(poi._meta.caveats.length).toBeGreaterThanOrEqual(4);
    expect(poi._meta.caveats.join('\n')).toContain('食堂');
    expect(poi._meta.caveats.join('\n')).toContain('学校官网');
  });
});

describe('投影：WGS84 ⇄ 像素', () => {
  it('25 个地点都投在底图范围内（地铁站可略超出，但仍在画布内）', () => {
    for (const location of CAMPUS_MAP_LOCATIONS) {
      const pixel = campusWgs84ToPixel(location);
      expect(Number.isFinite(pixel.px)).toBe(true);
      expect(pixel.px).toBeGreaterThanOrEqual(0);
      expect(pixel.px).toBeLessThanOrEqual(CAMPUS_BASEMAP.widthPx);
      expect(pixel.py).toBeGreaterThanOrEqual(0);
      expect(pixel.py).toBeLessThanOrEqual(CAMPUS_BASEMAP.heightPx);
    }
  });

  it('像素 → WGS84 往返误差 < 0.05 m（线性映射应精确）', () => {
    const library = CAMPUS_MAP_LOCATIONS.find((location) => location.key === 'library');
    expect(library).toBeDefined();
    const pixel = campusWgs84ToPixel(library!);
    const back = campusPixelToWgs84(pixel);
    const metersPerDegLat = 111_320;
    const metersPerDegLng = 111_320 * Math.cos((library!.lat * Math.PI) / 180);
    const error = Math.hypot(
      (back.lat - library!.lat) * metersPerDegLat,
      (back.lng - library!.lng) * metersPerDegLng,
    );
    expect(error).toBeLessThan(0.05);
  });
});
