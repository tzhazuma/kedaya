import { Text, View } from '@tarojs/components'
import { useDidShow, useRouter } from '@tarojs/taro'
import {
  CANTEEN_NAMES,
  DISH_CATEGORIES,
  DISH_CATEGORY_LABELS,
  fenToYuan,
  isDishCategory,
} from '@kedaya/shared'
import { useMemo, useRef, useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS } from '../../../../app/routes'
import { formatNutrientSource, toCartDish } from '../../../../domain/models/nutrition'
import type { CanteenDish } from '../../../../domain/models/nutrition'
import { readDishLibraryQuery } from '../../../../application/nutrition/dishLibrary'
import type { DishLibraryQuery } from '../../../../application/nutrition/dishLibrary'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField, KdyTag } from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 菜品库（按食堂看）+ 补录入口。
 *
 * 这一页回答的是「**我们学校的食堂里都有什么菜、营养怎么样**」：
 *   · 食堂分类是第一层筛选（白名单来自 `@kedaya/shared` 的 `CANTEEN_NAMES`，
 *     与营养管家的其它页面、Web 后台共用同一份，不在这里另写一份）；
 *   · 菜名与品类是**叠加**条件（「第二食堂」+「素菜」= 第二食堂的素菜）；
 *   · 每行都标明**食堂**与**营养数据来源** —— 「哪来的数据」是这一页的可信度来源。
 *
 * 定位说清楚：营养值由管理员在 Web 后台批量维护，**这里只是浏览 + 演示/补录**。
 * 因此补录表单默认折叠在「演示工具」里，打开后写入也要管理员权限（真实模式下）。
 */

interface DishForm {
  canteen: string
  name: string
  category: string
  servingG: string
  caloriesKcal: string
  proteinG: string
  fatG: string
  carbG: string
  fiberG: string
  sodiumMg: string
  priceYuan: string
}

const EMPTY_FORM: DishForm = {
  // 默认选中白名单第一项：食堂是**单选**（chip），不再是自由文本输入框 ——
  // 手写的食堂名会与筛选项对不上，筛选点下去就是空列表。
  canteen: CANTEEN_NAMES[0],
  name: '',
  category: 'other',
  servingG: '100',
  caloriesKcal: '',
  proteinG: '',
  fatG: '',
  carbG: '',
  fiberG: '0',
  sodiumMg: '0',
  priceYuan: '',
}

/**
 * 从页面参数里读初始食堂筛选（营养管家首页的食堂入口带过来）。
 *
 * 只认白名单里的名字：URL 是可以被手改的，把任意字符串塞进 `?canteen=`
 * 只会让用户看到一个空列表，还以为是数据没了。
 */
function readPresetCanteen(params: Record<string, string | undefined>): DishLibraryQuery | null {
  const raw = params.canteen
  if (raw === undefined) return null
  const name = decodeURIComponent(raw)
  if (!(CANTEEN_NAMES as readonly string[]).includes(name)) return null
  return { q: '', canteen: name, category: '' }
}

