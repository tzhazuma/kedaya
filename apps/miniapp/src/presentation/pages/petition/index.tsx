import { Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useState } from 'react'

import {
  PETITION_CATEGORIES,
  PETITION_CATEGORY_LABELS,
  PETITION_DEPARTMENTS,
  PETITION_SCOPE_LABELS,
  PETITION_SCOPES,
  PETITION_STATUS_LABELS,
  buildPetitionEmail,
  describePetitionProblem,
  petitionProgress,
  petitionThreshold,
  validatePetitionDraft,
} from '@kedaya/contracts'
import type { Petition, PetitionCategory, PetitionScope } from '@kedaya/contracts'

import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField, KdyTag } from '../../components'
import { KdyHeading } from '../../components/KdyHeading'
import { toast } from '../../../platform/navigation'
import './index.scss'

/**
 * 众筹诉求页。
 *
 * ## ⚠️ 这里的「众筹」不是筹钱
 *
 * 筹的是**共同诉求的证据** —— 有多少人真的需要这件事。
 * 页面里没有任何金额输入，这是刻意的：一旦有资金流转就变成金融业务。
 *
 * ## 三条用户可见的承诺
 *
 * 1. **附议者匿名**：只统计人数，不对外显示谁支持了什么
 * 2. **发起人实名**：他是对接人，部门需要能联系到的人
 * 3. **不达标不发信**：人数不够时「生成邮件」按钮不可用，且说明还差几人
 */

/** 演示数据：本项目还没有 petition 后端，先用本地样例让流程可走通 */
function demoPetitions(now: Date): Petition[] {
  const threshold = petitionThreshold('group', false)
  return [
    {
      id: 'P-2026-001',
      title: '希望二食堂增加素食窗口',
      body:
        '目前二食堂素食选择很少，素食同学每餐只能吃配菜。'
        + '希望能增设一个素食窗口，哪怕只在午餐时段开放，也能显著改善我们的就餐体验。',
      category: 'canteen',
      scope: 'group',
      urgent: false,
      status: 'collecting',
      initiator: '张三',
      departmentName: PETITION_DEPARTMENTS.canteen.name,
      departmentEmail: PETITION_DEPARTMENTS.canteen.email,
      createdAt: '2026-10-01T00:00:00.000Z',
      deadline: new Date(now.getTime() + 10 * 24 * 3600 * 1000).toISOString(),
      endorsements: Array.from({ length: Math.min(12, threshold - 1) }, (_, i) => ({
        endorsementId: `demo-${i}`,
        endorsedAt: '2026-10-10T00:00:00.000Z',
        note: null,
      })),
      submission: null,
      response: null,
    },
    {
      id: 'P-2026-002',
      title: '图书馆自习区希望能延长到 23:30',
      body:
        '期末周图书馆 22:00 闭馆，很多同学的实验/课程结束得晚，'
        + '只能去很远的地方自习。希望能把自习区开放时间延长到 23:30。',
      category: 'facility',
      scope: 'campus',
      urgent: false,
      status: 'ready',
      initiator: '李四',
      departmentName: PETITION_DEPARTMENTS.facility.name,
      departmentEmail: PETITION_DEPARTMENTS.facility.email,
      createdAt: '2026-09-20T00:00:00.000Z',
      deadline: new Date(now.getTime() + 3 * 24 * 3600 * 1000).toISOString(),
      endorsements: Array.from({ length: 118 }, (_, i) => ({
        endorsementId: `demo2-${i}`,
        endorsedAt: '2026-10-05T00:00:00.000Z',
        note: null,
      })),
      submission: null,
      response: null,
    },
  ]
}

