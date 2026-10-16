/**
 * wildlife · 坐标系与底图验收（规格 §3 / §11.1）
 *
 * 覆盖：T1（往返自洽）、T2（偏移量级 —— 唯一能抓住"转换被写成恒等函数"的断言）、
 * T3（境外不偏移）、T5（底图标定 rmse/控制点）、T6（校园边界 + lat/lng 互换）、
 * T7（1m≈1px 底图上 30m ≈ 30px）。
 */
import { describe, expect, it } from 'vitest';
import { distanceMeters } from '@kedaya/shared';
import { AppError } from '../../../common/errors/app-error';
import {
  BASEMAP_MAX_RMSE_PX,
  BASEMAP_MIN_CONTROL_POINTS,
  CAMPUS_BBOX,
  asWgs84,
  assertBasemap,
  assertInCampus,
  calibrateAffine,
  isInCampus,
  projectToPixels,
  toGcj02,
  toLatLng,
  toWgs84,
  type ControlPoint,
} from './geo';
import {
  BASEMAP_CAMPUS_BBOX,
  PLACEHOLDER_AFFINE,
  PLACEHOLDER_CONTROL_POINTS,
  WILDLIFE_PLACEHOLDER_BASEMAP,
} from '../wildlife.basemap';

/** 校园内 5 个点（含边界附近与中心） */
const CAMPUS_SAMPLES = [
  { lat: 31.178, lng: 121.59 },
  { lat: 31.1705, lng: 121.5825 },
  { lat: 31.1855, lng: 121.5975 },
  { lat: 31.1795, lng: 121.591 },
  { lat: 31.1815, lng: 121.5945 },
];

describe('§3.5 V1 往返自洽（T1）', () => {
  it('WGS84 → GCJ02 → WGS84 误差 < 1e-9 度（5 个点）', () => {
    for (const sample of CAMPUS_SAMPLES) {
      const gcj = toGcj02(asWgs84(sample.lat, sample.lng));
      expect(gcj.datum).toBe('GCJ02');
      const back = toWgs84(gcj);
      expect(back.datum).toBe('WGS84');
      expect(Math.abs(back.lat - sample.lat)).toBeLessThan(1e-9);
      expect(Math.abs(back.lng - sample.lng)).toBeLessThan(1e-9);
    }
  });
});

describe('§3.5 V2 偏移量级（T2）—— 能抓住"转换函数被实现成恒等函数"', () => {
  it('上海范围内偏移在 200–800 m 之间', () => {
    for (const sample of CAMPUS_SAMPLES) {
      const gcj = toGcj02(asWgs84(sample.lat, sample.lng));
      const offset = distanceMeters(sample, toLatLng(gcj));
      expect(offset).toBeGreaterThan(200);
      expect(offset).toBeLessThan(800);
    }
  });

  it('恒等函数会立刻失败（这条断言的存在意义）', () => {
    const identity = { lat: 31.178, lng: 121.59 };
    const gcj = toGcj02(asWgs84(identity.lat, identity.lng));
    // 若 toGcj02 退化成恒等，下面的偏移就是 0，断言失败
    expect(distanceMeters(identity, toLatLng(gcj))).not.toBe(0);
  });
});

describe('§3.5 V3 境外不偏移（T3）', () => {
  it('东京坐标转换后与原值相同（outOfChina 生效）', () => {
    const tokyo = asWgs84(35.6812, 139.7671);
    const gcj = toGcj02(tokyo);
    expect(gcj.lat).toBeCloseTo(tokyo.lat, 12);
    expect(gcj.lng).toBeCloseTo(tokyo.lng, 12);
    const back = toWgs84(gcj);
    expect(back.lat).toBeCloseTo(tokyo.lat, 12);
  });
});

describe('§3.5 V5 校园边界断言（T6）', () => {
  it('校园内坐标通过', () => {
    for (const sample of CAMPUS_SAMPLES) {
      expect(isInCampus(sample)).toBe(true);
      expect(() => assertInCampus(sample)).not.toThrow();
    }
  });

  it('校园外坐标被拒（VALIDATION_FAILED / COORDINATE_OUT_OF_CAMPUS）', () => {
    try {
      assertInCampus({ lat: 31.2, lng: 121.5 });
      throw new Error('期望抛错');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('VALIDATION_FAILED');
      expect((error as AppError).details).toMatchObject({ reason: 'COORDINATE_OUT_OF_CAMPUS' });
    }
  });

  it('**lat/lng 互换能被拒绝**（极高频错误）', () => {
    // 把 (31.178, 121.59) 写反 → (121.59, 31.178)
    expect(isInCampus({ lat: 121.59, lng: 31.178 })).toBe(false);
    expect(() => assertInCampus({ lat: 121.59, lng: 31.178 })).toThrow();
  });

  it('NaN / Infinity 被拒，且不回显原始坐标', () => {
    expect(() => assertInCampus({ lat: Number.NaN, lng: 121.59 })).toThrow();
    expect(() => assertInCampus({ lat: 31.178, lng: Number.POSITIVE_INFINITY })).toThrow();
    try {
      assertInCampus({ lat: 31.2, lng: 121.5 });
    } catch (error) {
      // 错误响应也是泄漏面：details 里只给 bbox，不给原始坐标
      expect(JSON.stringify((error as AppError).details)).not.toContain('31.2');
    }
  });

  it('校园边界框与底图用的是同一份常量（不会各写一套）', () => {
    expect(BASEMAP_CAMPUS_BBOX).toEqual(CAMPUS_BBOX);
    expect(isInCampus({ lat: CAMPUS_BBOX.minLat, lng: CAMPUS_BBOX.minLng })).toBe(true);
    expect(isInCampus({ lat: CAMPUS_BBOX.maxLat + 0.001, lng: CAMPUS_BBOX.maxLng })).toBe(false);
  });
});

