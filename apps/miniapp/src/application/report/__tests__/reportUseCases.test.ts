import { err, ok } from '@kedaya/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { REPORT_REASON_OPTIONS, reportReasonLabel } from '../../../domain/models/report'
import type { ReportReceipt } from '../../../domain/models/report'
import type { ReportRepository } from '../../../domain/ports/reportRepository'
import { createReportUseCases } from '../reportUseCases'

/**
 * 举报用例的规格。
 *
 * 这里守的是**用户在举报被骚扰时最容易被伤到的三件事**：
 *   1. 进详情页时不该为「是否已举报」重复发请求（缓存），
 *      但缓存**不能**在失败时被污染（否则那一条就永远显示成"没举报过"）；
 *   2. 重复提交返回的 409 必须被翻译成\"你已经举报过了\"，
 *      而不是弹一个红色错误让用户怀疑自己第一次到底提交成功没有；
 *   3. 换设备后（本地缓存为空）也要能从服务端补齐，而不是陷入
 *      \"点了说已经举报过、页面又显示没举报\"的循环。
 */

function receipt(overrides: Partial<ReportReceipt> = {}): ReportReceipt {
  return {
    id: 'r1',
    targetType: 'flea-item',
    targetId: 'item-1',
    targetTitle: '出一台 iPad',
    reason: 'fraud',
    detail: null,
    escalated: false,
    createdAt: '2026-10-17T00:00:00.000Z',
    ...overrides,
  }
}

function makeRepo(overrides: Partial<ReportRepository> = {}): ReportRepository {
  return {
    submit: vi.fn().mockResolvedValue(ok(receipt())),
    listMine: vi.fn().mockResolvedValue(ok([])),
    ...overrides,
  }
}

describe('举报原因（展示口径）', () => {
  it('「诈骗 / 虚假交易」排在第一（用户会顺手点第一个，校园二手最需要先处理的就是它）', () => {
    expect(REPORT_REASON_OPTIONS[0]?.value).toBe('fraud')
  })

  it('「其它」排最后，且每个原因都有中文标签', () => {
    expect(REPORT_REASON_OPTIONS.at(-1)?.value).toBe('other')
    for (const option of REPORT_REASON_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0)
      expect(reportReasonLabel(option.value)).toBe(option.label)
    }
  })

  it('原因不重复（重复会导致选择状态指向两个 chip）', () => {
    const values = REPORT_REASON_OPTIONS.map((option) => option.value)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('hasReported（缓存策略）', () => {
  let repo: ReportRepository

  beforeEach(() => {
    repo = makeRepo()
  })

  it('首次会拉取；同一条再问不再发请求（列表里连看十条不该发十次）', async () => {
    const report = createReportUseCases({ repository: repo })

    expect(await report.hasReported('flea-item', 'item-1')).toBe(false)
    expect(await report.hasReported('flea-item', 'item-1')).toBe(false)

    expect(repo.listMine).toHaveBeenCalledTimes(1)
  })

  it('拉到的记录能命中：已举报过的对象返回 true', async () => {
    repo = makeRepo({ listMine: vi.fn().mockResolvedValue(ok([receipt()])) })
    const report = createReportUseCases({ repository: repo })

    expect(await report.hasReported('flea-item', 'item-1')).toBe(true)
    expect(await report.hasReported('flea-item', 'item-2')).toBe(false)
  })

  it('类型相同但 id 不同不算命中（targetType 参与匹配）', async () => {
    repo = makeRepo({
      listMine: vi.fn().mockResolvedValue(ok([receipt({ targetType: 'forum-post', targetId: 'x' })])),
    })
    const report = createReportUseCases({ repository: repo })

    expect(await report.hasReported('flea-item', 'x')).toBe(false)
  })

  it('拉取失败 → 返回 false 但**不缓存**（下次还要再试，否则那一条就永远显示成没举报过）', async () => {
    const listMine = vi
      .fn()
      .mockResolvedValueOnce(err({ code: 'NETWORK', message: '网络不可用' }))
      .mockResolvedValueOnce(ok([receipt()]))
    repo = makeRepo({ listMine })

    const report = createReportUseCases({ repository: repo })
    expect(await report.hasReported('flea-item', 'item-1')).toBe(false)
    expect(await report.hasReported('flea-item', 'item-1')).toBe(true)
    expect(listMine).toHaveBeenCalledTimes(2)
  })
})

describe('submit', () => {
  it('成功提交后本地立即记住（同一会话再进详情页就是「已举报」，不用再等网络）', async () => {
    const repo = makeRepo()
    const report = createReportUseCases({ repository: repo })

    const result = await report.submit({
      targetType: 'flea-item',
      targetId: 'item-1',
      reason: 'fraud',
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.alreadyReported).toBe(false)

    // 关键：没有重新拉取 listMine，靠本地追加就知道已经举报过
    expect(await report.hasReported('flea-item', 'item-1')).toBe(true)
    expect(repo.listMine).not.toHaveBeenCalled()
  })

  it('409 → 翻译成「你之前已经举报过」的成功语义（不弹红色错误让用户自我怀疑）', async () => {
    const repo = makeRepo({
      submit: vi
        .fn()
        .mockResolvedValue(err({ code: 'CONFLICT', message: '你已经举报过这条内容，我们正在处理' })),
      listMine: vi.fn().mockResolvedValue(ok([receipt()])),
    })
    const report = createReportUseCases({ repository: repo })

    const result = await report.submit({
      targetType: 'flea-item',
      targetId: 'item-1',
      reason: 'fraud',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.alreadyReported).toBe(true)
      expect(result.value.receipt.id).toBe('r1')
    }
  })

  it('换设备：409 但服务端也查不到记录时，仍然如实返回错误（不假装成功）', async () => {
    const repo = makeRepo({
      submit: vi.fn().mockResolvedValue(err({ code: 'CONFLICT', message: '冲突' })),
      listMine: vi.fn().mockResolvedValue(ok([])),
    })
    const report = createReportUseCases({ repository: repo })

    const result = await report.submit({
      targetType: 'flea-item',
      targetId: 'item-1',
      reason: 'fraud',
    })
    expect(result.ok).toBe(false)
  })

  it('非 409 的错误原样透传（例如未登录 401 → 页面去引导登录）', async () => {
    const repo = makeRepo({
      submit: vi.fn().mockResolvedValue(err({ code: 'UNAUTHENTICATED', message: '请先登录' })),
    })
    const report = createReportUseCases({ repository: repo })

    const result = await report.submit({
      targetType: 'flea-item',
      targetId: 'item-1',
      reason: 'fraud',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
  })
})
