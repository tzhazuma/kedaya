import { Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { ArrowDown, ArrowUp, Close } from '@taroify/icons'

import { getContainer } from '../../../../app/container'
import { MAX_HOME_ENTRY_IDS } from '../../../../domain/models/homeEntries'
import type { HomeEntry } from '../../../../domain/models/homeEntries'
import { toast } from '../../../../platform/navigation'
import { KdyButton, KdyCard, KdyEmpty, KdyTag } from '../../../components'
import { KdyHeading } from '../../../components/KdyHeading'
import { KdyModuleIcon } from '../../../components/KdyModuleIcon'
import { useStore } from '../../../hooks'
import './index.scss'

/**
 * 首页管理 —— 决定「首页展示哪些内容」（对标支付宝的「我的应用 / 首页管理」）。
 *
 * ## 为什么放在「我的」而不是首页上直接拖
 *
 * 首页宫格是每天都会误触的地方：把排序入口放进去，用户滑一下就可能
 * 把某个服务挪走。管理动作集中在设置里，首页只保留一个「编辑」入口 ——
 * 一次点击进入、一个明确的返回，比"长按拖拽"更难出错也更好讲。
 *
 * ## 交互为什么不长按拖拽
 *
 * 小程序里跨行拖拽要么引入第三方库、要么手写触摸坐标，两种都会带来
 * "在真机上飘"的问题。这里用**上移 / 下移**两个按钮：单调但确定，
 * 每一步的结果都能看见，也让残障用户（读屏）能用。
 *
 * ## 什么不能被移除
 *
 * `wellbeing`（心理支持）是固定入口：安全出口不能被一次自定义误触藏掉。
 * 页面**明说**这条规则（而不是让按钮静默失灵）—— 静默失灵的按钮最招人烦。
 */

function ActionIcon({ kind }: { kind: 'up' | 'down' | 'remove' }) {
  if (kind === 'up') return <ArrowUp />
  if (kind === 'down') return <ArrowDown />
  return <Close />
}

export default function ProfileHomePage() {
  const container = getContainer()
  const layout = container.useCases.homeLayout
  useStore(layout)

  useDidShow(() => {
    layout.hydrate()
  })

  const selected = layout.selectedEntries()
  const addable = layout.addableEntries()
  const canAdd = layout.canAdd()

  function apply(result: { ok: boolean; message: string }): void {
    toast(result.message)
  }

  return (
    <View className='kdy-page kdy-manage'>
      <KdyHeading
        title='首页管理'
        subtitle='挑出你每天都会用的服务；首页最多放 12 个。'
        eyebrow='KEDAYA · 我的 → 首页管理'
      />

      <KdyCard title='已在我的首页' extra={`${selected.length} / ${MAX_HOME_ENTRY_IDS}`}>
        {selected.length === 0 && (
          <KdyEmpty
            mode='empty'
            title='首页是空的'
            description='从下面「可添加的服务」里挑几个，首页就有内容了。'
          />
        )}
        {selected.map((entry: HomeEntry, index: number) => (
          <View key={entry.id} className='kdy-manage__row'>
            <KdyModuleIcon id={entry.icon} />
            <View className='kdy-manage__row-copy'>
              <Text className='kdy-manage__row-name'>{entry.label}</Text>
              <Text className='kdy-manage__row-order'>第 {index + 1} 个</Text>
            </View>

            {entry.locked ? (
              <KdyTag tone='brand'>固定</KdyTag>
            ) : (
              <View className='kdy-manage__actions'>
                <View className='kdy-manage__action' onClick={() => apply(layout.move(entry.id, -1))}>
                  <ActionIcon kind='up' />
                </View>
                <View className='kdy-manage__action' onClick={() => apply(layout.move(entry.id, 1))}>
                  <ActionIcon kind='down' />
                </View>
                <View
                  className='kdy-manage__action kdy-manage__action--remove'
                  onClick={() => apply(layout.toggle(entry.id))}
                >
                  <ActionIcon kind='remove' />
                </View>
              </View>
            )}
          </View>
        ))}

        <Text className='kdy-manage__note'>
          心理支持是固定入口：可以排在别的位置，但不能从首页移除 ——
          安全出口不该被一次误触藏掉。首页底部还有一条常驻热线横幅。
        </Text>
      </KdyCard>

      <KdyCard title='可添加的服务' extra={`${addable.length} 个`} elevated={false}>
        {!canAdd && (
          <Text className='kdy-manage__note'>
            已经放满 {MAX_HOME_ENTRY_IDS} 个了。先在上面移除一个，或者去
            「服务大厅」直接用 —— 没放到首页不代表不能用。
          </Text>
        )}
        {addable.length === 0 && <KdyEmpty mode='empty' title='全部都放上去了' />}
        {addable.map((entry: HomeEntry) => (
          <View key={entry.id} className='kdy-manage__row'>
            <KdyModuleIcon id={entry.icon} />
            <View className='kdy-manage__row-copy'>
              <Text className='kdy-manage__row-name'>{entry.label}</Text>
              <Text className='kdy-manage__row-hint'>{entry.hint}</Text>
            </View>
            <KdyButton
              size='sm'
              variant='secondary'
              disabled={!canAdd}
              onClick={() => apply(layout.toggle(entry.id))}
            >
              添加
            </KdyButton>
          </View>
        ))}
      </KdyCard>

      <KdyCard title='改坏了怎么办' elevated={false}>
        <Text className='kdy-manage__note'>
          随时可以恢复成默认的 9 个服务；这份偏好只存在本机、并且跟随账号 ——
          换个账号登录看到的是那个账号自己的首页。
        </Text>
        <View className='kdy-manage__reset'>
          <KdyButton
            variant='secondary'
            disabled={!layout.isCustomized()}
            onClick={() => apply(layout.reset())}
          >
            恢复默认首页
          </KdyButton>
        </View>
      </KdyCard>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
