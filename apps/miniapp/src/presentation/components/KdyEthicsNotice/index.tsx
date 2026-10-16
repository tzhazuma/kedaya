import { Text, View } from '@tarojs/components'

import {
  FEEDING_POLICY_LABELS,
  FEEDING_POLICY_TONES,
  WILDLIFE_ETHICS_ACK_LABEL,
  WILDLIFE_ETHICS_RULES,
  WILDLIFE_ETHICS_TITLE,
  WILDLIFE_NO_DISTURB_NOTICE,
  feedingPolicyNotice,
} from '../../../domain/models/wildlife'
import type { FeedingPolicy } from '../../../domain/models/wildlife'
import { KdyTag } from '../KdyTag'
import './index.scss'

/**
 * KdyEthicsNotice —— 投喂规范 + 不打扰野生动物提示（规格 §8，**硬要求**）。
 *
 * ⚠️ **这不是同意门**（规格 §8.2 特意区分过）：
 * - 同意门 = 独立授权状态、可撤回、缺它则整个模块不可用（`CONSENT_REQUIRED`）；
 * - 这里的 `requireAck` 勾选 = **单次表单的操作确认**，缺它则该次提交被拒
 *   （`VALIDATION_FAILED`），但**浏览地图、查看区域、看别人的上报完全不受影响**。
 *
 * 因此 `requireAck` 默认为 `false`：区域详情 / 观测详情只做**告示**，不做拦截。
 * 只有上报页才传 `requireAck`。
 *
 * 色值全部来自设计令牌（`$kdy-*`），组件内**不得**手写色值（契约 §6.2）。
 */
export interface KdyEthicsNoticeProps {
  /** 生效的投喂政策（区域与物种取更严格者，见 `effectiveFeedingPolicy`） */
  policy: FeedingPolicy
  /** 用于文案的物种名，例如「黑天鹅」 */
  speciesName?: string
  /** 区域名，例如「人工湖」 */
  zoneName?: string
  /** 区域告示原文（`WildlifeZone.noticeText`） */
  noticeText?: string
  /** 是否需要用户勾选后才能提交（仅上报页为 true） */
  requireAck?: boolean
  acknowledged?: boolean
  onAcknowledgeChange?: (value: boolean) => void
  /** 是否展开伦理清单（默认展开 —— 规格 §8.2「折叠展开，默认展开」） */
  defaultExpanded?: boolean
  title?: string
}

export function KdyEthicsNotice({
  policy,
  speciesName,
  zoneName,
  noticeText,
  requireAck = false,
  acknowledged = false,
  onAcknowledgeChange,
  defaultExpanded = true,
  title = WILDLIFE_ETHICS_TITLE,
}: KdyEthicsNoticeProps) {
  const tone = FEEDING_POLICY_TONES[policy]
  const policyLabel = FEEDING_POLICY_LABELS[policy]

  return (
    <View className={`kdy-ethics kdy-ethics--${tone}`}>
      <View className='kdy-ethics__head'>
        <Text className='kdy-ethics__title'>{title}</Text>
        <KdyTag tone={tone}>{policyLabel}</KdyTag>
      </View>

      {zoneName !== undefined && zoneName !== '' && (
        <Text className='kdy-ethics__zone'>区域：{zoneName}</Text>
      )}

      {/* 投喂规范告示（规格 §8.1 E1/E2） */}
      <Text className='kdy-ethics__policy'>{feedingPolicyNotice(policy, speciesName)}</Text>

      {noticeText !== undefined && noticeText !== '' && (
        <Text className='kdy-ethics__notice'>{noticeText}</Text>
      )}

      {defaultExpanded && (
        <View className='kdy-ethics__rules'>
          {WILDLIFE_ETHICS_RULES.map((rule) => (
            <Text key={rule} className='kdy-ethics__rule'>
              · {rule}
            </Text>
          ))}
        </View>
      )}

      <Text className='kdy-ethics__disturb'>{WILDLIFE_NO_DISTURB_NOTICE}</Text>

      {requireAck && (
        <View
          className={`kdy-ethics__ack ${acknowledged ? 'kdy-ethics__ack--on' : ''}`}
          onClick={() => onAcknowledgeChange?.(!acknowledged)}
        >
          <Text className='kdy-ethics__box'>{acknowledged ? '☑' : '☐'}</Text>
          <Text className='kdy-ethics__ack-label'>{WILDLIFE_ETHICS_ACK_LABEL}</Text>
        </View>
      )}
    </View>
  )
}

export default KdyEthicsNotice
