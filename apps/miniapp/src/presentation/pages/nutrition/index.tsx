import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import {
  CANTEEN_NAMES,
  MEAL_TYPES,
  MEAL_TYPE_LABELS,
  SERVING_LIMITS,
  type MealType,
} from '@kedaya/shared'
import { useState } from 'react'

import { getContainer } from '../../../app/container'
import { PAGE_PATHS } from '../../../app/routes'
import { formatNutrientSource, toCartDish } from '../../../domain/models/nutrition'
import type { MealRecord } from '../../../domain/models/nutrition'
import { navigateTo, toast } from '../../../platform/navigation'
import { KdyBar, KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField, KdyRing, KdyTag } from '../../components'
import type { KdyRingTone } from '../../components'
import { useStore } from '../../hooks'
import './index.scss'

/**
 * 营养管家园 · 今日营养首页。
 *
 * 契约 §8 启动时序：`hydrate()` 同步给缓存 → `load()` 后台刷新。
 * 三态（loading / error / ready）显式处理；未设置每日需求时不画进度，
 * 而是明确引导去设置 —— 不偷偷用默认值（ADR 0006 决策 4）。
 *
 * 记错了要能改：每条记录可改餐型/备注/份数、可删除；
 * 推荐卡点一下能直接加进当餐购物车（推荐 → 记录的闭环）。
 *
 * 编辑用的是**自绘底部面板**而不是 `Taro.showActionSheet`：
 * 原生面板在小屏/模拟器里容易被裁到可视区外，看起来像「整页点不动」。
 */

function calorieTone(percent: number): KdyRingTone {
  if (percent > 100) return 'warning'
  return 'brand'
}

function rowTone(progress: { met: boolean; percent: number; isUpperLimit: boolean }): KdyRingTone {
  if (progress.met) return 'success'
  if (progress.isUpperLimit) return 'danger'
  return 'brand'
}

