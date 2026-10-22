import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import {
  TEABREAK_ACCESS,
  TEABREAK_ACCESS_HINTS,
  TEABREAK_ACCESS_LABELS,
  TEABREAK_FRESHNESS_LABELS,
  describeRemaining,
  describeSinceConfirm,
  describeTeabreakProblem,
  sortTeabreaks,
  teabreakStatus,
  validateTeabreakDraft,
} from '@kedaya/contracts'
import type { Teabreak, TeabreakAccess } from '@kedaya/contracts'

import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField, KdyTag } from '../../components'
import { KdyHeading } from '../../components/KdyHeading'
import { toast } from '../../../platform/navigation'
import './index.scss'

/**
 * 学术会议茶歇分享。
 *
 * ## 这个页面的核心不是「列表」，是「**多久没被确认了**」
 *
 * 一个 20 分钟的茶歇，昨天的信息等于没有。所以每条都显示
 * 「还有 X 分钟结束」+「X 分钟前确认」，让人能判断值不值得现在跑一趟。
 *
 * ## 关于 access
 *
 * 不谴责也不鼓励蹭会。三种开放程度各自的提示只在说明**去了会发生什么**
 * （比如「可能被工作人员询问」），由用户自己判断。
 */

const MINUTE = 60_000

/** 演示数据：相对 `now` 生成，保证过几天也不会全过期 */
function demoTeabreaks(now: Date): Teabreak[] {
  const at = (offsetMin: number): string => new Date(now.getTime() + offsetMin * MINUTE).toISOString()

  return [
    {
      id: 'T-1',
      conferenceName: '第七届信息科学前沿论坛',
      venue: '信息学院 1-101',
      conferenceStartsAt: at(-60),
      conferenceEndsAt: at(180),
      teaStartsAt: at(-30),
      teaEndsAt: at(20),
      access: 'open',
      postedBy: '李四',
      createdAt: at(-90),
      // 5 分钟前有人确认 → fresh
      confirms: [{ confirmId: 'c1', confirmedAt: at(-5) }],
      note: '有咖啡和可颂，在二楼走廊',
    },
    {
      id: 'T-2',
      conferenceName: '生物医学工程学术年会',
      venue: '生命学院 B-201',
      conferenceStartsAt: at(-120),
      conferenceEndsAt: at(120),
      teaStartsAt: at(-40),
      teaEndsAt: at(15),
      access: 'registered',
      postedBy: '王五',
      createdAt: at(-150),
      // 2 小时没确认 → stale
      confirms: [{ confirmId: 'c2', confirmedAt: at(-120) }],
      note: '需要胸牌，我朋友说门口会查',
    },
    {
      id: 'T-3',
      conferenceName: '数学科学研究所学术报告',
      venue: '数学所 3-302',
      conferenceStartsAt: at(90),
      conferenceEndsAt: at(240),
      teaStartsAt: at(150),
      teaEndsAt: at(180),
      access: 'unknown',
      postedBy: '张三',
      createdAt: at(-20),
      confirms: [],
      note: null,
    },
    {
      id: 'T-4',
      conferenceName: '材料器件中心研讨会',
      venue: '材料中心 1-105',
      conferenceStartsAt: at(-26 * 60),
      conferenceEndsAt: at(-24 * 60),
      teaStartsAt: at(-25 * 60),
      teaEndsAt: at(-24.5 * 60),
      access: 'open',
      postedBy: '赵六',
      createdAt: at(-27 * 60),
      confirms: [],
      note: '昨天的，仅供参考',
    },
  ]
}

