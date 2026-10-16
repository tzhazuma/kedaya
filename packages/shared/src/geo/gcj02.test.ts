import { describe, expect, it } from 'vitest';
import { gcj02ToWgs84, outOfChina, wgs84PointsToGcj02, wgs84ToGcj02 } from './gcj02';
import { distanceMeters, isGcj02OffsetPlausible } from './local';
import type { LatLng } from './types';

/** 上科大张江校区附近（WGS84） */
const SHANGHAITECH: LatLng = { lat: 31.1795, lng: 121.591 };
/** 北京天安门（WGS84 近似） */
const BEIJING: LatLng = { lat: 39.9087, lng: 116.3975 };

describe('outOfChina', () => {
  it('中国境内为 false，境外为 true', () => {
    expect(outOfChina(SHANGHAITECH.lat, SHANGHAITECH.lng)).toBe(false);
    expect(outOfChina(35.68, 139.69)).toBe(true); // 东京
    expect(outOfChina(51.5, -0.12)).toBe(true); // 伦敦
  });
});

describe('wgs84ToGcj02 —— V2 偏移量级断言（最关键的一组）', () => {
  /**
   * 这组测试是**故意**不用往返一致性来验证的。
   * 如果转换函数被误写成恒等函数（return {lat, lng}），
   * 往返测试（V1）依然会全绿 —— 因为恒等函数的往返也是自洽的。
   * 只有"偏移量必须落在百米量级"能抓住它。
   */
  it('上科大坐标的偏移量在 100–900m（真实 GCJ-02 量级）', () => {
    const gcj = wgs84ToGcj02(SHANGHAITECH.lat, SHANGHAITECH.lng);
    const offset = distanceMeters(SHANGHAITECH, gcj);
    expect(offset).toBeGreaterThan(100);
    expect(offset).toBeLessThan(900);
    expect(isGcj02OffsetPlausible(SHANGHAITECH, gcj)).toBe(true);
  });

  it('北京坐标的偏移量同样在百米量级', () => {
    const gcj = wgs84ToGcj02(BEIJING.lat, BEIJING.lng);
    expect(distanceMeters(BEIJING, gcj)).toBeGreaterThan(100);
    expect(distanceMeters(BEIJING, gcj)).toBeLessThan(900);
  });

  it('经度必然增大（东移）—— GCJ-02 在中国境内的稳定特征', () => {
    // ⚠️ 实测修正：偏移的**纬度**方向是地区相关的，不能想当然。
    //   实测值（见本文件下方注释）：
    //     上科大 31.1795,121.591 → dLat −248m, dLng +400m（**南东**，470m）
    //     北京   39.9087,116.3975 → dLat +156m, dLng +533m（**北东**，556m）
    //   所以只能断言"东移"，纬度方向必须实测而不能假设。
    const gcj = wgs84ToGcj02(SHANGHAITECH.lat, SHANGHAITECH.lng);
    expect(gcj.lng).toBeGreaterThan(SHANGHAITECH.lng);
  });

  it('上科大坐标实测偏移为南东约 470m（回归护栏）', () => {
    const gcj = wgs84ToGcj02(SHANGHAITECH.lat, SHANGHAITECH.lng);
    const dLatM = (gcj.lat - SHANGHAITECH.lat) * 111_320;
    const dLngM =
      (gcj.lng - SHANGHAITECH.lng) * 111_320 * Math.cos((SHANGHAITECH.lat * Math.PI) / 180);
    // 允许 ±20m 的实现差异，但方向与量级必须对
    expect(dLatM).toBeLessThan(-200);
    expect(dLatM).toBeGreaterThan(-300);
    expect(dLngM).toBeGreaterThan(350);
    expect(dLngM).toBeLessThan(450);
  });

  it('恒等函数会被这个断言抓住（反例自证）', () => {
    const identity = (p: LatLng) => ({ lat: p.lat, lng: p.lng });
    const bad = identity(SHANGHAITECH);
    expect(isGcj02OffsetPlausible(SHANGHAITECH, bad)).toBe(false);
  });

  it('境外不偏移', () => {
    const tokyo = { lat: 35.68, lng: 139.69 };
    expect(wgs84ToGcj02(tokyo.lat, tokyo.lng)).toEqual(tokyo);
  });
});

describe('gcj02ToWgs84 —— V1 往返一致性', () => {
  it('往返回到原点，误差 < 1m', () => {
    const gcj = wgs84ToGcj02(SHANGHAITECH.lat, SHANGHAITECH.lng);
    const back = gcj02ToWgs84(gcj.lat, gcj.lng);
    expect(distanceMeters(SHANGHAITECH, back)).toBeLessThan(1);
  });

  it('校园尺度内多个点往返都收敛', () => {
    const points: LatLng[] = [
      { lat: 31.1795, lng: 121.591 },
      { lat: 31.181, lng: 121.5935 },
      { lat: 31.178, lng: 121.588 },
      { lat: 31.1802, lng: 121.5948 },
    ];
    for (const p of points) {
      const gcj = wgs84ToGcj02(p.lat, p.lng);
      const back = gcj02ToWgs84(gcj.lat, gcj.lng);
      expect(distanceMeters(p, back), `点 ${JSON.stringify(p)} 往返误差过大`).toBeLessThan(1);
    }
  });

  it('境外往返为恒等', () => {
    const tokyo = { lat: 35.68, lng: 139.69 };
    expect(gcj02ToWgs84(tokyo.lat, tokyo.lng)).toEqual(tokyo);
  });
});

describe('wgs84PointsToGcj02', () => {
  it('批量转换保持顺序与数量', () => {
    const pts: LatLng[] = [
      { lat: 31.1795, lng: 121.591 },
      { lat: 31.181, lng: 121.5935 },
    ];
    const out = wgs84PointsToGcj02(pts);
    expect(out).toHaveLength(2);
    // 只断言"东移"（纬度方向地区相关，见上文实测注释）
    expect(out[0]!.lng).toBeGreaterThan(pts[0]!.lng);
    expect(out[1]!.lng).toBeGreaterThan(pts[1]!.lng);
  });

  it('空数组返回空数组', () => {
    expect(wgs84PointsToGcj02([])).toEqual([]);
  });
});
