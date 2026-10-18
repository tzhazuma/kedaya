import { Canvas, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import tokenJson from '@kedaya/design-tokens/tokens.json'
import { MEAL_TYPE_LABELS, computeDietPersonas, formatPersonaShare } from '@kedaya/shared'
import { useEffect, useState } from 'react'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS } from '../../../../app/routes'
import type { DailyMealSummary } from '../../../../domain/models/nutrition'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyEmpty, KdyTag } from '../../../components'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 历史与趋势页 —— 「昨天吃了什么」「这周吃了多少」。
 *
 * 三段内容：
 *   1. 本周报告（达标天数 / 钠超标 / 一句结论）
 *   2. 近 7 日**热量曲线**（canvas 折线 + 目标虚线 + 未记录标记）
 *   3. 选中日期的用餐列表（可删除 —— 记错了必须能撤回）
 *
 * 演示数据按钮只在 mock 模式下出现：趋势/周报靠「今天两餐」是看不出效果的。
 */

const CHART_CANVAS_ID = 'kdy-nutrition-trend'
const CHART_HEIGHT = 176

/** 图表配色：直接读 `tokens.json`（唯一真相），不手写色值（契约 §6.2） */
const chartColor = tokenJson.color

/**
 * 近 7 日热量曲线。
 *
 * 用 canvas 而不是纯 View：折线 + 面积渐变 + 目标虚线用 View 拼不出来，
 * 而趋势图是这一屏最值得「好看」的地方。
 * 颜色全部来自 `@kedaya/design-tokens`（禁手写色值，契约 §6.2）。
 */
function TrendChart({ days, targetKcal }: { days: DailyMealSummary[]; targetKcal: number | null }) {
  const [width, setWidth] = useState(300)

  useEffect(() => {
    const info = Taro.getWindowInfo ? Taro.getWindowInfo() : Taro.getSystemInfoSync()
    // 卡片左右各有 16px 边距 + 16px 内边距
    setWidth(Math.max(240, Math.round((info.windowWidth ?? 375) - 64)))
  }, [])

  // 值变了就重画（依赖序列化后的数据，避免每次渲染都重绘）
  const signature = days.map((day) => `${day.date}:${day.totals.caloriesKcal}:${day.meals}`).join('|')
  useEffect(() => {
    if (days.length === 0) return

    const height = CHART_HEIGHT
    const padding = { left: 30, right: 12, top: 20, bottom: 24 }
    const plotW = Math.max(1, width - padding.left - padding.right)
    const plotH = Math.max(1, height - padding.top - padding.bottom)

    const maxKcal = Math.max(
      targetKcal ?? 0,
      ...days.map((day) => day.totals.caloriesKcal),
      1,
    )
    const yMax = maxKcal * 1.15
    const stepX = days.length > 1 ? plotW / (days.length - 1) : 0
    const pointOf = (index: number, value: number) => ({
      x: padding.left + stepX * index,
      y: padding.top + plotH * (1 - value / yMax),
    })

    const ctx = Taro.createCanvasContext(CHART_CANVAS_ID)
    ctx.clearRect(0, 0, width, height)

    // 1) 横向网格 + y 轴刻度（0 / 半程 / 目标附近）
    ctx.setLineWidth(1)
    ctx.setStrokeStyle(chartColor.border)
    for (const ratio of [0, 0.5, 1]) {
      const y = padding.top + plotH * ratio
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(width - padding.right, y)
      ctx.stroke()
    }
    ctx.setFontSize(9)
    ctx.setFillStyle(chartColor.textMuted)
    ctx.fillText(`${Math.round(yMax)}`, 2, padding.top + 8)
    ctx.fillText('0', 18, padding.top + plotH + 3)

    // 2) 目标线（虚线）——标签放左侧，避免和右侧数据点的数值打架
    let targetY: number | null = null
    if (targetKcal !== null && targetKcal > 0) {
      targetY = padding.top + plotH * (1 - targetKcal / yMax)
      ctx.setLineWidth(1)
      ctx.setStrokeStyle(chartColor.success)
      ctx.setLineDash([4, 4], 0)
      ctx.beginPath()
      ctx.moveTo(padding.left, targetY)
      ctx.lineTo(width - padding.right, targetY)
      ctx.stroke()
      ctx.setLineDash([], 0)
      ctx.setFontSize(9)
      ctx.setFillStyle(chartColor.success)
      ctx.fillText(`目标 ${targetKcal}`, padding.left + 2, targetY - 4)
    }

    // 3) 面积（线性渐变，底部透明）
    const area = days.map((day, index) => pointOf(index, day.totals.caloriesKcal))
    const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + plotH)
    gradient.addColorStop(0, 'rgba(255, 197, 61, 0.45)')
    gradient.addColorStop(1, 'rgba(255, 197, 61, 0.02)')
    ctx.beginPath()
    ctx.moveTo(area[0]?.x ?? padding.left, padding.top + plotH)
    for (const point of area) ctx.lineTo(point.x, point.y)
    ctx.lineTo(area[area.length - 1]?.x ?? width - padding.right, padding.top + plotH)
    ctx.closePath()
    ctx.setFillStyle(gradient)
    ctx.fill()

    // 4) 平滑折线（相邻点中点做二次贝塞尔）
    ctx.beginPath()
    ctx.setLineWidth(2)
    ctx.setStrokeStyle(chartColor.brand)
    ctx.setLineJoin('round')
    const first = area[0]
    if (first !== undefined) ctx.moveTo(first.x, first.y)
    for (let index = 1; index < area.length; index += 1) {
      const prev = area[index - 1]
      const current = area[index]
      if (prev === undefined || current === undefined) continue
      const midX = (prev.x + current.x) / 2
      const midY = (prev.y + current.y) / 2
      ctx.quadraticCurveTo(prev.x, prev.y, midX, midY)
      if (index === area.length - 1) ctx.lineTo(current.x, current.y)
    }
    ctx.stroke()

    // 5) 数据点 + 数值 + 日期
    days.forEach((day, index) => {
      const point = pointOf(index, day.totals.caloriesKcal)
      const recorded = day.meals > 0
      ctx.beginPath()
      ctx.setFillStyle(recorded ? chartColor.brand : chartColor.surface)
      ctx.setStrokeStyle(recorded ? chartColor.brand : chartColor.border)
      ctx.setLineWidth(2)
      ctx.arc(point.x, point.y, recorded ? 3 : 2.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      if (recorded) {
        ctx.setFontSize(9)
        ctx.setFillStyle(chartColor.textMuted)
        const label = `${Math.round(day.totals.caloriesKcal)}`
        // 贴近目标线/顶部时把数值画到点的下方，避免压住虚线
        const tooCloseToTarget = targetY !== null && point.y - 10 < targetY
        const labelY = tooCloseToTarget ? point.y + 12 : point.y - 7
        ctx.fillText(label, point.x - label.length * 2.5, labelY)
      }

      ctx.setFontSize(9)
      ctx.setFillStyle(recorded ? chartColor.textMuted : chartColor.border)
      ctx.fillText(day.date.slice(5), point.x - 13, height - 6)
    })

    ctx.draw()
  }, [signature, targetKcal, width, days])

  return (
    <Canvas
      canvasId={CHART_CANVAS_ID}
      className='kdy-nu-history__chart'
      style={`width: ${width}px; height: ${CHART_HEIGHT}px`}
    />
  )
}

