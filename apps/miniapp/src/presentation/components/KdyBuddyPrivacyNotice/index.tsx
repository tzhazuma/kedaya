import { Text, View } from '@tarojs/components'

import {
  BUDDY_CONTACT_NOTICE,
  BUDDY_MATCH_ENABLED_NOTICE,
  BUDDY_PRIVACY_NOTICE,
  BUDDY_PRIVACY_NOTICE_SHORT,
  BUDDY_PRIVACY_POINTS,
} from '../../../domain/models/buddy'
import './index.scss'

/**
 * KdyBuddyPrivacyNotice —— 找搭子的隐私提示（规格 §6，**硬要求**）。
 *
 * 为什么必须显式告诉用户（而不是塞进隐私政策了事）：
 * `BuddyProfile` 里的「院系 + 兴趣标签 + 可用时段 + 常去区域」是**典型的画像输入**，
 * 而且 `buddy` 是**低敏感、无同意门**的模块（契约 §9 判定规则）——
 * 没有同意门兜底，就只剩「把话说清楚」这一道防线。用户必须能立刻知道：
 *
 * 1. **哪些信息会展示给他人** —— 只有活动信息、昵称与头像；
 *    `BuddyProfile` 对**任何人**都不可见（包括活动发起人）；
 * 2. **联系方式如何交换** —— 不允许写进活动说明（防爬取），
 *    申请被接受后通过站内信交换；
 * 3. **匹配资料可随时撤回** —— `DELETE /buddy/profile` 硬删该行（含 embedding），
 *    立即从推荐池移除。
 *
 * 三句话缺一不可 —— 少任何一句都会让用户对「我的资料去哪了」产生错误预期。
 *
 * 色值全部来自设计令牌（`$kdy-*`），禁止手写色值（契约 §6.2）。
 */
export interface KdyBuddyPrivacyNoticeProps {
  /** 紧凑版（列表 / 卡片里用） */
  compact?: boolean
  title?: string
  /** 展示匹配开关的说明（资料页用） */
  showMatchEnabled?: boolean
  /** 展示联系方式交换说明（详情 / 发布页用） */
  showContact?: boolean
}

export function KdyBuddyPrivacyNotice({
  compact = false,
  title = '关于你的匹配资料',
  showMatchEnabled = false,
  showContact = false,
}: KdyBuddyPrivacyNoticeProps) {
  return (
    <View className='kdy-buddy-privacy'>
      <View className='kdy-buddy-privacy__head'>
        <Text className='kdy-buddy-privacy__glyph'>🔒</Text>
        <Text className='kdy-buddy-privacy__title'>{title}</Text>
      </View>

      <Text className='kdy-buddy-privacy__body'>
        {compact ? BUDDY_PRIVACY_NOTICE_SHORT : BUDDY_PRIVACY_NOTICE}
      </Text>

      {!compact && (
        <View className='kdy-buddy-privacy__points'>
          {BUDDY_PRIVACY_POINTS.map((point) => (
            <Text key={point} className='kdy-buddy-privacy__point'>
              · {point}
            </Text>
          ))}
        </View>
      )}

      {showMatchEnabled && (
        <Text className='kdy-buddy-privacy__note'>{BUDDY_MATCH_ENABLED_NOTICE}</Text>
      )}

      {showContact && <Text className='kdy-buddy-privacy__note'>{BUDDY_CONTACT_NOTICE}</Text>}
    </View>
  )
}

export default KdyBuddyPrivacyNotice
