/**
 * wildlife · 位置模糊化（规格 §9）—— **本模块的隐私核心**
 *
 * 四层流水线，**必须全部生效**（规格 §9.2）：
 *
 * ```
 * 精确 WGS84
 *   ├─① 敏感区判定 ──命中──▶ 只给 zoneId，**不输出任何坐标**
 *   ├─② 网格吸附（snapToGrid，floor 划分）
 *   ├─③ 确定性加噪（HMAC(sightingId) → Box-Muller 高斯，σ = G/3）
 *   └─④ k-匿名（同格同 7 天窗口内去重人数 < 3 → 降级为只给 zone）
 * ```
 *
 * ## 为什么 ③ 必须"确定性"（本文件最重要的设计决策）
 *
 * 若每次请求重新随机，攻击者只需对同一 sighting 反复请求 N 次取平均，
 * 噪声以 1/√N 衰减 —— 100 次请求就能把 σ=50m 压到 5m，模糊化形同虚设。
 * 按 `sightingId` 派生 HMAC 后，**同一个 sighting 永远映射到同一个模糊点**，
 * 平均攻击无效（T8：100 次调用结果逐元素完全相同）。
 *
 * ## 为什么 ②③ 必须用 `snapToGrid` 而不是自己写 `round(x/g)*g`
 *
 * `snapToGrid` 与 `gridCellKey` 共用**同一套 floor 划分**（格边界在 k·g，格心在
 * (k+0.5)·g）。若吸附用 round、而 k-匿名计数用 floor，就会出现"同格的两点被吸到
 * 相距一整格"的矛盾，k-匿名保证随之失效。加噪后同样**重新吸附**，而不是自己算格心。
 *
 * ## 隐私强度的诚实说明（规格 §9.3）
 *
 * 网格吸附 + σ=G/3 加噪后，攻击者能确定的范围约 **150m × 150m**。
 * 这不足以定位到具体宿舍房间，但足以定位到"哪片区域" —— 这是**有意的取舍**。
 * **不能声称"完全匿名"，只能说"模糊到片区级"。**
 */
import { createHmac } from 'node:crypto';
import {
  CAMPUS_ORIGIN,
  coarseTime,
  gridCellKey,
  offsetMeters,
  pointInPolygon,
  seasonalFuzzMultiplier,
  snapToGrid,
  type LatLng,
  type SensitivePolygon,
} from '@kedaya/shared';

/* ------------------------------------------------------------------ *
 * 常量（规格 §9.3 / §9.4 / §9.5）
 * ------------------------------------------------------------------ */

/** 默认网格 `G`：一个宿舍楼的尺度；比这更细就能区分"哪一栋" */
export const DEFAULT_FUZZ_RADIUS_M = 50;

/**
 * k-匿名下限：同一网格 + 同一时间窗口内**去重上报人数** >= 3 才公开点位。
 *
 * 理由：若某个格子里只有 1 个人上报，那个点的模糊位置仍等价于
 * "这个人当时在这附近" —— 而我们知道这个人是谁（reporterId）。
 */
export const K_ANONYMITY_MIN_REPORTERS = 3;

/** k-匿名统计窗口（天） */
export const K_ANONYMITY_WINDOW_DAYS = 7;

/** 保护物种 + 繁殖期的公开延迟（天，规格 §9.5） */
export const NESTING_PUBLISH_DELAY_DAYS = 7;

/* ------------------------------------------------------------------ *
 * 类型
 * ------------------------------------------------------------------ */

/** 参与模糊化的物种属性（只取需要的字段，避免 domain 依赖完整实体） */
export interface FuzzSpeciesInput {
  isProtected: boolean;
  isNestingSensitive: boolean;
  nestingMonths: readonly number[];
}

/** 参与模糊化的区域属性 */
export interface FuzzZoneInput {
  id: string;
  fuzzRadiusM: number;
  isSensitive: boolean;
}

/** 实际生效的模糊层级（对外契约字段，见 OpenAPI `fuzzLevel`） */
export type FuzzLevel =
  /** 四层全部通过：公开网格化 + 加噪后的坐标 */
  | 'grid'
  /** k-匿名不足 → 只给区域，不给点（规格 §9.2 ④） */
  | 'coarsened'
  /** 命中敏感区 → 只给区域，不给点（规格 §9.2 ①，最强保证） */
  | 'zone-only';

