/**
 * 领域层统一出口。
 *
 * 依赖方向（契约 §7）：`presentation → application → domain ← data`
 * 本层**零框架依赖**：不 import Taro / React / 任何 IO。
 */
export * from './models'
export * from './ports'
