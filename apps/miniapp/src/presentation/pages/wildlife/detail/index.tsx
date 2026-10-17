import { Text, View } from '@tarojs/components'
import { useDidShow, useShareAppMessage, useRouter } from '@tarojs/taro'
import { formatRelativeTime } from '@kedaya/shared'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, readIdParam, wildlifeDetailPath } from '../../../../app/routes'
import {
  WILDLIFE_GUARD_HINT,
  formatCoordinate,
  isConfirmed,
  statusLabel,
} from '../../../../domain/models/wildlife'
import type { ReportTargetType } from '../../../../domain/models/report'
import { openLocation } from '../../../../platform/map'
import { toast } from '../../../../platform/navigation'
import {
  KdyButton,
  KdyCard,
  KdyEmpty,
  KdyReportEntry,
  KdyShareEntry,
  KdyTag,
} from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 校园动物观察点详情页。
 *
 * 这一页只有两个主动作，都是「不可逆的公共改动」之外最轻的：
 *   · **在地图上看看** —— 坐标是手填近似值，所以只是 `openLocation` 打开地图，
 *     不宣称"精确的动物巢穴"；
 *   · **我也看到了** —— 调 `POST /items/:id/confirm`，改的是**全校共享**的状态，
 *     不是给自己加一个计数（后端就这么实现的，页面上不能把它说成个人打卡）。
 *
 * 坐标按 **gcj02** 交给微信内置地图：与国内地图同一坐标系，
 * 否则会有几十米偏移（`platform/map.ts` 头注）。
 */

/**
 * 举报类型。与后端 `REPORT_TARGET_TYPES` 里的 `wildlife-spot` 一一对应
 * （两边白名单必须同步：漂移的后果是提交时 400，不是静默失败）。
 */
const WILDLIFE_REPORT_TARGET_TYPE: ReportTargetType = 'wildlife-spot'

