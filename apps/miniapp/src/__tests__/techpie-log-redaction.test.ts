import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createBindCampusUseCase } from '../application/techpie/bindCampus'
import { createCampusCardUseCase } from '../application/techpie/campusCard'
import { createCapabilitiesUseCase } from '../application/techpie/capabilities'
import { createListBindingsUseCase } from '../application/techpie/listBindings'
import { createMemoryStorage } from '../data/storage/memoryStorage'
import { createMockTechpieRepository } from '../data/repositories/mockTechpieRepository'
import { createTechpieMemoryDatabase } from '../data/mock/techpieMemoryDatabase'
import { createLogPort, createMemorySink } from '../platform/log'
import { TEST_PROFILE, TEST_TOKENS, createFakeSessionStore, fixedClock } from '../application/__tests__/testDoubles'
import type { LogRecord } from '../domain/ports/logPort'

/**
 * 规格 §10.3 的**端到端验收**：日志里不出现任何凭证。
 *
 * ## 为什么这个测试必须存在（而不是只靠单测）
 *
 * 规格 §10.3 的验收标准（P1-7）写的是：
 *
 * > 构造一次完整绑定流程，抓取全部日志输出，正则扫描
 * > `/castgc|CASTGC|tgc=|password/i`，**必须零命中**。
 *
 * 单测只能证明「某个用例在某个分支上没打凭证」。
 * 端到端则证明：把**真实的**日志适配器 + **真实的** mock 仓储 +
 * 四个用例串起来跑一遍完整流程之后，落点里依然干净。
 *
 * ## 为什么不用 `app/container.ts`
 *
 * 容器会 import `@tarojs/taro`（网络 / 存储适配器），而 vitest 跑在 node 环境，
 * Taro 的运行时在 node 下会抛 `ENABLE_INNER_HTML is not defined`。
 * 因此这里**手工装配同样的部件**，并另加一条**静态断言**证明容器的接线
 * 确实把 `log` 传给了 techpie 的仓储与用例（否则这条测试会与真实接线脱节）。
 */

const FIXED_NOW = (): Date => new Date('2026-10-17T03:00:00.000Z')

/** ⚠️ 这些字符串一旦出现在日志里，就是一次真实的凭证泄漏 */
const SECRET_MARKERS = {
  /** 校园卡 OPENID 通道的一次性 code（wx.login 的产物） */
  loginCode: 'wx-login-code-SECRET-9F3A',
  /** 一次性付款码 */
  paymentCodePrefix: 'MOCK',
  /** 演示用的一次性票据 */
  ticket: 'wvt_SECRET_TICKET',
}

function buildRig() {
  const sink = createMemorySink()
  const log = createLogPort({ sink, now: FIXED_NOW })
  const cache = createMemoryStorage()
  const clock = fixedClock('2026-10-17T03:00:00.000Z')
  const session = createFakeSessionStore(TEST_PROFILE, TEST_TOKENS)
  const database = createTechpieMemoryDatabase({ now: FIXED_NOW })
  const repository = createMockTechpieRepository({ latencyMs: 0, now: FIXED_NOW, database, log })

  const listBindings = createListBindingsUseCase({
    repository,
    cache,
    clock,
    cacheKey: 'rig:techpie:links',
    log,
  })
  const capabilities = createCapabilitiesUseCase({
    repository,
    cache,
    clock,
    cacheKey: 'rig:techpie:capabilities',
    log,
  })
  const bindCampus = createBindCampusUseCase({ repository, session, clock, log })
  const campusCard = createCampusCardUseCase({
    repository,
    cache,
    clock,
    cacheKey: 'rig:campus-card:txns',
    log,
    session,
    paymentCodeRegistered: false,
  })

  return { sink, log, cache, session, database, repository, listBindings, capabilities, bindCampus, campusCard }
}

function dump(records: readonly LogRecord[]): string {
  return JSON.stringify(records)
}

