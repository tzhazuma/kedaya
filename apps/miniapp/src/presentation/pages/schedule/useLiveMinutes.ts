import { useEffect, useReducer, useState } from 'react'

/**
 * 让「还有 20 分钟」在用户盯着页面时**真的往下走**。
 *
 * 服务端下发的是请求那一刻的分钟数（手机时间不准也不会算错），
 * 但用户可能在这一页停留十几分钟。这里不做任何时区/时钟换算：
 *
 *   · `minutes` 变化（重新拉取成功）时，记下"服务端说 20 分钟"与本地时刻；
 *   · 每 30 秒重渲染一次，用**本地流逝的时间**去减 —— 即使手机时钟偏了 3 分钟，
 *     两次采样之差仍然是准的；
 *   · 减到 0 就停在 0（页面文案是「马上开始」），不会出现负数倒计时。
 *
 * 30 秒而不是 1 秒：文案精度是分钟级，每秒重渲染只是白烧电量。
 */
export function useLiveMinutes(minutes: number | null): number | null {
  const [anchor, setAnchor] = useState<{ minutes: number | null; at: number }>(() => ({
    minutes,
    at: Date.now(),
  }))
  const [, tick] = useReducer((value: number) => (value + 1) % 1000000, 0)

  useEffect(() => {
    setAnchor({ minutes, at: Date.now() })
  }, [minutes])

  useEffect(() => {
    if (minutes === null) return
    const timer = setInterval(tick, 30000)
    return () => clearInterval(timer)
  }, [minutes])

  if (minutes === null) return null
  // 首帧（effect 尚未执行）或刚换了下一节课：先信服务端的值，避免闪一下旧数据
  if (anchor.minutes !== minutes) return minutes

  const elapsed = Math.floor((Date.now() - anchor.at) / 60000)
  return Math.max(0, minutes - elapsed)
}
