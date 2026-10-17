import { Image, ScrollView, Text, View } from '@tarojs/components'
import type { BaseEventOrig, ITouchEvent } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  CAMPUS_ATTRIBUTION,
  CAMPUS_FEATURED,
  CAMPUS_MAP,
  CAMPUS_METERS_PER_PIXEL,
  CAMPUS_PLACES,
  campusCoordinate,
  campusPixel,
  isOnCampus,
} from '@kedaya/contracts'
import type { CampusPoint } from '@kedaya/contracts'

import { KdyButton } from '../KdyButton'
import { KdySearchBar } from '../KdySearchBar'
import {
  centeredOffset,
  circleRect,
  fitWidth,
  layoutFor,
  offsetForPixel,
  renderedPoint,
  segmentRect,
  viewportCenterPixel,
  zoomBounds,
} from './geometry'
import type { CampusImageSize, CampusOffset, CampusViewport } from './geometry'
import './index.scss'

/**
 * KdyCampusMap —— **真实校园底图**上的动物地图（替代小程序原生 `<map>`）。
 *
 * ## 为什么换掉原生 `<map>`
 *
 * 原生 `<map>` 显示的是腾讯 / 高德的通用街道图：校园里那些**小路、桥、
 * 楼名**全是错的（那是给城市导航用的数据）。而我们要回答的是
 * 「黑天鹅在哪片水面旁边」—— 必须用**学校自己的**校园 GIS 底图。
 *
 * ## 坐标系（三条硬规则）
 *
 * 1. 入参一律 **GCJ-02**（与 `<map>` 时代完全一致）。页面继续走
 *    `buildMapOverlays()` 把 WGS84 转成 GCJ-02，本组件不做 WGS84 转换。
 * 2. 底图像素由 `@kedaya/contracts` 的 `campusPixel()` 计算 ——
 *    **组件内不做任何经纬度近似**。
 * 3. 点选（`onPick`）回调回来的是 **GCJ-02**：调用方必须声明坐标来源
 *    （`setPoint(point, 'gcj02')`），由用例层转回 WGS84 再落库。
 *
 * ## 与原生 `<map>` 的功能对照（**没有删减**）
 *
 * | 原生 `<map>` | 本组件 |
 * | --- | --- |
 * | `markers` + `callout` | 图标 + 点中后展示气泡（`title` / `calloutText`） |
 * | `circles` | 区域圈（半径按米换算，`circleRect`） |
 * | `polyline` + `dottedLine` | 虚线折线（推断轨迹「视觉上不像实测路径」） |
 * | 手势缩放 / 拖动 | 拖动 + 放大 / 缩小 / 全景按钮 |
 * | （无） | 建筑与地标名称、按名称搜索定位、校园范围外的点选拦截 |
 *
 * 底图是**分包内**的 1 MB 资源 —— 放主包会顶穿微信 2 MiB 上限，
 * 见 `config/index.ts` 的 copy 配置与 `scripts/verify-weapp-build.cjs`。
 */

/** 底图资源：位于 wildlife 分包内（三个用到它的页面都在同一分包） */
const CAMPUS_IMAGE_SRC = '/presentation/pages/wildlife/assets/campus.jpg'

/** 底图在 375 设计稿下的高度 */
const SURFACE_HEIGHT_DESIGN_PX = 420
/** 设计稿基准宽度（与 Taro `designWidth` 一致） */
const DESIGN_WIDTH = 375
/** 测量前的兜底视口宽度：页面左右各 20px 内边距 */
const FALLBACK_PADDING_DESIGN_PX = 20
/** 与拖动手势区分的点按阈值（px） */
const TAP_SLOP_PX = 8
/** 标记的触摸半径（px）：44px 触摸区的一半，用于区分「点标记」与「点底图」 */
const MARKER_TAP_RADIUS_PX = 22
/** 搜索最多展示的结果数 */
const SEARCH_RESULT_LIMIT = 8