export default function NutritionHistoryPage() {
  const container = getContainer()
  const history = container.useCases.mealHistory
  const state = useStore(history)

  useDidShow(() => {
    void history.load()
  })

  const days = state.trend?.days ?? []

  /** 演示数据：往前补 N 天（仅 mock 模式可用） */
  function seedDemoDays(count: number): void {
    const mock = container.mockNutritionControls
    if (mock === null) {
      toast('当前是真实后端模式，无法生成演示数据')
      return
    }
    const created = mock.seedPastDays(count)
    void history.load()
    toast(created > 0 ? `已补 ${created} 条历史记录` : '这几天已经有数据了')
  }

  async function handleDelete(id: string): Promise<void> {
    const modal = await Taro.showModal({
      title: '删除这条记录？',
      content: '删除后当天的营养汇总会立刻更新，且无法恢复。',
      confirmText: '删除',
      confirmColor: '#c0392b',
    })
    if (!modal.confirm) return
    const okDeleted = await history.removeMeal(id)
    toast(okDeleted ? '已删除' : (history.getSnapshot().error ?? '删除失败'), okDeleted ? 'success' : 'error')
  }

  const isToday = state.date === state.todayKey
  const summary = state.summary
  // 趋势图只看最近 7 天；季度形象看整季（90 天）
  const chartDays = days.slice(-7)
  // 平均只算「图表这 7 天」，否则会拿 90 天的均值配 7 天的标题
  const chartRecorded = chartDays.filter((day) => day.meals > 0)
  const chartRecordedDays = chartRecorded.length
  const chartAverage = {
    caloriesKcal:
      chartRecordedDays === 0
        ? 0
        : Math.round(
            chartRecorded.reduce((sum, day) => sum + day.totals.caloriesKcal, 0) / chartRecordedDays,
          ),
    proteinG:
      chartRecordedDays === 0
        ? 0
        : Math.round(chartRecorded.reduce((sum, day) => sum + day.totals.proteinG, 0) / chartRecordedDays),
    sodiumMg:
      chartRecordedDays === 0
        ? 0
        : Math.round(chartRecorded.reduce((sum, day) => sum + day.totals.sodiumMg, 0) / chartRecordedDays),
  }
  const persona =
    state.target === null || days.length === 0
      ? null
      : computeDietPersonas(days, state.target, 90, state.trend?.coverage)

  async function copySummary(): Promise<void> {
    if (summary === null) return
    const text = `【可达鸭 · 营养周报】${summary.headline}（连续记录 ${summary.streak} 天）`
    try {
      await Taro.setClipboardData({ data: text })
      toast('本周小结已复制', 'success')
    } catch {
      toast('复制失败，请手动截图', 'error')
    }
  }

  async function copyPersona(): Promise<void> {
    if (persona === null) return
    try {
      await Taro.setClipboardData({ data: formatPersonaShare(persona, '本季度') })
      toast('形象文案已复制', 'success')
    } catch {
      toast('复制失败，请手动截图', 'error')
    }
  }

  return (
    <View className='kdy-page kdy-nu-history'>
      {persona !== null && persona.primary !== null && (
        <KdyCard
          title='本季饮食形象'
          extra={<Text>{`近 ${persona.stats.windowDays} 天`}</Text>}
          elevated={false}
        >
          <View className='kdy-nu-history__persona'>
            <Text className='kdy-nu-history__persona-emoji'>{persona.primary.emoji}</Text>
            <View className='kdy-nu-history__persona-text'>
              <Text className='kdy-nu-history__persona-title'>{persona.primary.title}</Text>
              <Text className='kdy-nu-history__persona-subtitle'>{persona.primary.subtitle}</Text>
            </View>
          </View>

          {persona.tags.length > 1 && (
            <View className='kdy-nu-history__persona-tags'>
              {persona.tags.map((tag, index) => (
                <View
                  key={tag.key}
                  className={`kdy-nu-history__persona-tag${
                    index === 0 ? ' kdy-nu-history__persona-tag--main' : ''
                  }`}
                >
                  <Text className='kdy-nu-history__persona-tag-text'>
                    {tag.emoji} {tag.title}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View className='kdy-nu-history__persona-evidence'>
            {persona.primary.evidence.map((item) => (
              <Text key={item} className='kdy-nu-history__persona-evidence-item'>
                · {item}
              </Text>
            ))}
            {persona.tags.length > 1 && (
              <Text className='kdy-nu-history__persona-evidence-item'>
                · 一个人可以有很多形象：这些标签都是同时命中的
              </Text>
            )}
          </View>
          <Text className='kdy-nu-history__persona-advice'>{persona.primary.advice}</Text>
          <KdyButton size='sm' variant='ghost' onClick={() => void copyPersona()}>
            复制形象文案
          </KdyButton>
        </KdyCard>
      )}
      {summary !== null && (
        <KdyCard
          title='本周报告'
          extra={<Text>{`连续 ${summary.streak} 天`}</Text>}
          elevated={false}
        >
          <View className='kdy-nu-history__report'>
            <View className='kdy-nu-history__report-item'>
              <Text className='kdy-nu-history__report-value'>{summary.recordedDays}</Text>
              <Text className='kdy-nu-history__report-label'>记录天数</Text>
            </View>
            <View className='kdy-nu-history__report-item'>
              <Text className='kdy-nu-history__report-value'>{summary.calorieOnTargetDays}</Text>
              <Text className='kdy-nu-history__report-label'>热量达标</Text>
            </View>
            <View className='kdy-nu-history__report-item'>
              <Text className='kdy-nu-history__report-value'>{summary.proteinMetDays}</Text>
              <Text className='kdy-nu-history__report-label'>蛋白达标</Text>
            </View>
            <View className='kdy-nu-history__report-item'>
              <Text
                className={`kdy-nu-history__report-value${
                  summary.sodiumOverDays > 0 ? ' kdy-nu-history__report-value--warn' : ''
                }`}
              >
                {summary.sodiumOverDays}
              </Text>
              <Text className='kdy-nu-history__report-label'>钠超标</Text>
            </View>
          </View>
          <Text className='kdy-nu-history__hint'>{summary.headline}</Text>
          <KdyButton size='sm' variant='ghost' onClick={() => void copySummary()}>
            复制本周小结
          </KdyButton>
        </KdyCard>
      )}

      <KdyCard
        title='近 7 日摄入'
        extra={<Text>{state.trend === null ? '—' : `连续 ${state.trend.streak} 天`}</Text>}
        elevated={false}
      >
        {days.length === 0 ? (
          <Text className='kdy-nu-history__hint'>还没有足够的数据，记录两餐后这里会出现趋势</Text>
        ) : (
          <View className='kdy-nu-history__chart-wrap'>
            <TrendChart days={chartDays} targetKcal={state.target?.caloriesKcal ?? null} />
            <Text className='kdy-nu-history__hint'>
              实线 = 每天摄入热量（最近 7 天）；绿色虚线 = 你的每日目标；空心点 = 那天没记录。
            </Text>
          </View>
        )}

        {chartRecordedDays > 0 && (
          <Text className='kdy-nu-history__hint'>
            有记录的 {chartRecordedDays} 天里，平均每天 {chartAverage.caloriesKcal} kcal ·
            蛋白 {chartAverage.proteinG} g · 钠 {chartAverage.sodiumMg} mg
          </Text>
        )}
      </KdyCard>

      {container.mockNutritionControls !== null && (
        <KdyCard title='演示数据（仅 mock 模式）' elevated={false}>
          <Text className='kdy-nu-history__hint'>
            趋势图和周报需要有几天数据才好看。这里可以一键补几天历史记录（含「没记晚餐」「奶茶超标」的日子），
            也可以随时清空。
          </Text>
          <View className='kdy-nu-history__demo'>
            <KdyButton
              size='sm'
              variant='secondary'
              onClick={() => {
                seedDemoDays(3)
              }}
            >
              补 3 天
            </KdyButton>
            <KdyButton
              size='sm'
              variant='secondary'
              onClick={() => {
                seedDemoDays(7)
              }}
            >
              补 7 天
            </KdyButton>
            <KdyButton
              size='sm'
              variant='ghost'
              onClick={() => {
                container.mockNutritionControls?.reset()
                void history.load()
                toast('演示数据已重置')
              }}
            >
              重置
            </KdyButton>
          </View>
        </KdyCard>
      )}

      <KdyCard
        title={isToday ? `今天 · ${state.date}` : state.date}
        extra={
          <View className='kdy-nu-history__nav'>
            <Text className='kdy-nu-history__nav-btn' onClick={() => void history.shift(-1)}>
              前一天
            </Text>
            <Text
              className={`kdy-nu-history__nav-btn${isToday ? ' kdy-nu-history__nav-btn--disabled' : ''}`}
              onClick={() => {
                if (!isToday) void history.shift(1)
              }}
            >
              后一天
            </Text>
          </View>
        }
        elevated={false}
      >
        {state.status === 'loading' && <KdyEmpty mode='loading' description='正在读这一天的记录' />}
        {state.status === 'error' && (
          <KdyEmpty
            mode='error'
            description={state.error ?? '未知错误'}
            actionText='重试'
            onAction={() => void history.load()}
          />
        )}
        {state.status === 'ready' && state.meals.length === 0 && (
          <Text className='kdy-nu-history__hint'>这一天没有记录</Text>
        )}
        {state.status === 'ready' && state.meals.length > 0 && (
          <View className='kdy-nu-history__meals'>
            {state.meals.map((meal) => (
              <View key={meal.id} className='kdy-nu-history__meal'>
                <View className='kdy-nu-history__meal-head'>
                  <KdyTag tone='brand'>{MEAL_TYPE_LABELS[meal.mealType]}</KdyTag>
                  <Text className='kdy-nu-history__meal-time'>
                    {new Date(meal.eatenAt).toTimeString().slice(0, 5)}
                  </Text>
                  <Text className='kdy-nu-history__meal-kcal'>{Math.round(meal.totals.caloriesKcal)} kcal</Text>
                  <Text
                    className='kdy-nu-history__meal-delete'
                    onClick={() => {
                      void handleDelete(meal.id)
                    }}
                  >
                    {state.deletingId === meal.id ? '删除中…' : '删除'}
                  </Text>
                </View>
                <Text className='kdy-nu-history__meal-items'>
                  {meal.items
                    .map((item) => `${item.dishName}${item.servings === 1 ? '' : ` ×${item.servings}`}`)
                    .join('、')}
                </Text>
              </View>
            ))}
            <Text className='kdy-nu-history__hint'>
              合计 {Math.round(state.totals.caloriesKcal)} kcal · 蛋白 {Math.round(state.totals.proteinG)} g · 钠{' '}
              {Math.round(state.totals.sodiumMg)} mg
            </Text>
          </View>
        )}
      </KdyCard>

      <View className='kdy-nu-history__actions'>
        <View className='kdy-nu-history__action'>
          <KdyButton
            block
            variant='secondary'
            onClick={() => {
              void navigateTo(PAGE_PATHS.nutritionHome)
            }}
          >
            回今日
          </KdyButton>
        </View>
        <View className='kdy-nu-history__action'>
          <KdyButton
            block
            onClick={() => {
              void navigateTo(PAGE_PATHS.nutritionLog)
            }}
          >
            记录一餐
          </KdyButton>
        </View>
      </View>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。营养数据为演示量级，仅供参考。
      </Text>
    </View>
  )
}
