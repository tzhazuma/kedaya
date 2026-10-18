/** React Bits adaptations for Taro. Source links and license: ./README.md. */
import { View } from '@tarojs/components'
import type { BaseEventOrig, ITouchEvent } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './index.scss'

interface AnimatedContentProps {
  children: ReactNode
  className?: string
  delay?: number
  duration?: number
}

/** Animated Content's staggered slide/opacity entrance, rendered by native WXSS. */
export function AnimatedContent({ children, className = '', delay = 0, duration = 640 }: AnimatedContentProps) {
  return (
    <View
      className={`rb-animated-content ${className}`.trim()}
      style={{ animationDelay: `${delay}ms`, animationDuration: `${duration}ms` }}
    >
      {children}
    </View>
  )
}

interface SpotlightCardProps {
  children: ReactNode
  className?: string
  onClick?: () => void
}

let spotlightSerial = 0
type CardRect = { left: number; top: number; width: number; height: number }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Spotlight Card's local radial light + Glare Hover's streak, adapted to touch. */
export function SpotlightCard({ children, className = '', onClick }: SpotlightCardProps) {
  const [id] = useState(() => `rb-spotlight-${++spotlightSerial}`)
  const [engaged, setEngaged] = useState(false)
  const [position, setPosition] = useState({ left: '76%', top: '18%' })
  const rect = useRef<CardRect | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const pressed = useRef(false)
  const lastPaint = useRef(0)

  useEffect(() => () => { pressed.current = false }, [])

  function paint() {
    if (!pressed.current || !rect.current) return
    const box = rect.current
    setPosition({
      left: `${clamp(pointer.current.x - box.left, 0, box.width)}px`,
      top: `${clamp(pointer.current.y - box.top, 0, box.height)}px`,
    })
  }

  function move(event: BaseEventOrig) {
    const touch = (event as ITouchEvent).touches?.[0]
    if (!touch) return
    pointer.current = { x: touch.clientX, y: touch.clientY }
    const now = Date.now()
    if (now - lastPaint.current < 32) return
    lastPaint.current = now
    paint()
  }

  function start(event: BaseEventOrig) {
    pressed.current = true
    rect.current = null
    setEngaged(true)
    move(event)
    // Query once per gesture. Native touchmove keeps scrolling available.
    Taro.createSelectorQuery().select(`#${id}`).boundingClientRect((box) => {
      if (!box || Array.isArray(box) || !pressed.current) return
      rect.current = box
      paint()
    }).exec()
  }

  function release() {
    pressed.current = false
    setEngaged(false)
  }

  return (
    <View
      id={id}
      className={`${className} rb-spotlight-card${engaged ? ' rb-spotlight-card--lit' : ''}`.trim()}
      hoverClass='rb-spotlight-card--pressed'
      hoverStartTime={0}
      hoverStayTime={80}
      onTouchStart={start}
      onTouchMove={move}
      onTouchEnd={release}
      onTouchCancel={release}
      onClick={onClick}
    >
      <View className='rb-spotlight-card__light' style={position} aria-hidden='true' />
      {children}
      <View className='rb-spotlight-card__glare' aria-hidden='true' />
      <View className='rb-spotlight-card__rim' aria-hidden='true' />
    </View>
  )
}
