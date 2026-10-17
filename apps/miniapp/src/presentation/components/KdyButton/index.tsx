import Button from '@taroify/core/button'
import '@taroify/core/button/style'
import type { ReactNode } from 'react'

import './index.scss'

/**
 * KdyButton —— 统一按钮。
 *
 * 关于 `openType`：微信小程序的**分享必须由用户点击 `open-type="share"` 的按钮触发**，
 * 代码无法静默分享（见 `platform/share.ts`）。所以这里把 `openType` 透传出来，
 * 让页面用 `<KdyButton openType='share'>分享</KdyButton>` 走合法路径。
 *
 * `chooseAvatar` 同理：微信自 2022-10 起只允许用户**主动点击**
 * `<button open-type="chooseAvatar">` 才会回调头像，`getUserInfo` 已不再返回。
 */
export type KdyButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type KdyButtonSize = 'sm' | 'md' | 'lg'
export type KdyButtonOpenType = 'share' | 'contact' | 'getPhoneNumber' | 'chooseAvatar' | 'none'

/** `chooseAvatar` 的回调载荷（临时文件路径） */
export interface ChooseAvatarDetail {
  avatarUrl: string
}

export interface KdyButtonProps {
  children?: ReactNode
  variant?: KdyButtonVariant
  size?: KdyButtonSize
  /** 占满一行 */
  block?: boolean
  disabled?: boolean
  loading?: boolean
  openType?: KdyButtonOpenType
  /** `openType='chooseAvatar'` 生效时回调用户选中的头像临时路径 */
  onChooseAvatar?: (detail: ChooseAvatarDetail) => void
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
  onChooseAvatar,
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
      color={
        variant === 'danger'
          ? 'danger'
          : variant === 'primary'
            ? 'primary'
            : 'default'
      }
      variant={variant === 'ghost' ? 'outlined' : 'contained'}
      size={size === 'sm' ? 'small' : size === 'lg' ? 'large' : 'medium'}
      block={block}
      disabled={disabled || loading}
      loading={loading}
      openType={openType === 'none' ? undefined : openType}
      hoverClass='kdy-btn--hover'
      onClick={disabled || loading ? undefined : onClick}
      {...(onChooseAvatar === undefined
        ? {}
        : {
            onChooseAvatar: (event: { detail?: { avatarUrl?: string } }) => {
              const avatarUrl = event?.detail?.avatarUrl
              if (typeof avatarUrl === 'string' && avatarUrl.length > 0) {
                onChooseAvatar({ avatarUrl })
              }
            },
          })}
    >
      {children}
    </Button>
  )
}

export default KdyButton
