import { Input, Picker, Text, Textarea, View } from '@tarojs/components'
import { useDidShow, useRouter } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { buddyDetailPath } from '../../../../app/routes'
import {
  BUDDY_ACTIVITY_LABELS,
  BUDDY_CAPACITY_RANGE,
  BUDDY_DURATION_RANGE,
  BUDDY_GENDER_PREFERENCE_LABELS,
  BUDDY_GENDER_PREFERENCES,
  BUDDY_SECTION_LABELS,
  BUDDY_SECTIONS,
  BUDDY_SKILL_LEVEL_LABELS,
  BUDDY_SKILL_LEVELS,
  BUDDY_TAG_GROUPS,
  BUDDY_TAG_GROUP_LABELS,
  BUDDY_TAG_LIMITS,
  BUDDY_TITLE_MAX,
  BUDDY_DESCRIPTION_MAX,
  CAMPUS_AREAS,
  activitiesOf,
  contactWarning,
  sectionOf,
} from '../../../../domain/models/buddy'
import type { BuddyActivity, BuddySection, BuddySkillLevel, BuddyTagGroup } from '../../../../domain/models/buddy'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyBuddyPrivacyNotice, KdyButton, KdyCard, KdyEmpty, KdyField, KdyTag } from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 发布搭子页（规格 §5.4）。
 *
 * ⚠️ **标签只能从服务端的封闭标签表里选**（规格 §3.2）。
 * 页面上**没有**标签输入框 —— 这是刻意的：自由文本会让
 * 「羽毛球」/「打羽毛球」/「badminton」互不匹配，而「共同标签数」是本模块
 * 最精确、最可解释的匹配特征。用例层的 `addTagByText()` 会对任何未登记的
 * 字符串返回「未登记的标签：xxx」，页面在这里如实说明原因。
 *
 * 板块由 `activity` **派生**（规格 §2.3，`sectionOf`）—— 页面不存 section。
 * 「运动水平要求」只在 `sport` 板块出现（`minSkillLevel` 仅对 sport 有意义）。
 */

const DURATION_OPTIONS: readonly number[] = [30, 60, 90, 120, 150, 180, 240, 300, 360, 480]
const CAPACITY_OPTIONS: readonly number[] = Array.from(
  { length: BUDDY_CAPACITY_RANGE.max - BUDDY_CAPACITY_RANGE.min + 1 },
  (_, i) => BUDDY_CAPACITY_RANGE.min + i,
)

function todayShanghai(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(new Date())
}

