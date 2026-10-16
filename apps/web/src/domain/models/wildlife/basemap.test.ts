/**
 * 仿射标定与坐标映射测试（规格 §3.4 / §3.5 / 验收 T5、T6、T7）。
 *
 * 为什么这组测试是**最高优先级**（规格 §3.5）：
 * 坐标系错误**无法靠肉眼发现** —— 偏移几百米看起来像"数据错了"而不是"坐标系错了"。
 * 因此这里做机器验证：
 * - 像素 → WGS84 → 像素 的往返误差 < 1 px（任务硬要求；实测 ~1e-9 px）；
 * - 30 m 的上报在 1 m ≈ 1 px 的图上必须落在 25–35 px（能同时抓住
 *   仿射矩阵错、`cos(lat)` 漏乘、lat/lng 颠倒三类错误）；
 * - `assertInCampus` 必须拒绝校园外坐标与 **lat/lng 颠倒**。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BASEMAP_PLACEHOLDER_NOTICE,
  CAMPUS_BBOX,
  CoordinateOutOfCampusError,
  WILDLIFE_BASEMAP,
  WILDLIFE_BASEMAP_CONTROL_POINTS,
  assertInCampus,
  basemapCalibrationProblems,
  calibrate,
  isInCampus,
  isInsideBasemap,
  metersToPixel,
  pixelToMeters,
  pixelToWgs84,
  pixelsPerMeter,
  resolveCampusBasemap,
  wgs84ToPixel,
  type ControlPoint,
} from '@/domain/models/wildlife/basemap';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SVG_PATH = fileURLToPath(new URL('../../../../public/wildlife/basemap.svg', import.meta.url));

/** 一组覆盖四角与中心的像素点（外推误差最容易在角上暴露） */
const PROBE_PIXELS: ReadonlyArray<{ px: number; py: number }> = [
  { px: 0, py: 0 },
  { px: 1200, py: 0 },
  { px: 0, py: 800 },
  { px: 1200, py: 800 },
  { px: 600, py: 400 },
  { px: 100, py: 700 },
  { px: 1100, py: 150 },
  { px: 470, py: 300 },
  { px: 900, py: 250 },
  { px: 1120, py: 420 },
  { px: 250, py: 650 },
  { px: 820, py: 610 },
];

describe('仿射标定（calibrate）', () => {
  it('用 8 个控制点拟合出的 RMSE 必须 < 5 px（规格 §1.4 硬约束）', () => {
    const result = calibrate(WILDLIFE_BASEMAP_CONTROL_POINTS);
    expect(result.controlPointCount).toBe(8);
    expect(result.controlPointCount).toBeGreaterThanOrEqual(6);
    expect(result.rmsePx).toBeLessThan(5);
  });

  it('当前底图配置通过全部标定约束（basemapCalibrationProblems 为空）', () => {
    expect(basemapCalibrationProblems(WILDLIFE_BASEMAP)).toEqual([]);
    expect(WILDLIFE_BASEMAP.calibrationRmsePx).toBeLessThan(5);
    expect(WILDLIFE_BASEMAP.controlPointCount).toBeGreaterThanOrEqual(6);
  });

  it('控制点少于 3 个时抛错（宁可失败也不要静默给错矩阵）', () => {
    expect(() => calibrate(WILDLIFE_BASEMAP_CONTROL_POINTS.slice(0, 2))).toThrow(/至少需要 3 个控制点/);
  });

  it('控制点共线（退化）时抛错', () => {
    const degenerate: ControlPoint[] = [
      { name: 'a', wgsLat: 31.18, wgsLng: 121.59, px: 0, py: 0 },
      { name: 'b', wgsLat: 31.181, wgsLng: 121.591, px: 100, py: 100 },
      { name: 'c', wgsLat: 31.182, wgsLng: 121.592, px: 200, py: 200 },
    ];
    expect(() => calibrate(degenerate)).toThrow(/退化|不可逆|至少/);
  });

  it('标定残差超过 5 px 时被约束检查抓出来（不能放宽阈值）', () => {
    const problems = basemapCalibrationProblems({
      ...WILDLIFE_BASEMAP,
      calibrationRmsePx: 7.5,
      controlPointCount: 3,
    });
    expect(problems).toHaveLength(2);
    expect(problems.join('|')).toContain('RMSE');
    expect(problems.join('|')).toContain('控制点数量');
  });
});

describe('像素 ↔ 经纬度往返（任务硬要求：误差 < 1 px）', () => {
  it('像素 → WGS84 → 像素 的往返误差 < 1 px（覆盖四角与中心）', () => {
    const errors = PROBE_PIXELS.map((pixel) => {
      const wgs = pixelToWgs84(pixel);
      const back = wgs84ToPixel(wgs);
      return Math.hypot(back.px - pixel.px, back.py - pixel.py);
    });
    const maxError = Math.max(...errors);
    expect(maxError).toBeLessThan(1);
    // 实际远优于阈值（线性变换的解析求逆只有浮点噪声）
    expect(maxError).toBeLessThan(1e-6);
  });

  it('经纬度 → 像素 → 经纬度 的往返误差 < 1e-9 度', () => {
    for (const control of WILDLIFE_BASEMAP_CONTROL_POINTS) {
      const pixel = wgs84ToPixel({ lat: control.wgsLat, lng: control.wgsLng });
      const back = pixelToWgs84(pixel);
      expect(Math.abs(back.lat - control.wgsLat)).toBeLessThan(1e-9);
      expect(Math.abs(back.lng - control.wgsLng)).toBeLessThan(1e-9);
    }
  });

  it('米 ↔ 像素 互为逆变换', () => {
    const meters = { x: 123.4, y: -456.7 };
    const pixel = metersToPixel(meters, WILDLIFE_BASEMAP.affine);
    const back = pixelToMeters(pixel, WILDLIFE_BASEMAP.affine);
    expect(Math.abs(back.x - meters.x)).toBeLessThan(1e-9);
    expect(Math.abs(back.y - meters.y)).toBeLessThan(1e-9);
  });

  it('底图比例约为 1 m ≈ 1 px（方案 B 的"示意图但标定精确"）', () => {
    expect(pixelsPerMeter(WILDLIFE_BASEMAP.affine)).toBeGreaterThan(0.95);
    expect(pixelsPerMeter(WILDLIFE_BASEMAP.affine)).toBeLessThan(1.05);
  });

  it('不可逆的仿射矩阵会抛错，而不是静默返回 NaN', () => {
    const singular = [1, 2, 3, 2, 4, 6] as const;
    expect(() => pixelToMeters({ px: 10, py: 10 }, singular)).toThrow(/不可逆/);
  });
});

