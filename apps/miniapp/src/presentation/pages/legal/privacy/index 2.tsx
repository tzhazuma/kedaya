import { Text, View } from '@tarojs/components'

import { PAGE_PATHS } from '../../../../app/routes'
import { navigateTo } from '../../../../platform/navigation'
import { KdyButton } from '../../../components'
import { KdyLegalDoc } from '../../../components/KdyLegalDoc'
import { LEGAL_UPDATED_AT, PRIVACY_RULES, PRIVACY_SECTIONS } from '../../../content/legal'

/**
 * 隐私政策页。
 *
 * 除了政策正文，这里再展示一次**契约 §9 的六条硬规则**：
 * 它们是产品承诺，不是法律修辞 —— 用户不该只在"我的"页才能看到。
 */
export default function PrivacyPage() {
  return (
    <KdyLegalDoc
      title='隐私政策'
      subtitle='我们收集什么、用来做什么、你如何撤回同意，都写在这里。'
      updatedAt={LEGAL_UPDATED_AT}
      sections={PRIVACY_SECTIONS}
      footer={
        <View className='kdy-legal__footer'>
          <Text className='kdy-legal__section-title'>附：我们的六条硬规则</Text>
          {PRIVACY_RULES.map((rule) => (
            <View key={rule.title} className='kdy-legal__rule'>
              <Text className='kdy-legal__rule-title'>{rule.title}</Text>
              <Text className='kdy-legal__paragraph'>{rule.detail}</Text>
            </View>
          ))}
          <View className='kdy-legal__cta'>
            <KdyButton
              block
              size='sm'
              variant='secondary'
              onClick={() => {
                void navigateTo(PAGE_PATHS.profileSettings)
              }}
            >
              去隐私与数据设置
            </KdyButton>
          </View>
        </View>
      }
    />
  )
}
