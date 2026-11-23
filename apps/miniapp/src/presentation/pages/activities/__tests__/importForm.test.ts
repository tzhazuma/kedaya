import { describe, expect, it } from 'vitest'

import type { ActivityItem } from '../../../../domain/models/activity'
import {
  importFormReducer,
  initialImportFormState,
  type ImportFormState,
} from '../import/importForm'

/**
 * 导入页状态机（纯逻辑）。
 *
 * 这里最容易出的三个错：
 *   1. 请求抛错后 `submitting` 永远为 true（按钮卡死）；
 *   2. 成功后正文 / 链接还留在输入框里（用户以为没提交，重复导入）；
 *   3. 切到另一种模式后，上一种模式的错误还挂在页面上。
 */

function activity(id: string): ActivityItem {
  return {
    id,
    source: 'wechat-mp',
    kind: 'lecture',
    title: `活动 ${id}`,
    startsAt: null,
    endsAt: null,
    location: null,
    organizer: null,
    registrationDeadlineAt: null,
    registrationDeadlineRaw: null,
    registrationUrl: null,
    evidenceText: '证据',
    confidence: 0.5,
    status: 'candidate',
    sourceUrl: null,
    sourceLabel: '公众号',
    publishedAt: null,
    stale: false,
  }
}

function filled(): ImportFormState {
  return {
    ...initialImportFormState,
    mode: 'link',
    link: 'https://mp.weixin.qq.com/s/AbCd',
    text: '讲座正文',
  }
}

describe('导入表单状态', () => {
  it('成功后清空正文 / 链接，并保留全部导入结果', () => {
    const started = importFormReducer(filled(), { type: 'submit-start' })
    expect(started.submitting).toBe(true)

    const done = importFormReducer(started, {
      type: 'submit-success',
      items: [activity('a'), activity('b')],
    })

    expect(done.submitting).toBe(false)
    expect(done.link).toBe('')
    expect(done.text).toBe('')
    expect(done.results.map((item) => item.id)).toEqual(['a', 'b'])
    expect(done.error).toBeNull()
    expect(done.fieldError).toBeNull()
  })

  it('失败后解除提交态并保留输入，方便用户修正后重试', () => {
    const started = importFormReducer(filled(), { type: 'submit-start' })

    const failed = importFormReducer(started, {
      type: 'submit-failure',
      message: '服务端解析失败',
    })

    expect(failed.submitting).toBe(false)
    expect(failed.error).toBe('服务端解析失败')
    expect(failed.link).toBe('https://mp.weixin.qq.com/s/AbCd')
    expect(failed.text).toBe('讲座正文')
  })

  it('请求抛错时 finally 的 submit-end 也会解除提交态', () => {
    const started = importFormReducer(filled(), { type: 'submit-start' })

    const ended = importFormReducer(started, { type: 'submit-end' })

    expect(ended.submitting).toBe(false)
  })

  it('客户端校验失败落在字段错误上，不显示成服务端错误', () => {
    const state = importFormReducer(initialImportFormState, {
      type: 'submit-invalid',
      message: '请粘贴公众号文章链接或正文',
    })

    expect(state.submitting).toBe(false)
    expect(state.fieldError).toBe('请粘贴公众号文章链接或正文')
    expect(state.error).toBeNull()
  })

  it('切换模式清掉上一种模式的错误', () => {
    const state: ImportFormState = {
      ...filled(),
      error: '上次导入失败',
      fieldError: '链接格式不正确',
    }

    const switched = importFormReducer(state, { type: 'mode', mode: 'text' })

    expect(switched.mode).toBe('text')
    expect(switched.error).toBeNull()
    expect(switched.fieldError).toBeNull()
  })

  it('开始提交时清掉旧错误', () => {
    const state: ImportFormState = { ...filled(), error: '旧错误', fieldError: '旧字段错误' }

    const started = importFormReducer(state, { type: 'submit-start' })

    expect(started.error).toBeNull()
    expect(started.fieldError).toBeNull()
    expect(started.submitting).toBe(true)
  })
})