const CAMPUS_IMAGE: CampusImageSize = { width: CAMPUS_MAP.width, height: CAMPUS_MAP.height }

let surfaceSerial = 0

/** 区域圈（与 `domain/models/wildlife.ts` 的 `MapCircle` 同形状，页面可直接传） */
export interface KdyCampusMapCircle {
  latitude: number
  longitude: number
  /** 半径，**米** */
  radius: number
  /** 描边色（设计令牌） */
  color: string
  /** 填充色（设计令牌，可带 alpha） */
  fillColor: string
  /**
   * 圈的名字（如「黑天鹅湖」）。
   *
   * 有名字就**画在圈上**：地图上出现一个无名的圈，用户唯一能做的就是猜
   * （「这圆圈是什么？」）。名字是公开信息，与「敏感区坐标被模糊化」不冲突。
   */
  label?: string
}

/** 观测点 / 聚合热点标记 */
export interface KdyCampusMapMarker {
  /**
   * 数字 id。与 `<map>` 时代一样由 `buildMapOverlays()` 按下标分配，
   * 页面用 `onMarkerTap(markerId)` 反查业务 id。
   */
  markerId: number
  latitude: number
  longitude: number
  title: string
  /** 图标路径（相对小程序根目录，见 `theme/mapColors.ts`） */
  iconPath: string
  /** 点中后气泡里的文案 */
  calloutText: string
}

/** 折线（推断轨迹） */
export interface KdyCampusMapPolyline {
  points: Array<{ latitude: number; longitude: number }>
  color: string
  /** 虚线。推断轨迹**必须**是虚线 —— 让它在视觉上就不像实测路径（规格 §6.1） */
  dotted?: boolean
}

export interface KdyCampusMapProps {
  markers?: readonly KdyCampusMapMarker[]
  circles?: readonly KdyCampusMapCircle[]
  polyline?: KdyCampusMapPolyline | null
  /** 用户当前位置（GCJ-02）。轨迹页不传 */
  position?: CampusPoint | null
  /** 已选定 / 待上报的位置（GCJ-02）—— 画成醒目的圆点并自动居中 */
  picked?: CampusPoint | null
  /** 需要居中的点（GCJ-02，不绘制）。多用在「选中某个区域后看它」 */
  focus?: CampusPoint | null
  /** 点选底图（回调 GCJ-02）。不传则底图只读（不响应点选） */
  onPick?: (point: CampusPoint) => void
  /** 点击标记（传 `markerId`） */
  onMarkerTap?: (markerId: number) => void
  className?: string
}