describe('§3.4 仿射标定（T5）', () => {
  it('至少 6 个控制点（少于 6 个直接拒绝标定）', () => {
    expect(() => calibrateAffine(PLACEHOLDER_CONTROL_POINTS.slice(0, 5))).toThrow(/至少需要 6 个控制点/);
    expect(PLACEHOLDER_CONTROL_POINTS.length).toBeGreaterThanOrEqual(BASEMAP_MIN_CONTROL_POINTS);
  });

  it('从控制点能解出与占位仿射一致的矩阵，且 rmse 远小于 5px', () => {
    const { affine, rmsePx } = calibrateAffine(PLACEHOLDER_CONTROL_POINTS);
    expect(rmsePx).toBeLessThan(BASEMAP_MAX_RMSE_PX);
    // 占位仿射是 [1,0,500,0,-1,500]（1px/m，y 轴翻转）
    expect(affine[0]).toBeCloseTo(PLACEHOLDER_AFFINE[0], 3);
    expect(affine[2]).toBeCloseTo(PLACEHOLDER_AFFINE[2], 0);
    expect(affine[4]).toBeCloseTo(PLACEHOLDER_AFFINE[4], 3);
  });

  it('控制点共线 → 拒绝（不给出一个会外推爆炸的矩阵）', () => {
    const collinear: ControlPoint[] = Array.from({ length: 6 }, (_, i) => ({
      wgsLat: 31.178 + i * 0.0001,
      wgsLng: 121.59 + i * 0.0001,
      px: 100 + i * 10,
      py: 100 + i * 10,
    }));
    expect(() => calibrateAffine(collinear)).toThrow(/退化/);
  });

  it('assertBasemap 拦住 rmse ≥ 5px / 控制点不足 / ODbL 无署名', () => {
    expect(() => assertBasemap({ ...WILDLIFE_PLACEHOLDER_BASEMAP, calibrationRmsePx: 5 })).toThrow(/残差/);
    expect(() => assertBasemap({ ...WILDLIFE_PLACEHOLDER_BASEMAP, controlPointCount: 5 })).toThrow(/控制点/);
    expect(() =>
      assertBasemap({ ...WILDLIFE_PLACEHOLDER_BASEMAP, license: 'odbl', attribution: '  ' }),
    ).toThrow(/署名/);
    expect(() => assertBasemap(WILDLIFE_PLACEHOLDER_BASEMAP)).not.toThrow();
  });

  it('占位底图自带"待实测"标记（不假装标定已完成）', () => {
    expect(WILDLIFE_PLACEHOLDER_BASEMAP.version).toContain('placeholder');
    expect(WILDLIFE_PLACEHOLDER_BASEMAP.license).toBe('original');
    expect(WILDLIFE_PLACEHOLDER_BASEMAP.calibrationRmsePx).toBeLessThan(BASEMAP_MAX_RMSE_PX);
    expect(WILDLIFE_PLACEHOLDER_BASEMAP.controlPointCount).toBe(PLACEHOLDER_CONTROL_POINTS.length);
  });
});

describe('§3.5 V5 静态底图像素距离（T7）', () => {
  it('相距 30 m 的两点在 1m≈1px 的底图上像素距离在 25–35 px', () => {
    const a = asWgs84(31.178, 121.59);
    // 30m 正北：一度纬度 ≈ 110540 m
    const b = asWgs84(31.178 + 30 / 110_540, 121.59);
    expect(distanceMeters(toLatLng(a), toLatLng(b))).toBeCloseTo(30, 0);

    const pa = projectToPixels(a, PLACEHOLDER_AFFINE);
    const pb = projectToPixels(b, PLACEHOLDER_AFFINE);
    const pixelDistance = Math.hypot(pa.u - pb.u, pa.v - pb.v);
    expect(pixelDistance).toBeGreaterThan(25);
    expect(pixelDistance).toBeLessThan(35);
  });

  it('经度方向也按 cos(lat) 缩放（漏乘会让东西方向拉伸 17%）', () => {
    const a = asWgs84(31.178, 121.59);
    const b = asWgs84(31.178, 121.59 + 30 / (111_320 * Math.cos((31.178 * Math.PI) / 180)));
    const pa = projectToPixels(a, PLACEHOLDER_AFFINE);
    const pb = projectToPixels(b, PLACEHOLDER_AFFINE);
    expect(Math.hypot(pa.u - pb.u, pa.v - pb.v)).toBeGreaterThan(25);
    expect(Math.hypot(pa.u - pb.u, pa.v - pb.v)).toBeLessThan(35);
  });

  it('lat/lng 互换后投影会跑到画布之外（可被断言抓住）', () => {
    const correct = projectToPixels(asWgs84(31.178, 121.59), PLACEHOLDER_AFFINE);
    const swapped = projectToPixels(asWgs84(121.59, 31.178), PLACEHOLDER_AFFINE);
    expect(Math.abs(swapped.u)).toBeGreaterThan(100_000);
    expect(Math.abs(correct.u)).toBeLessThan(1000);
  });
});
