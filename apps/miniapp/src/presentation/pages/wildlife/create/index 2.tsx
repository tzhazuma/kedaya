import { Text, View } from '@tarojs/components'
import { useState } from 'react'

import { getContainer } from '../../../../app/container'
import { wildlifeDetailPath } from '../../../../app/routes'
import { validateDraft } from '../../../../application/wildlife/wildlifeUseCases'
import {
  WILDLIFE_CAMPUS_CENTER,
  WILDLIFE_GUARD_HINT,
  WILDLIFE_NOTE_MAX,
  WILDLIFE_PLACE_MAX,
  WILDLIFE_SPECIES_MAX,
  WILDLIFE_SPECIES_SUGGESTIONS,
} from '../../../../domain/models/wildlife'
import { navigateTo, toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyField } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import './index.scss'

/**
 * 上报校园动物观察点。
 *
 * 三条纪律（都来自后端契约）：
 *   · **不需要登录**：本模块匿名，后端 `POST /items` 刻意忽略登录主体，
 *     客户端也就不做"未登录请先登录"这种多余的拦截；
 *   · **文字上限与后端 `createSchema` 一致**（500/500/500），只用同一份
 *     纯函数提示，绝不发一个注定 400 的请求来试探；
 *   · **坐标可选、且只用于地图定位**：平台没有「获取当前位置」能力，
 *     所以坐标是手填；留空就用校园中心兜底。页面上必须如实说清
 *     "这是近似值，不是精确定位"，不能让人以为我们拿到了 GPS。
 *
 * 状态（`active` / `confirmed`）不由表单决定：新建一律由后端写默认值，
 * 「我也看到了」是详情页的领域动作。
 */

export default function WildlifeCreatePage() {
  const container = getContainer()
  const wildlife = container.useCases.wildlife

  const [species, setSpecies] = useState('')
  const [place, setPlace] = useState('')
  const [note, setNote] = useState('')
  const [latitudeText, setLatitudeText] = useState('')
  const [longitudeText, setLongitudeText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const draft = { species, place, note, latitudeText, longitudeText }
  const problems = validateDraft(draft)

  async function handleSubmit(): Promise<void> {
    if (submitting) return
    setError(null)
    setSubmitting(true)

    const result = await wildlife.create(draft)
    setSubmitting(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }
    toast('上报成功', 'success')
    await navigateTo(wildlifeDetailPath(result.value.id))
  }

  return (
    <View className='kdy-page kdy-wildlife-create'>
      <KdyHeading
        title='上报观察点'
        subtitle='看到就记一笔：在哪儿见到了什么。不用登录，但请尽量写清楚地点，别人才能找到。'
        eyebrow='KEDAYA · 猫鸟黑天鹅'
      />

      <KdyCard title='看到了什么' elevated={false}>
        <KdyField
          label='物种'
          value={species}
          onChange={setSpecies}
          placeholder='例如：橘猫 / 黑天鹅 / 不知道什么鸟'
          maxLength={WILDLIFE_SPECIES_MAX}
        />
        <View className='kdy-wildlife-create__chips'>
          {WILDLIFE_SPECIES_SUGGESTIONS.map((item) => (
            <KdyChip key={item} active={species === item} onClick={() => setSpecies(item)}>
              {item}
            </KdyChip>
          ))}
        </View>
        <Text className='kdy-wildlife-create__hint'>
          上面只是常见选项，认不出也可以照自己的说法写；物种是自由填写，没有标准答案。
        </Text>
      </KdyCard>

      <KdyCard title='在哪儿' elevated={false}>
        <KdyField
          label='地点'
          value={place}
          onChange={setPlace}
          placeholder='例如：图书馆后门 / 湖畔东侧'
          maxLength={WILDLIFE_PLACE_MAX}
          hint='用校园里叫得出名字的地方，比坐标更好用'
        />
        <KdyField
          label='备注'
          value={note}
          onChange={setNote}
          placeholder={`外观特征、常出现的时间、注意事项（选填，最多 ${WILDLIFE_NOTE_MAX} 字）`}
          maxLength={WILDLIFE_NOTE_MAX}
        />
      </KdyCard>

      <KdyCard title='坐标（选填）' elevated={false}>
        <Text className='kdy-wildlife-create__hint'>
          可达鸭暂时没有「获取当前位置」的能力，所以坐标要手填，只用来在地图上定位到大概位置。
          留空也可以，会默认用校园中心（{WILDLIFE_CAMPUS_CENTER.name}）。两个要么都填，要么都留空。
        </Text>
        <View className='kdy-wildlife-create__coords'>
          <KdyField
            label='纬度'
            type='digit'
            value={latitudeText}
            onChange={setLatitudeText}
            placeholder='例如 31.17943'
            maxLength={20}
          />
          <KdyField
            label='经度'
            type='digit'
            value={longitudeText}
            onChange={setLongitudeText}
            placeholder='例如 121.59261'
            maxLength={20}
          />
        </View>
        <Text className='kdy-wildlife-create__hint'>
          坐标是近似值，仅用于地图定位，不是精确定位。
        </Text>
      </KdyCard>

      <Text className='kdy-wildlife-create__guard'>{WILDLIFE_GUARD_HINT}</Text>

      {problems.length > 0 && (
        <Text className='kdy-wildlife-create__problems'>还需要完善：{problems.join('、')}</Text>
      )}
      {error !== null && <Text className='kdy-wildlife-create__error'>{error}</Text>}

      <View className='kdy-wildlife-create__actions'>
        <KdyButton
          block
          loading={submitting}
          disabled={problems.length > 0}
          onClick={() => void handleSubmit()}
        >
          提交观察点
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。请勿为了拍照投喂、追赶或惊扰动物；坐标是近似值，请以现场观察为准。
      </Text>
    </View>
  )
}
