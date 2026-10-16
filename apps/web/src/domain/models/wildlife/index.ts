/**
 * wildlife 领域模型导出面（domain 层零框架、零 IO —— 契约 §7）。
 *
 * 分文件的原因：这个模块有四块**互相独立**的语义，混在一个文件里必然写错：
 * - `basemap.ts`   底图与坐标标定（方案 B 的像素 ↔ WGS84 映射）
 * - `species.ts`   物种分类、投喂政策、置信度分档、区域
 * - `sightings.ts` 观测记录（发现时间 vs 上报时间、坐标扣留、审核）
 * - `tracks.ts`    热点与**推断轨迹**（"非实测路径"）
 * - `ethics.ts`    伦理与隐私文案（硬要求）
 * - `geometry.ts`  叠加层几何（像素空间）
 */
export * from './basemap';
export * from './species';
export * from './sightings';
export * from './tracks';
export * from './ethics';
export * from './geometry';
