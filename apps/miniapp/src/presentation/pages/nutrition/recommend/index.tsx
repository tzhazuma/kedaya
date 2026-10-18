import { Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { DISH_CATEGORY_LABELS, NUTRIENT_LABELS } from '@kedaya/shared'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS } from '../../../../app/routes'
import { formatNutrientSource, toCartDish } from '../../../../domain/models/nutrition'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyBar, KdyButton, KdyCard, KdyEmpty, KdyTag } from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 推荐页 —— 「当天还需要吃什么」。
 *
 * 缺口与推荐全部由后端 / mock 的 shared 同一份代码算出，
 * 本页只渲染：还差多少 → 推荐哪几道 → 为什么（可解释理由，不写「算法推荐」）。
 */

export default function NutritionRecommendPage() {
  const container = getContainer()
  const recommendations = container.useCases.recommendations
  const state = useStore(recommendations)

  useDidShow(() => {
    void recommendations.load()
  })

  const gaps = state.gaps
  const gapRows =
    gaps === null
      ? []
      : (
          [
            { key: 'caloriesKcal', label: '热量', unit: 'kcal' },
            { key: 'proteinG', label: '蛋白质', unit: 'g' },
            { key: 'fatG', label: '脂肪', unit: 'g' },
            { key: 'carbG', label: '碳水', unit: 'g' },
            { key: 'fiberG', label: '膳食纤维', unit: 'g' },
          ] as const
        )
          .map((row) => ({ ...row, value: Math.round(gaps[row.key]) }))
          .filter((row) => row.value > 0)

  return (
    <View className='kdy-page kdy-nu-recommend'>
      {state.status === 'loading' && <KdyEmpty mode='loading' description='正在计算今日缺口' />}

      {state.status === 'error' && (
        <KdyCard elevated={false}>
          <Text className='kdy-nu-recommend__hint'>{state.error ?? '未知错误'}</Text>
          <View className='kdy-nu-recommend__error-actions'>
            {/*
              未设置每日需求时后端返回的是「引导去设置」的文案：
              这时给一个明确的 CTA，而不是让用户点「重试」把自己卡死。
            */}
            {(state.error ?? '').includes('需求') && (
              <KdyButton
                size='sm'
                onClick={() => {
                  void navigateTo(PAGE_PATHS.nutritionTargets)
                }}
              >
                去设置每日需求
              </KdyButton>
            )}
            <KdyButton size='sm' variant='ghost' onClick={() => void recommendations.load()}>
              重试
            </KdyButton>
          </View>
        </KdyCard>
      )}

      {state.status === 'ready' && (
        <View>
          <KdyCard title='今日还差' elevated={false} tone='yellow'>
            {gapRows.length === 0 ? (
              <Text className='kdy-nu-recommend__all-met'>
                目标型营养都已达标，注意钠别超上限就好。
              </Text>
            ) : (
              <View className='kdy-nu-recommend__gaps'>
                {gapRows.map((row) => (
                  <KdyTag key={row.key} tone='brand'>
                    还差 {row.label} {row.value} {row.unit}
                  </KdyTag>
                ))}
              </View>
            )}
          </KdyCard>

          <KdyCard title='推荐菜品' extra={<Text>{state.items.length} 道</Text>} elevated={false}>
            {state.items.length === 0 ? (
              <Text className='kdy-nu-recommend__hint'>当前缺口下没有更合适的菜品了</Text>
            ) : (
              <View className='kdy-nu-recommend__list'>
                {state.items.map((item) => (
                  <View
                    key={item.dish.id}
                    className='kdy-nu-recommend__item'
                    onClick={() => {
                      // 点推荐 → 加入当餐（与首页推荐卡同一行为）
                      container.useCases.logMeal.addToCart(toCartDish(item.dish))
                      toast(`已加入：${item.dish.name}`)
                      void navigateTo(PAGE_PATHS.nutritionLog)
                    }}
                  >
                    <View className='kdy-nu-recommend__item-head'>
                      <Text className='kdy-nu-recommend__item-name'>{item.dish.name}</Text>
                      <KdyTag tone='neutral'>{DISH_CATEGORY_LABELS[item.dish.category as keyof typeof DISH_CATEGORY_LABELS] ?? item.dish.category}</KdyTag>
                      <Text className='kdy-nu-recommend__item-kcal'>
                        {item.dish.caloriesKcal} kcal/份
                      </Text>
                    </View>
                    <Text className='kdy-nu-recommend__item-reason'>{item.reason}</Text>
                    {formatNutrientSource(item.dish.source, item.dish.lastVerifiedAt) !== null && (
                      <Text className='kdy-nu-recommend__item-source'>
                        {formatNutrientSource(item.dish.source, item.dish.lastVerifiedAt)}
                      </Text>
                    )}
                    <View className='kdy-nu-recommend__fills'>
                      {Object.entries(item.fills).map(([key, value]) => (
                        <View key={key} className='kdy-nu-recommend__fill'>
                          <Text className='kdy-nu-recommend__fill-label'>
                            {(NUTRIENT_LABELS as Record<string, string>)[key] ?? key}
                          </Text>
                          <KdyBar percent={Math.round((value ?? 0) * 100)} tone='brand' height={6} />
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </KdyCard>

          <View className='kdy-nu-recommend__actions'>
            <KdyButton
              block
              onClick={() => {
                void navigateTo(PAGE_PATHS.nutritionLog)
              }}
            >
              去记录当餐
            </KdyButton>
            <KdyButton
              block
              variant='ghost'
              onClick={() => {
                void navigateTo(PAGE_PATHS.nutritionTargets)
              }}
            >
              调整每日需求
            </KdyButton>
          </View>
        </View>
      )}

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。营养建议仅供参考，不构成医疗意见。
      </Text>
    </View>
  )
}