export interface FuzzRequest {
  /** 用于派生确定性噪声的稳定标识 */
  sightingId: string;
  /** 精确 WGS84 坐标（**只在这里短暂存在**，绝不入库到公开表） */
  point: LatLng;
  observedAt: Date;
  species?: FuzzSpeciesInput | null;
  zone?: FuzzZoneInput | null;
  sensitiveAreas?: readonly SensitivePolygon[];
  /** `WILDLIFE_FUZZ_SECRET`（≥32 字节）。缺失时**启动失败**（规格 §9.7） */
  secret: string;
  /**
   * 同一网格 + 同一 7 天窗口内的**去重上报人数**（含本条）。
   * 由 data 层按 `gridCellKey` 查出来后传入 —— domain 层不碰 IO。
   */
  distinctReportersInCell: number;
  /** 默认网格半径（配置项 `WILDLIFE_FUZZ_DEFAULT_RADIUS_M`） */
  defaultRadiusM?: number;
  /** 时钟注入点（测试用） */
  now?: Date;
}

export interface FuzzResult {
  level: FuzzLevel;
  /** 公开坐标。`level !== 'grid'` 时**恒为 null** —— 没有坐标就没有反推的可能 */
  geo: LatLng | null;
  zoneId: string | null;
  /** 公开的粗化时间（ISO-8601 UTC） */
  observedAtFuzzed: string;
  /** 生效的模糊半径（米），含 §9.4 季节性加强 */
  fuzzRadiusM: number;
  /** k-匿名计数用的网格键（与 `snapToGrid` 同一套划分） */
  gridCellKey: string;
  /** 命中的敏感区 id（未命中为 null） */
  sensitiveAreaId: string | null;
  sensitiveReason: string | null;
  /** 降级原因；`null` 表示未降级 */
  degradeReason: 'sensitive-area' | 'k-anonymity' | null;
  /** 公开延迟（天）。保护物种繁殖期为 7，其余为 0（规格 §9.5） */
  publishDelayDays: number;
}

/* ------------------------------------------------------------------ *
 * ① 敏感区判定（规格 §9.3 ①，最强保证）
 * ------------------------------------------------------------------ */

/**
 * 点在敏感区多边形内（射线法，先转局部米制平面再做）。
 *
 * **命中即"不输出任何坐标"，只输出 zoneId** —— 这是最强的隐私保证：
 * 没有坐标就没有反推的可能。
 *
 * 为什么用"敏感区多边形"而不是"提高模糊半径"：半径再大，圆内仍然泄漏
 * "在圆的哪一侧"。而宿舍楼是**离散的建筑物**，用多边形精确圈定、
 * 完全不给坐标，是**确定性的**保证。
 */
