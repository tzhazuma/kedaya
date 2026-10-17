import { Text, View } from '@tarojs/components'
import { useDidShow, useRouter } from '@tarojs/taro'
import { useState } from 'react'
import { ArrowRight } from '@taroify/icons'

import { getContainer } from '../../../../app/container'
import {
  wildlifeMapWithSpeciesPath,
  wildlifeReportPath,
  wildlifeTracksPath,
} from '../../../../app/routes'
import type { FeedingPolicy, WildlifeIndividual } from '../../../../domain/models/wildlife'
import {
  FEEDING_POLICY_LABELS,
  FEEDING_POLICY_TONES,
  WILDLIFE_STATUS_LABELS,
  speciesDisplayName,
  summarizeSighting,
} from '../../../../domain/models/wildlife'
import { navigateTo } from '../../../../platform/navigation'
import {
  KdyButton,
  KdyCard,
  KdyChip,
  KdyEmpty,
  KdyEthicsNotice,
  KdyPrivacyNotice,
  KdyTag,
} from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { KdyModuleIcon } from '../../../components/KdyModuleIcon'
import { useStore } from '../../../hooks'
import { speciesIconPath } from '../../../theme/speciesIcons'
import './index.scss'

/**
 * 野生动物档案页（`wildlife` 的模块主界面）。
 *
 * ## 这一页解决什么
 *
 * 之前点「野生动物」直接落到地图：地图能回答「在哪」，回答不了「都有谁」。
 * 校园动物的产品面其实是**居民档案** —— 谁住在这儿、谁被起了名字、
 * 什么不能投喂。这三个问题的答案都不在地图上，所以主界面做成档案，
 * 地图变成档案里最重要的一张卡片（一次点击）。
 *
 * ## 数据一条都不新造
 *
 * 物种、个体（被命名的「居民」）、观测全部来自已有用例
 * （`useCases.wildlifeMap`，它顺带把个体一起加载了 —— 见
 * `application/wildlife/wildlifeMap.ts` 的 `individuals`）。因此本页没有自己的
 * 仓储、没有自己的缓存：与地图页共用一份数据，从地图返回档案时不会出现
 * "两边数字不一样"。
 *
 * ## 为什么筛选是本页的本地状态，而不是共用用例的 `activeSpeciesId`
 *
 * 用例里的 `activeSpeciesId` 属于**地图**（它决定地图上画哪些区域与热点，
 * 并且会重新拉一次数据）。档案页的筛选只是"我想先看哪一类"，
 * 换一次筛选不该再发一次请求，也不该顺手把地图的筛选改掉。
 * 因此：
 *   · 本页 `load(null)` **始终拉全量** —— 否则先按 A 物种进来、
 *     再切到 B 物种会看到一片空（数据确实没拉 B）；
 *   · 筛选只影响本页渲染；要带着筛选去看地图，走顶部那张卡片的「打开地图」。
 *
 * ## 仍然遵守的两条老规矩
 *
 * 1. **不打扰**：伦理规范与投喂规范在这一页明着写，不做成折叠的脚注；
 * 2. **不暴露位置**：个体只显示「属于哪个物种 / 叫什么名字」，
 *    绝不显示某只动物的坐标（一只个体的位置 = 实时定位，规格 §9.3）。
 */

/** 一屏最多铺几条：档案页是"看一眼"的页面，不是无限列表 */
const RECENT_SIGHTING_LIMIT = 6