export default function NutritionDishesPage() {
  const container = getContainer()
  const library = container.useCases.dishLibrary
  const state = useStore(library)
  const router = useRouter()

  const preset = useMemo(() => readPresetCanteen(router.params), [router.params])
  const presetApplied = useRef(false)

  /** 搜索框文本（点「搜索」才下传，避免每敲一个字发一次请求） */
  const [qText, setQText] = useState('')
  const [showForm, setShowForm] = useState(false)

  const appliedQuery = readDishLibraryQuery(state.query)
  const filtering =
    appliedQuery.q !== '' || appliedQuery.canteen !== '' || appliedQuery.category !== ''

  useDidShow(() => {
    // 带着首页选的食堂进来时**跳过缓存**：否则会先闪一下「全部菜品」再跳到筛选结果
    if (preset !== null && !presetApplied.current) {
      presetApplied.current = true
      void library.load(preset)
      return
    }
    library.hydrate()
    void library.load()
  })

  function applyCanteen(canteen: string): void {
    applyFilters({ canteen })
  }

  function applyCategory(category: string): void {
    applyFilters({ category })
  }

  function handleSearch(): void {
    applyFilters({ q: qText })
  }

  function clearFilters(): void {
    setQText('')
    applyFilters({ q: '', canteen: '', category: '' })
  }

  /**
   * 换筛选 = 换一次检索：先 `reset()` 清掉上一批结果，再 `load()`。
   *
   * 为什么不直接 `load()`：`listUseCase` 的既定行为是「已有内容就保持 ready，
   * 不把首屏打回骨架屏」—— 这在列表翻页场景下是对的，但在**筛选**场景下会变成
   * 「点了第二食堂，屏幕上还是第一食堂的菜」，看起来像筛选没生效。
   */
  function applyFilters(patch: Partial<DishLibraryQuery>): void {
    library.reset()
    void library.load(patch)
  }

  /** 从菜品库直接记一餐：浏览 → 记录 的闭环（营养来自菜品库快照） */
  function addToMeal(dish: CanteenDish): void {
    container.useCases.logMeal.addToCart(toCartDish(dish), 1)
    toast(`已加入当餐：${dish.name}`)
    void navigateTo(PAGE_PATHS.nutritionLog)
  }

  return (
    <View className='kdy-page kdy-nu-dishes'>
      <KdyCard title='按食堂看菜品' elevated={false} tone='mint'>
        <Text className='kdy-nu-dishes__hint'>
          食堂分类与营养管家的其它页面共用同一份白名单。点一个食堂看它有哪些菜；菜名与品类是叠加条件
          （「第二食堂」+「素菜」两个一起生效）。
        </Text>

        {/*
          食堂分类 —— 白名单来自 `@kedaya/shared` 的 `CANTEEN_NAMES`（三端唯一真相）。
          「全部食堂」不在白名单里，只是取消筛选的入口。
        */}
        <Text className='kdy-nu-dishes__label'>食堂</Text>
        <View className='kdy-nu-dishes__chips'>
          <KdyChip active={appliedQuery.canteen === ''} onClick={() => applyCanteen('')}>
            全部食堂
          </KdyChip>
          {CANTEEN_NAMES.map((canteen) => (
            <KdyChip
              key={canteen}
              active={appliedQuery.canteen === canteen}
              onClick={() => applyCanteen(canteen)}
            >
              {canteen}
            </KdyChip>
          ))}
        </View>

        <Text className='kdy-nu-dishes__label'>菜的种类</Text>
        <View className='kdy-nu-dishes__chips'>
          <KdyChip active={appliedQuery.category === ''} onClick={() => applyCategory('')}>
            全部
          </KdyChip>
          {DISH_CATEGORIES.map((category) => (
            <KdyChip
              key={category}
              active={appliedQuery.category === category}
              onClick={() => applyCategory(category)}
            >
              {DISH_CATEGORY_LABELS[category]}
            </KdyChip>
          ))}
        </View>

        <View className='kdy-nu-dishes__row'>
          <KdyField
            className='kdy-nu-dishes__field'
            value={qText}
            placeholder='按菜名搜索，如：红烧排骨'
            onChange={setQText}
            onConfirm={handleSearch}
          />
          <KdyButton size='sm' onClick={handleSearch}>
            搜索
          </KdyButton>
        </View>

        {filtering && (
          <View className='kdy-nu-dishes__filters'>
            <Text className='kdy-nu-dishes__filters-text'>
              筛选：{appliedQuery.canteen === '' ? '全部食堂' : appliedQuery.canteen}
              {isDishCategory(appliedQuery.category)
                ? ` · ${DISH_CATEGORY_LABELS[appliedQuery.category]}`
                : ''}
              {appliedQuery.q === '' ? '' : ` · 菜名含「${appliedQuery.q}」`} · 已加载{' '}
              {state.items.length} 道
            </Text>
            <KdyButton size='sm' variant='ghost' onClick={clearFilters}>
              清空筛选
            </KdyButton>
          </View>
        )}

        {state.status === 'loading' && <KdyEmpty mode='loading' description='正在检索菜品库' />}

        {state.status === 'error' && (
          <KdyEmpty
            mode='error'
            description={state.error ?? '菜品库加载失败'}
            actionText='重试'
            onAction={() => void library.load()}
          />
        )}

        {state.status === 'empty' && (
          <View className='kdy-nu-dishes__empty'>
            <Text className='kdy-nu-dishes__hint'>
              {appliedQuery.canteen === ''
                ? '菜品库还没有符合条件的菜。'
                : `${appliedQuery.canteen}还没有录入菜品 —— 这不代表这个食堂没有饭，只是还没人把菜录进来。`}
            </Text>
            {appliedQuery.canteen !== '' && (
              <KdyButton size='sm' variant='ghost' onClick={() => applyCanteen('')}>
                不限食堂
              </KdyButton>
            )}
          </View>
        )}

        {state.items.length > 0 && (
          <View className='kdy-nu-dishes__list'>
            {state.items.map((dish) => {
              const source = formatNutrientSource(dish.source, dish.lastVerifiedAt)
              return (
                <View key={dish.id} className='kdy-nu-dishes__row-item'>
                  <View className='kdy-nu-dishes__row-head'>
                    <Text className='kdy-nu-dishes__row-name'>{dish.name}</Text>
                    <KdyTag tone='info'>{dish.canteen}</KdyTag>
                    <KdyTag tone='neutral'>{DISH_CATEGORY_LABELS[dish.category]}</KdyTag>
                  </View>
                  <Text className='kdy-nu-dishes__row-meta'>
                    {dish.servingG}g/份 · {dish.caloriesKcal} kcal · 蛋白 {dish.proteinG}g · 脂肪{' '}
                    {dish.fatG}g · 碳水 {dish.carbG}g · 钠 {dish.sodiumMg}mg · ¥{fenToYuan(dish.priceFen)}
                  </Text>
                  {source !== null && <Text className='kdy-nu-dishes__row-source'>{source}</Text>}
                  <View className='kdy-nu-dishes__row-actions'>
                    <KdyButton size='sm' variant='ghost' onClick={() => addToMeal(dish)}>
                      记这一餐
                    </KdyButton>
                  </View>
                </View>
              )
            })}

            {state.nextCursor !== null && (
              <KdyButton
                block
                size='sm'
                variant='secondary'
                loading={state.loadingMore}
                onClick={() => void library.loadMore()}
              >
                加载更多
              </KdyButton>
            )}
          </View>
        )}

        {state.fromCache && (
          <Text className='kdy-nu-dishes__hint'>
            以上是上次拉到的菜品（可能来自上一次筛选），正在后台刷新…
          </Text>
        )}
      </KdyCard>

      {/*
        补录表单折叠在「演示工具」里：正式数据由管理员在 Web 后台维护，
        这一页的主要职责是**展示**（AGENTS：Mock 操作放在折叠的演示工具中）。
      */}
      <KdyCard elevated={false}>
        <View className='kdy-nu-dishes__tools'>
          <View className='kdy-nu-dishes__tools-text'>
            <Text className='kdy-nu-dishes__tools-title'>演示工具</Text>
            <Text className='kdy-nu-dishes__tools-hint'>
              菜品库里没有你想吃的菜？可以在这里补录一条（mock 模式下只存本地；连上后端后写入需要管理员权限）。
            </Text>
          </View>
          <KdyButton size='sm' variant='ghost' onClick={() => setShowForm(!showForm)}>
            {showForm ? '收起' : '补录一道菜'}
          </KdyButton>
        </View>

        {showForm && (
          <DishForm
            onSaved={(canteen, name) => {
              toast(`已录入：${name}`)
              setShowForm(false)
              // 录入完成后直接看这个食堂的菜品：这样「录进去了没有」是看得见的
              setQText('')
              applyFilters({ q: '', canteen, category: '' })
            }}
          />
        )}
      </KdyCard>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。营养数据为演示量级，仅供参考。
      </Text>
    </View>
  )
}

