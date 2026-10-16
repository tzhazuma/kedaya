import { Button } from '@tarojs/components'
import type { ReactNode } from 'react'

import './index.scss'

/**
 * KdyButton —— 统一按钮。
 *
 * 关于 `openType`：微信小程序的**分享必须由用户点击 `open-type="share"` 的按钮触发**，
 * 代码无法静默分享（见 `platform/share.ts`）。所以这里把 `openType` 透传出来，
 * 让页面用 `<KdyButton openType='share'>分享</KdyButton>` 走合法路径。
 */
export type KdyButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type KdyButtonSize = 'sm' | 'md' | 'lg'
export type KdyButtonOpenType = 'share' | 'contact' | 'getPhoneNumber' | 'none'

export interface KdyButtonProps {
  children?: ReactNode
  variant?: KdyButtonVariant
  size?: KdyButtonSize
  /** 占满一行 */
  block?: boolean
  disabled?: boolean
  loading?: boolean
  openType?: KdyButtonOpenType
  onClick?: () => void
  className?: string
}

export function KdyButton({
  children,
  variant = 'primary',
  size = 'md',
  block = false,
  disabled = false,
  loading = false,
  openType = 'none',
  onClick,
  className,
}: KdyButtonProps) {
  const classes = [
    'kdy-btn',
    `kdy-btn--${variant}`,
    `kdy-btn--${size}`,
    block ? 'kdy-btn--block' : '',
    disabled || loading ? 'kdy-btn--disabled' : '',
    className ?? '',
  ]
    .filter((item) => item !== '')
    .join(' ')

  return (
    <Button
      className={classes}
      disabled={disabled || loading}
      loading={loading}
      openType={openType === 'none' ? undefined : openType}
      hoverClass='kdy-btn--hover'
      onClick={disabled || loading ? undefined : onClick}
    >
      {children}
    </Button>
  )
}

export default KdyButton