export default function BuddyCreatePage() {
  const router = useRouter()
  const container = getContainer()
  const create = container.useCases.createBuddyPost
  const state = useStore(create)
  const [section, setSection] = useState<BuddySection>(() => {
    const raw = router.params.section
    return BUDDY_SECTIONS.find((s) => s === raw) ?? 'sport'
  })

  useDidShow(() => {
    void create.loadTags()
  })

  const draft = state.draft
  const activities = activitiesOf(section)
  // 板块由 activity 派生（规格 §2.3）—— 用户改活动类型时高亮要跟着走。
  // 用 `sectionOf` 而不是遍历板块：派生规则只有一处实现，页面不重复它。
  const activeSection = sectionOf(draft.activity)
  const contact = contactWarning(`${draft.title}\n${draft.description}`)

  async function handleSubmit(): Promise<void> {
    const result = await create.submit()
    if (!result.ok) {
      toast(result.error.message, 'error')
      return
    }
    toast('发布成功')
    create.reset()
    await navigateTo(buddyDetailPath(result.value))
  }

  function tagsOf(group: BuddyTagGroup) {
    return state.tags.filter((tag) => tag.group === group)
  }

  return (
    <View className='kdy-page kdy-buddy-create'>
      {state.tagsLoading && state.tags.length === 0 && (
        <KdyEmpty mode='loading' description='正在拉取可选的标签清单' />
      )}

      {state.tagsError !== null && (
        <Text className='kdy-buddy-create__warn'>
          标签清单拉取提示：{state.tagsError}
        </Text>
      )}

      {/* ---------------- 板块 + 活动类型 ---------------- */}
      <KdyCard title='板块'>
        <View className='kdy-buddy-create__chips'>
          {BUDDY_SECTIONS.map((item) => (
            <View
              key={item}
              className={`kdy-buddy-create__chip${
                item === activeSection ? ' kdy-buddy-create__chip--active' : ''
              }`}
              onClick={() => {
                setSection(item)
                create.setSection(item)
              }}
            >
              <Text className='kdy-buddy-create__chip-text'>{BUDDY_SECTION_LABELS[item]}</Text>
            </View>
          ))}
        </View>

        <View className='kdy-buddy-create__chips'>
          {activities.map((activity: BuddyActivity) => (
            <View
              key={activity}
              className={`kdy-buddy-create__chip${
                activity === draft.activity ? ' kdy-buddy-create__chip--active' : ''
              }`}
              onClick={() => create.setActivity(activity)}
            >
              <Text className='kdy-buddy-create__chip-text'>
                {BUDDY_ACTIVITY_LABELS[activity]}
              </Text>
            </View>
          ))}
        </View>
      </KdyCard>

      {/* ---------------- 基本信息 ---------------- */}
      <KdyCard title='基本信息'>
        <KdyField label='标题' required hint={`${[...draft.title].length}/${BUDDY_TITLE_MAX}`}>
          <Input
            className='kdy-buddy-create__input'
            value={draft.title}
            maxlength={BUDDY_TITLE_MAX}
            placeholder='例如：周六下午羽毛球，缺 2 人'
            onInput={(event) => create.setTitle(event.detail.value)}
          />
        </KdyField>

        <KdyField
          label='说明'
          hint={`${[...draft.description].length}/${BUDDY_DESCRIPTION_MAX}`}
          error={contact ?? undefined}
        >
          <Textarea
            className='kdy-buddy-create__textarea'
            value={draft.description}
            maxlength={BUDDY_DESCRIPTION_MAX}
            placeholder='时间、集合点、强度……注意不要写联系方式'
            onInput={(event) => create.setDescription(event.detail.value)}
          />
        </KdyField>

        <KdyField label='地点' required hint='取自校园地点清单'>
          <Picker
            mode='selector'
            // Taro 的 `range` 要求可变数组，而白名单是 `readonly` —— 展开一份
            range={[...CAMPUS_AREAS]}
            onChange={(event) => {
              const index = Number(event.detail.value)
              const area = CAMPUS_AREAS[index]
              if (area !== undefined) create.setLocation(area)
            }}
          >
            <Text className='kdy-buddy-create__picker'>
              {draft.location === '' ? '请选择地点' : draft.location}
            </Text>
          </Picker>
        </KdyField>
      </KdyCard>

      {/* ---------------- 时间 / 人数 ---------------- */}
      <KdyCard title='时间与人数'>
        <KdyField label='日期' required>
          <Picker
            mode='date'
            start={todayShanghai()}
            value={draft.startsAtLocal.slice(0, 10) || todayShanghai()}
            onChange={(event) => create.setStartDate(String(event.detail.value))}
          >
            <Text className='kdy-buddy-create__picker'>
              {draft.startsAtLocal.slice(0, 10) || '请选择日期'}
            </Text>
          </Picker>
        </KdyField>

        <KdyField label='开始时间' required>
          <Picker
            mode='time'
            value={draft.startsAtLocal.slice(11) || '19:00'}
            onChange={(event) => create.setStartTime(String(event.detail.value))}
          >
            <Text className='kdy-buddy-create__picker'>
              {draft.startsAtLocal.slice(11) || '请选择时间'}
            </Text>
          </Picker>
        </KdyField>

        <KdyField label='时长' hint={`${BUDDY_DURATION_RANGE.min}–${BUDDY_DURATION_RANGE.max} 分钟`}>
          <Picker
            mode='selector'
            range={DURATION_OPTIONS.map((m) => `${m} 分钟`)}
            onChange={(event) => {
              const value = DURATION_OPTIONS[Number(event.detail.value)]
              if (value !== undefined) create.setDuration(value)
            }}
          >
            <Text className='kdy-buddy-create__picker'>{draft.durationMin} 分钟</Text>
          </Picker>
        </KdyField>

        <KdyField
          label='人数'
          hint={`${BUDDY_CAPACITY_RANGE.min}–${BUDDY_CAPACITY_RANGE.max} 人（含你自己）`}
        >
          <Picker
            mode='selector'
            range={CAPACITY_OPTIONS.map((n) => `${n} 人`)}
            onChange={(event) => {
              const value = CAPACITY_OPTIONS[Number(event.detail.value)]
              if (value !== undefined) create.setCapacity(value)
            }}
          >
            <Text className='kdy-buddy-create__picker'>{draft.capacity} 人</Text>
          </Picker>
        </KdyField>
      </KdyCard>

      {/* ---------------- 性别准入 + 运动水平 ---------------- */}
      <KdyCard title='准入条件'>
        <KdyField label='性别偏好' hint='契约已冻结的准入约束，不参与匹配打分'>
          <Picker
            mode='selector'
            range={BUDDY_GENDER_PREFERENCES.map((p) => BUDDY_GENDER_PREFERENCE_LABELS[p])}
            onChange={(event) => {
              const value = BUDDY_GENDER_PREFERENCES[Number(event.detail.value)]
              if (value !== undefined) create.setGenderPreference(value)
            }}
          >
            <Text className='kdy-buddy-create__picker'>
              {BUDDY_GENDER_PREFERENCE_LABELS[draft.genderPreference]}
            </Text>
          </Picker>
        </KdyField>

        {activeSection === 'sport' && (
          <KdyField label='最低运动水平' hint='仅运动板块；作为硬过滤，不是打分'>
            <Picker
              mode='selector'
              range={['不限', ...BUDDY_SKILL_LEVELS.map((l) => BUDDY_SKILL_LEVEL_LABELS[l])]}
              onChange={(event) => {
                const index = Number(event.detail.value)
                create.setMinSkillLevel(
                  index === 0 ? null : (BUDDY_SKILL_LEVELS[index - 1] as BuddySkillLevel),
                )
              }}
            >
              <Text className='kdy-buddy-create__picker'>
                {draft.minSkillLevel === null
                  ? '不限'
                  : BUDDY_SKILL_LEVEL_LABELS[draft.minSkillLevel]}
              </Text>
            </Picker>
          </KdyField>
        )}
      </KdyCard>

      {/* ---------------- 标签（封闭标签表） ---------------- */}
      <KdyCard
        title='标签'
        extra={
          <KdyTag tone={draft.tags.length > BUDDY_TAG_LIMITS.postTags ? 'danger' : 'neutral'}>
            {draft.tags.length}/{BUDDY_TAG_LIMITS.postTags}
          </KdyTag>
        }
      >
        <Text className='kdy-buddy-create__note'>
          标签只能从下面的清单里选（服务端封闭标签表）。刻意**没有**自由输入框 ——
          自由文本会让「羽毛球」「打羽毛球」「badminton」互不匹配，而共同标签数是本模块最精确的匹配特征。
        </Text>

        {state.tagError !== null && (
          <Text className='kdy-buddy-create__error'>{state.tagError}</Text>
        )}

        {BUDDY_TAG_GROUPS.map((group) => {
          const tags = tagsOf(group)
          if (tags.length === 0) return null
          return (
            <View key={group} className='kdy-buddy-create__group'>
              <Text className='kdy-buddy-create__group-title'>
                {BUDDY_TAG_GROUP_LABELS[group]}
              </Text>
              <View className='kdy-buddy-create__chips'>
                {tags.map((tag) => (
                  <View
                    key={tag.key}
                    className={`kdy-buddy-create__chip${
                      draft.tags.includes(tag.key) ? ' kdy-buddy-create__chip--active' : ''
                    }`}
                    onClick={() => create.toggleTag(tag.key)}
                  >
                    <Text className='kdy-buddy-create__chip-text'>{tag.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          )
        })}
      </KdyCard>

      {state.errors.length > 0 && (
        <View className='kdy-buddy-create__errors'>
          {state.errors.map((error) => (
            <Text key={`${error.field}-${error.message}`} className='kdy-buddy-create__error'>
              {error.message}
            </Text>
          ))}
        </View>
      )}

      {state.error !== null && state.errors.length === 0 && (
        <Text className='kdy-buddy-create__error'>{state.error}</Text>
      )}

      <KdyBuddyPrivacyNotice showContact />

      <View className='kdy-buddy-create__actions'>
        <KdyButton loading={state.status === 'submitting'} onClick={() => void handleSubmit()}>
          发布
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