/**
 * 补录表单（演示工具）—— 抽成独立组件是为了让主页面只关心**浏览**这一条路径，
 * 表单内部的文本状态不会在切换食堂筛选时被牵连重渲染。
 */
function DishForm({ onSaved }: { onSaved: (canteen: string, name: string) => void }) {
  const container = getContainer()
  const [form, setForm] = useState<DishForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  function setField(key: keyof DishForm, value: string): void {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function num(value: string): number | null {
    if (value.trim() === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.round(parsed) : null
  }

  async function handleSave(): Promise<void> {
    const priceYuan = num(form.priceYuan)
    const values = {
      canteen: form.canteen.trim(),
      name: form.name.trim(),
      servingG: num(form.servingG),
      caloriesKcal: num(form.caloriesKcal),
      proteinG: num(form.proteinG),
      fatG: num(form.fatG),
      carbG: num(form.carbG),
      fiberG: num(form.fiberG),
      sodiumMg: num(form.sodiumMg),
      priceFen: priceYuan === null ? null : Math.round(priceYuan * 100),
    }
    if (values.canteen === '' || values.name === '') {
      toast('食堂和菜名不能为空')
      return
    }
    if (
      values.servingG === null ||
      values.caloriesKcal === null ||
      values.proteinG === null ||
      values.fatG === null ||
      values.carbG === null ||
      values.fiberG === null ||
      values.sodiumMg === null ||
      values.priceFen === null
    ) {
      toast('请把营养字段填完整（可以是 0）')
      return
    }

    setSaving(true)
    const result = await container.nutritionRepository.createDish({
      canteen: values.canteen,
      name: values.name,
      category: form.category as (typeof DISH_CATEGORIES)[number],
      servingG: values.servingG,
      caloriesKcal: values.caloriesKcal,
      proteinG: values.proteinG,
      fatG: values.fatG,
      carbG: values.carbG,
      fiberG: values.fiberG,
      sodiumMg: values.sodiumMg,
      priceFen: values.priceFen,
    })
    setSaving(false)

    if (!result.ok) {
      toast(result.error.message)
      return
    }
    onSaved(values.canteen, result.value.name)
  }

  return (
    <View className='kdy-nu-dishes__form'>
      <Text className='kdy-nu-dishes__hint'>
        营养值为「每份」口径（不是每 100g）。食堂请从白名单里选 —— 手写的名字不会出现在筛选里。
      </Text>

      <Text className='kdy-nu-dishes__label'>食堂</Text>
      <View className='kdy-nu-dishes__chips'>
        {CANTEEN_NAMES.map((canteen) => (
          <KdyChip
            key={canteen}
            active={canteen === form.canteen}
            onClick={() => setField('canteen', canteen)}
          >
            {canteen}
          </KdyChip>
        ))}
      </View>

      <KdyField
        className='kdy-nu-dishes__field'
        label='菜名'
        value={form.name}
        placeholder='如：红烧排骨'
        onChange={(value) => setField('name', value)}
      />

      <Text className='kdy-nu-dishes__label'>菜的种类</Text>
      <View className='kdy-nu-dishes__chips'>
        {DISH_CATEGORIES.map((category) => (
          <KdyChip
            key={category}
            active={category === form.category}
            onClick={() => setField('category', category)}
          >
            {DISH_CATEGORY_LABELS[category]}
          </KdyChip>
        ))}
      </View>

      <View className='kdy-nu-dishes__row'>
        <KdyField
          className='kdy-nu-dishes__field'
          label='每份克数 (g)'
          type='number'
          value={form.servingG}
          onChange={(value) => setField('servingG', value)}
        />
        <KdyField
          className='kdy-nu-dishes__field'
          label='价格 (元)'
          type='digit'
          value={form.priceYuan}
          placeholder='如：14'
          onChange={(value) => setField('priceYuan', value)}
        />
      </View>

      <Text className='kdy-nu-dishes__section-title'>每份营养成分</Text>

      <View className='kdy-nu-dishes__grid'>
        <KdyField
          className='kdy-nu-dishes__field'
          label='热量 (kcal)'
          type='number'
          value={form.caloriesKcal}
          onChange={(value) => setField('caloriesKcal', value)}
        />
        <KdyField
          className='kdy-nu-dishes__field'
          label='蛋白质 (g)'
          type='number'
          value={form.proteinG}
          onChange={(value) => setField('proteinG', value)}
        />
        <KdyField
          className='kdy-nu-dishes__field'
          label='脂肪 (g)'
          type='number'
          value={form.fatG}
          onChange={(value) => setField('fatG', value)}
        />
        <KdyField
          className='kdy-nu-dishes__field'
          label='碳水 (g)'
          type='number'
          value={form.carbG}
          onChange={(value) => setField('carbG', value)}
        />
        <KdyField
          className='kdy-nu-dishes__field'
          label='膳食纤维 (g)'
          type='number'
          value={form.fiberG}
          onChange={(value) => setField('fiberG', value)}
        />
        <KdyField
          className='kdy-nu-dishes__field'
          label='钠 (mg)'
          type='number'
          value={form.sodiumMg}
          onChange={(value) => setField('sodiumMg', value)}
        />
      </View>

      <KdyButton block loading={saving} onClick={() => void handleSave()}>
        保存到菜品库
      </KdyButton>
    </View>
  )
}
