import { Text, View } from '@tarojs/components'
import { ArrowRight } from '@taroify/icons'

import { PAGE_PATHS } from '../../../app/routes'
import { navigateTo } from '../../../platform/navigation'
import { KdyAgentFab, KdyButton } from '../../components'
import { KdyHeading } from '../../components/KdyHeading'
import { KdyModuleIcon } from '../../components/KdyModuleIcon'
import './index.scss'

/**
 * 凑凑 —— 「拼单 + 找搭子」的共同入口。
 *
 * 产品要求一级入口叫「凑凑」，下设这两件事。它们对用户是同一类需求：
 * **一个人凑不齐，需要别人**。宫格里并排放两个格子，用户每次都要先想
 * "我这次是想买还是想玩"；合成一个入口、进去再选，更贴近真实心理。
 *
 * 它**不是契约模块**：契约里 `groupbuy` / `buddy` 仍是两个独立模块
 * （各自的 API、数据与页面都没有变），这里只是导航聚合，没有自己的数据。
 */
export default function CouPage() {
  return (
    <View className='kdy-page kdy-cou'>
      <KdyHeading title='凑凑' />

      <View className='kdy-cou__row' onClick={() => void navigateTo(PAGE_PATHS.groupBuyList)}>
        <KdyModuleIcon id='cou' />
        <View className='kdy-cou__row-body'>
          <Text className='kdy-cou__row-title'>拼单</Text>
          <Text className='kdy-cou__row-sub'>凑够份数，一起买更划算</Text>
        </View>
        <ArrowRight />
      </View>

      <View className='kdy-cou__row' onClick={() => void navigateTo(PAGE_PATHS.buddyList)}>
        <KdyModuleIcon id='buddy' />
        <View className='kdy-cou__row-body'>
          <Text className='kdy-cou__row-title'>找搭子</Text>
          <Text className='kdy-cou__row-sub'>一起吃饭、健身、看展、复习</Text>
        </View>
        <ArrowRight />
      </View>

      <View className='kdy-cou__actions'>
        <KdyButton
          size='sm'
          variant='secondary'
          onClick={() => void navigateTo(PAGE_PATHS.profileAssets)}
        >
          我的拼单
        </KdyButton>
        <KdyButton
          size='sm'
          variant='secondary'
          onClick={() => void navigateTo(PAGE_PATHS.buddyProfile)}
        >
          我的搭子资料
        </KdyButton>
      </View>

      <Text className='kdy-cou__note'>
        平台只登记与汇总，不代收付款；金额在取货时线下结清。
        会员代购资格只能由发起人自述，平台不做核验。
      </Text>

      <Text className='kdy-disclaimer'>
        第三方非官方平台 · 与上海科技大学官方系统无关。
      </Text>

      <KdyAgentFab module='groupbuy' page={PAGE_PATHS.cou} />
    </View>
  )
}
