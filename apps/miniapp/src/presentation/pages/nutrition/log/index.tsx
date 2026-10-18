import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  CANTEEN_NAMES,
  DISH_CATEGORY_LABELS,
  MEAL_TYPES,
  MEAL_TYPE_LABELS,
  SERVING_STEP,
  fenToYuan,
  formatAllergenList,
  matchAvoidedAllergens,
  suggestMealType,
} from '@kedaya/shared'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS } from '../../../../app/routes'
import { navigateBack, navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField, KdyTag } from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 记录当餐页 —— 需求的两个入口都落在这里：
 *
 *   · 拍照：`拍照识别` → 候选列表 → 勾选加入（演示期 mock 识别，界面明示）
 *   · 输菜名：搜索菜品库 → 点选加入
 *
 * 两条路汇到同一辆「当餐购物车」，落库时营养一律由菜品库快照，
 * 客户端传不了营养值（与后端同一约定，ADR 0006）。
 */

export default function NutritionLogPage() {
  const container = getContainer()
  const logMeal = container.useCases.logMeal
  const state = useStore(logMeal)

  const [mode, setMode] = useState<'idle' | 'photo' | 'search'>('idle')
  const [mealType, setMealType] = useState(suggestMealType(new Date()))
  const [note, setNote] = useState('')
  const [photoAdded, setPhotoAdded] = useState(false)

  useDidShow(() => {
    // 每次进入都是新的一笔（购物车跨页面保留，刷新即清）
    logMeal.setQuery('')
  })

  async function handleRecognize(): Promise<void> {
    setMode('photo')
    // 优先走真实选图；取消/不支持时用演示照片（识别本就是 mock，诚实标注）
    let imageUrl = `demo://photo/${Date.now()}`
    try {
      const chooser = await Taro.chooseMedia({ count: 1, mediaType: ['image'] })
      const file = chooser.tempFiles?.[0]?.tempFilePath
      if (typeof file === 'string' && file !== '') {
        imageUrl = file
      } else {
        toast('未选择图片，使用演示照片')
      }
    } catch {
      toast('未选择图片，使用演示照片')
    }
    await logMeal.recognize(imageUrl)
  }

  function handleSearch(): void {
    setMode('search')
    void logMeal.search(state.query)
  }

  function addFromCandidate(candidate: (typeof state.candidates)[number]): void {
    if (candidate.dish === null) {
      toast(`「${candidate.name}」菜品库还没有，请先录入营养成分`)
      return
    }
    logMeal.addToCart(candidate.dish, 1)
    setPhotoAdded(true)
    toast(`已加入：${candidate.name}`)
  }

  function addFromResult(dish: (typeof state.results)[number]): void {
    logMeal.addToCart(dish, 1)
    toast(`已加入：${dish.name}`)
  }

  /**
   * 保存前做一次忌口/过敏原检查。
   *
   * 为什么不在加入购物车时就拦：用户可能就想吃这道菜（或者只是看看）。
   * 但**保存**进当天记录前必须提醒一次 —— 这是「知道自己踩了线」的机会，
   * 而不是替用户做决定。
   */
  async function confirmAllergensIfNeeded(): Promise<boolean> {
    const targets = container.useCases.nutritionTargets
    const loaded = await targets.load()
    const avoid = loaded.target?.avoidAllergens ?? []
    if (avoid.length === 0) return true

    const conflicts = state.cart.flatMap((item) => ({
      name: item.dish.name,
      hits: matchAvoidedAllergens(item.dish.allergens, avoid),
    }))
    const hit = conflicts.filter((item) => item.hits.length > 0)
    if (hit.length === 0) return true

    const detail = hit.map((item) => `${item.name}（${formatAllergenList(item.hits)}）`).join('、')
    const modal = await Taro.showModal({
      title: '含你勾选的忌口',
      content: `${detail}。仍要记录这一餐吗？`,
      confirmText: '仍然记录',
      cancelText: '返回修改',
    })
    return modal.confirm
  }

  async function handleSave(): Promise<void> {
    const allowed = await confirmAllergensIfNeeded()
    if (!allowed) return

    const record = await logMeal.confirm({
      mealType,
      source: photoAdded ? 'photo' : 'manual',
      note: note.trim() === '' ? undefined : note.trim(),
    })
    if (record !== null) {
      toast('已记录当餐')
      void navigateBack()
    }
  }

  const cartTotals = logMeal.cartTotals()

  return (
    <View className='kdy-page kdy-nu-log'>
      <KdyCard title='怎么记录这一餐？' elevated={false}>
        <View className='kdy-nu-log__entries'>
          <View className='kdy-nu-log__entry'>
            <KdyButton block variant='primary' onClick={() => void handleRecognize()}>
              拍照识别（演示）
            </KdyButton>
          </View>
          <View className='kdy-nu-log__entry'>
            <KdyButton block variant='secondary' onClick={handleSearch}>
              输入菜名
            </KdyButton>
          </View>
        </View>
        <Text className='kdy-nu-log__entries-hint'>
          拍照识别当前为演示模式：返回确定性候选，不调用真实视觉服务。
        </Text>
      </KdyCard>

      {mode === 'photo' && (
        <KdyCard title='识别候选' extra={<Text>{state.candidates.length} 个</Text>} elevated={false}>
          {state.recognizing && <KdyEmpty mode='loading' description='正在识别（演示）' />}
          {state.recognizeError !== null && (
            <KdyEmpty mode='error' description={state.recognizeError} actionText='重试' onAction={() => void handleRecognize()} />
          )}
          {!state.recognizing && state.candidates.length === 0 && state.recognizeError === null && (
            <Text className='kdy-nu-log__hint'>点上面的「拍照识别」看看效果</Text>
          )}
          {state.candidates.length > 0 && (
            <View className='kdy-nu-log__fallback'>
              <Text className='kdy-nu-log__hint'>识别不准？直接按菜名找，一样能记上。</Text>
              <KdyButton size='sm' variant='ghost' onClick={handleSearch}>
                改成按菜名找
              </KdyButton>
            </View>
          )}
          <View className='kdy-nu-log__candidates'>
            {state.candidates.map((candidate) => (
              <View key={candidate.name} className='kdy-nu-log__candidate'>
                <View className='kdy-nu-log__candidate-head'>
                  <Text className='kdy-nu-log__candidate-name'>{candidate.name}</Text>
                  <KdyTag tone='neutral'>{DISH_CATEGORY_LABELS[candidate.category]}</KdyTag>
                  <Text className='kdy-nu-log__candidate-confidence'>
                    置信度 {Math.round(candidate.confidence * 100)}%
                  </Text>
                </View>
                {candidate.dish === null ? (
                  <Text className='kdy-nu-log__candidate-missing'>
                    识别到了，但菜品库还没有这道菜的营养成分 —— 请先录入
                  </Text>
                ) : (
                  <View className='kdy-nu-log__candidate-foot'>
                    <Text className='kdy-nu-log__candidate-nutrition'>
                      {candidate.dish.caloriesKcal} kcal · 蛋白 {candidate.dish.proteinG}g · 钠{' '}
                      {candidate.dish.sodiumMg}mg / 份
                      {candidate.dish.allergens !== undefined && candidate.dish.allergens.length > 0
                        ? ` · 含 ${formatAllergenList(candidate.dish.allergens)}`
                        : ''}
                    </Text>
                    <KdyButton size='sm' onClick={() => addFromCandidate(candidate)}>
                      加入
                    </KdyButton>
                  </View>
                )}
              </View>
            ))}
          </View>
        </KdyCard>
      )}

      {mode === 'search' && (
        <KdyCard title='按菜名找' elevated={false}>
          <View className='kdy-nu-log__search'>
            <KdyField
              className='kdy-nu-log__search-input'
              value={state.query}
              placeholder='输入菜名，如：红烧排骨'
              onChange={logMeal.setQuery}
              onConfirm={handleSearch}
            />
            <KdyButton size='sm' onClick={handleSearch}>
              搜索
            </KdyButton>
          </View>

          {/*
            食堂分类 —— 与「共建菜品库」页面的筛选同一份白名单
            （`@kedaya/shared` 的 CANTEEN_NAMES），不再各写一份。
            「全部」不是白名单成员，只是一个取消筛选的入口。
          */}
          <View className='kdy-nu-log__canteens'>
            <KdyChip active={state.canteen === null} onClick={() => void logMeal.setCanteen(null)}>
              全部食堂
            </KdyChip>
            {CANTEEN_NAMES.map((name) => (
              <KdyChip
                key={name}
                active={state.canteen === name}
                onClick={() => void logMeal.setCanteen(name)}
              >
                {name}
              </KdyChip>
            ))}
          </View>
          <Text className='kdy-nu-log__canteens-hint'>
            食堂和菜名是叠加条件：选了食堂再看菜名，两个条件一起生效。
          </Text>

          {state.searching && <KdyEmpty mode='loading' description='正在搜索菜品库' />}
          {!state.searching && state.results.length === 0 && (state.query !== '' || state.canteen !== null) && (
            <View className='kdy-nu-log__no-result'>
              <Text className='kdy-nu-log__hint'>
                {state.query === ''
                  ? `「${state.canteen}」暂无菜品`
                  : `菜品库里没找到「${state.query}」${state.canteen === null ? '' : `（限${state.canteen}）`}`}
              </Text>
              {state.canteen !== null && (
                <KdyButton size='sm' variant='ghost' onClick={() => void logMeal.setCanteen(null)}>
                  不限食堂
                </KdyButton>
              )}
              <KdyButton
                size='sm'
                variant='ghost'
                onClick={() => {
                  void navigateTo(PAGE_PATHS.nutritionDishes)
                }}
              >
                去录入这道菜
              </KdyButton>
            </View>
          )}
          <View className='kdy-nu-log__results'>
            {state.results.map((dish) => (
              <View key={dish.id} className='kdy-nu-log__result' onClick={() => addFromResult(dish)}>
                <View className='kdy-nu-log__result-main'>
                  <Text className='kdy-nu-log__result-name'>{dish.name}</Text>
                  <KdyTag tone='neutral'>{DISH_CATEGORY_LABELS[dish.category]}</KdyTag>
                </View>
                <Text className='kdy-nu-log__result-meta'>
                  {dish.canteen} · {dish.servingG}g/份 · {dish.caloriesKcal} kcal · ¥
                  {fenToYuan(dish.priceFen)}
                  {dish.allergens !== undefined && dish.allergens.length > 0
                    ? ` · 含 ${formatAllergenList(dish.allergens)}`
                    : ''}
                </Text>
              </View>
            ))}
          </View>
        </KdyCard>
      )}

      <KdyCard title={`当餐（${state.cart.length}）`} extra={<Text>{Math.round(cartTotals.caloriesKcal)} kcal</Text>} elevated={false}>
        {state.cart.length === 0 ? (
          <Text className='kdy-nu-log__hint'>还没有添加菜品。用上面的拍照识别或输入菜名开始。</Text>
        ) : (
          <View className='kdy-nu-log__cart'>
            {state.cart.map((item) => (
              <View key={item.dish.id} className='kdy-nu-log__cart-item'>
                <View className='kdy-nu-log__cart-main'>
                  <Text className='kdy-nu-log__cart-name'>{item.dish.name}</Text>
                  <Text className='kdy-nu-log__cart-meta'>
                    {item.dish.caloriesKcal * item.servings} kcal · 蛋白 {item.dish.proteinG * item.servings}g
                  </Text>
                </View>
                <View className='kdy-nu-log__stepper'>
                  <Text
                    className='kdy-nu-log__stepper-btn'
                    onClick={() => logMeal.setServings(item.dish.id, item.servings - SERVING_STEP)}
                  >
                    −
                  </Text>
                  <Text className='kdy-nu-log__stepper-value'>{item.servings}</Text>
                  <Text
                    className='kdy-nu-log__stepper-btn'
                    onClick={() => logMeal.setServings(item.dish.id, item.servings + SERVING_STEP)}
                  >
                    +
                  </Text>
                  <Text
                    className='kdy-nu-log__cart-remove'
                    onClick={() => logMeal.removeFromCart(item.dish.id)}
                  >
                    移除
                  </Text>
                </View>
              </View>
            ))}

            <View className='kdy-nu-log__meal-types'>
              {MEAL_TYPES.map((type) => (
                <KdyChip key={type} active={type === mealType} onClick={() => setMealType(type)}>
                  {MEAL_TYPE_LABELS[type]}
                </KdyChip>
              ))}
            </View>

            <KdyField
              className='kdy-nu-log__note'
              value={note}
              placeholder='备注（可选），如：聚餐 / 没吃完饭'
              onChange={setNote}
            />

            {state.saveError !== null && (
              <Text className='kdy-nu-log__save-error'>{state.saveError}</Text>
            )}

            <KdyButton block disabled={state.cart.length === 0} loading={state.saving} onClick={() => void handleSave()}>
              保存这一餐
            </KdyButton>
          </View>
        )}
      </KdyCard>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。营养数据为演示量级，仅供参考。
      </Text>
    </View>
  )
}
