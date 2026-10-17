import { Text, View } from '@tarojs/components'
import { ArrowRight } from '@taroify/icons'

import { PAGE_PATHS } from '../../../app/routes'
import { navigateTo } from '../../../platform/navigation'
import { KdyAgentFab, KdyButton, KdyCard, KdyTag } from '../../components'
import { KdyHeading } from '../../components/KdyHeading'
import { KdyModuleIcon } from '../../components/KdyModuleIcon'
import './index.scss'

/**
 * 凑凑 —— 「拼单 + 找搭子」的共同入口。
 *
 * ## 为什么要有这一页
 *
 * 产品要求把一级入口命名为「凑凑」，下设「拼单」和「找搭子」。这两件事对用户
 * 是同一类需求 —— **一个人凑不齐，需要别人**：凑够份数下单、凑够人一起玩。
 * 宫格里并排放两个格子，用户每次都要先判断"我这次是想买还是想玩"；
 * 合成一个入口、进去再选，更贴近真实心理。
 *
 * ## 它为什么不是契约模块
 *
 * 契约里的 `groupbuy` / `buddy` 仍是两个独立模块（各自的 API、数据与页面
 * 都没有变），这里只是一个**导航聚合页**：没有自己的仓储、没有自己的数据。
 * 所以「每个契约模块都有真实端点与页面」这条交付口径不受影响 ——
 * 找搭子的发布与报名在本仓库是已经做好的，不是占位。
 *
 * ## 文案纪律
 *
 * 「不代收付款」「会员代购只能自述」两条都写在页面上，而且**不写**成脚注：
 * 拼单最容易让用户误以为"平台会担保交易"，说清楚比事后解释便宜得多。
 */

export default function CouPage() {
  return (
    <View className='kdy-page kdy-cou'>
      <KdyHeading
        title='凑凑'
        subtitle='一个人凑不齐的，凑一凑就够了。'
        eyebrow='KEDAYA · 凑凑'
      />

      <KdyCard
        title='拼单'
        onClick={() => void navigateTo(PAGE_PATHS.groupBuyList)}
      >
        <View className='kdy-cou__lead'>
          <KdyModuleIcon id='cou' />
          <Text className='kdy-cou__lead-text'>凑够份数，一起买更划算</Text>
        </View>
        <Text className='kdy-cou__body'>
          发起一个拼单、写清目标份数与取货地点，同学参团凑够就成团。
          平台只负责登记与汇总，不代收付款、不碰钱 —— 取货时当面结清。
        </Text>
        <View className='kdy-cou__link'>
          去看拼单 <ArrowRight />
        </View>
      </KdyCard>

      <KdyCard
        title='找搭子'
        onClick={() => void navigateTo(PAGE_PATHS.buddyList)}
      >
        <View className='kdy-cou__lead'>
          <KdyModuleIcon id='buddy' />
          <Text className='kdy-cou__lead-text'>一起吃饭、健身、看展、复习</Text>
        </View>
        <Text className='kdy-cou__body'>
          发一条搭子帖，写清想做什么、什么时候、希望对方是什么样的人。
          联系方式默认不公开，双方都同意之后才交换。
        </Text>
        <View className='kdy-cou__link'>
          去找搭子 <ArrowRight />
        </View>
      </KdyCard>

      <KdyCard title='我参与过的' elevated={false}>
        <Text className='kdy-cou__body'>
          参与记录在各模块自己的页面里看，这里不另做一份副本。
        </Text>
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
      </KdyCard>

      <KdyCard title='两条规矩' elevated={false}>
        <View className='kdy-cou__rule'>
          <KdyTag tone='warning'>不代收付款</KdyTag>
          <Text className='kdy-cou__rule-text'>
            拼单首版不做在线支付、退款与佣金；金额与结算都在线下完成。
          </Text>
        </View>
        <View className='kdy-cou__rule'>
          <KdyTag tone='warning'>会员代购只能自述</KdyTag>
          <Text className='kdy-cou__rule-text'>
            商家会员资格在核验能力上线前，只显示「发起人自述持有会员」，
            不显示平台认证标识。
          </Text>
        </View>
      </KdyCard>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>

      <KdyAgentFab module='groupbuy' page={PAGE_PATHS.cou} hint='凑不齐？问我' />
    </View>
  )
}
