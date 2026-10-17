import { Image, Input, ScrollView, Text, View } from '@tarojs/components'
import type { ITouchEvent } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { CAMPUS_MAP, CAMPUS_PLACES, CAMPUS_FEATURED, campusPixel, campusCoordinate, isOnCampus } from '@kedaya/contracts/campus-map'
import type { CampusPoint } from '@kedaya/contracts/campus-map'
import type { WildlifeSighting } from '@kedaya/contracts/wildlife'
import { WILDLIFE_CATEGORIES } from '@kedaya/contracts/wildlife'

let serial = 0
export function CampusView({ groups = [], position, picked, focus, onSelect, onPick }:
  { groups?: WildlifeSighting[][]; position?: CampusPoint | null; picked?: CampusPoint | null; focus?: CampusPoint | null;
    onSelect?: (group: WildlifeSighting[]) => void; onPick?: (point: CampusPoint, name?: string) => void }) {
  const id = useRef(`campus-surface-${++serial}`), start = useRef({ x: 0, y: 0 })
  const viewportWidth = () => Taro.getWindowInfo().windowWidth - 28
  // 与 wildlife.scss 中 .wa-campus-scroll 的 950px(rpx) 高度保持一致，用于计算铺满视野的全景宽度。
  const viewportHeight = () => Math.round(Taro.getWindowInfo().windowWidth * 950 / 750)
  const fullWidth = () => Math.max(viewportWidth(), Math.round(viewportHeight() * CAMPUS_MAP.width / CAMPUS_MAP.height))
  const [width, setWidth] = useState(() => fullWidth())
  const [left, setLeft] = useState(() => Math.max(0, Math.round((fullWidth() - (Taro.getWindowInfo().windowWidth - 28)) / 2)))
  const [top, setTop] = useState(0)
  const [search, setSearch] = useState(''), [detail, setDetail] = useState(false), [notice, setNotice] = useState('')
  const pos = useRef({ left, top })
  const scale = width / CAMPUS_MAP.width, height = CAMPUS_MAP.height * scale
  const places = detail ? CAMPUS_PLACES : CAMPUS_FEATURED
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
  function focusPixel(p: { x: number; y: number }, nextWidth = width) {
    const ratio = nextWidth / CAMPUS_MAP.width
    const nextLeft = clamp(p.x * ratio - viewportWidth() / 2, 0, Math.max(0, nextWidth - viewportWidth()))
    const nextTop = clamp(p.y * ratio - viewportHeight() / 2, 0, Math.max(0, CAMPUS_MAP.height * ratio - viewportHeight()))
    pos.current = { left: nextLeft, top: nextTop }; setLeft(nextLeft); setTop(nextTop); setNotice('')
  }
  function focusPoint(point: CampusPoint, nextWidth = width) {
    if (!isOnCampus(point)) { setNotice('当前位置在校园范围外，地图保持在上科大校内。'); return }
    focusPixel(campusPixel(point), nextWidth)
  }
  const pickedKey = picked ? `${picked.latitude},${picked.longitude}` : ''
  // A fresh focus object is also an explicit "return to campus" request at the same coordinates.
  useEffect(() => { if (focus) focusPoint(focus) }, [focus])
  useEffect(() => { if (picked) focusPoint(picked) }, [pickedKey])
  function zoom(next: number) {
    const target = clamp(next, fullWidth(), 2400)
    const center = { x: (pos.current.left + viewportWidth() / 2) / scale, y: (pos.current.top + viewportHeight() / 2) / scale }
    setWidth(target); focusPixel(center, target)
  }
  const pointStyle = (point: CampusPoint) => { const p = campusPixel(point); return { left: `${p.x * scale}px`, top: `${p.y * scale}px` } }
  return <View className='wa-campus'>
    <Input className='wa-input' value={search} onInput={e => setSearch(e.detail.value)} placeholder='搜索物质塔、图书馆、桥、宿舍…' />
    {search && <View className='wa-campus-results'>{CAMPUS_PLACES.filter(p => p.name.includes(search)).slice(0, 8).map(p => <Text key={p.id} onClick={() => { setSearch(''); focusPoint(p); if (onPick) onPick(p, p.name) }}>{p.name}</Text>)}</View>}
    <View className='wa-campus-tools'><Text onClick={() => zoom(width + 360)}>放大 ＋</Text><Text onClick={() => zoom(width - 360)}>缩小 −</Text>
      <Text onClick={() => { const next = fullWidth(), nextHeight = CAMPUS_MAP.height * next / CAMPUS_MAP.width
        const nextLeft = Math.max(0, Math.round((next - viewportWidth()) / 2)), nextTop = Math.max(0, Math.round((nextHeight - viewportHeight()) / 2))
        pos.current = { left: nextLeft, top: nextTop }; setWidth(next); setLeft(nextLeft); setTop(nextTop) }}>全景</Text><Text onClick={() => setDetail(v => !v)}>{detail ? '主要地标' : '全部建筑'}</Text></View>
    <ScrollView className='wa-campus-scroll' scrollX scrollY enhanced scrollLeft={left} scrollTop={top} onScroll={e => {
      const next = { left: e.detail.scrollLeft, top: e.detail.scrollTop }
      pos.current = next; setLeft(next.left); setTop(next.top)
    }}>
      <View id={id.current} className='wa-campus-surface' style={{ width: `${width}px`, height: `${height}px` }}
        onTouchStart={e => { const t = (e as ITouchEvent).touches[0]; if (t) start.current = { x: t.clientX, y: t.clientY } }}
        onTouchEnd={e => {
          if (!onPick) return
          const t = (e as ITouchEvent).changedTouches[0]; if (!t || Math.hypot(t.clientX - start.current.x, t.clientY - start.current.y) > 8) return
          Taro.createSelectorQuery().select(`#${id.current}`).boundingClientRect(rect => {
            if (!rect || Array.isArray(rect)) return
            const p = campusCoordinate((t.clientX - rect.left) / scale, (t.clientY - rect.top) / scale)
            if (!isOnCampus(p)) { setNotice('请在上科大校园内部选择动物发现位置。'); return }
            setNotice(''); onPick(p)
          }).exec()
        }}>
        <Image src='/assets/wildlife/campus.jpg' className='wa-campus-image' mode='scaleToFill' style={{ width: `${width}px`, height: `${height}px` }} />
        {places.map(p => <Text key={p.id} className={`wa-campus-label ${p.kind}`} style={pointStyle(p)} onTouchEnd={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); if (onPick) onPick(p, p.name); else focusPoint(p) }}>{p.name}</Text>)}
        {groups.filter(g => g[0]).map(g => {
          const item = g[0]!, kind = WILDLIFE_CATEGORIES.find(c => c.id === item.category)
          return <View key={g.length > 1 ? `group-${item.id}` : item.id} className='wa-campus-animal' style={{ ...pointStyle(item), background: kind?.color ?? '#65854e' }}
            onTouchEnd={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onSelect?.(g) }}><Text>{g.length > 1 ? g.length : kind?.glyph ?? '●'}</Text></View>
        })}
        {position && isOnCampus(position) && <View className='wa-campus-position' style={pointStyle(position)} />}
        {picked && isOnCampus(picked) && <Text className='wa-campus-picked' style={pointStyle(picked)}>📍</Text>}
      </View>
    </ScrollView>
    <Text className='wa-campus-caption'>仅上海科技大学校园 · 可向各方向拖动、放大查看桥梁与建筑</Text>
    <Text className='wa-campus-caption'>底图与建筑：上海科技大学校园 GIS · 物质塔：OpenStreetMap</Text>
    {notice && <Text className='wa-muted'>{notice}</Text>}
  </View>
}