describe('端到端尺度断言（规格 §3.5 V5 / 验收 T7）', () => {
  it('相距 30 m 的两个上报，像素距离在 25–35 px 之间', () => {
    const a = { lat: 31.1795, lng: 121.591 };
    const b = { lat: 31.1795 + 30 / 111_320, lng: 121.591 };
    const pa = wgs84ToPixel(a);
    const pb = wgs84ToPixel(b);
    const distancePx = Math.hypot(pa.px - pb.px, pa.py - pb.py);
    expect(distancePx).toBeGreaterThan(25);
    expect(distancePx).toBeLessThan(35);
  });

  it('lat/lng 颠倒会被校园边界拒绝（上科大 lat≈31、lng≈121）', () => {
    const swapped = { lat: 121.591, lng: 31.1795 };
    expect(isInCampus(swapped)).toBe(false);
    expect(() => assertInCampus(swapped)).toThrow(CoordinateOutOfCampusError);
    // 颠倒后的像素坐标也远在底图之外
    expect(isInsideBasemap(wgs84ToPixel(swapped))).toBe(false);
  });

  it('校园外的坐标被拒绝，且错误带上机器可读的 reason', () => {
    const outside = { lat: 39.9, lng: 116.4 }; // 北京
    expect(isInCampus(outside)).toBe(false);
    try {
      assertInCampus(outside);
      throw new Error('应当抛错');
    } catch (error) {
      expect(error).toBeInstanceOf(CoordinateOutOfCampusError);
      expect((error as CoordinateOutOfCampusError).reason).toBe('COORDINATE_OUT_OF_CAMPUS');
    }
  });

  it('全部控制点都落在校园边界框内', () => {
    for (const control of WILDLIFE_BASEMAP_CONTROL_POINTS) {
      expect(isInCampus({ lat: control.wgsLat, lng: control.wgsLng })).toBe(true);
    }
    expect(CAMPUS_BBOX.minLat).toBeLessThan(CAMPUS_BBOX.maxLat);
    expect(CAMPUS_BBOX.minLng).toBeLessThan(CAMPUS_BBOX.maxLng);
  });
});

describe('底图配置与占位声明（规格 §1.3 / §1.4）', () => {
  it('当前底图是占位自绘，且占位声明非空（学校授权状态未知）', () => {
    expect(WILDLIFE_BASEMAP.license).toBe('original');
    expect(WILDLIFE_BASEMAP.isPlaceholder).toBe(true);
    expect(WILDLIFE_BASEMAP.placeholderNotice).toBe(BASEMAP_PLACEHOLDER_NOTICE);
    expect(WILDLIFE_BASEMAP.placeholderNotice).toContain('占位');
  });

  it('只有 school-authorized 才不算占位（把授权变成可检查的前置条件）', () => {
    const base = {
      version: 'v1',
      imageUrl: '/x.svg',
      widthPx: 1200,
      heightPx: 800,
      affine: WILDLIFE_BASEMAP.affine,
      calibrationRmsePx: 1,
      controlPointCount: 6,
      attribution: '某来源',
    } as const;
    expect(resolveCampusBasemap({ ...base, license: 'original' }).isPlaceholder).toBe(true);
    expect(resolveCampusBasemap({ ...base, license: 'odbl' }).isPlaceholder).toBe(true);
    const authorized = resolveCampusBasemap({ ...base, license: 'school-authorized' });
    expect(authorized.isPlaceholder).toBe(false);
    expect(authorized.placeholderNotice).toBe('');
  });

  it('底图 SVG 与配置的像素尺寸一致（1200×800）', () => {
    const svg = readFileSync(SVG_PATH, 'utf8');
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="800"');
    expect(svg).toContain('viewBox="0 0 1200 800"');
    expect(svg).toContain('占位底图');
    expect(WILDLIFE_BASEMAP.widthPx).toBe(1200);
    expect(WILDLIFE_BASEMAP.heightPx).toBe(800);
  });

  it('isInsideBasemap 拒绝画布外的点', () => {
    expect(isInsideBasemap({ px: 0, py: 0 })).toBe(true);
    expect(isInsideBasemap({ px: 1200, py: 800 })).toBe(true);
    expect(isInsideBasemap({ px: -1, py: 10 })).toBe(false);
    expect(isInsideBasemap({ px: 10, py: 801 })).toBe(false);
    expect(isInsideBasemap({ px: Number.NaN, py: 10 })).toBe(false);
  });
});
