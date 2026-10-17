import { Text, View } from '@tarojs/components'
import Image from '@taroify/core/image'
import Loading from '@taroify/core/loading'
import { AddOutlined, Close, WarningOutlined } from '@taroify/icons'
import '@taroify/core/image/style'
import '@taroify/core/loading/style'

import { imageCountLabel } from '../../../domain/models/media'
import type { AttachmentItem } from '../../hooks/useImageAttachments'
import { describeAvailability } from '../../hooks/useImageAttachments'
import type { MediaAvailability } from '../../../application/media/mediaUseCases'
import './index.scss'

/**
 * KdyImageUploader —— 发布页的「多图上传」控件。
 *
 * ## 为什么没有直接用 Taroify 的 `Uploader`
 *
 * `Uploader` 是**受控**组件：它用自己的 `UploadFile[]` 表达状态，删除时通过
 * `onChange` 回传一个新数组。而本项目的每一项都需要「按本地 id 精确重试」和
 * 「上传失败时保留原图 + 显示原因」，用它的数组反推 id 会引入一层易错的映射。
 *
 * 因此这里只借 Taroify 的**原子组件**（`Image` / `Loading` + 官方图标），
 * 网格与状态遮罩自己画 —— 状态机仍然只有一份（`useImageAttachments`）。
 *
 * ## 三个必须显式的状态
 *
 * | 情况 | 表现 |
 * |---|---|
 * | 服务端没配对象存储 | 整块**不渲染**选图入口，只留一句"为什么不能发图、找谁开" |
 * | 能力探测没问到（断网/500） | 入口**保留但禁用** + 「重试」，而不是凭空消失 |
 * | 有图正在传 / 传失败 | 图上有遮罩；失败**必须**能点着重试，不能静默丢图 |
 */
export interface KdyImageUploaderProps {
  items: AttachmentItem[]
  availability: MediaAvailability
  /** 是否已达张数上限 */
  full: boolean
  maxCount: number
  /** 点「添加图片」 */
  onAdd: () => void
  onRemove: (id: string) => void
  onRetry: (id: string) => void
  /** 能力探测失败时的「重试」（不传则不显示） */
  onRetryAvailability?: () => void
}

export function KdyImageUploader({
  items,
  availability,
  full,
  maxCount,
  onAdd,
  onRemove,
  onRetry,
  onRetryAvailability,
}: KdyImageUploaderProps) {
  const view = describeAvailability(availability)
  const failed = items.filter((item) => item.status === 'failed')

  return (
    <View className='kdy-uploader'>
      <View className='kdy-uploader__grid'>
        {items.map((item) => (
          <View key={item.id} className='kdy-uploader__tile'>
            <Image
              src={item.previewUrl}
              mode='aspectFill'
              className='kdy-uploader__image'
            />

            {item.status === 'uploading' ? (
              <View className='kdy-uploader__mask'>
                <Loading className='kdy-uploader__spinner' />
                <Text className='kdy-uploader__mask-text'>上传中</Text>
              </View>
            ) : null}

            {item.status === 'failed' ? (
              <View className='kdy-uploader__mask kdy-uploader__mask--failed' onClick={() => onRetry(item.id)}>
                <WarningOutlined className='kdy-uploader__fail-icon' />
                <Text className='kdy-uploader__mask-text'>点我重试</Text>
              </View>
            ) : null}

            <View
              className='kdy-uploader__remove'
              onClick={() => {
                onRemove(item.id)
              }}
            >
              <Close className='kdy-uploader__remove-icon' />
            </View>
          </View>
        ))}

        {view.showEntry && !full ? (
          <View
            className={view.canAdd ? 'kdy-uploader__add' : 'kdy-uploader__add kdy-uploader__add--disabled'}
            onClick={
              view.canAdd
                ? () => {
                    onAdd()
                  }
                : undefined
            }
          >
            <AddOutlined className='kdy-uploader__add-icon' />
            <Text className='kdy-uploader__add-text'>{items.length === 0 ? '添加图片' : '继续添加'}</Text>
          </View>
        ) : null}
      </View>

      <View className='kdy-uploader__footer'>
        <Text className='kdy-uploader__count'>{imageCountLabel(items.length, maxCount)}</Text>
        {failed.length > 0 ? (
          <Text className='kdy-uploader__failed'>有 {failed.length} 张没传成功，点图可重试</Text>
        ) : null}
      </View>

      {view.note === null ? null : (
        <View className='kdy-uploader__note'>
          <Text className='kdy-uploader__note-text'>{view.note}</Text>
          {availability.status === 'disabled' && availability.reason === 'unavailable' && onRetryAvailability !== undefined ? (
            <Text
              className='kdy-uploader__note-action'
              onClick={() => {
                onRetryAvailability()
              }}
            >
              重试
            </Text>
          ) : null}
        </View>
      )}

      {view.canAdd ? (
        <Text className='kdy-uploader__hint'>支持 JPG / PNG，选好会立即上传（图片里的位置信息会在服务端被清除）</Text>
      ) : null}
    </View>
  )
}
