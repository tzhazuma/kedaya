import { View } from '@tarojs/components'
import Skeleton from '@taroify/core/skeleton'
import '@taroify/core/skeleton/style'

import './index.scss'

/**
 * KdyListSkeleton —— 列表首屏的骨架屏。
 *
 * ## 为什么值得单独做一个组件
 *
 * 列表页原来的首屏是「转圈 + 正在加载…」。两者都在表达同一件事（还没好），
 * 但用户的感受完全不同：转圈让人**等**，骨架让人觉得**已经在出来的路上** ——
 * 差别不在于快了多少毫秒，而在于「屏幕上有没有东西」。
 *
 * 形状也对齐真实卡片（左侧 64px 方图 + 标题 + 两行副信息），
 * 所以数据到位时不是\"换了一屏\"，而是骨架**长成了**内容，
 * 不会出现高度跳变导致的手指打滑。
 *
 * ## 只在首屏用（刻意）
 *
 * `KdyEmpty mode='loading'` 仍然有用武之地：**刷新已有内容**时不该把
 * 看得见的列表换成骨架（那等于把用户正在读的东西抹掉）。
 * 列表用例已经把这两种情况分开了（`status: 'loading'` 只在没有条目时出现），
 * 所以这里的用法是 `state.status === 'loading' && <KdyListSkeleton />`。
 */
export interface KdyListSkeletonProps {
  /** 骨架条数（默认 3 条，约等于一屏能看到的卡片数） */
  rows?: number
  className?: string
}

export function KdyListSkeleton({ rows = 3, className }: KdyListSkeletonProps) {
  return (
    <View className={['kdy-list-skeleton', className ?? ''].filter((item) => item !== '').join(' ')}>
      {Array.from({ length: rows }, (_, index) => (
        <View className='kdy-list-skeleton__card' key={String(index)}>
          <Skeleton
            loading
            animate
            avatar
            avatarShape='square'
            avatarSize={64}
            title
            titleWidth='66%'
            row={2}
            rowWidth={['92%', '48%']}
          />
        </View>
      ))}
    </View>
  )
}
