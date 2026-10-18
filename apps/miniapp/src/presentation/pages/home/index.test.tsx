import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tarojs/components', () => ({ Text: 'span', View: 'div', Image: 'img' }))
vi.mock('../../../app/container', () => ({
  getContainer: () => ({ useCases: { session: {} } }),
}))
vi.mock('../../../platform/navigation', () => ({ navigateTo: vi.fn(), toast: vi.fn() }))
vi.mock('../../hooks', () => ({ useStore: () => ({ profile: null }) }))
vi.mock('../../theme/useThemeMode', () => ({ useThemeMode: () => ({ mode: 'dark', toggleTheme: vi.fn() }) }))
vi.mock('../../components', () => ({
  KdyTag: ({ children }: { children: unknown }) => children,
  KdyDock: () => null,
  KdyFeatureArtwork: () => null,
}))
vi.mock('../../components/ReactBits', () => ({
  AnimatedContent: ({ children }: { children: React.ReactNode }) => children,
  SpotlightCard: ({ children, className }: { children: React.ReactNode; className: string }) => <div className={className}>{children}</div>,
}))
vi.mock('./index.scss', () => ({}))

import HomePage from './index'

describe('首页模块渲染', () => {
  it('首次打开能显示全部一级入口，凑凑取代独立找搭子入口', () => {
    const html = renderToStaticMarkup(<HomePage />)

    // 契约 §4：一级入口数量由模块注册表决定（18 个）
    expect(html).toContain('18 个')

    // 凑凑是产品入口，找搭子作为子功能不单独占首页格子
    expect(html).toContain('凑凑')
    expect(html).not.toContain('kdy-home__grid-name">找搭子<')

    // 首屏展示两个已实现模块及四个常用入口，其余通过「更多模块」展开。
    expect((html.match(/class="kdy-home__hero-card /g) ?? []).length).toBe(2)
    expect((html.match(/class="kdy-home__grid-item"/g) ?? []).length).toBe(4)
    expect(html).toContain('更多模块，继续探索')
  })
})
