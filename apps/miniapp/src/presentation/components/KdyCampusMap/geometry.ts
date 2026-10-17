/**
 * 校园底图的几何计算 —— 纯函数，不依赖 React / Taro（因此可直接单测）。
 *
 * 为什么单独一层：底图是**一张固定像素尺寸的图片**，而「铺满视野、缩放、
 * 平移、圈半径换算」全是坐标运算。把它们写在组件里就没法测，而这类
 * 「除以零 / 缩放算错」的 bug 表现只是**点位整体偏一点**，肉眼很难发现。
 *
 * 坐标系约定（与 `@kedaya/contracts` 的 `campus-map` 模块一致）：
 * - **底图像素**：底图原图坐标系，`x` 向右、`y` 向下，原点在左上角；
 * - **渲染像素**：屏幕上真实 CSS px。`scale = 渲染宽度 / 底图宽度`。
 */

export interface CampusViewport {
  /** 视口宽度（CSS px）—— 底图滚动区域本身的宽 */
  width: number
  /** 视口高度（CSS px） */
  height: number
}

export interface CampusImageSize {
  width: number
  height: number
}

export interface CampusLayout {
  /** 底图渲染宽度（CSS px） */
  renderedWidth: number
  /** 底图渲染高度（CSS px） */
  renderedHeight: number
  /** 1 个底图像素 → 多少渲染像素 */
  scale: number
  /** 1 米 → 多少渲染像素 */
  pxPerMeter: number
}

export interface CampusOffset {
  left: number
  top: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 「铺满视野」所需的渲染宽度。
 *
 * 取「视口宽」与「整张底图高度缩放后铺满视口所需的宽度」二者较大者：
 * 保证默认视图**纵向不露白**（宁可横向可以拖动）。
 */
export function fitWidth(viewport: CampusViewport, image: CampusImageSize): number {
  if (viewport.height <= 0 || image.height <= 0) return Math.max(1, viewport.width)
  return Math.max(viewport.width, (viewport.height * image.width) / image.height)
}

/**
 * 缩放区间。
 *
 * 下限是「铺满视野」，上限允许放到底图**原始像素的 1:1**（再大就是纯放大模糊），
 * 同时至少给 3 倍于下限，避免小屏上根本拉不开。
 */
export function zoomBounds(viewport: CampusViewport, image: CampusImageSize): { min: number; max: number } {
  const min = fitWidth(viewport, image)
  return { min, max: Math.max(min * 3, image.width) }
}

/** 由渲染宽度算出完整布局（高度与缩放都由它派生，避免各处各算一次） */
export function layoutFor(
  renderedWidth: number,
  image: CampusImageSize,
  metersPerPixel: number,
): CampusLayout {
  const safeWidth = Math.max(1, renderedWidth)
  const scale = safeWidth / image.width
  return {
    renderedWidth: safeWidth,
    renderedHeight: image.height * scale,
    scale,
    // 1 个底图像素 = metersPerPixel 米；换算成渲染像素要再乘 scale。
    // metersPerPixel ≤ 0 说明数据坏了 —— 返回 0 而不是 Infinity，宁可圈画不出来也不要崩。
    pxPerMeter: metersPerPixel > 0 ? scale / metersPerPixel : 0,
  }
}

/** 把偏移夹回「底图边界内」（底图小于视口时居中在 0） */
export function clampOffset(
  offset: CampusOffset,
  layout: CampusLayout,
  viewport: CampusViewport,
): CampusOffset {
  return {
    left: clamp(offset.left, 0, Math.max(0, layout.renderedWidth - viewport.width)),
    top: clamp(offset.top, 0, Math.max(0, layout.renderedHeight - viewport.height)),
  }
}

/** 居中偏移（默认视图：整个校园在视口正中） */
export function centeredOffset(layout: CampusLayout, viewport: CampusViewport): CampusOffset {
  return clampOffset(
    {
      left: (layout.renderedWidth - viewport.width) / 2,
      top: (layout.renderedHeight - viewport.height) / 2,
    },
    layout,
    viewport,
  )
}

/** 让某个**底图像素**落在视口正中的偏移（超出边界时夹回） */
export function offsetForPixel(
  pixel: { x: number; y: number },
  layout: CampusLayout,
  viewport: CampusViewport,
): CampusOffset {
  return clampOffset(
    {
      left: pixel.x * layout.scale - viewport.width / 2,
      top: pixel.y * layout.scale - viewport.height / 2,
    },
    layout,
    viewport,
  )
}

/** 视口正中对应的**底图像素**（缩放时用它保持中心不动） */
export function viewportCenterPixel(
  offset: CampusOffset,
  layout: CampusLayout,
  viewport: CampusViewport,
): { x: number; y: number } {
  return {
    x: (offset.left + viewport.width / 2) / layout.scale,
    y: (offset.top + viewport.height / 2) / layout.scale,
  }
}

/** 底图像素 → 渲染位置（叠加层的 `left` / `top` 就是它的 x / y） */
export function renderedPoint(
  pixel: { x: number; y: number },
  layout: CampusLayout,
): { x: number; y: number } {
  return { x: pixel.x * layout.scale, y: pixel.y * layout.scale }
}

/**
 * 区域圈的外接矩形。
 *
 * 半径是**米**，因此先经 `pxPerMeter` 换成渲染像素 ——
 * 这是全仓库唯一一处米 → 像素的换算，页面不要自己乘。
 */
export function circleRect(
  centerPixel: { x: number; y: number },
  radiusM: number,
  layout: CampusLayout,
): { left: number; top: number; size: number } {
  const size = Math.max(0, radiusM) * layout.pxPerMeter * 2
  const center = renderedPoint(centerPixel, layout)
  return { left: center.x - size / 2, top: center.y - size / 2, size }
}

/**
 * 折线的一段：从 `a` 到 `b` 的位置 / 长度 / 旋转角度（deg）。
 *
 * 小程序没有 SVG / canvas 叠加层，画一条线只能用一个 `View` 旋转摆放，
 * 因此这一段的几何必须算准（角度以 `transform-origin: 0 0` 为准）。
 */
export function segmentRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { left: number; top: number; length: number; angle: number } {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  return {
    left: a.x,
    top: a.y,
    length,
    angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
  }
}