export default function PetitionPage() {
  const [now] = useState<Date>(() => new Date())
  const [items, setItems] = useState<readonly Petition[]>(() => demoPetitions(new Date()))
  const [showForm, setShowForm] = useState(false)
  const [preview, setPreview] = useState<{ to: string; subject: string; body: string } | null>(null)

  // 新建表单
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState<PetitionCategory>('canteen')
  const [scope, setScope] = useState<PetitionScope>('group')
  const [urgent, setUrgent] = useState(false)
  const [initiator, setInitiator] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useDidShow(() => {
    // 目前没有后端，数据是本机样例。接后端时这里换成 load()。
  })

  function handleEndorse(id: string): void {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item
        const progress = petitionProgress(item, now)
        if (!progress.accepting) {
          toast('该诉求已过期或已提交，不再接受附议')
          return item
        }
        // ⚠️ 本地立刻 +1，但**不假装已同步到服务端**：
        // 真正接后端时这里要等请求成功再改状态。
        return {
          ...item,
          endorsements: [
            ...item.endorsements,
            {
              endorsementId: `local-${Date.now()}`,
              endorsedAt: now.toISOString(),
              note: null,
            },
          ],
        }
      }),
    )
  }

  function handlePreviewEmail(item: Petition): void {
    try {
      const email = buildPetitionEmail(item, now)
      setPreview(email)
    } catch (error) {
      // 未达阈值会抛错 —— 这正是我们要的：不许"人不构也发"
      toast(error instanceof Error ? error.message : '暂时无法生成邮件')
    }
  }

  function handleCreate(): void {
    const deadline = new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString()
    const problems = validatePetitionDraft({ title, body, deadline }, now)
    if (initiator.trim() === '') {
      setFormError('请填写发起人姓名 —— 部门需要能联系到的人')
      return
    }
    if (problems.length > 0) {
      setFormError(problems.map(describePetitionProblem).join('；'))
      return
    }
    setFormError(null)

    const department = PETITION_DEPARTMENTS[category]
    const next: Petition = {
      id: `P-${now.getFullYear()}-${String(items.length + 1).padStart(3, '0')}`,
      title: title.trim(),
      body: body.trim(),
      category,
      scope,
      urgent,
      status: 'collecting',
      initiator: initiator.trim(),
      departmentName: department.name,
      departmentEmail: department.email,
      createdAt: now.toISOString(),
      deadline,
      endorsements: [],
      submission: null,
      response: null,
    }
    setItems((prev) => [...prev, next])
    setShowForm(false)
    setTitle('')
    setBody('')
    setInitiator('')
    toast('已发起。把链接发给同学附议吧')
  }

  return (
    <View className='kdy-page kdy-petition'>
      <KdyHeading
        title='众筹诉求'
        subtitle='把共同需求汇总成一份可核对的诉求，达到门槛后发信给对应部门'
      />

      <KdyCard elevated={false} title='这里筹的不是钱'>
        <Text className='kdy-petition__intro'>
          筹的是「有多少人真的需要这件事」。页面里没有任何金额 ——
          我们只统计附议人数，达到门槛后由发起人把一封正式邮件发给对应部门。
        </Text>
        <Text className='kdy-petition__intro kdy-petition__intro--muted'>
          附议是匿名的（只统计人数）；发起人必须实名，因为部门需要能联系到的人。
        </Text>
      </KdyCard>

      <View className='kdy-petition__actions'>
        <KdyButton onClick={() => setShowForm((v) => !v)}>
          {showForm ? '收起发起表单' : '发起一条诉求'}
        </KdyButton>
      </View>

      {showForm && (
        <KdyCard title='发起诉求'>
          <KdyField label='标题' value={title} onChange={setTitle} maxLength={60}
            placeholder='一句话说清希望学校做什么' hint='6–60 字' />
          <KdyField label='详细说明' value={body} onChange={setBody} multiline
            placeholder='现状是什么、影响了谁、你希望怎么改' hint='至少 20 字' />
          <KdyField label='发起人' value={initiator} onChange={setInitiator}
            placeholder='你的姓名（部门需要能联系到的人）' />

          <Text className='kdy-petition__label'>类别（决定对接部门）</Text>
          <View className='kdy-petition__chips'>
            {PETITION_CATEGORIES.map((c) => (
              <KdyChip key={c} active={c === category} onClick={() => setCategory(c)}>
                {PETITION_CATEGORY_LABELS[c]}
              </KdyChip>
            ))}
          </View>

          <Text className='kdy-petition__label'>影响范围（决定门槛）</Text>
          <View className='kdy-petition__chips'>
            {PETITION_SCOPES.map((s) => (
              <KdyChip key={s} active={s === scope} onClick={() => setScope(s)}>
                {`${PETITION_SCOPE_LABELS[s]}（${petitionThreshold(s, urgent)} 人）`}
              </KdyChip>
            ))}
          </View>

          <View className='kdy-petition__chips'>
            <KdyChip active={urgent} onClick={() => setUrgent((v) => !v)}>
              {urgent ? '紧急（门槛减半）' : '标记为紧急'}
            </KdyChip>
          </View>

          <Text className='kdy-petition__hint'>
            {`将发送给：${PETITION_DEPARTMENTS[category].name}（${PETITION_DEPARTMENTS[category].email}）`}
          </Text>
          {!PETITION_DEPARTMENTS[category].emailConfirmed && (
            <Text className='kdy-petition__error'>
              {`该类别没有找到学校公布的收件邮箱，上面这个地址属于${PETITION_DEPARTMENTS[category].name}，不一定能受理你的诉求 —— 发送前请自行核实。`}
            </Text>
          )}
          {/* 有 note 说明「这是部门总邮箱 / 该走别的渠道」时必须显示 —— 
              不说清楚用户会以为投给了具体窗口，等不到回复也不知道为什么 */}
          {PETITION_DEPARTMENTS[category].note !== null && (
            <Text className='kdy-petition__hint'>
              {PETITION_DEPARTMENTS[category].note}
            </Text>
          )}

          {formError !== null && <Text className='kdy-petition__error'>{formError}</Text>}

          <View className='kdy-petition__actions'>
            <KdyButton onClick={handleCreate}>发起</KdyButton>
            <KdyButton variant='ghost' onClick={() => setShowForm(false)}>取消</KdyButton>
          </View>
        </KdyCard>
      )}

      {items.length === 0 ? (
        <KdyEmpty
          mode='empty'
          title='还没有诉求'
          description='如果你和同学有共同的需求，可以发起第一条。'
          actionText='发起一条诉求'
          onAction={() => setShowForm(true)}
        />
      ) : (
        items.map((item) => {
          const progress = petitionProgress(item, now)
          return (
            <KdyCard
              key={item.id}
              title={item.title}
              extra={
                <KdyTag tone={item.status === 'ready' ? 'success' : 'neutral'}>
                  {PETITION_STATUS_LABELS[item.status]}
                </KdyTag>
              }
            >
              <View className='kdy-petition__meta'>
                <Text className='kdy-petition__meta-text'>
                  {`${PETITION_CATEGORY_LABELS[item.category]} · ${PETITION_SCOPE_LABELS[item.scope]}`}
                  {item.urgent ? ' · 紧急' : ''}
                </Text>
              </View>

              <Text className='kdy-petition__body'>{item.body}</Text>

              {/* 进度条：用数字而不是纯图形 —— 无障碍与截图可读性都更好 */}
              <View className='kdy-petition__progress'>
                <Text className='kdy-petition__progress-text'>
                  {progress.reached
                    ? `✅ 已达标：${progress.count} / ${progress.threshold} 人`
                    : `还差 ${progress.remaining} 人（${progress.count} / ${progress.threshold}）`}
                </Text>
                <View className='kdy-petition__bar'>
                  <View
                    className='kdy-petition__bar-fill'
                    style={{ width: `${Math.round(progress.ratio * 100)}%` }}
                  />
                </View>
              </View>

              <Text className='kdy-petition__meta-text'>
                {`发起人：${item.initiator} · 对接：${item.departmentName}`}
              </Text>

              <View className='kdy-petition__actions'>
                <KdyButton
                  size='sm'
                  variant={progress.accepting ? 'primary' : 'ghost'}
                  onClick={() => handleEndorse(item.id)}
                >
                  {progress.accepting ? '附议' : '已停止征集'}
                </KdyButton>
                <KdyButton
                  size='sm'
                  variant='ghost'
                  onClick={() => handlePreviewEmail(item)}
                >
                  {progress.reached ? '预览邮件' : `未达门槛（差 ${progress.remaining} 人）`}
                </KdyButton>
              </View>
            </KdyCard>
          )
        })
      )}

      {preview !== null && (
        <KdyCard title='将发给部门的邮件'>
          <Text className='kdy-petition__meta-text'>{`收件人：${preview.to}`}</Text>
          <Text className='kdy-petition__meta-text'>{`主题：${preview.subject}`}</Text>
          <Text className='kdy-petition__mail'>{preview.body}</Text>
          <View className='kdy-petition__actions'>
            <KdyButton variant='ghost' onClick={() => setPreview(null)}>关闭</KdyButton>
          </View>
          <Text className='kdy-petition__hint'>
            我们不会替你按发送 —— 需要你确认收件部门无误后自己发出。
            发错部门比不发更糟。
          </Text>
        </KdyCard>
      )}
    </View>
  )
}
