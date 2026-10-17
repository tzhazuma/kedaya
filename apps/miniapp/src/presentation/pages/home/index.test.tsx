import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tarojs/components', () => ({ Text: 'span', View: 'div' }))
vi.mock('../../../app/container', () => ({
  getContainer: () => ({ useCases: { session: {} } }),
}))
vi.mock('../../../platform/navigation', () => ({ navigateTo: vi.fn(), toast: vi.fn() }))
vi.mock('../../hooks', () => ({ useStore: () => ({ profile: null }) }))
vi.mock('../../components', () => ({
  KdyCard: ({ children, extra }: { children: unknown; extra: unknown }) => [extra, children],
  KdyTag: ({ children }: { children: unknown }) => children,
}))
vi.mock('./index.scss', () => ({}))

import HomePage from './index'

describe('首页模块渲染', () => {
  it('首次打开能显示一级入口数量，凑凑取代独立找搭子入口', () => {
    const html = renderToStaticMarkup(<HomePage />)
    expect(html).toContain('18 个')
    expect(html).toContain('凑凑')
    expect(html).not.toContain('找搭子')
    expect((html.match(/class="kdy-home__grid-item"/g) ?? []).length).toBe(18)
  })
})
