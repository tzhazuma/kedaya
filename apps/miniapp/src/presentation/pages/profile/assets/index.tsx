import { Text, View } from '@tarojs/components'
import { useDidShow, useReachBottom } from '@tarojs/taro'
import { fenToYuan } from '@kedaya/shared'

import { getContainer } from '../../../../app/container'
import { PAGE_PATHS, groupBuyDetailPath } from '../../../../app/routes'
import type { GroupBuyRole } from '../../../../domain/ports/groupbuyRepository'
import type { GroupBuySummary } from '../../../../domain/models/groupbuy'
import { navigateTo } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyChip, KdyEmpty, KdyProgress, KdyTag } from '../../../components'
import type { KdyTagTone } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 我的资产 —— 把"我参与过什么"集中到一个页面。
 *
 * 本轮只内联**拼单**（发起 / 参与）：它是唯一有"我发起的 vs 我参与的"
 * 双角色语义、且首页主打的模块。其余模块（闲置、跑腿、搭子、失物、论坛）
 * 各自的列表页已有「我的」筛选，这里只给入口 —— 不做半成品的假聚合
 * （把五个模块的记录硬塞进一页，只会让每一条都看不全）。
 *
 * 未登录时不发注定 401 的请求，直接引导登录。
 */

function statusTone(status: GroupBuySummary['status']): KdyTagTone {
  if (status === 'open') return 'brand'
  if (status === 'full') return 'success'
  if (status === 'closed') return 'neutral'
  return 'danger'
}

/**
 * 截止时间的样式：临期高亮、已过期划线。
 *
 * 「我的资产」里最该被催的是**还没成团、快到期**的那几单，所以截止时间不再是
 * 一行灰字。判定来自领域层的 `deadlineUrgent` / `deadlinePassed` ——
 * 页面不自己比时间，否则「临期窗口」会在这一页悄悄变成另一个值。
 */
function deadlineClass(item: GroupBuySummary): string {
  if (item.deadlinePassed) return 'kdy-assets__card-deadline is-passed'
  if (item.deadlineUrgent) return 'kdy-assets__card-deadline is-urgent'
  return 'kdy-assets__card-deadline'
}

const OTHER_MODULES: readonly { label: string; detail: string; path: string }[] = [
  { label: '我的闲置', detail: '我发布的商品与预定状态', path: PAGE_PATHS.fleaList },
  { label: '我的跑腿', detail: '我发布的悬赏、我接的单', path: PAGE_PATHS.errandList },
  { label: '我的搭子', detail: '我发起的组队', path: PAGE_PATHS.buddyList },
  { label: '我的失物', detail: '我发布的失物与招领', path: PAGE_PATHS.lostFoundList },
  { label: '我的帖子', detail: '我发起的主题与讨论', path: PAGE_PATHS.forumList },
]

