import { Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import {
  ACTIVITY_LABELS,
  ALLERGENS,
  ALLERGEN_LABELS,
  GOAL_LABELS,
  type ActivityLevel,
  type NutritionGoal,
  type Sex,
} from '@kedaya/shared'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { navigateBack, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyField } from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 每日营养需求页 —— 「因人而异，由使用者提出」的落点（ADR 0006 决策 4）。
 *
 * 三件事都在这里：
 *   1. 估算器预填：填身体数据 → Mifflin-St Jeor 公式算一版 → 自动填入下表
 *   2. 直接修改：六项全是输入框，使用者说了算
 *   3. 忌口/过敏原：勾选后推荐阶段**硬过滤**（命中的菜整道不出现）
 *
 * 估算器只是纯函数（shared），本页只负责表单编排。
 */

const ACTIVITY_LEVELS: readonly ActivityLevel[] = ['sedentary', 'light', 'moderate', 'high']
const GOALS: readonly NutritionGoal[] = ['lose', 'maintain', 'gain']

interface TargetForm {
  caloriesKcal: string
  proteinG: string
  fatG: string
  carbG: string
  fiberG: string
  sodiumMg: string
}

const EMPTY_FORM: TargetForm = {
  caloriesKcal: '',
  proteinG: '',
  fatG: '',
  carbG: '',
  fiberG: '',
  sodiumMg: '',
}

function toForm(target: {
  caloriesKcal: number
  proteinG: number
  fatG: number
  carbG: number
  fiberG: number
  sodiumMg: number
}): TargetForm {
  return {
    caloriesKcal: String(target.caloriesKcal),
    proteinG: String(target.proteinG),
    fatG: String(target.fatG),
    carbG: String(target.carbG),
    fiberG: String(target.fiberG),
    sodiumMg: String(target.sodiumMg),
  }
}

function toNumber(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}

export default function NutritionTargetsPage() {
  const container = getContainer()
  const targets = container.useCases.nutritionTargets
  const state = useStore(targets)

  const [form, setForm] = useState<TargetForm>(EMPTY_FORM)
  const [sex, setSex] = useState<Sex>('male')
  const [age, setAge] = useState('20')
  const [heightCm, setHeightCm] = useState('175')
  const [weightKg, setWeightKg] = useState('70')
  const [activity, setActivity] = useState<ActivityLevel>('moderate')
  const [goal, setGoal] = useState<NutritionGoal>('maintain')
  /** 忌口/过敏原（机器值） */
  const [avoidAllergens, setAvoidAllergens] = useState<string[]>([])

  useDidShow(() => {
    void targets.load().then((next) => {
      if (next.target === null) return
      setForm(toForm(next.target))
      // 身体档案一起回填：重新估算时不用重填（体重变了直接改一个数字再算）
      if (next.target.sex !== undefined) setSex(next.target.sex)
      if (next.target.activity !== undefined) setActivity(next.target.activity)
      if (next.target.goal !== undefined) setGoal(next.target.goal)
      if (next.target.age !== undefined && next.target.age !== null) setAge(String(next.target.age))
      if (next.target.heightCm !== undefined && next.target.heightCm !== null) {
        setHeightCm(String(next.target.heightCm))
      }
      if (next.target.weightKg !== undefined && next.target.weightKg !== null) {
        setWeightKg(String(next.target.weightKg))
      }
      setAvoidAllergens(next.target.avoidAllergens ?? [])
    })
  })

  function toggleAllergen(allergen: string): void {
    setAvoidAllergens((prev) =>
      prev.includes(allergen) ? prev.filter((item) => item !== allergen) : [...prev, allergen],
    )
  }

  function setField(key: keyof TargetForm, value: string): void {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleEstimate(): void {
    const parsedAge = toNumber(age)
    const parsedHeight = toNumber(heightCm)
    const parsedWeight = toNumber(weightKg)
    if (parsedAge === null || parsedHeight === null || parsedWeight === null) {
      toast('请把年龄 / 身高 / 体重填完整')
      return
    }
    const estimated = targets.estimate({
      sex,
      age: parsedAge,
      heightCm: parsedHeight,
      weightKg: parsedWeight,
      activity,
      goal,
    })
    setForm(toForm(estimated))
    toast('已按估算器预填，可逐项修改')
  }

  async function handleSave(): Promise<void> {
    const { caloriesKcal, proteinG, fatG, carbG, fiberG, sodiumMg } = {
      caloriesKcal: toNumber(form.caloriesKcal),
      proteinG: toNumber(form.proteinG),
      fatG: toNumber(form.fatG),
      carbG: toNumber(form.carbG),
      fiberG: toNumber(form.fiberG),
      sodiumMg: toNumber(form.sodiumMg),
    }
    if (
      caloriesKcal === null ||
      proteinG === null ||
      fatG === null ||
      carbG === null ||
      fiberG === null ||
      sodiumMg === null
    ) {
      toast('六项都需要填写（可以是 0）')
      return
    }
    // 身体档案一起存：下次重新估算不用重填，体重变了也能一键更新目标
    const parsedAge = toNumber(age)
    const parsedHeight = toNumber(heightCm)
    const parsedWeight = toNumber(weightKg)
    const ok = await targets.save({
      caloriesKcal,
      proteinG,
      fatG,
      carbG,
      fiberG,
      sodiumMg,
      sex,
      activity,
      goal,
      avoidAllergens,
      ...(parsedAge === null ? {} : { age: parsedAge }),
      ...(parsedHeight === null ? {} : { heightCm: parsedHeight }),
      ...(parsedWeight === null ? {} : { weightKg: parsedWeight }),
    })
    if (ok) {
      toast('已保存每日需求')
      void navigateBack()
    }
  }

  return (
    <View className='kdy-page kdy-nu-targets'>
      {state.status === 'loading' && <KdyEmpty mode='loading' description='正在读取你的每日需求' />}

      {state.status === 'error' && (
        <KdyEmpty
          mode='error'
          description={state.error ?? '未知错误'}
          actionText='重试'
          onAction={() => void targets.load()}
        />
      )}

      {state.status === 'ready' && (
        <View>
          <KdyCard title='估算器（可选，只负责预填）' elevated={false}>
            <Text className='kdy-nu-targets__hint'>
              填身体数据算一版推荐量，自动填到下方；最终以你修改后的值为准。
            </Text>

            <View className='kdy-nu-targets__chips'>
              <KdyChip active={sex === 'male'} onClick={() => setSex('male')}>
                男
              </KdyChip>
              <KdyChip active={sex === 'female'} onClick={() => setSex('female')}>
                女
              </KdyChip>
            </View>

            <View className='kdy-nu-targets__row'>
              <KdyField
                className='kdy-nu-targets__field'
                label='年龄'
                type='number'
                value={age}
                onChange={setAge}
              />
              <KdyField
                className='kdy-nu-targets__field'
                label='身高 (cm)'
                type='number'
                value={heightCm}
                onChange={setHeightCm}
              />
              <KdyField
                className='kdy-nu-targets__field'
                label='体重 (kg)'
                type='number'
                value={weightKg}
                onChange={setWeightKg}
              />
            </View>

            <Text className='kdy-nu-targets__label'>活动量</Text>
            <View className='kdy-nu-targets__chips'>
              {ACTIVITY_LEVELS.map((level) => (
                <KdyChip key={level} active={level === activity} onClick={() => setActivity(level)}>
                  {ACTIVITY_LABELS[level]}
                </KdyChip>
              ))}
            </View>

            <Text className='kdy-nu-targets__label'>目标</Text>
            <View className='kdy-nu-targets__chips'>
              {GOALS.map((item) => (
                <KdyChip key={item} active={item === goal} onClick={() => setGoal(item)}>
                  {GOAL_LABELS[item]}
                </KdyChip>
              ))}
            </View>

            <View className='kdy-nu-targets__estimate-action'>
              <KdyButton variant='secondary' onClick={handleEstimate}>
                用估算器预填
              </KdyButton>
            </View>
          </KdyCard>

          <KdyCard
            title='忌口 / 过敏原'
            extra={<Text>{avoidAllergens.length === 0 ? '未设置' : `${avoidAllergens.length} 项`}</Text>}
            elevated={false}
          >
            <Text className='kdy-nu-targets__hint'>
              勾选后，推荐里不会再出现含这些成分的菜（硬过滤，不是排序靠后）。
            </Text>
            <View className='kdy-nu-targets__chips'>
              {ALLERGENS.map((allergen) => (
                <KdyChip
                  key={allergen}
                  active={avoidAllergens.includes(allergen)}
                  onClick={() => toggleAllergen(allergen)}
                >
                  {ALLERGEN_LABELS[allergen]}
                </KdyChip>
              ))}
            </View>
            <Text className='kdy-nu-targets__hint'>
              过敏原由菜名自动推断，可能标注不全 —— 有严重过敏请以食堂公示与工作人员确认为准。
            </Text>
          </KdyCard>

          <KdyCard title='我的每日需求' elevated={false}>
            <Text className='kdy-nu-targets__hint'>
              钠是上限（超过即扣分），其余是目标。热量有 1200 kcal 保底建议。
            </Text>

            <View className='kdy-nu-targets__form'>
              <KdyField
                className='kdy-nu-targets__field'
                label='热量 (kcal)'
                type='number'
                value={form.caloriesKcal}
                onChange={(value) => setField('caloriesKcal', value)}
              />
              <KdyField
                className='kdy-nu-targets__field'
                label='蛋白质 (g)'
                type='number'
                value={form.proteinG}
                onChange={(value) => setField('proteinG', value)}
              />
              <KdyField
                className='kdy-nu-targets__field'
                label='脂肪 (g)'
                type='number'
                value={form.fatG}
                onChange={(value) => setField('fatG', value)}
              />
              <KdyField
                className='kdy-nu-targets__field'
                label='碳水 (g)'
                type='number'
                value={form.carbG}
                onChange={(value) => setField('carbG', value)}
              />
              <KdyField
                className='kdy-nu-targets__field'
                label='膳食纤维 (g)'
                type='number'
                value={form.fiberG}
                onChange={(value) => setField('fiberG', value)}
              />
              <KdyField
                className='kdy-nu-targets__field'
                label='钠 (mg，上限)'
                type='number'
                value={form.sodiumMg}
                onChange={(value) => setField('sodiumMg', value)}
              />
            </View>

            {state.error !== null && <Text className='kdy-nu-targets__error'>{state.error}</Text>}

            <KdyButton block loading={state.saving} onClick={() => void handleSave()}>
              保存每日需求
            </KdyButton>
          </KdyCard>
        </View>
      )}

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。营养建议仅供参考，不构成医疗意见。
      </Text>
    </View>
  )
}
