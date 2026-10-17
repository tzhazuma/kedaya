import { Text, View } from '@tarojs/components'
import { useDidShow, useShareAppMessage, useRouter } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { faqDetailPath, readIdParam } from '../../../../app/routes'
import { summarize } from '../../../../domain/models/faq'
import type { FaqEntry } from '../../../../domain/models/faq'
import { toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyEmpty, KdyReportEntry, KdyShareEntry, KdyTag } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 常见问题详情页。
 *
 * 页面职责很窄：把一条问答完整、舒服地读出来，并给一个「有帮助」的热度动作。
 *
 * ## 「有帮助」为什么要客户端自己锁一次
 *
 * 后端 `POST /faq/items/:id/helpful` 是**无脑 +1**（`{ increment: 1 }`），
 * 既不知道是谁点的、也没有投票表可以查重。于是「连点两次」会真的加 2。
 * 用例层（`faqUseCases.markHelpful`）把「我已标记过的 id」记在本地缓存里，
 * 第二次点击**不发请求**直接返回 CONFLICT。这里额外做一道 UI 防线：
 * 点击后**立刻**把按钮置为不可再点（`marked`），避免连点落在请求往返的窗口里。
 *
 * 需要如实说明的边界：这只拦得住本机重复点击，拦不住换设备/清缓存后再点。
 * 所以文案是「有帮助 N」（热度计数），不是「N 人觉得有用」。
 *
 * ## 举报入口
 *
 * 问答是**同学共建的公开内容** —— 别人可以往里塞广告、甚至"补办校园卡请先转账"
 * 这类诈骗引导，所以「能举报」是必要的。`faq-entry` 已同时登记在
 * 客户端 `ReportTargetType` 与后端 `REPORT_TARGET_TYPES`（漂移的后果是提交时 400）。
 */
export default function FaqDetailPage() {
  const container = getContainer()
  const router = useRouter()
  const id = readIdParam(router.params as Record<string, string | undefined>)

  const faq = container.useCases.faq
  const detail = useStore(faq.detail)

  // 初态同步读本地标记：重开小程序后按钮不会又变回「未标记」
  const [marked, setMarked] = useState(() => (id === null ? false : faq.isMarkedHelpful(id)))
  const [marking, setMarking] = useState(false)

  useDidShow(() => {
    if (id !== null) void faq.detail.load(id)
  })

  if (id === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='error' title='链接不对' description='缺少信息 id，请从列表进入' />
      </View>
    )
  }

  /**
   * 转发落地路径**带上 id**：好友点开看到的就是这一条问答，
   * 而不是被丢回列表里再找一遍。转发标题只由用户点击
   * `open-type='share'` 的按钮触发（页面底部的 `<KdyShareEntry />`）。
   */
  useShareAppMessage(() => ({
    title: detail.data === null ? '可达鸭 · 常见问题' : `${detail.data.question} · 可达鸭`,
    path: faqDetailPath(id),
  }))

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
          title='没能打开这条问答'
          description={detail.error ?? '请稍后重试'}
          actionText='重试'
          onAction={() => void faq.detail.load(id)}
        />
      </View>
    )
  }

  if (detail.data === null) {
    return (
      <View className='kdy-page'>
        <KdyEmpty mode='empty' title='这条问答不存在' />
      </View>
    )
  }

  const item: FaqEntry = detail.data
  // 派生视图复用领域函数：分类标题、时间文案、预览都只有一处实现
  const view = summarize(item, container.clock.now())

  async function handleHelpful(): Promise<void> {
    if (id === null || marked || marking) return

    // 先锁按钮再发请求：请求往返期间连点会真的多加计数
    setMarked(true)
    setMarking(true)
    const result = await faq.markHelpful(id)
    setMarking(false)

    if (result.ok) {
      // 用服务端返回的实体替换本地详情，计数以后端为准
      faq.detail.seed(result.value)
      toast('谢谢，你让这条更有用了', 'success')
      return
    }

    // CONFLICT = 本机之前已经标记过（用例层拦下、没发请求），并非真的失败
    if (result.error.code === 'CONFLICT') {
      toast('你已经标记过这一条了')
      return
    }

    // 请求失败：解锁按钮，允许重试
    setMarked(false)
    toast(result.error.message, 'error')
  }

  return (
    <View className='kdy-page kdy-faq-detail'>
      <KdyHeading
        title={item.question}
        subtitle={`${view.categoryLabel} · ${view.createdLabel}`}
        eyebrow='KEDAYA · 常见问题'
      />

      <KdyCard elevated={false}>
        {/* 长答案：宽松行高，原样保留换行，读起来不费劲 */}
        <Text className='kdy-faq-detail__answer'>{item.answer}</Text>

        {item.tags.length === 0 ? null : (
          <View className='kdy-faq-detail__tags'>
            {item.tags.map((tag) => (
              <KdyTag key={tag} tone='neutral'>
                {tag}
              </KdyTag>
            ))}
          </View>
        )}
      </KdyCard>

      <KdyCard elevated={false}>
        <View className='kdy-faq-detail__helpful'>
          <Text className='kdy-faq-detail__helpful-count'>有帮助 {view.helpfulCount}</Text>
          <KdyButton
            size='sm'
            variant={marked ? 'ghost' : 'primary'}
            loading={marking}
            disabled={marked}
            onClick={() => void handleHelpful()}
          >
            {marked ? '已标记有帮助' : '有帮助'}
          </KdyButton>
        </View>
        <Text className='kdy-faq-detail__hint'>
          这是一个热度计数，不是一人一票：本机会记住你标记过的条目、不重复计数；换设备或清缓存后可能再次计入。
        </Text>
      </KdyCard>

      {detail.error !== null && <Text className='kdy-faq-detail__error'>{detail.error}</Text>}

      <KdyShareEntry />

      <KdyReportEntry targetType='faq-entry' targetId={item.id} targetTitle={item.question} />

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。问答由同学共建整理，涉及教务、财务等以学校官方通知为准。
      </Text>
    </View>
  )
}