export default function ProfileAssetsPage() {
  const container = getContainer()
  const myGroupBuys = container.useCases.myGroupBuys
  const state = useStore(myGroupBuys)
  const session = useStore(container.useCases.session)

  const filters = state.query as { role?: GroupBuyRole }
  const role: GroupBuyRole = filters.role === 'member' ? 'member' : 'owner'

  useDidShow(() => {
    if (session.tokens === null) return
    myGroupBuys.hydrate()
    void myGroupBuys.load({ role })
  })

  useReachBottom(() => {
    void myGroupBuys.loadMore()
  })

  const loggedIn = session.tokens !== null

  return (
    <View className='kdy-page kdy-assets'>
      <KdyHeading
        title='我的资产'
        subtitle='我发起和参与的拼单，一处看全。'
        eyebrow='KEDAYA · 我的'
      />

      {!loggedIn ? (
        <KdyCard elevated={false}>
          <Text className='kdy-assets__hint'>登录后才能看到你发起和参与的拼单。</Text>
          <View className='kdy-assets__actions'>
            <KdyButton block onClick={() => void navigateTo(PAGE_PATHS.authLogin)}>
              去登录
            </KdyButton>
          </View>
        </KdyCard>
      ) : (
        <>
          <View className='kdy-assets__scopes'>
            <KdyChip
              active={role === 'owner'}
              onClick={() => {
                myGroupBuys.reset()
                void myGroupBuys.load({ role: 'owner', cursor: null })
              }}
            >
              我发起的
            </KdyChip>
            <KdyChip
              active={role === 'member'}
              onClick={() => {
                myGroupBuys.reset()
                void myGroupBuys.load({ role: 'member', cursor: null })
              }}
            >
              我参与的
            </KdyChip>
          </View>

          {state.status === 'loading' && state.items.length === 0 && (
            <KdyCard elevated={false}>
              <KdyEmpty mode='loading' title='正在加载…' />
            </KdyCard>
          )}

          {state.status === 'error' && (
            <KdyCard elevated={false}>
              <KdyEmpty
                mode='error'
                description={state.error ?? '请检查网络后重试'}
                actionText='重试'
                onAction={() => void myGroupBuys.load({ role, cursor: null })}
              />
            </KdyCard>
          )}

          {state.status === 'empty' && (
            <KdyCard elevated={false}>
              <KdyEmpty
                mode='empty'
                title={role === 'owner' ? '还没有发起过拼单' : '还没有参与过拼单'}
                description={
                  role === 'owner'
                    ? '去拼单广场发布一个，凑齐更快。'
                    : '在拼单广场挑一个感兴趣的参团吧。'
                }
                actionText='去拼单广场'
                onAction={() => void navigateTo(PAGE_PATHS.groupBuyList)}
              />
            </KdyCard>
          )}

          {state.items.map((item) => (
            <KdyCard
              key={item.id}
              elevated={false}
              onClick={() => {
                void navigateTo(groupBuyDetailPath(item.id))
              }}
            >
              <View className='kdy-assets__card'>
                <View className='kdy-assets__card-head'>
                  <Text className='kdy-assets__card-title'>{item.title}</Text>
                  <KdyTag tone={statusTone(item.status)}>{item.statusLabel}</KdyTag>
                </View>

                <View className='kdy-assets__card-row'>
                  <Text className='kdy-assets__card-progress'>
                    已拼 {item.joinedQuantity} / {item.targetCount} 份
                  </Text>
                  <Text
                    className={
                      item.remainingSlots === 0
                        ? 'kdy-assets__card-short is-full'
                        : 'kdy-assets__card-short'
                    }
                  >
                    {item.remainingSlots === 0 ? '已拼满' : `还差 ${item.remainingSlots} 份`}
                  </Text>
                </View>

                <KdyProgress
                  className='kdy-assets__card-bar'
                  percent={item.progressPercent}
                  tone={item.remainingSlots === 0 ? 'success' : 'brand'}
                />

                <View className='kdy-assets__card-foot'>
                  <Text className={deadlineClass(item)}>{item.deadlineLabel}</Text>
                  <Text className='kdy-assets__card-meta'>
                    ¥{fenToYuan(item.priceFen)}/份 ·{' '}
                    {role === 'owner' ? '我发起的' : `发起人 ${item.initiatorName}`}
                  </Text>
                </View>

                {item.pickupPlace !== '' && (
                  <Text className='kdy-assets__card-place'>取货：{item.pickupPlace}</Text>
                )}
              </View>
            </KdyCard>
          ))}

          {state.nextCursor !== null && (
            <View className='kdy-assets__more'>
              <KdyButton
                size='sm'
                variant='secondary'
                loading={state.loadingMore}
                onClick={() => void myGroupBuys.loadMore()}
              >
                加载更多
              </KdyButton>
            </View>
          )}
        </>
      )}

      <KdyCard title='其他模块' elevated={false}>
        {OTHER_MODULES.map((item) => (
          <View
            key={item.path}
            className='kdy-assets__nav'
            onClick={() => {
              void navigateTo(item.path)
            }}
          >
            <View className='kdy-assets__nav-body'>
              <Text className='kdy-assets__nav-title'>{item.label}</Text>
              <Text className='kdy-assets__nav-detail'>{item.detail}</Text>
            </View>
            <Text className='kdy-assets__nav-arrow'>›</Text>
          </View>
        ))}
        <Text className='kdy-assets__hint'>
          这些模块的列表页都有「我的」筛选，进去即可看到自己的记录。
        </Text>
      </KdyCard>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