export default function WildlifeArchivePage() {
  const router = useRouter()
  const container = getContainer()
  const map = container.useCases.wildlifeMap
  const state = useStore(map)

  const now = container.clock.now()

  /**
   * 初始筛选可以来自 URL（从地图/服务大厅带 `speciesId` 进来）。
   * 之后一律由本页自己控制，不再跟随用例状态 —— 见文件头注释。
   */
  const [activeSpeciesId, setActiveSpeciesId] = useState<string | null>(
    typeof router.params.speciesId === 'string' && router.params.speciesId !== ''
      ? router.params.speciesId
      : null,
  )

  useDidShow(() => {
    // 契约 §8：同步读缓存 → 立刻有内容；再后台刷新（**全量**，见文件头注释）
    map.hydrate()
    void map.load(null)
  })

  const activeSpecies = state.species.find((species) => species.id === activeSpeciesId)
  const speciesList =
    activeSpeciesId === null
      ? state.species
      : state.species.filter((species) => species.id === activeSpeciesId)

  const individuals: readonly WildlifeIndividual[] =
    activeSpeciesId === null
      ? state.individuals
      : state.individuals.filter((individual) => individual.speciesId === activeSpeciesId)

  const sightings = state.sightings
    .filter((sighting) => activeSpeciesId === null || sighting.speciesId === activeSpeciesId)
    .slice(0, RECENT_SIGHTING_LIMIT)

  /**
   * 档案页的投喂告示取**全校最严格**的口径：一张告示只能给一条政策，
   * 只要有物种是「禁止投喂」，整页就按禁止说 —— 宁可保守，
   * 也不要在有黑天鹅的校园里给出「可投喂」的印象。
   */
  const archivePolicy: FeedingPolicy = state.species.some(
    (species) => species.defaultFeedingPolicy === 'forbidden',
  )
    ? 'forbidden'
    : 'discouraged'

  function sightingCountOf(speciesId: string): number {
    return state.sightings.filter((sighting) => sighting.speciesId === speciesId).length
  }

  function openMap(): void {
    void navigateTo(wildlifeMapWithSpeciesPath(activeSpeciesId))
  }

  if (state.status === 'loading') {
    return (
      <View className='kdy-page kdy-archive'>
        <KdyEmpty mode='loading' description='正在读取野生居民档案' />
      </View>
    )
  }

  if (state.status === 'error') {
    return (
      <View className='kdy-page kdy-archive'>
        <KdyEmpty
          mode='error'
          description={state.error ?? '未知错误'}
          actionText='重试'
          onAction={() => {
            void map.load(null)
          }}
        />
      </View>
    )
  }

  return (
    <View className='kdy-page kdy-archive'>
      <KdyHeading
        title='野生居民档案'
        subtitle='记录每一次偶遇，认识校园里的每一位野生居民。'
        eyebrow='KEDAYA · 野生动物'
      />

      <KdyCard title='校园活动地图' onClick={openMap}>
        <View className='kdy-archive__lead'>
          <KdyModuleIcon id='wildlife' />
          <Text className='kdy-archive__lead-text'>
            {activeSpecies === undefined
              ? '活动区域、聚合热点与历史观测'
              : `只看 ${speciesDisplayName(activeSpecies)} 的区域与观测`}
          </Text>
        </View>
        <Text className='kdy-archive__body'>
          地图上是模糊后的位置：敏感区（宿舍、保育区、巢区）不公开坐标，
          聚合热点延迟 24 小时才显示。这里没有"现在这只动物在哪"。
        </Text>
        <View className='kdy-archive__link'>
          打开地图 <ArrowRight />
        </View>
      </KdyCard>

      <View className='kdy-archive__filters'>
        <View className='kdy-archive__filter'>
          <KdyChip active={activeSpeciesId === null} onClick={() => setActiveSpeciesId(null)}>
            全部
          </KdyChip>
        </View>
        {state.species.map((species) => (
          <View key={species.id} className='kdy-archive__filter'>
            <KdyChip
              active={activeSpeciesId === species.id}
              onClick={() => setActiveSpeciesId(species.id)}
            >
              {species.commonNameZh}
            </KdyChip>
          </View>
        ))}
      </View>

      {state.status === 'empty' && (
        <KdyEmpty
          mode='empty'
          title='档案还是空的'
          description='还没有任何物种或观测记录。可以先上报一次观测，或点「重置演示数据」。'
          actionText='去上报'
          onAction={() => void navigateTo(wildlifeReportPath())}
        />
      )}

      {(state.status === 'ready' || state.status === 'idle') && (
        <View>
          {state.fromCache && (
            <Text className='kdy-archive__hint'>当前展示本地缓存，正在后台刷新…</Text>
          )}

          <KdyCard title={`物种 · ${speciesList.length}`} elevated={false}>
            {speciesList.length === 0 && (
              <Text className='kdy-archive__hint'>这个筛选下没有登记物种。</Text>
            )}
            {speciesList.map((species) => {
              const icon = speciesIconPath(species.id)
              const policy = species.defaultFeedingPolicy
              return (
                <View
                  key={species.id}
                  className='kdy-archive__species'
                  onClick={() => setActiveSpeciesId(species.id)}
                >
                  {icon === null ? (
                    <View className='kdy-archive__species-fallback'>
                      <Text>{species.commonNameZh.slice(0, 1)}</Text>
                    </View>
                  ) : (
                    <View
                      className='kdy-archive__species-photo'
                      style={{ backgroundImage: `url(${icon})` }}
                    />
                  )}
                  <View className='kdy-archive__species-copy'>
                    <Text className='kdy-archive__species-name'>{species.commonNameZh}</Text>
                    <Text className='kdy-archive__species-latin'>{species.scientificName}</Text>
                    <View className='kdy-archive__species-tags'>
                      {species.isProtected && <KdyTag tone='danger'>受保护</KdyTag>}
                      {species.isNestingSensitive && <KdyTag tone='warning'>繁殖期敏感</KdyTag>}
                      <KdyTag tone={FEEDING_POLICY_TONES[policy]}>
                        {FEEDING_POLICY_LABELS[policy]}
                      </KdyTag>
                    </View>
                  </View>
                  <Text className='kdy-archive__species-count'>
                    {sightingCountOf(species.id)} 条观测
                  </Text>
                </View>
              )
            })}
          </KdyCard>

          <KdyCard title={`常住居民 · ${individuals.length}`} elevated={false}>
            <Text className='kdy-archive__hint'>
              被同学起了名字的个体。只记录「谁」，不记录它在哪 ——
              个体的实时位置不公开。
            </Text>
            {individuals.length === 0 && (
              <KdyEmpty
                mode='empty'
                title='还没有被命名的居民'
                description='上报观测时可以给认识的个体起个名字，之后它就会出现在这里。'
                actionText='去上报'
                onAction={() => void navigateTo(wildlifeReportPath())}
              />
            )}
            {individuals.map((individual) => (
              <View key={individual.id} className='kdy-archive__resident'>
                <Text className='kdy-archive__resident-name'>{individual.name}</Text>
                <Text className='kdy-archive__resident-meta'>
                  {speciesDisplayName(
                    state.species.find((species) => species.id === individual.speciesId),
                  )}
                  {' · '}
                  {WILDLIFE_STATUS_LABELS[individual.status]}
                </Text>
                {individual.note !== undefined && individual.note !== '' && (
                  <Text className='kdy-archive__resident-note'>{individual.note}</Text>
                )}
              </View>
            ))}
          </KdyCard>

          <KdyCard
            title='最近的观测'
            extra={`${sightings.length} / ${state.sightings.length}`}
            elevated={false}
          >
            {sightings.length === 0 && (
              <Text className='kdy-archive__hint'>当前筛选下还没有观测记录。</Text>
            )}
            {sightings.map((sighting) => {
              const summary = summarizeSighting(sighting, state.species, state.zones, now)
              return (
                <View key={sighting.id} className='kdy-archive__sighting'>
                  <View className='kdy-archive__sighting-head'>
                    <Text className='kdy-archive__sighting-species'>{summary.speciesName}</Text>
                    <Text className='kdy-archive__sighting-when'>{summary.observedAtLabel}</Text>
                  </View>
                  <Text className='kdy-archive__sighting-meta'>
                    {summary.zoneName} · {summary.fuzzLabel}
                  </Text>
                  {summary.note !== '' && (
                    <Text className='kdy-archive__sighting-note'>{summary.note}</Text>
                  )}
                  <View className='kdy-archive__sighting-tags'>
                    <KdyTag tone={summary.feedingPolicyTone}>{summary.feedingPolicyLabel}</KdyTag>
                    {summary.healthConcern && <KdyTag tone='danger'>健康异常</KdyTag>}
                    {summary.speciesSource === 'corrected' && (
                      <KdyTag tone='info'>已人工纠正</KdyTag>
                    )}
                  </View>
                </View>
              )
            })}
          </KdyCard>

          <View className='kdy-archive__actions'>
            <KdyButton onClick={() => void navigateTo(wildlifeReportPath())}>上报观测</KdyButton>
            <KdyButton variant='ghost' onClick={openMap}>
              在地图上看看
            </KdyButton>
            <KdyButton variant='ghost' onClick={() => void navigateTo(wildlifeTracksPath())}>
              推断轨迹
            </KdyButton>
          </View>

          <KdyEthicsNotice policy={archivePolicy} />
          <View className='kdy-archive__privacy'>
            <KdyPrivacyNotice showAggregation compact />
          </View>
        </View>
      )}

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
