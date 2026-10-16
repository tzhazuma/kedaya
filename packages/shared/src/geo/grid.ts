/**
 * 网格吸附（纯数学，可三端共用）。
 *
 * ⚠️ 网格吸附**单独使用不足以保护隐私**（规格文档 §9.3 ②）：
 * 吸附后公布的是**格心**，而"真实点在格内"这一事实会随多次上报被逐步收窄。
 * 因此服务端**必须叠加确定性加噪**（见 `services/api/.../fuzzing.ts`）。
 * 本文件只提供纯几何操作，不含任何加密逻辑 —— 加密必须在服务端。
 */

import { fromLocalMeters, toLocalMeters } from './local';
import { CAMPUS_ORIGIN, type LatLng } from './types';

/**
 * 把坐标吸附到边长 gridM 的**所在格的中心**。
 *
 * ⚠️ 必须用 `floor` 定格、再取格心（`(floor(x/g) + 0.5) * g`），
 * **不能**用 `round(x/g) * g`（最近的格心）—— 两者是**不同的划分**：
 *   - `round` 的格心在 `k*g`，格边界在 `(k±0.5)*g`
 *   - `floor` 的格边界在 `k*g`，格心在 `(k+0.5)*g`
 * 若吸附用 round、而 k-匿名计数用 floor（`gridCellKey`），
 * 就会出现"同格的两点被吸到相距一整格"的矛盾，k-匿名保证随之失效。
 * 本函数与 [gridCellKey] 使用**同一套划分**，这是它们能配合工作的前提。
 */
export function snapToGrid(
  point: LatLng,
  gridM: number,
  origin: LatLng = CAMPUS_ORIGIN,
): LatLng {
  if (!(gridM > 0)) throw new RangeError(`snapToGrid: gridM 必须为正数，收到 ${gridM}`);
  const { x, y } = toLocalMeters(point, origin);
  const cell = (v: number) => (Math.floor(v / gridM) + 0.5) * gridM;
  return fromLocalMeters({ x: cell(x), y: cell(y) }, origin);
}

/** 在局部平面上平移（米），用于加噪后落点 */
export function offsetMeters(
  point: LatLng,
  dxM: number,
  dyM: number,
  origin: LatLng = CAMPUS_ORIGIN,
): LatLng {
  const { x, y } = toLocalMeters(point, origin);
  return fromLocalMeters({ x: x + dxM, y: y + dyM }, origin);
}

/** 网格格子的稳定标识（用于 k-匿名计数）；同一格返回同一字符串 */
export function gridCellKey(
  point: LatLng,
  gridM: number,
  origin: LatLng = CAMPUS_ORIGIN,
): string {
  if (!(gridM > 0)) throw new RangeError(`gridCellKey: gridM 必须为正数，收到 ${gridM}`);
  const { x, y } = toLocalMeters(point, origin);
  return `${Math.floor(x / gridM)}:${Math.floor(y / gridM)}`;
}

/** 时间粗化：把 ISO 时间截断到小时 / 天（规格文档 §9.5） */
export function coarseTime(iso: string, granularity: 'hour' | 'day'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new TypeError(`coarseTime: 非法时间 "${iso}"`);
  if (granularity === 'day') {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
  }
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()),
  ).toISOString();
}

/**
 * 季节加强系数（规格文档 §9.4）：保护物种 / 繁殖期把模糊半径放大。
 * 返回乘数（≥1）。
 */
export function seasonalFuzzMultiplier(
  month: number,
  isNestingSensitive: boolean,
  nestingMonths: readonly number[],
): number {
  if (!isNestingSensitive) return 1;
  return nestingMonths.includes(month) ? 4 : 1;
}
