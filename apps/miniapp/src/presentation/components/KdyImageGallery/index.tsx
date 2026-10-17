import { View } from '@tarojs/components'
import Image from '@taroify/core/image'
import { PhotoFail } from '@taroify/icons'
import Taro from '@tarojs/taro'
import '@taroify/core/image/style'

import './index.scss'

/**
 * KdyImageGallery —— 详情页/卡片里的图片展示。
 *
 * 两个刻意的做法：
 *
 * 1. **点击进入微信原生大图预览**（`Taro.previewImage`）。这是用户对图片的默认预期：
 *    能放大、能左右滑、能长按保存。自己写一个弹层只会更差。
 *
 * 2. **加载失败不留白块**：`fallback` 渲染一个「图片不可用」图标。列表里出现一个
 *    纯白方块比显示一张明确的坏图图标更容易被误当成布局 bug。
 *
 * 组件本身**不做权限判断** —— 传进来的地址一定是已通过服务端 `MediaUrlPolicy`
 * 校验的地址。空数组直接不渲染（页面不需要再判一次）。
 */

/** 单张缩略图（图片坏了要用同一个占位，避免两处样式漂移） */
function Broken() {
  return (
    <View className='kdy-gallery__fallback'>
      <PhotoFail className='kdy-gallery__fallback-icon' />
    </View>
  )
}

export interface KdyImageGalleryProps {
  urls: readonly string[]
  /** 每行几张（详情页 3 张、卡片里 4 张更紧凑） */
  columns?: number
  /** 卡片内的小尺寸模式（64px 方块） */
  compact?: boolean
  className?: string
}

/** 内容区可用宽度（375 基准 - 页面左右留白 12×2 - 卡片内边距 12×2） */
const CONTENT_WIDTH = 327
const GAP = 8

export function KdyImageGallery({ urls, columns = 3, compact = false, className }: KdyImageGalleryProps) {
  if (urls.length === 0) return null

  const size = compact ? 64 : Math.floor((CONTENT_WIDTH - (columns - 1) * GAP) / columns)

  const preview = (index: number): void => {
    void Taro.previewImage({ current: urls[index], urls: [...urls] })
  }

  return (
    <View
      className={['kdy-gallery', compact ? 'kdy-gallery--compact' : '', className ?? '']
        .filter((value) => value !== '')
        .join(' ')}
    >
      {urls.map((url, index) => (
        <View
          key={`${url}-${index}`}
          className='kdy-gallery__tile'
          style={{ width: `${size}px`, height: `${size}px` }}
          onClick={() => {
            preview(index)
          }}
        >
          <Image src={url} mode='aspectFill' className='kdy-gallery__image' fallback={<Broken />} />
        </View>
      ))}
    </View>
  )
}

/**
 * 单张列表缩略图。
 *
 * 列表卡片只展示**第一张**：列表的作用是"扫一眼决定点不点"，
 * 铺开所有图会把标题和价格挤下去，反而更难扫。想看全部的点进详情即可。
 */
export interface KdyImageThumbProps {
  /** 第一张图的地址（没有图就传 null，组件不渲染） */
  url: string | null
  /** 全部图片的**完整地址**（用于点击后能左右滑看全部）；缺省则只看这一张 */
  allUrls?: readonly string[]
  /** 图片总数（> 1 时右下角显示 "+N"） */
  count?: number
  className?: string
}

export function KdyImageThumb({ url, allUrls, count = 1, className }: KdyImageThumbProps) {
  if (url === null || url === '') return null
  const gallery = allUrls !== undefined && allUrls.length > 0 ? [...allUrls] : [url]

  return (
    <View className={['kdy-gallery__thumb', className ?? ''].filter((value) => value !== '').join(' ')}>
      <Image
        src={url}
        mode='aspectFill'
        className='kdy-gallery__thumb-image'
        fallback={<Broken />}
        onClick={() => {
          void Taro.previewImage({ current: url, urls: gallery })
        }}
      />
      {count > 1 ? <View className='kdy-gallery__thumb-more'>{`+${count - 1}`}</View> : null}
    </View>
  )
}