export function isInSensitiveArea(
  point: LatLng,
  areas: readonly SensitivePolygon[],
): SensitivePolygon | null {
  for (const area of areas) {
    if (area.ring.length < 3) continue;
    if (pointInPolygon(point, area.ring)) return area;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * ③ 确定性加噪（规格 §9.3 ③，防平均攻击的关键）
 * ------------------------------------------------------------------ */

/**
 * 确定性高斯噪声（Box-Muller）。
 *
 * 用 HMAC-SHA256(secret, sightingId) 的前 8 字节生成两个独立均匀量，
 * 再 Box-Muller 变换为标准正态，最后乘 σ。
 *
 * **确定性是全部意义所在**：同一 sighting 永远得到同一对 (dx, dy)。
 */
export function deterministicNoise(
  sightingId: string,
  sigmaM: number,
  secret: string,
): { dx: number; dy: number } {
  if (!secret) {
    // 宁可抛错，也不要静默产出"无噪声"的坐标（规格 §9.7）
    throw new Error('WILDLIFE_FUZZ_SECRET 未配置：位置模糊化不能降级为不加噪');
  }
  const mac = createHmac('sha256', secret).update(sightingId, 'utf8').digest();
  // +1 避免 u1 === 0 导致 log(0) = -Infinity
  const u1 = (mac.readUInt32BE(0) + 1) / 0x1_0000_0000;
  const u2 = (mac.readUInt32BE(4) + 1) / 0x1_0000_0000;
  const r = Math.sqrt(-2 * Math.log(u1));
  const z0 = r * Math.cos(2 * Math.PI * u2);
  const z1 = r * Math.sin(2 * Math.PI * u2);
  return { dx: z0 * sigmaM, dy: z1 * sigmaM };
}

/* ------------------------------------------------------------------ *
 * ② 网格吸附（规格 §9.3 ②）
 * ------------------------------------------------------------------ */

/**
 * 网格吸附。**必须叠加 ③ 加噪**（规格 §9.3 ② 的警告）：
 * 吸附后公布的是格心，攻击者结合多次上报可以把"真实点在格内"逐步收窄。
 */
export function snapPointToGrid(point: LatLng, gridM: number): LatLng {
  return snapToGrid(point, gridM, CAMPUS_ORIGIN);
}

/**
 * ②+③ 的组合：先按 σ=G/3 加噪，**再吸附到同一套 floor 网格**。
 *
 * 注意这里**不是** `round((x+dx)/g)*g`（规格 §9.3 伪码的写法）——
 * 那会与 `gridCellKey` 的 floor 划分不一致。加噪后的点同样走 `snapToGrid`，
 * 保证"吸附结果落在 `gridCellKey` 所标识的格内"这一不变式成立。
 */
export function snapWithNoise(point: LatLng, sightingId: string, gridM: number, secret: string): LatLng {
  const sigmaM = gridM / 3; // 3σ ≈ 1 格：足以让相邻格混淆，又不会把点挪出区域
  const { dx, dy } = deterministicNoise(sightingId, sigmaM, secret);
  return snapToGrid(offsetMeters(point, dx, dy, CAMPUS_ORIGIN), gridM, CAMPUS_ORIGIN);
}

/* ------------------------------------------------------------------ *
 * 季节性加强（规格 §9.4）
 * ------------------------------------------------------------------ */

/** 上海本地月份（UTC+8，无夏令时） */
export function monthInShanghai(at: Date): number {
  return new Date(at.getTime() + 8 * 60 * 60 * 1000).getUTCMonth() + 1;
}

/**
 * 生效的模糊半径（规格 §9.4）。
 *
 * E5 的技术落地：繁殖期（黑天鹅约 3–6 月）把模糊半径放大，
 * **即使有人想公开巢穴位置，公开出来的点也落在放大后的范围内**。
 * 这不是靠"提醒用户不要公开"，而是**技术上做不到公开**。
 *
 * ⚠️ 与规格 §9.4 伪码的一处**刻意偏离**：伪码对"仅 isNestingSensitive"给 ×2，
 * 对"保护物种 + 繁殖期"给 ×4。本实现统一采用 `@kedaya/shared` 的
 * `seasonalFuzzMultiplier`（繁殖期一律 ×4）—— 理由是仓库里只能有**一份**
 * 季节系数真相（Lead 已在 shared 中冻结），且 ×4 比 ×2 **更保守**（更模糊），
 * 方向上只会更安全。差异已记入交付说明。
 */
export function effectiveFuzzRadius(
  species: FuzzSpeciesInput | null | undefined,
  zone: FuzzZoneInput | null | undefined,
  at: Date,
  defaultRadiusM: number = DEFAULT_FUZZ_RADIUS_M,
): number {
  const base = zone?.fuzzRadiusM ?? defaultRadiusM;
  if (!species) return base;
  const multiplier = seasonalFuzzMultiplier(
    monthInShanghai(at),
    species.isNestingSensitive,
    species.nestingMonths,
  );
  return base * multiplier;
}

/** 保护物种且处于繁殖月 → 需要额外公开延迟（规格 §9.5） */
export function needsNestingDelay(species: FuzzSpeciesInput | null | undefined, at: Date): boolean {
  if (!species || !species.isProtected || !species.isNestingSensitive) return false;
  return species.nestingMonths.includes(monthInShanghai(at));
}

/* ------------------------------------------------------------------ *
 * 时间粗化（规格 §9.5）
 * ------------------------------------------------------------------ */

/**
 * 时间粒度：精确时间戳同样会泄漏 —— "某同学凌晨 3 点在宿舍区上报"
 * 本身就暴露了作息。
 *
 * | 场景 | 粒度 |
 * | --- | --- |
 * | 普通区域，普通物种 | 小时（分秒置 0） |
 * | 敏感区 / k-匿名降级 | 天（00:00） |
 * | 保护物种 + 繁殖期 | 天 |
 */
export function timeGranularityFor(
  level: FuzzLevel,
  species: FuzzSpeciesInput | null | undefined,
  at: Date,
): 'hour' | 'day' {
  if (level !== 'grid') return 'day';
  if (species?.isNestingSensitive && species.nestingMonths.includes(monthInShanghai(at))) {
    return 'day';
  }
  return 'hour';
}

/** 时间粗化（委托 `@kedaya/shared` 的 `coarseTime`，全仓唯一实现） */
export function fuzzTime(t: Date, granularity: 'hour' | 'day'): string {
  return coarseTime(t.toISOString(), granularity);
}

/* ------------------------------------------------------------------ *
 * 四层流水线
 * ------------------------------------------------------------------ */

/**
 * 执行 §9.2 的四层流水线。
 *
 * 返回值里的 `geo` 是**唯一**可以公开的坐标形态；`level !== 'grid'` 时为 `null`，
 * 此时对外只暴露 `zoneId`。调用方**必须**把 `null` 原样传下去，
 * 不得"顺手补一个近似坐标"。
 */
export function fuzzSighting(req: FuzzRequest): FuzzResult {
  const defaultRadiusM = req.defaultRadiusM ?? DEFAULT_FUZZ_RADIUS_M;
  const radiusM = effectiveFuzzRadius(req.species, req.zone, req.observedAt, defaultRadiusM);
  const cellKey = gridCellKey(req.point, radiusM, CAMPUS_ORIGIN);
  const publishDelayDays = needsNestingDelay(req.species, req.observedAt)
    ? NESTING_PUBLISH_DELAY_DAYS
    : 0;

  // —— ① 敏感区判定：命中则**不输出任何坐标** ——
  const hit = isInSensitiveArea(req.point, req.sensitiveAreas ?? []);
  if (hit) {
    const level: FuzzLevel = 'zone-only';
    return {
      level,
      geo: null,
      zoneId: req.zone?.id ?? hit.id,
      observedAtFuzzed: fuzzTime(req.observedAt, 'day'),
      fuzzRadiusM: radiusM,
      gridCellKey: cellKey,
      sensitiveAreaId: hit.id,
      sensitiveReason: hit.reason,
      degradeReason: 'sensitive-area',
      publishDelayDays,
    };
  }

  // —— ④ k-匿名检查（在决定是否公开坐标之前做） ——
  if (req.distinctReportersInCell < K_ANONYMITY_MIN_REPORTERS) {
    const level: FuzzLevel = 'coarsened';
    return {
      level,
      geo: null,
      zoneId: req.zone?.id ?? null,
      observedAtFuzzed: fuzzTime(req.observedAt, 'day'),
      fuzzRadiusM: radiusM,
      gridCellKey: cellKey,
      sensitiveAreaId: null,
      sensitiveReason: null,
      degradeReason: 'k-anonymity',
      publishDelayDays,
    };
  }

  // —— ② 网格吸附 + ③ 确定性加噪（加噪后再吸附到同一套 floor 网格） ——
  const geo = snapWithNoise(req.point, req.sightingId, radiusM, req.secret);
  const level: FuzzLevel = 'grid';

  return {
    level,
    geo,
    zoneId: req.zone?.id ?? null,
    observedAtFuzzed: fuzzTime(req.observedAt, timeGranularityFor(level, req.species, req.observedAt)),
    fuzzRadiusM: radiusM,
    gridCellKey: cellKey,
    sensitiveAreaId: null,
    sensitiveReason: null,
    degradeReason: null,
    publishDelayDays,
  };
}

/* ------------------------------------------------------------------ *
 * 密钥（规格 §9.7）
 * ------------------------------------------------------------------ */

/** 最小密钥长度（字节） */
export const FUZZ_SECRET_MIN_BYTES = 32;

/**
 * 校验 `WILDLIFE_FUZZ_SECRET`。
 *
 * **这是本模块唯一"缺配置就崩溃"的地方，且是故意的**（规格 §9.7）：
 * 加噪是隐私防线，静默降级等于静默泄漏。宁可启动失败。
 * 对比 §5.4 的分类器降级（可以降级，因为分类不是隐私防线）。
 */
export function assertFuzzSecret(secret: string | undefined | null): string {
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      'WILDLIFE_FUZZ_SECRET 缺失：位置模糊化是隐私关键路径，不能降级为"不加噪"，因此启动失败（规格 §9.7）',
    );
  }
  if (Buffer.byteLength(secret, 'utf8') < FUZZ_SECRET_MIN_BYTES) {
    throw new Error(
      `WILDLIFE_FUZZ_SECRET 长度不足 ${FUZZ_SECRET_MIN_BYTES} 字节（规格 §9.7：需 ≥32 字节随机）`,
    );
  }
  return secret;
}

/** k-匿名统计窗口的起点（含） */
export function kAnonymityWindowStart(at: Date): Date {
  return new Date(at.getTime() - K_ANONYMITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}
