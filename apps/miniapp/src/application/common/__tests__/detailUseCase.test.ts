import { describe, expect, it } from 'vitest'
import { err, ok, type Result } from '@kedaya/shared'

import { createDetailUseCase } from '../detailUseCase'
import type { RepositoryError } from '../../../domain/ports/errors'

/**
 * 通用详情用例规格。
 *
 * 详情页的三条不变量（六个模块共用，所以必须比业务代码更严）：
 *   1. 首次失败 → `error` 态且可重试；
 *   2. **刷新**失败不能把已经看到的内容清空（只挂错误文案）；
 *   3. 领域动作成功后用**服务端返回的实体**替换详情，失败则原样保留。
 */

interface Item {
  id: string
  status: string
}

const notFound: Result<Item, RepositoryError> = err({
  code: 'NOT_FOUND',
  message: '商品不存在或已被删除',
})

const conflict: Result<Item, RepositoryError> = err({
  code: 'CONFLICT',
  message: '该商品已被预定',
})

const item = (status = 'on-sale'): Item => ({ id: 'i1', status })

describe('load', () => {
  it('首次加载成功 → ready，并带上数据', async () => {
    const detail = createDetailUseCase<Item>(async () => ok(item()))

    const state = await detail.load('i1')

    expect(state.status).toBe('ready')
    expect(state.data?.id).toBe('i1')
    expect(state.error).toBeNull()
  })

  it('首次加载失败 → error（页面才有机会显示重试）', async () => {
    const detail = createDetailUseCase<Item>(async () => notFound)

    const state = await detail.load('ghost')

    expect(state.status).toBe('error')
    expect(state.data).toBeNull()
    expect(state.error).toContain('不存在')
  })

  it('刷新失败时保留已有数据，只挂错误文案（不把用户正在看的内容弄丢）', async () => {
    let attempt = 0
    const detail = createDetailUseCase<Item>(async () => {
      attempt += 1
      return attempt === 1 ? ok(item('reserved')) : notFound
    })

    await detail.load('i1')
    const refreshed = await detail.load('i1')

    expect(refreshed.status).toBe('ready')
    expect(refreshed.data?.status).toBe('reserved')
    expect(refreshed.error).toContain('不存在')
  })

  it('seed 让列表页点进来时能秒开，随后 load 会覆盖成服务端最新值', async () => {
    const detail = createDetailUseCase<Item>(async () => ok(item('sold')))

    const seeded = detail.seed(item())
    expect(seeded.status).toBe('ready')
    expect(seeded.data?.status).toBe('on-sale')

    const loaded = await detail.load('i1')
    expect(loaded.data?.status).toBe('sold')
  })
})

describe('mutate（领域动作）', () => {
  it('成功 → 用服务端返回的实体替换详情，并清掉错误', async () => {
    const detail = createDetailUseCase<Item>(async () => ok(item()))
    await detail.load('i1')

    const result = await detail.mutate(async () => ok(item('reserved')))

    expect(result.ok).toBe(true)
    const state = detail.getSnapshot()
    expect(state.data?.status).toBe('reserved')
    expect(state.mutating).toBe(false)
    expect(state.error).toBeNull()
  })

  it('失败 → 保留原详情、把错误挂出来，并且 mutating 复位（按钮不能一直转）', async () => {
    const detail = createDetailUseCase<Item>(async () => ok(item()))
    await detail.load('i1')

    const result = await detail.mutate(async () => conflict)

    expect(result.ok).toBe(false)
    const state = detail.getSnapshot()
    expect(state.data?.status).toBe('on-sale')
    expect(state.error).toContain('已被预定')
    expect(state.mutating).toBe(false)
  })

  it('把 Result 原样返回给页面（页面据此决定跳转 / 弹提示）', async () => {
    const detail = createDetailUseCase<Item>(async () => ok(item()))

    const result = await detail.mutate(async () => conflict)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CONFLICT')
  })
})

describe('订阅', () => {
  it('每次状态变更都会通知订阅者，取消订阅后不再通知', async () => {
    const detail = createDetailUseCase<Item>(async () => ok(item()))
    let calls = 0
    const unsubscribe = detail.subscribe(() => {
      calls += 1
    })

    await detail.load('i1')
    expect(calls).toBeGreaterThan(0)

    const before = calls
    unsubscribe()
    await detail.load('i1')
    expect(calls).toBe(before)
  })

  it('reset 回到初始态（离开页面时清理，避免串数据）', async () => {
    const detail = createDetailUseCase<Item>(async () => ok(item()))
    await detail.load('i1')

    detail.reset()

    const state = detail.getSnapshot()
    expect(state.status).toBe('idle')
    expect(state.data).toBeNull()
  })
})
