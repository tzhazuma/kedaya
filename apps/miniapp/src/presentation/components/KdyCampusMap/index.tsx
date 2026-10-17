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
import type { CampusImageSize, CampusViewport } from './geometry'
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
  const [offset, setOffset] = useState(() =>
    centeredOffset(layoutFor(fittedWidth, CAMPUS_IMAGE, CAMPUS_METERS_PER_PIXEL), viewport),
  )
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
    setOffset(centeredOffset(layoutFor(nextWidth, CAMPUS_IMAGE, CAMPUS_METERS_PER_PIXEL), viewport))
  }, [fittedWidth, renderedWidth, viewport])

  function focusPixel(pixel: { x: number; y: number }): void {
    setOffset(offsetForPixel(pixel, layout, viewport))
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
    const center = viewportCenterPixel(offset, layout, viewport)
    const nextLayout = layoutFor(nextWidth, CAMPUS_IMAGE, CAMPUS_METERS_PER_PIXEL)
    setRenderedWidth(nextWidth)
    setOffset(offsetForPixel(center, nextLayout, viewport))
  }

  function handleResetView(): void {
    const nextWidth = zoomBounds(viewport, CAMPUS_IMAGE).min
    const nextLayout = layoutFor(nextWidth, CAMPUS_IMAGE, CAMPUS_METERS_PER_PIXEL)
    setRenderedWidth(nextWidth)
    setOffset(centeredOffset(nextLayout, viewport))
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

  function handleTouchStart(event: BaseEventOrig): void {
    const touch = touchPointOf(event, 'touches')
    if (touch === null) return
    touchStart.current = touch
  }

  function handleTouchEnd(event: BaseEventOrig): void {
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
        enhanced
        scrollLeft={offset.left}
        scrollTop={offset.top}
        onScroll={(event) => {
          const detail = event.detail as { scrollLeft?: number; scrollTop?: number }
          setOffset({ left: detail.scrollLeft ?? 0, top: detail.scrollTop ?? 0 })
        }}
      >
        <View
          id={surfaceId}
          className='kdy-campus__surface'
          style={{ width: `${layout.renderedWidth}px`, height: `${layout.renderedHeight}px` }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
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