describe('端到端 · 日志脱敏（规格 §10.3 / 验收 P1-7）', () => {
  it('⚠️ 完整流程走完，日志里**零命中**凭证正则', async () => {
    const rig = buildRig()

    // 1. 绑定列表（含一次契约违规注入：响应里夹带禁用键）
    //    刻意用 **phase1 的过期绑定**做违规演示，而不是校园卡 ——
    //    否则下一步"绑定校园卡"会因为 ALREADY_LINKED 而失败
    rig.database.seedExpiredEgateBinding()
    rig.repository.injectForbiddenKeysOnce()
    await rig.listBindings.load()
    await rig.listBindings.load()

    // 2. 能力清单
    await rig.capabilities.load()

    // 3. 绑定校园卡（凭证进仓储，**不进日志**）
    const bound = await rig.bindCampus.bindEcard({
      channel: 'wechat-openid',
      wechatLoginCode: SECRET_MARKERS.loginCode,
    })
    expect(bound.ok).toBe(true)

    // 4. 校园卡：流水 + 付款码
    await rig.campusCard.load()
    const code = await rig.campusCard.requestPaymentCode()
    expect(code.ok).toBe(true)

    // 5. 手动续期（校园卡可续）+ 解绑
    const id = bound.ok ? bound.value.id : ''
    await rig.bindCampus.renew(id)
    await rig.bindCampus.unbind(id)

    // 6. Phase 1 平台的绑定请求（会被拒绝，且**不发请求**）
    rig.bindCampus.requestPhase1Binding('egate')

    // 7. WebView 直连的打开事件
    rig.log.info('techpie.webview.open', { targetId: 'ecourse', domainVerified: false })

    const records = rig.sink.records
    expect(records.length).toBeGreaterThan(5)

    const text = dump(records)

    // 规格 §10.3 的验收正则（原样照抄，逐字）
    expect(text).not.toMatch(/castgc|CASTGC|tgc=|password/i)

    // 更宽的自查：cookie / 授权头 / 一次性凭证 / 付款码 / 票据
    expect(text).not.toMatch(/cookie|jsessionid|bearer|authorization/i)
    expect(text).not.toContain(SECRET_MARKERS.loginCode)
    expect(text).not.toContain(SECRET_MARKERS.ticket)
    expect(text).not.toContain(SECRET_MARKERS.paymentCodePrefix)
    expect(text).not.toContain('TGT-DEMO-VIOLATION')

    // 该记的仍然记了 —— 否则"没泄漏"只是因为"什么都没记"
    expect(text).toContain('techpie.bindings.load.succeeded')
    expect(text).toContain('techpie.binding.create.succeeded')
    expect(text).toContain('campus-card.transactions.load.succeeded')
    expect(text).toContain('techpie.contract.violation')
    expect(text).toContain('techpie.webview.open')
    expect(text).toContain('ecard')
  })

  it('⚠️ 绑定失败时日志只记错误码，不记上游 message（message 可能回显凭证）', async () => {
    const rig = buildRig()

    // 让 mock 仓储的下一次调用失败
    rig.repository.failNextRequests(1)
    const failed = await rig.bindCampus.bindEcard({
      channel: 'wechat-openid',
      wechatLoginCode: SECRET_MARKERS.loginCode,
    })
    expect(failed.ok).toBe(false)

    const text = dump(rig.sink.records)
    expect(text).toContain('UPSTREAM_UNAVAILABLE')
    expect(text).not.toContain(SECRET_MARKERS.loginCode)
    expect(text).not.toMatch(/cookie|castgc|password/i)
  })

  it('⚠️ 契约违规（响应夹带禁用键）被记录，但**不记录违规内容本身**', async () => {
    const rig = buildRig()
    rig.database.seedEcardBinding()
    rig.repository.injectForbiddenKeysOnce()

    await rig.listBindings.load()

    const text = dump(rig.sink.records)
    expect(text).toContain('techpie.contract.violation')
    expect(text).toContain('droppedCount')
    // 违规的具体键名/值都不进日志
    expect(text).not.toContain('TGT-DEMO-VIOLATION')
    expect(text).not.toContain('castgc')
  })
})

describe('端到端 · 装配接线（静态断言，因为 node 下无法构造容器）', () => {
  const containerSource = readFileSync(
    fileURLToPath(new URL('../app/container.ts', import.meta.url)),
    'utf8',
  )

  it('容器把 log 传给了 techpie 的仓储与四个用例', () => {
    expect(containerSource).toContain('createHttpTechpieRepository(apiClient, { log })')
    // mock 仓储同样必须拿到 log（格式不限，但 `log` 必须在参数里）
    expect(containerSource).toMatch(/createMockTechpieRepository\(\{[^}]*\blog\b[^}]*\}\)/)
    for (const useCase of ['listBindings', 'capabilities', 'bindCampus', 'campusCard']) {
      expect(containerSource).toContain(`const ${useCase} = create`)
    }
    // 四个用例的装配里都必须出现 log
    const techpieSection = containerSource.slice(
      containerSource.indexOf('const listBindings = createListBindingsUseCase'),
      containerSource.indexOf('return {\n    env,'),
    )
    expect(techpieSection.length).toBeGreaterThan(100)
    expect((techpieSection.match(/log,/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })

  it('容器里的 log 端口不是 NOOP（否则"没泄漏"会因为"没记录"而虚假通过）', () => {
    expect(containerSource).toContain('createLogPort()')
    expect(containerSource).not.toContain('NOOP_LOG_PORT')
  })
})
