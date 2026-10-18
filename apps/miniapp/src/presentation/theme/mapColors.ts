import tokensJson from '@kedaya/design-tokens/tokens.json'

import type { OverlayColors } from '../../application/wildlife/wildlifeMap'

/**
 * 地图叠加层的色值 —— **全部派生自设计令牌**（契约 §6.2：禁止手写色值）。
 *
 * 为什么需要这个文件：底图上叠加的 marker 图标、区域圈、折线都通过
 * **JS 属性**接收色值（不是 CSS），因此无法用 SCSS 变量。
 *
 * ⚠️ 这里刻意 import **`tokens.json`**（令牌包的**真相来源文件本身**），
 * 而不是 `@kedaya/design-tokens` 的 TS 入口：
 * 那个入口内部写的是 `from './tokens.generated.js'` —— TypeScript 的 Bundler 解析
 * 能把它映射到 `.ts`，但 **webpack 不能**（构建会报
 * `resolve './tokens.generated.js' ... doesn't exist`）。
 * `tokens.json` 是 `app.config.ts` 已经在用的同一份文件，两端一致、构建确定。
 *
 * 色值仍然只有一个真相来源，端上没有任何硬编码色值。
 */

const color = tokensJson.color

/** 追加 alpha 通道（`#RRGGBB` → `#RRGGBBAA`）—— 不是新色值，只是加透明度 */
function withAlpha(hex: string, alpha: string): string {
  return `${hex}${alpha}`
}

/** 区域圈（普通区域）用信息蓝，敏感区用危险红 —— 让「不公开坐标」在视觉上就能区分 */
export const MAP_OVERLAY_COLORS: OverlayColors = {
  zoneStroke: color.info,
  zoneFill: withAlpha(color.info, '22'),
  sensitiveStroke: color.danger,
  sensitiveFill: withAlpha(color.danger, '22'),
  track: color.brandStrong,
}

/**
 * marker 图标路径（相对小程序根目录；由 `config/index.ts` 的 copy 拷进 dist）
 *
 * ⚠️ 原生 `<map>` 时代这里还有一份 `buildCallout()`（补全 Taro 的
 * `MapProps.callout` 必填字段）。换成 `KdyCampusMap` 后气泡由组件自己画
 * （见 `components/KdyCampusMap/index.scss`），该函数已随 `<map>` 一起删除 ——
 * 色值口径不变，仍全部来自设计令牌。
 */
export const MAP_MARKER_ICONS = {
  spot: '/assets/wildlife/marker-spot.png',
  sighting: '/assets/wildlife/marker-sighting.png',
  sensitive: '/assets/wildlife/marker-sensitive.png',
  track: '/assets/wildlife/marker-track.png',
} as const
