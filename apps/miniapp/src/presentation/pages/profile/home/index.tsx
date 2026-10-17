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
 * 首页管理 —— 决定首页显示哪些服务（对标支付宝的「我的应用」）。
 *
 * 为什么放在「我的」而不是首页上直接拖：首页宫格是每天都会误触的地方，
 * 把排序入口放进去，用户滑一下就可能挪走一个服务。管理动作集中在设置里，
 * 首页只留一个「编辑」入口，一次点击进入、一个明确的返回。
 *
 * 用「上移 / 下移」而不是长按拖拽：小程序里跨行拖拽在真机上容易飘，
 * 而且读屏用户用不了。按钮单调，但每一步的结果都看得见。
 */
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
      <KdyHeading title='首页管理' />

      <KdyCard title='我的常用' extra={`${selected.length} / ${MAX_HOME_ENTRY_IDS}`}>
        {selected.length === 0 && <KdyEmpty mode='empty' title='首页是空的' />}
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
                  <ArrowUp />
                </View>
                <View className='kdy-manage__action' onClick={() => apply(layout.move(entry.id, 1))}>
                  <ArrowDown />
                </View>
                <View
                  className='kdy-manage__action kdy-manage__action--remove'
                  onClick={() => apply(layout.toggle(entry.id))}
                >
                  <Close />
                </View>
              </View>
            )}
          </View>
        ))}

        <Text className='kdy-manage__note'>
          凑凑与心理支持固定在首页：可以换位置，不能移除。
        </Text>
      </KdyCard>

      <KdyCard title='可添加的服务' extra={`${addable.length}`} elevated={false}>
        {!canAdd && (
          <Text className='kdy-manage__note'>
            已经放满 {MAX_HOME_ENTRY_IDS} 个，先移除一个再加。没放到首页的服务在服务大厅里照样能用。
          </Text>
        )}
        {addable.length === 0 && <KdyEmpty mode='empty' title='全部都放上去了' />}
        {addable.map((entry: HomeEntry) => (
          <View key={entry.id} className='kdy-manage__row'>
            <KdyModuleIcon id={entry.icon} />
            <View className='kdy-manage__row-copy'>
              <Text className='kdy-manage__row-name'>{entry.label}</Text>
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

      <View className='kdy-manage__reset'>
        <KdyButton
          block
          variant='secondary'
          disabled={!layout.isCustomized()}
          onClick={() => apply(layout.reset())}
        >
          恢复默认首页
        </KdyButton>
      </View>

      <Text className='kdy-disclaimer'>
        可达鸭是第三方非官方校园服务平台，与上海科技大学官方系统无关。
      </Text>
    </View>
  )
}
