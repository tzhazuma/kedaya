import { useEffect, useState } from 'react'

/**
 * 倒计时（用于「重新发送验证码」的冷却）。
 *
 * 用 `endAt` 时间戳而不是每次 `-1`：小程序切后台会暂停定时器，
 * 自减计数会停在错误的数值上，用绝对时间才是对的。
 */
export function useCountdown(): {
  secondsLeft: number
  start: (seconds: number) => void
} {
  const [endAt, setEndAt] = useState<number | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)

  useEffect(() => {
    if (endAt === null) {
      setSecondsLeft(0)
      return
    }

    function tick(): void {
      const remain = Math.max(0, Math.ceil(((endAt as number) - Date.now()) / 1000))
      setSecondsLeft(remain)
      if (remain === 0) setEndAt(null)
    }

    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [endAt])

  return {
    secondsLeft,
    start: (seconds: number) => {
      setEndAt(Date.now() + seconds * 1000)
    },
  }
}
