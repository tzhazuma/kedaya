import Progress from '@taroify/core/progress'
import '@taroify/core/progress/style'

/**
 * KdyProgress —— 进度条（Taroify `Progress` 的令牌化封装）。
 *
 * 为什么不在页面里直接写一排 `View` 拼进度：宽度百分比属于**布局计算**，
 * 各模块各写一遍就会出现"某处的 0% 还留着一截、100% 撑破容器"这类差异。
 * 夹紧（clamp）与四舍五入只在**这一处**做。
 *
 * 颜色走 `appearance.scss` 里映射好的 `--primary-color`（可达鸭黄），
 * 因此默认就是品牌色，不需要在页面里传色值（契约 §6.2：色值只来自令牌）。
 */
export interface KdyProgressProps {
  /**
   * 进度百分比（0–100）。
   *
   * 超出范围或非有限数会被夹到 `[0, 100]`：服务端多算一格（`7/6`）时，
   * 画一条撑破容器的进度条比画 100% 更糟 —— 前者看起来像 UI 坏了。
   */
  percent: number
  /** 语义色：`brand`（默认）/ `success` / `warning` / `danger` */
  tone?: 'brand' | 'success' | 'warning' | 'danger'
  /** 是否在进度条上显示百分比文字（默认不显示：调用方多给「已拼 6/10」这类更具体的信息） */
  showLabel?: boolean
  className?: string
}

const TONE_COLOR = {
  brand: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
} as const

export function KdyProgress({
  percent,
  tone = 'brand',
  showLabel = false,
  className,
}: KdyProgressProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0)))

  return (
    <Progress
      className={className === undefined ? 'kdy-progress' : `kdy-progress ${className}`}
      percent={clamped}
      color={TONE_COLOR[tone]}
      label={showLabel ? `${clamped}%` : false}
    />
  )
}

export default KdyProgress
