import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import {
  FAQ_TICKET_QUESTION_MAX_LENGTH,
  validateTicketDraft,
} from '../../../../domain/models/faq'
import type { FaqDraftFieldError } from '../../../../domain/models/faq'
import { navigateBack, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyEmpty, KdyField, KdyTag } from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 「我的工单」页 —— 列表 + 提交。
 *
 * 契约 §8：`hydrate()` 同步给出缓存工单 → `load()` 后台刷新。
 * 未登录也可提交（domain-model §2.8），此时工单归属为 `null`（页面明确标注）。
 *
 * 隐私硬约束：联系方式**拒绝手机号**（domain-model §2.8「不存明文手机号」），
 * 校验在 domain 层（`validateTicketDraft`），页面只负责展示错误。
 */

function errorFor(errors: FaqDraftFieldError[], field: string): string | undefined {
  return errors.find((error) => error.field === field)?.message
}

export default function FaqTicketsPage() {
  const container = getContainer()
  const tickets = container.useCases.myTickets
  const state = useStore(tickets)

  const [contact, setContact] = useState('')
  const [question, setQuestion] = useState('')
  const [errors, setErrors] = useState<FaqDraftFieldError[]>([])
  const [submitting, setSubmitting] = useState(false)

  function reload(): Promise<void> {
    return tickets.load().then(() => undefined)
  }

  useDidShow(() => {
    tickets.hydrate()
    void reload()
  })

  usePullDownRefresh(() => {
    void reload().then(() => Taro.stopPullDownRefresh())
  })

  async function handleSubmit(): Promise<void> {
    const validation = validateTicketDraft({ contact, question })
    if (!validation.valid) {
      setErrors(validation.errors)
      toast('请先修正表单里的问题')
      return
    }

    setErrors([])
    setSubmitting(true)
    try {
      const result = await tickets.submit({ contact, question })
      if (!result.ok) {
        toast(result.error.message)
        return
      }
      setContact('')
      setQuestion('')
      toast('工单已提交', 'success')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <View className='kdy-page kdy-faq-tickets'>
      <KdyCard title='提交工单' elevated={false}>
        <Text className='kdy-faq-tickets__hint'>
          找不到答案时可以直接提问。未登录也能提交，但登录后才能在「我的工单」里看到历史记录。
        </Text>

        <KdyField
          label='联系方式'
          required
          hint='邮箱或微信号，请勿填写手机号'
          error={errorFor(errors, 'contact')}
          value={contact}
          placeholder='例如 student@shanghaitech.edu.cn 或 wechat: 你的微信号'
          onChange={setContact}
        />

        <KdyField
          label='问题描述'
          required
          hint={`${[...question].length}/${FAQ_TICKET_QUESTION_MAX_LENGTH}`}
          error={errorFor(errors, 'question')}
          multiline
          value={question}
          placeholder='请描述你遇到的问题，附上出错时间会更快定位'
          maxLength={FAQ_TICKET_QUESTION_MAX_LENGTH}
          onChange={setQuestion}
        />

        <KdyButton
          block
          loading={submitting}
          onClick={() => {
            void handleSubmit()
          }}
        >
          提交工单
        </KdyButton>
      </KdyCard>

      <KdyCard title={`我的工单（${state.tickets.length}）`} elevated={false}>
        {state.status === 'loading' && <KdyEmpty mode='loading' description='正在加载工单' />}

        {state.status === 'error' && (
          <KdyEmpty
            mode='error'
            description={state.error ?? '未知错误'}
            actionText='重试'
            onAction={() => {
              void reload()
            }}
          />
        )}

        {state.status === 'empty' && (
          <KdyEmpty mode='empty' description='还没有提交过工单' />
        )}

        {state.tickets.length > 0 && (
          <View>
            {state.tickets.map((ticket) => (
              <View key={ticket.id} className='kdy-faq-tickets__item'>
                <View className='kdy-faq-tickets__item-head'>
                  <KdyTag
                    tone={
                      ticket.status === 'ANSWERED'
                        ? 'success'
                        : ticket.status === 'CLOSED'
                          ? 'neutral'
                          : 'warning'
                    }
                  >
                    {ticket.statusLabel}
                  </KdyTag>
                  {ticket.anonymous && <KdyTag tone='info'>未登录提交</KdyTag>}
                  <Text className='kdy-faq-tickets__time'>{ticket.createdAtLabel}</Text>
                </View>

                <Text className='kdy-faq-tickets__question'>{ticket.question}</Text>

                {/* 看工单的人只关心一件事：「有人回我了吗」。因此回复单独成块、带左侧色条，
                    而不是和问题、联系方式挤在同一段灰字里。 */}
                {ticket.answer !== null ? (
                  <View className='kdy-faq-tickets__reply'>
                    <Text className='kdy-faq-tickets__reply-label'>官方回复</Text>
                    <Text className='kdy-faq-tickets__reply-body'>{ticket.answer}</Text>
                  </View>
                ) : ticket.status === 'OPEN' ? (
                  <Text className='kdy-faq-tickets__waiting'>
                    还没有回复 —— 工单由志愿者按顺序处理，不承诺响应时限。
                  </Text>
                ) : null}

                <Text className='kdy-faq-tickets__contact'>联系方式：{ticket.contact}</Text>
              </View>
            ))}
          </View>
        )}

        {state.error !== null && state.status === 'ready' && (
          <Text className='kdy-faq-tickets__soft-error'>
            刷新失败，正在显示上次的内容
          </Text>
        )}
      </KdyCard>

      <View className='kdy-faq-tickets__actions'>
        <KdyButton size='sm' variant='ghost' onClick={() => void navigateBack()}>
          返回
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台。工单由志愿者处理，不承诺响应时限。
      </Text>
    </View>
  )
}