export default function NutritionHomePage() {
  const container = getContainer()
  const today = container.useCases.todayNutrition
  const state = useStore(today)

  /** 自绘编辑面板：正在编辑哪一餐（null = 关闭） */
  const [editing, setEditing] = useState<MealRecord | null>(null)
  const [editMealType, setEditMealType] = useState<MealType>('lunch')
  const [editNote, setEditNote] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  useDidShow(() => {
    today.hydrate()
    void today.load()
  })

  usePullDownRefresh(() => {
    void today.load().then(() => Taro.stopPullDownRefresh())
  })

  function reload(): void {
    void today.load()
  }

  async function handleDelete(id: string): Promise<void> {
    const modal = await Taro.showModal({
      title: '删除这条记录？',
      content: '删除后今天的营养汇总会立刻更新，且无法恢复。',
      confirmText: '删除',
      confirmColor: '#c0392b',
    })
    if (!modal.confirm) return
    const okDeleted = await today.removeMeal(id)
    toast(okDeleted ? '已删除' : (today.getSnapshot().error ?? '删除失败'), okDeleted ? 'success' : 'error')
  }

  async function stepServings(meal: { id: string; items: Array<{ servings: number }> }, index: number, delta: number): Promise<void> {
    const servings = meal.items.map((item, i) => (i === index ? item.servings + delta : item.servings))
    const target = servings[index] ?? 0
    if (target < SERVING_LIMITS.min || target > SERVING_LIMITS.max) {
      toast(`份数需在 ${SERVING_LIMITS.min} - ${SERVING_LIMITS.max} 之间`)
      return
    }
    const updated = await today.updateMeal(meal.id, { servings })
    if (!updated) toast(today.getSnapshot().error ?? '修改失败', 'error')
  }

  /** 打开编辑面板（自绘，不用原生 showActionSheet —— 见文件头注释） */
  function openEdit(meal: MealRecord): void {
    setEditMealType(meal.mealType)
    setEditNote(meal.note ?? '')
    setEditing(meal)
  }

  function closeEdit(): void {
    if (editSaving) return
    setEditing(null)
  }

  /** 保存：只提交真正变了的字段（减少一次无意义的写） */
  async function saveEdit(): Promise<void> {
    const meal = editing
    if (meal === null) return
    const note = editNote.trim()
    const nextNote = note === '' ? null : note

    const payload: { mealType?: MealType; note?: string | null } = {}
    if (editMealType !== meal.mealType) payload.mealType = editMealType
    if (nextNote !== (meal.note ?? null)) payload.note = nextNote
    if (payload.mealType === undefined && payload.note === undefined) {
      setEditing(null)
      return
    }

    setEditSaving(true)
    const ok = await today.updateMeal(meal.id, payload)
    setEditSaving(false)
    if (!ok) {
      toast(today.getSnapshot().error ?? '修改失败', 'error')
      return
    }
    setEditing(null)
    toast('已保存', 'success')
  }

  async function deleteFromSheet(): Promise<void> {
    const meal = editing
    if (meal === null) return
    setEditing(null)
    await handleDelete(meal.id)
  }

  function simulateError(): void {
    const mock = container.mockNutritionControls
    if (mock === null) {
      toast('当前是真实后端模式，无法模拟错误')
      return
    }
    mock.failNextRequests(1)
    reload()
  }

  function resetDemo(): void {
    container.mockNutritionControls?.reset()
    reload()
  }

  /**
   * 打开菜品库（可带上食堂分类）——「按食堂看菜品」是营养管家的一个正经入口，
   * 不是隐藏的调试页：用户想知道「第二食堂有什么」，从这里一步到位。
   */
  function openDishes(canteen: string | null): void {
    const url =
      canteen === null
        ? PAGE_PATHS.nutritionDishes
        : `${PAGE_PATHS.nutritionDishes}?canteen=${encodeURIComponent(canteen)}`
    void navigateTo(url)
  }

  const calorieProgress = state.progress.find((item) => item.key === 'caloriesKcal')
  const caloriePercent = calorieProgress?.percent ?? 0
  const remaining = state.gaps === null ? null : Math.round(state.gaps.caloriesKcal)

  /**
   * 各餐里「蛋白最不够」的那一餐 —— 比整天汇总更能指导下一顿吃什么。
   * 只在设置了需求、且至少记了一餐时给。
   */
  const target = state.target
  const mealTypeHint = ((): string | null => {
    if (target === null || target.proteinG <= 0) return null
    const recorded = state.byMealType.filter((row) => row.meals > 0)
    if (recorded.length === 0) return null
    const weakest = recorded.reduce((min, row) => (row.totals.proteinG < min.totals.proteinG ? row : min))
    const share = Math.round((weakest.totals.proteinG / target.proteinG) * 100)
    if (share >= 30) return null
    return `${MEAL_TYPE_LABELS[weakest.mealType]}蛋白只有 ${Math.round(
      weakest.totals.proteinG,
    )}g（目标的 ${share}%），下一餐可以加一份荤菜或豆制品。`
  })()

  return (
    <View className='kdy-page kdy-nu-home'>
      {state.status === 'loading' && <KdyEmpty mode='loading' description='正在汇总今日营养' />}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          description={state.error ?? '未知错误'}
          actionText='重试'
          onAction={reload}
        />
      )}

      {state.status === 'ready' && (
        <View>
          <KdyCard elevated={false}>
            <View className='kdy-nu-home__date'>
              <Text className='kdy-nu-home__date-text'>今天 · {state.date ?? ''}</Text>
              <View className='kdy-nu-home__date-side'>
                {state.fromCache && <KdyTag tone='info'>缓存数据</KdyTag>}
                <Text
                  className='kdy-nu-home__history-link'
                  onClick={() => {
                    void navigateTo(PAGE_PATHS.nutritionHistory)
                  }}
                >
                  历史与趋势
                </Text>
              </View>
            </View>

            {state.target === null ? (
              <View className='kdy-nu-home__no-target'>
                <Text className='kdy-nu-home__no-target-text'>
                  还没有设置每日营养需求。需求因人而异 —— 设置后这里会显示今日进度与推荐。
                </Text>
                <KdyButton
                  size='sm'
                  onClick={() => {
                    void navigateTo(PAGE_PATHS.nutritionTargets)
                  }}
                >
                  去设置每日需求
                </KdyButton>
              </View>
            ) : (
              <View className='kdy-nu-home__ring'>
                <KdyRing percent={caloriePercent} tone={calorieTone(caloriePercent)}>
                  <Text className='kdy-ring__value-text'>
                    {remaining === null ? '--' : remaining > 0 ? remaining : 0}
                  </Text>
                  <Text className='kdy-ring__label-text'>
                    {remaining !== null && remaining > 0 ? '还可吃 (kcal)' : '已达标 (kcal)'}
                  </Text>
                </KdyRing>
                <View className='kdy-nu-home__ring-side'>
                  <Text className='kdy-nu-home__ring-line'>
                    已摄入 {Math.round(state.totals.caloriesKcal)} / {state.target.caloriesKcal} kcal
                  </Text>
                  <Text className='kdy-nu-home__ring-sub'>
                    {state.meals.length} 条用餐记录 · 下拉可刷新
                  </Text>
                </View>
              </View>
            )}
          </KdyCard>

          {state.target !== null && (
            <KdyCard title='六项营养进度' elevated={false}>
              <View className='kdy-nu-home__nutrients'>
                {state.progress.map((item) => (
                  <View key={item.key} className='kdy-nu-home__nutrient'>
                    <View className='kdy-nu-home__nutrient-head'>
                      <Text className='kdy-nu-home__nutrient-label'>
                        {item.label}
                        {item.isUpperLimit ? '（上限）' : ''}
                      </Text>
                      <Text className='kdy-nu-home__nutrient-value'>
                        {Math.round(item.current)} / {item.target} {item.unit}
                        {item.met ? ' ✓' : item.percent > 100 ? ' ⚠' : ''}
                      </Text>
                    </View>
                    <KdyBar percent={item.percent} tone={rowTone(item)} />
                  </View>
                ))}
              </View>
            </KdyCard>
          )}

          {state.meals.length > 0 && (
            <KdyCard
              title='各餐分布'
              extra={<Text>{state.byMealType.filter((row) => row.meals > 0).length} 餐</Text>}
              elevated={false}
            >
              <View className='kdy-nu-home__dist'>
                {state.byMealType.map((row) => (
                  <View key={row.mealType} className='kdy-nu-home__dist-row'>
                    <Text className='kdy-nu-home__dist-name'>{MEAL_TYPE_LABELS[row.mealType]}</Text>
                    <View className='kdy-nu-home__dist-track'>
                      <KdyBar
                        percent={
                          state.totals.caloriesKcal <= 0
                            ? 0
                            : Math.round((row.totals.caloriesKcal / state.totals.caloriesKcal) * 100)
                        }
                        height={6}
                      />
                    </View>
                    <Text className='kdy-nu-home__dist-value'>
                      {row.meals === 0
                        ? '未记录'
                        : `${Math.round(row.totals.caloriesKcal)} kcal · 蛋白 ${Math.round(row.totals.proteinG)}g`}
                    </Text>
                  </View>
                ))}
              </View>
              {mealTypeHint !== null && <Text className='kdy-nu-home__hint'>{mealTypeHint}</Text>}
            </KdyCard>
          )}

          <KdyCard
            title='今日用餐'
            extra={<Text>{state.meals.length} 条</Text>}
            elevated={false}
          >
            {state.meals.length === 0 ? (
              <Text className='kdy-nu-home__empty-meals'>今天还没有记录，去记一笔吧</Text>
            ) : (
              <View className='kdy-nu-home__meals'>
                {state.meals.map((meal) => (
                  <View key={meal.id} className='kdy-nu-home__meal'>
                    <View className='kdy-nu-home__meal-head'>
                      <KdyTag tone='brand'>{MEAL_TYPE_LABELS[meal.mealType]}</KdyTag>
                      <Text className='kdy-nu-home__meal-time'>
                        {new Date(meal.eatenAt).toTimeString().slice(0, 5)}
                      </Text>
                      <Text className='kdy-nu-home__meal-kcal'>
                        {Math.round(meal.totals.caloriesKcal)} kcal
                      </Text>
                      <Text
                        className='kdy-nu-home__meal-edit'
                        onClick={() => {
                          openEdit(meal)
                        }}
                      >
                        编辑
                      </Text>
                      <Text
                        className='kdy-nu-home__meal-delete'
                        onClick={() => {
                          void handleDelete(meal.id)
                        }}
                      >
                        {state.deletingId === meal.id ? '处理中…' : '删除'}
                      </Text>
                    </View>
                    {meal.items.map((item, index) => (
                      <View key={`${meal.id}-${item.dishName}-${index}`} className='kdy-nu-home__meal-item'>
                        <Text className='kdy-nu-home__meal-item-name'>{item.dishName}</Text>
                        <View className='kdy-nu-home__stepper'>
                          <Text
                            className='kdy-nu-home__stepper-btn'
                            onClick={() => void stepServings(meal, index, -0.5)}
                          >
                            −
                          </Text>
                          <Text className='kdy-nu-home__stepper-value'>{item.servings}</Text>
                          <Text
                            className='kdy-nu-home__stepper-btn'
                            onClick={() => void stepServings(meal, index, 0.5)}
                          >
                            +
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ))}
                <Text className='kdy-nu-home__hint'>
                  「−」「+」按半份调整份数；记错了可以直接删除这条记录。
                </Text>
              </View>
            )}
          </KdyCard>

          {state.target !== null && state.recommendations.length > 0 && (
            <KdyCard title='今天还吃什么' extra={<Text>{state.recommendations.length} 道</Text>} elevated={false}>
              <View className='kdy-nu-home__recs'>
                {state.recommendations.slice(0, 3).map((rec) => (
                  <View
                    key={rec.dish.id}
                    className='kdy-nu-home__rec'
                    onClick={() => {
                      // 推荐 → 一键加入当餐，再跳去记录页确认（闭环的关键一步）
                      container.useCases.logMeal.addToCart(toCartDish(rec.dish))
                      toast(`已加入：${rec.dish.name}`)
                      void navigateTo(PAGE_PATHS.nutritionLog)
                    }}
                  >
                    <View className='kdy-nu-home__rec-head'>
                      <Text className='kdy-nu-home__rec-name'>{rec.dish.name}</Text>
                      <Text className='kdy-nu-home__rec-kcal'>{rec.dish.caloriesKcal} kcal/份</Text>
                      <Text className='kdy-nu-home__rec-add'>加入</Text>
                    </View>
                    <Text className='kdy-nu-home__rec-reason'>{rec.reason}</Text>
                    {formatNutrientSource(rec.dish.source, rec.dish.lastVerifiedAt) !== null && (
                      <Text className='kdy-nu-home__rec-source'>
                        {formatNutrientSource(rec.dish.source, rec.dish.lastVerifiedAt)}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
              <KdyButton
                size='sm'
                variant='ghost'
                onClick={() => {
                  void navigateTo(PAGE_PATHS.nutritionRecommend)
                }}
              >
                查看全部推荐
              </KdyButton>
            </KdyCard>
          )}

          {/*
            按食堂看菜品 —— 食堂分类是这一模块的第一层分类维度，
            因此在首页就给出 7 个食堂的入口（白名单来自 `@kedaya/shared`）。
          */}
          <KdyCard title='按食堂看菜品' extra={<Text>菜品库</Text>} elevated={false}>
            <Text className='kdy-nu-home__hint'>
              营养数据按食堂分类维护。点一个食堂看看有哪些菜、每份多少营养、数据来自哪里。
            </Text>
            <View className='kdy-nu-home__canteens'>
              <KdyChip active={false} onClick={() => openDishes(null)}>
                全部菜品
              </KdyChip>
              {CANTEEN_NAMES.map((name) => (
                <KdyChip key={name} active={false} onClick={() => openDishes(name)}>
                  {name}
                </KdyChip>
              ))}
            </View>
          </KdyCard>

          <View className='kdy-nu-home__actions'>
            <KdyButton
              block
              onClick={() => {
                void navigateTo(PAGE_PATHS.nutritionLog)
              }}
            >
              记录当餐
            </KdyButton>
            <View className='kdy-nu-home__actions-row'>
              <View className='kdy-nu-home__action'>
                <KdyButton
                  block
                  variant='secondary'
                  onClick={() => {
                    void navigateTo(PAGE_PATHS.nutritionRecommend)
                  }}
                >
                  看看推荐
                </KdyButton>
              </View>
              <View className='kdy-nu-home__action'>
                <KdyButton
                  block
                  variant='secondary'
                  onClick={() => {
                    void navigateTo(PAGE_PATHS.nutritionHistory)
                  }}
                >
                  历史趋势
                </KdyButton>
              </View>
              <View className='kdy-nu-home__action'>
                <KdyButton
                  block
                  variant='ghost'
                  onClick={() => {
                    void navigateTo(PAGE_PATHS.nutritionTargets)
                  }}
                >
                  每日需求
                </KdyButton>
              </View>
            </View>
          </View>

          <View className='kdy-nu-home__demo'>
            <KdyButton size='sm' variant='ghost' onClick={simulateError}>
              模拟错误态
            </KdyButton>
            <KdyButton size='sm' variant='ghost' onClick={resetDemo}>
              重置演示数据
            </KdyButton>
          </View>

          {state.error !== null && state.status === 'ready' && (
            <Text className='kdy-nu-home__soft-error'>后台刷新失败：{state.error}（已继续展示缓存）</Text>
          )}
        </View>
      )}

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。营养数据为演示量级，仅供参考。
      </Text>

      {editing !== null && (
        <View className='kdy-nu-sheet__mask' onClick={closeEdit}>
          <View
            className='kdy-nu-sheet'
            onClick={(event) => {
              // 点面板本身不关闭（只有点遮罩或「取消」才关）
              event.stopPropagation()
            }}
          >
            <View className='kdy-nu-sheet__head'>
              <Text className='kdy-nu-sheet__title'>编辑这一餐</Text>
              <Text className='kdy-nu-sheet__close' onClick={closeEdit}>
                取消
              </Text>
            </View>

            <Text className='kdy-nu-sheet__label'>餐型</Text>
            <View className='kdy-nu-sheet__chips'>
              {MEAL_TYPES.map((type) => (
                <KdyChip key={type} active={type === editMealType} onClick={() => setEditMealType(type)}>
                  {MEAL_TYPE_LABELS[type]}
                </KdyChip>
              ))}
            </View>

            <KdyField
              label='备注'
              value={editNote}
              placeholder='如：聚餐 / 没吃完饭'
              onChange={setEditNote}
            />

            <Text className='kdy-nu-sheet__hint'>
              {editing.items.map((item) => `${item.dishName} ×${item.servings}`).join('、')}
              （换菜请删除重记：营养是记录那一刻的快照）
            </Text>

            <View className='kdy-nu-sheet__actions'>
              <View className='kdy-nu-sheet__action'>
                <KdyButton block variant='ghost' onClick={() => void deleteFromSheet()}>
                  删除这条
                </KdyButton>
              </View>
              <View className='kdy-nu-sheet__action'>
                <KdyButton block loading={editSaving} onClick={() => void saveEdit()}>
                  保存
                </KdyButton>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}