export default function TeabreakPage() {
  const [now] = useState<Date>(() => new Date())
  const [items, setItems] = useState<readonly Teabreak[]>(() => demoTeabreaks(new Date()))
  const [showForm, setShowForm] = useState(false)

  const [conferenceName, setConferenceName] = useState('')
  const [venue, setVenue] = useState('')
  const [access, setAccess] = useState<TeabreakAccess>('open')
  const [teaStartMin, setTeaStartMin] = useState('0')
  const [teaEndMin, setTeaEndMin] = useState('30')
  const [formError, setFormError] = useState<string | null>(null)

  const sorted = sortTeabreaks(items, now)

  function handleConfirm(id: string): void {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item
        const status = teabreakStatus(item, now)
        if (status.freshness === 'over') {
          toast('这个茶歇已经结束了')
          return item
        }
        return {
          ...item,
          confirms: [
            ...item.confirms,
            { confirmId: `local-${Date.now()}`, confirmedAt: nextNow().toISOString() },
          ],
        }
      }),
    )
    toast('已记录。20 分钟内别人看到会显示「刚确认还有」')
  }

  function nextNow(): Date {
    return new Date()
  }

  function handleCreate(): void {
    const base = new Date(now.getTime())
    const startMin = Number(teaStartMin)
    const endMin = Number(teaEndMin)
    if (Number.isNaN(startMin) || Number.isNaN(endMin)) {
      setFormError('请填写茶歇的开始与结束时间（相对会议开始的分钟数）')
      return
    }

    const teaStartsAt = new Date(base.getTime() + startMin * MINUTE).toISOString()
    const teaEndsAt = new Date(base.getTime() + endMin * MINUTE).toISOString()
    // 会议窗口比茶歇宽 —— 正常会议都这样
    const conferenceStartsAt = new Date(base.getTime() + (startMin - 60) * MINUTE).toISOString()
    const conferenceEndsAt = new Date(base.getTime() + (endMin + 120) * MINUTE).toISOString()

    const problems = validateTeabreakDraft(
      {
        conferenceName,
        venue,
        conferenceStartsAt,
        conferenceEndsAt,
        teaStartsAt,
        teaEndsAt,
      },
      now,
    )
    if (problems.length > 0) {
      setFormError(problems.map(describeTeabreakProblem).join('；'))
      return
    }
    setFormError(null)

    const created: Teabreak = {
      id: `T-${Date.now()}`,
      conferenceName: conferenceName.trim(),
      venue: venue.trim(),
      conferenceStartsAt,
      conferenceEndsAt,
      teaStartsAt,
      teaEndsAt,
      access,
      postedBy: '我',
      createdAt: now.toISOString(),
      confirms: [],
      note: null,
    }
    setItems((prev) => [...prev, created])
    setShowForm(false)
    setConferenceName('')
    setVenue('')
    toast('已发布。记得过一会儿如果还有，回来点「确认还有」')
  }

  return (
    <View className='kdy-page kdy-teabreak'>
      <KdyHeading
        title='会议茶歇'
        subtitle='把手边会议的时间地点报上来，别让点心凉在会议室里'
      />

      <KdyCard elevated={false} title='这个功能怎么用'>
        <Text className='kdy-teabreak__intro'>
          看到楼里有学术会议在发茶歇，就发一条：会议名、地点、大概什么时间。
          去之前瞄一眼「多久前确认」—— 20 分钟内有人确认过，现在去大概率还有。
        </Text>
        <Text className='kdy-teabreak__intro kdy-teabreak__intro--muted'>
          茶歇只有二十分钟，昨天的信息等于没有。所以你到了之后如果还有，
          回来点一下「确认还有」，这是这个功能唯一靠得住的部分。
        </Text>
      </KdyCard>

      <View className='kdy-teabreak__actions'>
        <KdyButton onClick={() => setShowForm((v) => !v)}>
          {showForm ? '收起' : '报告一场茶歇'}
        </KdyButton>
      </View>

      {showForm && (
        <KdyCard title='报告茶歇'>
          <KdyField
            label='会议名称'
            value={conferenceName}
            onChange={setConferenceName}
            maxLength={80}
            placeholder='比如「第七届信息科学前沿论坛」'
            hint='要能认出来是哪个会'
          />
          <KdyField
            label='地点'
            value={venue}
            onChange={setVenue}
            maxLength={60}
            placeholder='比如「信息学院 1-101」'
            hint='写清楼和房间号'
          />

          <Text className='kdy-teabreak__label'>茶歇开始（从现在起多少分钟）</Text>
          <KdyField label='' value={teaStartMin} onChange={setTeaStartMin} placeholder='0' />
          <Text className='kdy-teabreak__label'>茶歇结束（从现在起多少分钟）</Text>
          <KdyField label='' value={teaEndMin} onChange={setTeaEndMin} placeholder='30' />

          <Text className='kdy-teabreak__label'>开放程度</Text>
          <View className='kdy-teabreak__chips'>
            {TEABREAK_ACCESS.map((a) => (
              <KdyChip key={a} active={a === access} onClick={() => setAccess(a)}>
                {TEABREAK_ACCESS_LABELS[a]}
              </KdyChip>
            ))}
          </View>
          <Text className='kdy-teabreak__hint'>{TEABREAK_ACCESS_HINTS[access]}</Text>

          {formError !== null && <Text className='kdy-teabreak__error'>{formError}</Text>}

          <View className='kdy-teabreak__actions'>
            <KdyButton onClick={handleCreate}>发布</KdyButton>
            <KdyButton variant='ghost' onClick={() => setShowForm(false)}>取消</KdyButton>
          </View>
        </KdyCard>
      )}

      {sorted.length === 0 ? (
        <KdyEmpty
          mode='empty'
          title='还没有茶歇信息'
          description='看到楼里有会议在发茶歇，就发一条。二十分钟的窗口，靠大家互相报。'
          actionText='报告一场茶歇'
          onAction={() => setShowForm(true)}
        />
      ) : (
        sorted.map((item) => {
          const status = teabreakStatus(item, now)
          const isOver = status.freshness === 'over'
          const isNotStarted = status.freshness === 'notStarted'
          return (
            <KdyCard
              key={item.id}
              title={item.conferenceName}
              extra={
                <KdyTag
                  tone={
                    status.freshness === 'fresh'
                      ? 'success'
                      : isOver
                        ? 'neutral'
                        : 'warning'
                  }
                >
                  {TEABREAK_FRESHNESS_LABELS[status.freshness]}
                </KdyTag>
              }
            >
              <Text className='kdy-teabreak__venue'>{item.venue}</Text>

              <Text className='kdy-teabreak__window'>
                {isOver
                  ? '茶歇已结束'
                  : isNotStarted
                    ? '还没开始'
                    : `茶歇中 · ${describeRemaining(item.teaEndsAt, now)}`}
              </Text>

              <View className='kdy-teabreak__meta'>
                <KdyTag tone={item.access === 'open' ? 'success' : 'neutral'}>
                  {TEABREAK_ACCESS_LABELS[item.access]}
                </KdyTag>
                <Text className='kdy-teabreak__meta-text'>
                  {describeSinceConfirm(status.sinceLastConfirmMs)}
                </Text>
              </View>

              <Text className='kdy-teabreak__hint'>{TEABREAK_ACCESS_HINTS[item.access]}</Text>

              {item.note !== null && <Text className='kdy-teabreak__note'>{item.note}</Text>}

              <Text className='kdy-teabreak__by'>{`${item.postedBy} 发布`}</Text>

              <View className='kdy-teabreak__actions'>
                <KdyButton
                  size='sm'
                  variant={isOver ? 'ghost' : 'primary'}
                  onClick={() => handleConfirm(item.id)}
                >
                  {isOver ? '已结束' : '我去看了，还有'}
                </KdyButton>
              </View>
            </KdyCard>
          )
        })
      )}

      <Text className='kdy-disclaimer'>
        茶歇信息由同学自发分享，可达鸭不保证其准确性；进入会议区域请遵守会场规定。
      </Text>
    </View>
  )
}
