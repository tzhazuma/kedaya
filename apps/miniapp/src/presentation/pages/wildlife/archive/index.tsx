import { Text, View } from '@tarojs/components'
import { ArrowRight } from '@taroify/icons'
import { useDidShow, useRouter } from '@tarojs/taro'
import { useState } from 'react'

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
 * 野生动物（模块主界面）。
 *
 * 地图能回答「在哪」，回答不了「都有谁」。所以主界面做成**居民档案**：
 * 谁住在这儿、谁被起了名字、什么不能投喂。地图退成这里最重要的一张卡片。
 *
 * 数据全部来自 `useCases.wildlifeMap`（物种、个体、观测各一份），本页没有
 * 自己的缓存 —— 与地图页共用一份数据，返回时不会出现"两边数字不一样"。
 *
 * 筛选是本页的本地状态，和地图的 `activeSpeciesId` 分开：换筛选不重新发请求，
 * 也不会顺手改掉地图的筛选（因此这里始终按全量加载）。
 *
 * 两条不改的规矩：伦理与投喂规范写在页面上（不折叠）；个体只显示「谁」，
 * 不显示它在哪（一只个体的位置就是实时定位）。
 */

/** 一屏最多铺几条：档案页是"看一眼"的页面，不是无限列表 */
const RECENT_SIGHTING_LIMIT = 6

export default function WildlifeArchivePage() {
  const router = useRouter()
  const container = getContainer()
  const map = container.useCases.wildlifeMap
  const state = useStore(map)

  const now = container.clock.now()

  const [activeSpeciesId, setActiveSpeciesId] = useState<string | null>(
    typeof router.params.speciesId === 'string' && router.params.speciesId !== ''
      ? router.params.speciesId
      : null,
  )

  useDidShow(() => {
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

  /** 告示取全校最严格的口径：只要有物种「禁止投喂」，整页就按禁止说 */
  const archivePolicy: FeedingPolicy = state.species.some(
    (species) => species.defaultFeedingPolicy === 'forbidden',
  )
    ? 'forbidden'
    : 'discouraged'

  function sightingCountOf(speciesId: string): number {
    return state.sightings.filter((sighting) => sighting.speciesId === speciesId).length
  }

  if (state.status === 'loading') {
    return (
      <View className='kdy-page kdy-archive'>
        <KdyEmpty mode='loading' description='正在加载' />
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
      <KdyHeading title='野生动物' />

      <View
        className='kdy-archive__map'
        onClick={() => void navigateTo(wildlifeMapWithSpeciesPath(activeSpeciesId))}
      >
        <KdyModuleIcon id='wildlife' />
        <View className='kdy-archive__map-body'>
          <Text className='kdy-archive__map-title'>校园活动地图</Text>
          <Text className='kdy-archive__map-sub'>
            {activeSpecies === undefined
              ? '活动区域、热点与观测'
              : `只看${speciesDisplayName(activeSpecies)}`}
          </Text>
        </View>
        <ArrowRight />
      </View>

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
          title='还没有观测记录'
          actionText='去上报'
          onAction={() => void navigateTo(wildlifeReportPath())}
        />
      )}

      {(state.status === 'ready' || state.status === 'idle') && (
        <View>
          <KdyCard title='物种' elevated={false}>
            {speciesList.length === 0 && <Text className='kdy-archive__hint'>暂无记录</Text>}
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
                      <KdyTag tone={FEEDING_POLICY_TONES[policy]}>
                        {FEEDING_POLICY_LABELS[policy]}
                      </KdyTag>
                    </View>
                  </View>
                  <Text className='kdy-archive__species-count'>
                    {sightingCountOf(species.id)} 条
                  </Text>
                </View>
              )
            })}
          </KdyCard>

          <KdyCard title={`常住居民 ${individuals.length}`} elevated={false}>
            {individuals.length === 0 && (
              <KdyEmpty
                mode='empty'
                title='还没有被命名的居民'
                description='上报观测时可以给认识的个体起个名字。'
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
              </View>
            ))}
          </KdyCard>

          <KdyCard
            title='最近观测'
            extra={`${sightings.length} / ${state.sightings.length}`}
            elevated={false}
          >
            {sightings.length === 0 && (
              <Text className='kdy-archive__hint'>当前筛选下没有观测记录</Text>
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
                  <View className='kdy-archive__sighting-tags'>
                    <KdyTag tone={summary.feedingPolicyTone}>{summary.feedingPolicyLabel}</KdyTag>
                    {summary.healthConcern && <KdyTag tone='danger'>健康异常</KdyTag>}
                    {summary.speciesSource === 'corrected' && <KdyTag tone='info'>已纠正</KdyTag>}
                  </View>
                </View>
              )
            })}
          </KdyCard>

          <View className='kdy-archive__actions'>
            <KdyButton onClick={() => void navigateTo(wildlifeReportPath())}>上报观测</KdyButton>
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
