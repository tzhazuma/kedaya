import Collapse from '@taroify/core/collapse'
import '@taroify/core/collapse/style'
import type { ReactNode } from 'react'

export function KdyDemoTools({ children }: { children: ReactNode }) {
  return (
    // Taroify 的 Collapse 在非手风琴模式下把 value 当数组用（内部 `value.includes`），
    // 必须显式给 `defaultValue={[]}`，否则受控值会一直是 undefined 并在渲染时抛错。
    <Collapse className='kdy-demo-tools' defaultValue={[]} bordered={false}>
      <Collapse.Item
        title='演示与调试工具'
        brief='仅用于体验功能与状态'
        value='demo'
        bordered={false}
      >
        {children}
      </Collapse.Item>
    </Collapse>
  )
}
