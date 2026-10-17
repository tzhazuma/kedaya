import { Text, View } from '@tarojs/components'
import { CANTEEN_NAMES, DISH_CATEGORIES, DISH_CATEGORY_LABELS } from '@kedaya/shared'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { navigateBack, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyField } from '../../../components'
import './index.scss'

/**
 * 菜品录入页 —— 「每道菜上传其主要营养成分」的小程序侧入口。
 *
 * 定位说清楚：这是**演示/补录**用的轻量表单；正式的菜品营养数据
 * 管理在 Web 后台（批量、可审核）。mock 模式下录入的菜品只存在本地。
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
  // 手写的食堂名会与「共建菜品库」的筛选项对不上，筛选点下去就是空列表。
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

export default function NutritionDishesPage() {
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
    toast(`已录入：${result.value.name}`)
    void navigateBack()
  }

  return (
    <View className='kdy-page kdy-nu-dishes'>
      <KdyCard title='录入菜品' elevated={false}>
        <Text className='kdy-nu-dishes__hint'>
          营养值为「每份」口径（不是每 100g）。mock 模式下只存本地；连上后端后，写入需要管理员权限
          （正式数据由管理员在 Web 后台批量维护，这里适合演示 / 补录）。
        </Text>

        {/*
          食堂用**单选 chip** 而不是输入框：手写食堂名（「一食堂」vs「第一食堂」）
          会让「共建菜品库」的筛选点下去是空的。白名单来自 `@kedaya/shared`，三端同一份。
        */}
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
      </KdyCard>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。营养数据为演示量级，仅供参考。
      </Text>
    </View>
  )
}