export default function WildlifeDetailPage() {
  const container = getContainer()
  const router = useRouter()
  const id = readIdParam(router.params as Record<string, string | undefined>)

  const wildlife = container.useCases.wildlife
  const detail = useStore(wildlife.detail)

  useDidShow(() => {
    if (id !== null) void wildlife.detail.load(id)
  })

  /**
   * 转发给好友：落地路径**带上 id**，好友点开看到的就是这一条观察点，
   * 而不是被丢回列表里再翻一遍。
   */
  useShareAppMessage(() => ({
    title:
      detail.data === null
        ? '可达鸭 · 校园动物观察点'
        : `${detail.data.species} · ${detail.data.place} · 可达鸭`,
    path: id === null ? PAGE_PATHS.wildlifeList : wildlifeDetailPath(id),
  }))

  if (id === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='error' title='链接不对' description='缺少观察点 id，请从列表进入' />
      </View>
    )
  }

  if (detail.status === 'loading' && detail.data === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='loading' />
      </View>
    )
  }

  if (detail.status === 'error' && detail.data === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty
          mode='error'
          title='没能打开这个观察点'
          description={detail.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => void wildlife.detail.load(id)}
        />
      </View>
    )
  }

  if (detail.data === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='empty' title='观察点不存在' description='它可能已被删除，回列表看看别的吧。' />
      </View>
    )
  }

  // 已过 null 校验：用局部非空变量，事件处理里也能安全取用
  const item = detail.data
  const confirmed = isConfirmed(item.status)
  const coordinateLabel = formatCoordinate(item.lat, item.lng)

  async function handleOpenMap(): Promise<void> {
    const result = await openLocation({
      latitude: item.lat,
      longitude: item.lng,
      name: item.place,
      coordinateSystem: 'gcj02',
    })
    if (!result.ok) {
      toast(result.error.message, 'error')
      return
    }
    if (result.value === 'clipboard') {
      // H5 降级：拿不到地图就复制坐标，明确告诉用户"去哪看"，而不是静默什么都不做
      toast('已复制坐标，可粘贴到地图里查看')
    }
  }

  async function handleConfirm(): Promise<void> {
    const result = await wildlife.confirm(item.id)
    if (!result.ok) {
      toast(result.error.message, 'error')
      return
    }
    toast('已确认为有效观察点，谢谢你的补充', 'success')
  }

  return (
    <View className='kdy-page kdy-wildlife-detail'>
      <KdyHeading
        title={item.species}
        subtitle={item.place}
        eyebrow='KEDAYA · 猫鸟黑天鹅'
      />

      <KdyCard elevated={false}>
        <View className='kdy-wildlife-detail__hero'>
          <Text className='kdy-wildlife-detail__badge'>{item.species}</Text>
          <View className='kdy-wildlife-detail__status'>
            <KdyTag tone={confirmed ? 'success' : 'neutral'}>{statusLabel(item.status)}</KdyTag>
          </View>
        </View>

        <View className='kdy-wildlife-detail__rows'>
          <View className='kdy-wildlife-detail__row'>
            <Text className='kdy-wildlife-detail__k'>物种</Text>
            <Text className='kdy-wildlife-detail__v'>{item.species}</Text>
          </View>
          <View className='kdy-wildlife-detail__row'>
            <Text className='kdy-wildlife-detail__k'>地点</Text>
            <Text className='kdy-wildlife-detail__v'>{item.place}</Text>
          </View>
          <View className='kdy-wildlife-detail__row'>
            <Text className='kdy-wildlife-detail__k'>备注</Text>
            <Text className='kdy-wildlife-detail__v'>{item.note ?? '没有填写备注'}</Text>
          </View>
          <View className='kdy-wildlife-detail__row'>
            <Text className='kdy-wildlife-detail__k'>坐标</Text>
            <Text className='kdy-wildlife-detail__v'>{coordinateLabel}</Text>
          </View>
          <View className='kdy-wildlife-detail__row'>
            <Text className='kdy-wildlife-detail__k'>状态</Text>
            <Text className='kdy-wildlife-detail__v'>{statusLabel(item.status)}</Text>
          </View>
          <View className='kdy-wildlife-detail__row'>
            <Text className='kdy-wildlife-detail__k'>上报时间</Text>
            <Text className='kdy-wildlife-detail__v'>
              {formatRelativeTime(item.createdAt, container.clock.now())}
            </Text>
          </View>
        </View>
      </KdyCard>

      <KdyCard title='在地图上看大概位置' elevated={false}>
        <Text className='kdy-wildlife-detail__hint'>
          坐标是上报同学手填的近似值，不是精确定位，只用来在地图上找到大概在哪一片。
          到了现场请自己观察，别把它当成「动物就在这一点」。
        </Text>
        <View className='kdy-wildlife-detail__actions'>
          <KdyButton onClick={() => void handleOpenMap()}>打开地图</KdyButton>
        </View>
      </KdyCard>

      <KdyCard title='你也见过它吗' elevated={false}>
        <Text className='kdy-wildlife-detail__hint'>
          {confirmed
            ? '已经有同学确认过这个观察点仍然有效。谢谢大家帮忙维护这张地图。'
            : '确认会把这条观察点标记为「已确认」（全校共享），让其他同学更放心地参考，而不是给你记一次打卡。'}
        </Text>
        <View className='kdy-wildlife-detail__actions'>
          <KdyButton
            variant={confirmed ? 'ghost' : 'primary'}
            loading={detail.mutating}
            disabled={confirmed}
            onClick={() => void handleConfirm()}
          >
            {confirmed ? '已确认' : '我也看到了'}
          </KdyButton>
        </View>
      </KdyCard>

      <Text className='kdy-wildlife-detail__guard'>{WILDLIFE_GUARD_HINT}</Text>

      {detail.error !== null && <Text className='kdy-wildlife-detail__error'>{detail.error}</Text>}

      <KdyShareEntry />

      <KdyReportEntry
        targetType={WILDLIFE_REPORT_TARGET_TYPE}
        targetId={item.id}
        targetTitle={`${item.species} · ${item.place}`}
      />

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。观察记录由同学上报，坐标是近似值。拍摄请保持距离，不要投喂、不要追赶，也不要为了拍清楚把野生动物困住。
      </Text>
    </View>
  )
}