export function KdyCampusMap({
  markers = [],
  circles = [],
  polyline = null,
  position = null,
  picked = null,
  focus = null,
  onPick,
  onMarkerTap,
  className,
}: KdyCampusMapProps) {
  const surfaceId = useRef(`kdy-campus-surface-${(surfaceSerial += 1)}`).current
  const scrollId = useRef(`kdy-campus-scroll-${(surfaceSerial += 1)}`).current
  const touchStart = useRef({ x: 0, y: 0 })

  /**
   * 视口尺寸必须**实测**，不能猜：底图是按视口宽度铺满的，
   * 宽度算错 5px 就会让整张图的点位整体偏移。
   */
  const windowInfo = useMemo(() => Taro.getWindowInfo(), [])
  const designRatio = windowInfo.windowWidth / DESIGN_WIDTH
  const [viewport, setViewport] = useState<CampusViewport>(() => ({
    width: Math.max(
      1,
      Math.round(windowInfo.windowWidth - 2 * FALLBACK_PADDING_DESIGN_PX * designRatio),
    ),
    height: Math.max(1, Math.round(SURFACE_HEIGHT_DESIGN_PX * designRatio)),
  }))

  useEffect(() => {
    Taro.createSelectorQuery()
      .select(`#${scrollId}`)
      .boundingClientRect((rect) => {
        if (rect === null || Array.isArray(rect)) return
        const width = Math.round(rect.width)
        if (width <= 0) return
        setViewport((current) => (current.width === width ? current : { ...current, width }))
      })
      .exec()
  }, [scrollId])

  const fittedWidth = fitWidth(viewport, CAMPUS_IMAGE)
  const [renderedWidth, setRenderedWidth] = useState(() => fittedWidth)
  const layout = useMemo(
    () => layoutFor(renderedWidth, CAMPUS_IMAGE, CAMPUS_METERS_PER_PIXEL),
    [renderedWidth],
  )

  /**
   * 视口当前滚动位置。**刻意放在 ref 里，而不是 state。**
   *
   * `scroll-view` 的 `scrollLeft` / `scrollTop` 是受控属性：如果每次 `onScroll`
   * 都 `setState` 回写，就等于「用户的每一次拖动 → 重渲染 → 重新下发滚动位置」，
   * 与微信自己的滚动惯性互相打断。真机上的表现正是「一直跳动、一闪一闪」。
   *
   * 于是拆成两半：
   *   · `offsetRef` —— 只记录**现在滚到哪了**（拖动、惯性滚动时只写 ref，不重渲染）；
   *   · `scrollTarget` —— 只在**程序化移动**（缩放 / 居中 / 全景 / 选中点位）时更新，
   *     用它去驱动 `scroll-view` 的位置。
   * 拖动过程中 `scrollTarget` 不动，微信就不会被我们拽回去。
   */
  const offsetRef = useRef<CampusOffset>(
    centeredOffset(layoutFor(fittedWidth, CAMPUS_IMAGE, CAMPUS_METERS_PER_PIXEL), viewport),
  )
  const [scrollTarget, setScrollTarget] = useState<CampusOffset>(offsetRef.current)

  /** 程序化移动：先更新 ref（后续手势接着算），再把受控滚动位置推过去 */
  function moveTo(next: CampusOffset): void {
    offsetRef.current = next
    setScrollTarget(next)
  }

  /**
   * 双指捏合状态：起始指距 + 起始渲染宽度。
   * 锚点固定取**当前视口中心** —— 见 `handleTouchMove` 里的说明。
   */
  const pinchRef = useRef<{ distance: number; width: number } | null>(null)
  /** 本次手势是捏合：抬手时不要误当成「在底图上选点」 */
  const pinchedRef = useRef(false)

  const [showAllPlaces, setShowAllPlaces] = useState(false)
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  const [focusedMarkerId, setFocusedMarkerId] = useState<number | null>(null)

  /**
   * 实测视口宽度到达（或真机旋转）后重新铺满底图。
   *
   * 保持**相对缩放**：用户已经放大到 2 倍时，换了宽度之后仍然是 2 倍，
   * 只是重新以校园中心为基准居中 —— 不这么做的话，旋转屏幕会把底图甩到角落。
   */
  const fittedRef = useRef(fittedWidth)
  useEffect(() => {
    const previous = fittedRef.current
    fittedRef.current = fittedWidth
    if (previous === fittedWidth) return
    const nextWidth = Math.max(fittedWidth, (renderedWidth / previous) * fittedWidth)
    setRenderedWidth(nextWidth)
    moveTo(centeredOffset(layoutFor(nextWidth, CAMPUS_IMAGE, CAMPUS_METERS_PER_PIXEL), viewport))
  }, [fittedWidth, renderedWidth, viewport])

  function focusPixel(pixel: { x: number; y: number }): void {
    moveTo(offsetForPixel(pixel, layout, viewport))
    setNotice('')
  }

  function focusPoint(point: CampusPoint): void {
    if (!isOnCampus(point)) {
      setNotice('该位置在校园范围外 —— 底图只覆盖上海科技大学校园。')
      return
    }
    focusPixel(campusPixel(point))
  }

  function handleZoom(factor: number): void {
    const bounds = zoomBounds(viewport, CAMPUS_IMAGE)
    const nextWidth = Math.min(bounds.max, Math.max(bounds.min, layout.renderedWidth * factor))
    if (Math.abs(nextWidth - layout.renderedWidth) < 0.5) return
    const center = viewportCenterPixel(offsetRef.current, layout, viewport)
    const nextLayout = layoutFor(nextWidth, CAMPUS_IMAGE, CAMPUS_METERS_PER_PIXEL)
    setRenderedWidth(nextWidth)
    moveTo(offsetForPixel(center, nextLayout, viewport))
  }

  function handleResetView(): void {
    const nextWidth = zoomBounds(viewport, CAMPUS_IMAGE).min
    const nextLayout = layoutFor(nextWidth, CAMPUS_IMAGE, CAMPUS_METERS_PER_PIXEL)
    setRenderedWidth(nextWidth)
    moveTo(centeredOffset(nextLayout, viewport))
    setNotice('')
  }

  // 选中某个点（区域 / 观测）后自动居中；同一坐标不会反复抢镜
  const focusKey = focus === null ? '' : `${focus.latitude.toFixed(6)},${focus.longitude.toFixed(6)}`
  useEffect(() => {
    if (focus === null) return
    focusPoint(focus)
    // eslint 未启用 react-hooks 规则；依赖刻意只取坐标 key（否则每次滚动都会重新居中）
  }, [focusKey])

  const pickedKey = picked === null ? '' : `${picked.latitude.toFixed(6)},${picked.longitude.toFixed(6)}`
  useEffect(() => {
    if (picked === null) return
    focusPoint(picked)
  }, [pickedKey])

  /**
   * Taro 把 `<View>` 的触摸事件声明成了「通用事件」（`BaseEventOrig`，没有
   * `touches` / `changedTouches`），而微信运行时会原样带上触摸点。
   * 这里集中收口这一次断言，其余代码只面对真正的触摸数据。
   */
  function touchPointOf(
    event: BaseEventOrig,
    source: 'touches' | 'changedTouches',
  ): { x: number; y: number } | null {
    const touch = (event as unknown as ITouchEvent)[source][0]
    return touch === undefined ? null : { x: touch.clientX, y: touch.clientY }
  }

  /** 当前按在屏幕上的手指（最多取前两根，够算捏合） */
  function touchPointsOf(event: BaseEventOrig): Array<{ x: number; y: number }> {
    const touches = (event as unknown as ITouchEvent).touches ?? []
    return Array.from(touches)
      .slice(0, 2)
      .map((touch) => ({ x: touch.clientX, y: touch.clientY }))
  }

  function handleTouchStart(event: BaseEventOrig): void {
    const points = touchPointsOf(event)
    if (points.length >= 2) {
      const [first, second] = points as [{ x: number; y: number }, { x: number; y: number }]
      const distance = Math.hypot(first.x - second.x, first.y - second.y)
      // 双指按下＝捏合手势：记录起始指距与起始缩放，并宣告「这不是点选」
      pinchRef.current = distance > 0 ? { distance, width: layout.renderedWidth } : null
      pinchedRef.current = true
      setFocusedMarkerId(null)
      return
    }
    const touch = touchPointOf(event, 'touches')
    if (touch === null) return
    touchStart.current = touch
  }

  /**
   * 双指捏合缩放 —— 「不能手动放大」的修复点（在此之前只有三个按钮能改缩放）。
   *
   * 锚点固定取**当前视口中心**：手指中点更好，但算它需要容器在屏幕上的位置，
   * 而那个矩形在滚动中一直在变，用「上一帧的矩形」去算反而会抖。
   * 视口中心不需要任何额外测量，缩放前后中心那块地图停在原地，最稳。
   *
   * 手指在动的同时 `scroll-view` 也会按原生滚动走两指的平均位移 ——
   * 对称的捏合平均位移约等于 0，所以不会互相抢；这也是这里不做
   * `catchtouchmove` 的原因（拦掉它，拖动就死了）。
   */
  function handleTouchMove(event: BaseEventOrig): void {
    const pinch = pinchRef.current
    if (pinch === null) return
    const points = touchPointsOf(event)
    if (points.length < 2) return
    const [first, second] = points as [{ x: number; y: number }, { x: number; y: number }]
    const distance = Math.hypot(first.x - second.x, first.y - second.y)
    if (distance <= 0) return

    const bounds = zoomBounds(viewport, CAMPUS_IMAGE)
    const nextWidth = Math.min(
      bounds.max,
      Math.max(bounds.min, (pinch.width * distance) / pinch.distance),
    )
    if (Math.abs(nextWidth - layout.renderedWidth) < 0.5) return

    // 以视口中心为锚：先记下中心对应哪块底图，缩放后再把它放回正中
    const anchor = viewportCenterPixel(offsetRef.current, layout, viewport)
    const nextLayout = layoutFor(nextWidth, CAMPUS_IMAGE, CAMPUS_METERS_PER_PIXEL)
    setRenderedWidth(nextWidth)
    moveTo(offsetForPixel(anchor, nextLayout, viewport))
  }

  function handleTouchEnd(event: BaseEventOrig): void {
    const remaining = touchPointsOf(event).length
    if (remaining < 2) pinchRef.current = null
    // 捏合结束（含只剩一根手指）不当作点选；等手指全部离开再复位
    if (pinchedRef.current) {
      if (remaining === 0) pinchedRef.current = false
      return
    }
    if (onPick === undefined) return
    const touch = touchPointOf(event, 'changedTouches')
    if (touch === null) return
    // 拖动地图不等于点选：位移超过阈值就当作平移
    if (Math.hypot(touch.x - touchStart.current.x, touch.y - touchStart.current.y) > TAP_SLOP_PX) {
      return
    }
    Taro.createSelectorQuery()
      .select(`#${surfaceId}`)
      .boundingClientRect((rect) => {
        if (rect === null || Array.isArray(rect)) return
        const localX = touch.x - rect.left
        const localY = touch.y - rect.top
        // 点在标记上 = 选那个观测点，不是「在底图上选一个位置」。
        // 标记自己也 `stopPropagation` 了，但部分平台不保证冒泡被拦住，
        // 这里按「离标记足够近」再兜一层，避免两种选中同时触发。
        const onMarker = markers.some((marker) => {
          const spot = renderedPoint(campusPixel(marker), layout)
          return Math.hypot(spot.x - localX, spot.y - localY) <= MARKER_TAP_RADIUS_PX
        })
        if (onMarker) return
        const point = campusCoordinate(localX / layout.scale, localY / layout.scale)
        if (!isOnCampus(point)) {
          setNotice('请在上海科技大学校园范围内选择位置。')
          return
        }
        setFocusedMarkerId(null)
        setNotice('')
        onPick(point)
      })
      .exec()
  }

  /** 触摸被系统打断（来电 / 切后台）：清掉捏合状态，不留下「永远不是点选」的手势 */
  function handleTouchCancel(): void {
    pinchRef.current = null
    pinchedRef.current = false
  }

  function handlePlaceTap(point: CampusPoint): void {
    setSearch('')
    focusPoint(point)
    // 选中一个地点＝选定那个位置（上报页会把它作为观测点）
    if (onPick !== undefined && isOnCampus(point)) onPick(point)
  }

  function handleMarkerTap(marker: KdyCampusMapMarker): void {
    setFocusedMarkerId(marker.markerId)
    setNotice('')
    onMarkerTap?.(marker.markerId)
  }

  const places = showAllPlaces ? CAMPUS_PLACES : CAMPUS_FEATURED
  const keyword = search.trim()
  const matches = keyword === '' ? [] : CAMPUS_PLACES.filter((place) => place.name.includes(keyword)).slice(0, SEARCH_RESULT_LIMIT)

  return (
    <View className={className === undefined ? 'kdy-campus' : `kdy-campus ${className}`}>
      <View className='kdy-campus__tools'>
        <KdySearchBar
          value={search}
          placeholder='搜索建筑 / 桥：图书馆、物质塔…'
          onChange={setSearch}
          onClear={() => setSearch('')}
        />
        <View className='kdy-campus__buttons'>
          <KdyButton size='sm' variant='ghost' onClick={() => handleZoom(1.4)}>
            放大
          </KdyButton>
          <KdyButton size='sm' variant='ghost' onClick={() => handleZoom(1 / 1.4)}>
            缩小
          </KdyButton>
          <KdyButton size='sm' variant='ghost' onClick={handleResetView}>
            全景
          </KdyButton>
          <KdyButton size='sm' variant='ghost' onClick={() => setShowAllPlaces(!showAllPlaces)}>
            {showAllPlaces ? '只看主要地标' : '显示全部建筑'}
          </KdyButton>
        </View>
      </View>

      {matches.length > 0 && (
        <View className='kdy-campus__results'>
          {matches.map((place) => (
            <Text key={place.id} className='kdy-campus__result' onClick={() => handlePlaceTap(place)}>
              {place.name}
            </Text>
          ))}
        </View>
      )}

      <ScrollView
        id={scrollId}
        className='kdy-campus__scroll'
        style={{ height: `${viewport.height}px` }}
        scrollX
        scrollY
        scrollLeft={scrollTarget.left}
        scrollTop={scrollTarget.top}
        onScroll={(event) => {
          const detail = event.detail as { scrollLeft?: number; scrollTop?: number }
          // 只记位置，**不 setState** —— 见 `offsetRef` 的注释（受控回写会抖）
          offsetRef.current = { left: detail.scrollLeft ?? 0, top: detail.scrollTop ?? 0 }
        }}
      >
        <View
          id={surfaceId}
          className='kdy-campus__surface'
          style={{ width: `${layout.renderedWidth}px`, height: `${layout.renderedHeight}px` }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
        >
          <Image
            className='kdy-campus__image'
            src={CAMPUS_IMAGE_SRC}
            mode='scaleToFill'
            style={{ width: `${layout.renderedWidth}px`, height: `${layout.renderedHeight}px` }}
          />

          {/* 区域圈：半径是米，必须经 pxPerMeter 换算（circleRect） */}
          {circles.map((circle, index) => {
            const rect = circleRect(campusPixel(circle), circle.radius, layout)
            return (
              <View
                key={`circle-${index}`}
                className='kdy-campus__circle'
                style={{
                  left: `${rect.left}px`,
                  top: `${rect.top}px`,
                  width: `${rect.size}px`,
                  height: `${rect.size}px`,
                  borderColor: circle.color,
                  backgroundColor: circle.fillColor,
                }}
              />
            )
          })}

          {/*
            圈的名字单独一层渲染（不嵌在圈里）：圈的 `left/top` 是绝对定位的，
            嵌进去后子元素的坐标就要按圈的局部坐标算，很容易跟着布局漂。
            「地图上这个圆圈是什么」必须**画在圈上**才答得出来 —— 只放图例里
            用户对不上号。
          */}
          {circles.map((circle, index) => {
            if (circle.label === undefined) return null
            const rect = circleRect(campusPixel(circle), circle.radius, layout)
            return (
              <Text
                key={`circle-label-${index}`}
                className='kdy-campus__circle-label'
                style={{
                  left: `${rect.left + rect.size / 2}px`,
                  top: `${rect.top}px`,
                  color: circle.color,
                }}
              >
                {circle.label}
              </Text>
            )
          })}

          {/* 推断轨迹：逐段旋转摆放，虚线由 repeating-linear-gradient 画出 */}
          {polyline === null
            ? null
            : polyline.points.slice(0, -1).map((point, index) => {
                const next = polyline.points[index + 1]
                if (next === undefined) return null
                const segment = segmentRect(
                  renderedPoint(campusPixel(point), layout),
                  renderedPoint(campusPixel(next), layout),
                )
                return (
                  <View
                    key={`segment-${index}`}
                    className='kdy-campus__segment'
                    style={{
                      left: `${segment.left}px`,
                      top: `${segment.top}px`,
                      width: `${segment.length}px`,
                      transform: `rotate(${segment.angle}deg)`,
                      ...(polyline.dotted === true
                        ? {
                            backgroundImage: `repeating-linear-gradient(90deg, ${polyline.color} 0 6px, transparent 6px 12px)`,
                          }
                        : { backgroundColor: polyline.color }),
                    }}
                  />
                )
              })}

          {/* 终点箭头：说明「推断的走向」，与原生 `<map>` 的 arrowLine 等价 */}
          {polyline === null || polyline.points.length < 2
            ? null
            : (() => {
                const last = polyline.points[polyline.points.length - 1]
                const previous = polyline.points[polyline.points.length - 2]
                if (last === undefined || previous === undefined) return null
                const tail = renderedPoint(campusPixel(previous), layout)
                const head = renderedPoint(campusPixel(last), layout)
                const angle = segmentRect(tail, head).angle
                return (
                  <View
                    className='kdy-campus__arrow'
                    style={{
                      left: `${head.x}px`,
                      top: `${head.y}px`,
                      transform: `translate(-50%, -50%) rotate(${angle + 45}deg)`,
                      borderRightColor: polyline.color,
                      borderTopColor: polyline.color,
                    }}
                  />
                )
              })()}

          {/* 建筑 / 地标名称（不可交互：它们不该抢走点选手势） */}
          {places.map((place) => {
            const spot = renderedPoint(place, layout)
            return (
              <Text
                key={place.id}
                className={`kdy-campus__label kdy-campus__label--${place.kind}`}
                style={{ left: `${spot.x}px`, top: `${spot.y}px` }}
              >
                {place.name}
              </Text>
            )
          })}

          {/* 观测点 / 聚合热点 */}
          {markers.map((marker) => {
            const spot = renderedPoint(campusPixel(marker), layout)
            const focused = marker.markerId === focusedMarkerId
            return (
              <View
                key={`marker-${marker.markerId}`}
                className={focused ? 'kdy-campus__marker kdy-campus__marker--focused' : 'kdy-campus__marker'}
                style={{ left: `${spot.x}px`, top: `${spot.y}px` }}
                onTouchStart={(event) => event.stopPropagation()}
                onTouchEnd={(event) => event.stopPropagation()}
                onClick={() => handleMarkerTap(marker)}
              >
                <Image className='kdy-campus__marker-icon' src={marker.iconPath} mode='aspectFit' />
                {focused && <Text className='kdy-campus__callout'>{marker.calloutText}</Text>}
              </View>
            )
          })}

          {position !== null && isOnCampus(position) && (
            <View
              className='kdy-campus__position'
              style={{
                left: `${renderedPoint(campusPixel(position), layout).x}px`,
                top: `${renderedPoint(campusPixel(position), layout).y}px`,
              }}
            />
          )}

          {picked !== null && isOnCampus(picked) && (
            <View
              className='kdy-campus__picked'
              style={{
                left: `${renderedPoint(campusPixel(picked), layout).x}px`,
                top: `${renderedPoint(campusPixel(picked), layout).y}px`,
              }}
            />
          )}
        </View>
      </ScrollView>

      <Text className='kdy-campus__caption'>{CAMPUS_ATTRIBUTION}</Text>
      <Text className='kdy-campus__caption'>
        {onPick === undefined
          ? '可拖动查看校园内的桥梁与建筑。'
          : '可拖动查看桥梁与建筑；点底图空白处即在该处选点。'}
      </Text>
      {notice !== '' && <Text className='kdy-campus__notice'>{notice}</Text>}
    </View>
  )
}

export default KdyCampusMap
