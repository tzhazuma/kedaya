import { describe, expect, it } from 'vitest';
import { gcjToWgs, wgsToGcj } from './wildlife-coordinates';
describe('野生居民地图坐标转换', () => {
  it('浏览器定位转换为微信坐标，再转回时误差小于一米', () => {
    const original = { latitude: 31.17917, longitude: 121.58972 };
    const converted = wgsToGcj(original);
    expect(Math.abs(converted.longitude - original.longitude)).toBeGreaterThan(.001);
    const roundTrip = gcjToWgs(converted);
    expect(Math.abs(roundTrip.latitude - original.latitude)).toBeLessThan(.000001);
    expect(Math.abs(roundTrip.longitude - original.longitude)).toBeLessThan(.000001);
  });
  it('境外坐标不施加国内偏移', () => {
    const original = { latitude: 48.85, longitude: 2.35 };
    expect(wgsToGcj(original)).toEqual(original);
    expect(gcjToWgs(original)).toEqual(original);
  });
});
