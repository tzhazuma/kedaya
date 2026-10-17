import { Text, View } from '@tarojs/components'
import { useDidShow, useShareAppMessage, useRouter } from '@tarojs/taro'
import { formatRelativeTime } from '@kedaya/shared'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, readIdParam, techpieDetailPath } from '../../../../app/routes'
import {
  TECHPIE_DISCLAIMER,
  TECHPIE_NOTICE,
  categoryHint,
  categoryLabel,
  isReviewed,
  statusLabel,
  urlHost,
} from '../../../../domain/models/techpie'
import type { ReportTargetType } from '../../../../domain/models/report'
import { copyText } from '../../../../platform/clipboard'
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
 * 校园技术服务目录（`techpie`）详情页。
 *
 * ## 三条必须守住的规则
 *
 * 1. **不在此端打开外链**。微信小程序的 `web-view` 需要配置业务域名 + 备案，
 *    是提审硬门槛，我们拿不到，所以这里只给「复制服务地址」，并明说
 *    「复制后在浏览器里打开」。复制成功**不再弹 toast** —— 微信自己会弹
 *    「内容已复制」，再弹一次用户会看到两条。
 * 2. **`sync`（「我核对过了」）不是同步**。后端只是把 status 写成 `synced`，
 *    并靠 `@updatedAt` 推进 `updatedAt`；页面把它读作「人工核对」，
 *    也就是说，状态是**人**维护的，不是系统探测的。
 * 3. **举报入口放在最底部**，且指向 `'techpie-link'`：共建目录最容易被塞广告 /
 *    钓鱼链接，而链接本身没有作者可追责，只能靠举报 + 人工复核。
 */

/** 与后端 `REPORT_TARGET_TYPES` 的 `'techpie-link'` 一一对应（漂移的后果是提交时 400） */
const TECHPIE_REPORT_TARGET_TYPE: ReportTargetType = 'techpie-link'

export default function TechpieDetailPage() {
  const container = getContainer()
  const router = useRouter()
  const id = readIdParam(router.params as Record<string, string | undefined>)

  const techpie = container.useCases.techpie
  const detail = useStore(techpie.detail)

  useDidShow(() => {
    if (id !== null) void techpie.detail.load(id)
  })

  /** 转发给好友：落地路径**带上 id**，好友点开看到的就是这一条服务 */
  useShareAppMessage(() => ({
    title:
      detail.data === null
        ? '可达鸭 · 校园技术服务'
        : `${detail.data.name} · 校园技术服务 · 可达鸭`,
    path: id === null ? PAGE_PATHS.techpieList : techpieDetailPath(id),
  }))

  if (id === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='error' title='链接不对' description='缺少服务 id，请从列表进入' />
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
          title='没能打开这条服务'
          description={detail.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => void techpie.detail.load(id)}
        />
      </View>
    )
  }

  if (detail.data === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty
          mode='empty'
          title='这条服务不存在'
          description='它可能已被下架，回列表看看别的吧。'
        />
      </View>
    )
  }

  // 已过 null 校验：用局部非空变量，事件处理里也能安全取用
  const link = detail.data
  const reviewed = isReviewed(link.status)
  const now = container.clock.now()

  async function handleCopy(): Promise<void> {
    const result = await copyText(link.url)
    if (!result.ok) {
      // 失败必须说清楚，否则用户以为复制成功了、去浏览器里粘贴不出东西
      toast(result.error.message, 'error')
      return
    }
    // 成功不弹：微信 setClipboardData 自己会弹「内容已复制」
  }

  async function handleSync(): Promise<void> {
    const result = await techpie.sync(link.id)
    if (!result.ok) {
      toast(result.error.message, 'error')
      return
    }
    // 成功就地刷新详情（由 detail.mutate 用服务端返回的实体替换），再给一句确认
    toast(reviewed ? '已更新核对时间' : '已标记为核对过，谢谢你的维护', 'success')
  }

  return (
    <View className='kdy-page kdy-techpie-detail'>
      <KdyHeading title={link.name} subtitle={urlHost(link.url)} eyebrow='KEDAYA · 技术服务目录' />

      <Text className='kdy-techpie-detail__notice'>{TECHPIE_NOTICE}</Text>

      <KdyCard title='服务地址' elevated={false}>
        <Text className='kdy-techpie-detail__url'>{link.url}</Text>
        <Text className='kdy-techpie-detail__hint'>
          可达鸭不在这里打开外部网页（小程序打开外链需要业务域名与备案）。请先复制地址，
          再粘贴到手机或电脑的浏览器里打开。
        </Text>
        <View className='kdy-techpie-detail__actions'>
          <KdyButton onClick={() => void handleCopy()}>复制服务地址</KdyButton>
        </View>
      </KdyCard>

      <KdyCard title='这条记录的状况' elevated={false}>
        <View className='kdy-techpie-detail__rows'>
          <View className='kdy-techpie-detail__row'>
            <Text className='kdy-techpie-detail__k'>分类</Text>
            <Text className='kdy-techpie-detail__v'>{categoryLabel(link.category)}</Text>
          </View>
          <View className='kdy-techpie-detail__row'>
            <Text className='kdy-techpie-detail__k'>分类说明</Text>
            <Text className='kdy-techpie-detail__v'>{categoryHint(link.category)}</Text>
          </View>
          <View className='kdy-techpie-detail__row'>
            <Text className='kdy-techpie-detail__k'>状态</Text>
            <Text className='kdy-techpie-detail__v'>
              <KdyTag tone={reviewed ? 'info' : 'success'}>{statusLabel(link.status)}</KdyTag>
            </Text>
          </View>
          <View className='kdy-techpie-detail__row'>
            <Text className='kdy-techpie-detail__k'>最后核对</Text>
            <Text className='kdy-techpie-detail__v'>
              {formatRelativeTime(link.updatedAt, now)}
            </Text>
          </View>
          <View className='kdy-techpie-detail__row'>
            <Text className='kdy-techpie-detail__k'>登记时间</Text>
            <Text className='kdy-techpie-detail__v'>
              {formatRelativeTime(link.createdAt, now)}
            </Text>
          </View>
        </View>

        <Text className='kdy-techpie-detail__hint'>
          {reviewed
            ? '「已核对」表示最近有同学点过下面的按钮，并更新了「最后核对」时间。它不代表可达鸭探测过这个链接。'
            : '还没有同学核对过这条。如果你刚打开过并且它确实可用，点一下下面的按钮即可帮到其他人。'}
        </Text>

        <View className='kdy-techpie-detail__actions'>
          <KdyButton loading={detail.mutating} onClick={() => void handleSync()}>
            {reviewed ? '再核对一次' : '我核对过了'}
          </KdyButton>
        </View>
      </KdyCard>

      {detail.error !== null && <Text className='kdy-techpie-detail__error'>{detail.error}</Text>}

      <KdyShareEntry />

      {/* 刻意放在最底部：共建目录会被塞进广告 / 钓鱼链接，举报入口不能落在视线第一落点 */}
      <KdyReportEntry
        targetType={TECHPIE_REPORT_TARGET_TYPE}
        targetId={link.id}
        targetTitle={`${link.name} · ${urlHost(link.url)}`}
      />

      <Text className='kdy-disclaimer'>{TECHPIE_DISCLAIMER}</Text>
    </View>
  )
}
