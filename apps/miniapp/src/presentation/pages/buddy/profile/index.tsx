import { Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import {
  AVAILABILITY_DOW_LABELS,
  BUDDY_BIO_MAX,
  BUDDY_SECTION_LABELS,
  BUDDY_SECTIONS,
  BUDDY_SKILL_LEVEL_LABELS,
  BUDDY_SKILL_LEVELS,
  BUDDY_TAG_GROUPS,
  BUDDY_TAG_GROUP_LABELS,
  CAMPUS_AREAS,
  PREFERRED_AREA_LIMIT,
  SHTU_DEPARTMENTS,
  describeAvailability,
  formatMinuteOfDay,
  isValidAvailabilitySlot,
  parseMinuteOfDay,
} from '../../../../domain/models/buddy'
import type { BuddySkillLevel, BuddyTagGroup } from '../../../../domain/models/buddy'
import { toast } from '../../../../platform/navigation'
import {
  KdyBuddyPrivacyNotice,
  KdyButton,
  KdyCard,
  KdyEmpty,
  KdyField,
  KdyPicker,
  KdySwitch,
  KdyTag,
} from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 「我的匹配资料」页（`BuddyProfile`，规格 §2.2 / §6.3）。
 *
 * 这是 **F7 硬过滤（可用时段）唯一的填写入口** ——
 * 用户必须能真的填「周几 + 起止时间」，否则推荐会退化成纯时间排序。
 *
 * 隐私设计（规格 §6.3）：
 * - `matchEnabled` **默认关闭**，页面上是显式开关，并解释它到底影响什么；
 * - 「删除匹配资料」调用 `DELETE /buddy/profile`，硬删该行（含 embedding），
 *   服务端立即把用户移出推荐池；
 * - 页面顶部常驻隐私提示（规格 §6 硬要求）。
 *
 * 标签同样**只能从服务端封闭标签表里选**（`interestTags` ≤20 / `activityTags` ≤10）。
 * 「运动水平」只在选择了运动板块时出现 —— `skillLevel` 仅对 `sport` 有意义。
 */

const DOW_OPTIONS: readonly number[] = [1, 2, 3, 4, 5, 6, 0]

export default function BuddyProfilePage() {
  const container = getContainer()
  const profile = container.useCases.buddyProfile
  const state = useStore(profile)

  const [dowIndex, setDowIndex] = useState(0)
  const [startTime, setStartTime] = useState('18:00')
  const [endTime, setEndTime] = useState('22:00')
  const [slotError, setSlotError] = useState<string | null>(null)

  useDidShow(() => {
    // 契约 §8 第 1 步（同步 hydrate）+ 第 3 步
    profile.hydrate()
    void profile.load()
    void profile.loadTags()
  })

  const data = state.profile
  const includeSport = data.sections.includes('sport')

  function tagsOf(group: BuddyTagGroup) {
    return state.tags.filter((tag) => tag.group === group)
  }

  function handleAddSlot(): void {
    const dow = DOW_OPTIONS[dowIndex] ?? 1
    const startMin = parseMinuteOfDay(startTime)
    const endMin = parseMinuteOfDay(endTime)
    if (startMin === null || endMin === null) {
      setSlotError('时间格式应为 HH:mm')
      return
    }
    const slot = { dow, startMin, endMin }
    if (!isValidAvailabilitySlot(slot)) {
      setSlotError('结束时间必须晚于开始时间（时段本身不跨零点）')
      return
    }
    setSlotError(null)
    profile.addAvailabilitySlot(slot)
  }

  async function handleSave(): Promise<void> {
    const result = await profile.save()
    toast(result.ok ? '已保存匹配资料' : (result.error.message ?? '保存失败'), result.ok ? 'success' : 'error')
  }

  async function handleWithdraw(): Promise<void> {
    const result = await profile.withdraw()
    toast(result.ok ? '已删除匹配资料，已移出推荐池' : '删除失败', result.ok ? 'success' : 'error')
  }

  return (
    <View className='kdy-page kdy-buddy-profile'>
      {/* 隐私提示（规格 §6，硬要求） */}
      <KdyBuddyPrivacyNotice showMatchEnabled />

      {state.status === 'loading' && <KdyEmpty mode='loading' description='正在加载你的匹配资料' />}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          description={state.error ?? '加载失败'}
          actionText='重试'
          onAction={() => void profile.load()}
        />
      )}

      {state.status !== 'loading' && (
        <View>
          {state.withdrawn && (
            <Text className='kdy-buddy-profile__note'>
              匹配资料已删除。你仍然可以正常发布和申请搭子，只是不再出现在别人的推荐里。
            </Text>
          )}

          {/* ---------------- 匹配开关 ---------------- */}
          <KdyCard title='参与匹配'>
            <KdySwitch
              checked={data.matchEnabled}
              label='开启「找搭子」推荐匹配'
              description='默认关闭；开启后你的资料会参与推荐排序（不对外展示）'
              onChange={(checked) => profile.setMatchEnabled(checked)}
            />
            {!state.exists && (
              <Text className='kdy-buddy-profile__note'>还没有保存过匹配资料，填完点下面的「保存」。</Text>
            )}
          </KdyCard>

          {/* ---------------- 板块 ---------------- */}
          <KdyCard title='参与哪些板块'>
            <View className='kdy-buddy-profile__chips'>
              {BUDDY_SECTIONS.map((section) => (
                <View
                  key={section}
                  className={`kdy-buddy-profile__chip${
                    data.sections.includes(section) ? ' kdy-buddy-profile__chip--active' : ''
                  }`}
                  onClick={() => profile.toggleSection(section)}
                >
                  <Text className='kdy-buddy-profile__chip-text'>
                    {BUDDY_SECTION_LABELS[section]}
                  </Text>
                </View>
              ))}
            </View>
            <Text className='kdy-buddy-profile__note'>
              开启匹配时至少要选一个板块，否则进了推荐池也没有板块可用。
            </Text>
          </KdyCard>

          {/* ---------------- 院系 ---------------- */}
          <KdyCard title='院系'>
            <KdyField label='院系' hint='仅用于「学术自习」板块的同院系匹配'>
              <KdyPicker
                range={SHTU_DEPARTMENTS}
                title='选择院系'
                placeholder='请选择院系'
                value={data.department === null ? -1 : SHTU_DEPARTMENTS.indexOf(data.department)}
                onChange={(index) => {
                  const value = SHTU_DEPARTMENTS[index]
                  if (value !== undefined) profile.setDepartment(value)
                }}
              />
            </KdyField>
            <Text className='kdy-buddy-profile__note'>
              刻意用「院系」而不是「专业」：专业在小程序端填报质量不可控
              （「计算机」/「CS」/「计算机科学与技术」三种写法会让精确相等匹配失效）。
            </Text>
          </KdyCard>

          {/* ---------------- 兴趣标签 ---------------- */}
          <KdyCard
            title='兴趣标签'
            extra={
              <KdyTag tone={data.interestTags.length > 20 ? 'danger' : 'neutral'}>
                {data.interestTags.length}/20
              </KdyTag>
            }
          >
            <Text className='kdy-buddy-profile__note'>
              只能从服务端封闭标签表里选（无自由输入）—— 见发布页的同款说明。
            </Text>
            {BUDDY_TAG_GROUPS.map((group) => {
              const tags = tagsOf(group)
              if (tags.length === 0) return null
              return (
                <View key={group} className='kdy-buddy-profile__group'>
                  <Text className='kdy-buddy-profile__group-title'>
                    {BUDDY_TAG_GROUP_LABELS[group]}
                  </Text>
                  <View className='kdy-buddy-profile__chips'>
                    {tags.map((tag) => (
                      <View
                        key={tag.key}
                        className={`kdy-buddy-profile__chip${
                          data.interestTags.includes(tag.key)
                            ? ' kdy-buddy-profile__chip--active'
                            : ''
                        }`}
                        onClick={() => profile.toggleInterestTag(tag.key)}
                      >
                        <Text className='kdy-buddy-profile__chip-text'>{tag.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )
            })}
          </KdyCard>

          {/* ---------------- 活动标签 ---------------- */}
          <KdyCard
            title='活动标签'
            extra={
              <KdyTag tone={data.activityTags.length > 10 ? 'danger' : 'neutral'}>
                {data.activityTags.length}/10
              </KdyTag>
            }
          >
            {BUDDY_TAG_GROUPS.map((group) => {
              const tags = tagsOf(group)
              if (tags.length === 0) return null
              return (
                <View key={group} className='kdy-buddy-profile__group'>
                  <Text className='kdy-buddy-profile__group-title'>
                    {BUDDY_TAG_GROUP_LABELS[group]}
                  </Text>
                  <View className='kdy-buddy-profile__chips'>
                    {tags.map((tag) => (
                      <View
                        key={tag.key}
                        className={`kdy-buddy-profile__chip${
                          data.activityTags.includes(tag.key)
                            ? ' kdy-buddy-profile__chip--active'
                            : ''
                        }`}
                        onClick={() => profile.toggleActivityTag(tag.key)}
                      >
                        <Text className='kdy-buddy-profile__chip-text'>{tag.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )
            })}
          </KdyCard>

          {/* ---------------- 可用时段（F7 硬过滤的依据） ---------------- */}
          <KdyCard
            title='每周可用时段'
            extra={<KdyTag tone='brand'>{data.availability.length} 段</KdyTag>}
          >
            <Text className='kdy-buddy-profile__note'>
              这是硬过滤的依据：时间碰不上的活动不会推荐给你。
              时段本身不跨零点（跨零点的活动会自动按次日判定）。
            </Text>

            {data.availability.length === 0 ? (
              <Text className='kdy-buddy-profile__empty'>
                还没填可用时段 —— 不填的话推荐只会按时间排序。
              </Text>
            ) : (
              describeAvailability(data.availability).map((label, index) => (
                <View key={`${label}-${index}`} className='kdy-buddy-profile__slot'>
                  <Text className='kdy-buddy-profile__slot-text'>{label}</Text>
                  <Text
                    className='kdy-buddy-profile__slot-remove'
                    onClick={() => profile.removeAvailabilitySlot(index)}
                  >
                    删除
                  </Text>
                </View>
              ))
            )}

            <View className='kdy-buddy-profile__slot-form'>
              <View className='kdy-buddy-profile__slot-picker'>
                <KdyPicker
                  range={DOW_OPTIONS.map((dow) => AVAILABILITY_DOW_LABELS[dow] ?? '')}
                  title='选择星期'
                  value={dowIndex}
                  onChange={setDowIndex}
                />
              </View>

              <View className='kdy-buddy-profile__slot-picker'>
                <KdyPicker
                  mode='time'
                  value={startTime}
                  onChange={setStartTime}
                />
              </View>

              <Text className='kdy-buddy-profile__to'>至</Text>

              <View className='kdy-buddy-profile__slot-picker'>
                <KdyPicker mode='time' value={endTime} onChange={setEndTime} />
              </View>
            </View>

            {slotError !== null && <Text className='kdy-buddy-profile__error'>{slotError}</Text>}

            <View className='kdy-buddy-profile__actions'>
              <KdyButton size='sm' variant='secondary' onClick={handleAddSlot}>
                添加时段
              </KdyButton>
              <KdyButton
                size='sm'
                variant='ghost'
                onClick={() => profile.clearAvailability()}
              >
                清空时段
              </KdyButton>
            </View>

            <Text className='kdy-buddy-profile__note'>
              当前：{describeAvailability(data.availability).join('、') || '（空）'}
              {' · 分钟粒度：'}
              {formatMinuteOfDay(18 * 60)}
            </Text>
          </KdyCard>

          {/* ---------------- 常去区域 ---------------- */}
          <KdyCard
            title='常去区域'
            extra={
              <KdyTag tone={data.preferredAreas.length > PREFERRED_AREA_LIMIT ? 'danger' : 'neutral'}>
                {data.preferredAreas.length}/{PREFERRED_AREA_LIMIT}
              </KdyTag>
            }
          >
            <View className='kdy-buddy-profile__chips'>
              {CAMPUS_AREAS.map((area) => (
                <View
                  key={area}
                  className={`kdy-buddy-profile__chip${
                    data.preferredAreas.includes(area) ? ' kdy-buddy-profile__chip--active' : ''
                  }`}
                  onClick={() => profile.togglePreferredArea(area)}
                >
                  <Text className='kdy-buddy-profile__chip-text'>{area}</Text>
                </View>
              ))}
            </View>
            <Text className='kdy-buddy-profile__note'>
              只到「区域」粒度，不采集精确坐标（规格 §6.3 的数据最小化）。
            </Text>
          </KdyCard>

          {/* ---------------- 运动水平（仅 sport） ---------------- */}
          {includeSport && (
            <KdyCard title='运动水平'>
              <View className='kdy-buddy-profile__chips'>
                {BUDDY_SKILL_LEVELS.map((level: BuddySkillLevel) => (
                  <View
                    key={level}
                    className={`kdy-buddy-profile__chip${
                      data.skillLevel === level ? ' kdy-buddy-profile__chip--active' : ''
                    }`}
                    onClick={() => profile.setSkillLevel(level)}
                  >
                    <Text className='kdy-buddy-profile__chip-text'>
                      {BUDDY_SKILL_LEVEL_LABELS[level]}
                    </Text>
                  </View>
                ))}
              </View>
              <Text className='kdy-buddy-profile__note'>
                只在「运动组队」板块使用；不参与运动板块时它不是匹配特征。
              </Text>
            </KdyCard>
          )}

          {/* ---------------- 一句话自述 ---------------- */}
          <KdyCard title='一句话自述'>
            <KdyField
              label='自述'
              hint={`${[...(data.bio ?? '')].length}/${BUDDY_BIO_MAX}`}
              value={data.bio ?? ''}
              maxLength={BUDDY_BIO_MAX}
              placeholder='例如：常打羽毛球，也常泡图书馆'
              onChange={profile.setBio}
            />
            <Text className='kdy-buddy-profile__note'>
              不要写联系方式（会被校验拦下）—— 申请通过后由站内信交换。
            </Text>
          </KdyCard>

          {state.errors.length > 0 && (
            <View className='kdy-buddy-profile__errors'>
              {state.errors.map((error) => (
                <Text key={`${error.field}-${error.message}`} className='kdy-buddy-profile__error'>
                  {error.message}
                </Text>
              ))}
            </View>
          )}

          {state.error !== null && state.errors.length === 0 && (
            <Text className='kdy-buddy-profile__error'>{state.error}</Text>
          )}

          <View className='kdy-buddy-profile__actions'>
            <KdyButton loading={state.saving} onClick={() => void handleSave()}>
              保存匹配资料
            </KdyButton>
            <KdyButton
              variant='danger'
              size='sm'
              loading={state.saving}
              disabled={!state.exists}
              onClick={() => void handleWithdraw()}
            >
              删除匹配资料（撤回）
            </KdyButton>
          </View>

          {state.savedAt !== null && (
            <Text className='kdy-buddy-profile__note'>最近保存：{state.savedAt}</Text>
          )}
        </View>
      )}

      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
