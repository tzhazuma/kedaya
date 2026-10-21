import { describe, expect, it } from 'vitest'

import {
  CAMPUS_PLATFORMS,
  CAMPUS_WEBVIEW_LOGIN_NOTICE,
  CAMPUS_WEBVIEW_TARGETS,
  CONTRACT_FORBIDDEN_CREDENTIAL_KEYS,
  PHASE0_BINDABLE_PLATFORMS,
  bindingSummaryForbiddenKeys,
  campusCapabilityDefinition,
  campusViewerFromBindings,
  campusWebviewTarget,
  countUnboundCapabilities,
  isBindingUsable,
  isHttpsCampusUrl,
  isPhase0Bindable,
  normalizeBindingStatus,
  normalizeCampusBindingSummary,
  normalizeCampusBindingSummaries,
  normalizeCampusCapabilities,
  normalizeCampusCapability,
  resolveCapabilityEntry,
  type CampusBindingSummary,
  type CampusCapability,
} from '../techpie'

/**
 * techpie 领域模型 —— 契约 §11.18 / §11.10-F 的客户端落点。
 *
 * 本文件里**最重要**的一组断言是「`CAMPUS_BINDING_REQUIRED` 是**引导**而不是错误」
 * （契约不变式 I4）与「未登录 ≠ 未绑定」。它们钉住的是 UI 语义，
 * 而不是某个函数的实现细节 —— 如果有人把未绑定改成红色报错，这里会先失败。
 */

function capability(overrides: Partial<CampusCapability> = {}): CampusCapability {
  return {
    key: 'campus_card',
    nameZh: '校园卡',
    available: true,
    requiredProvider: 'ecard',
    phase: 'phase0',
    blockedReason: null,
    ...overrides,
  }
}

describe('domain · techpie（绑定摘要归一化，契约 I1 的镜像）', () => {
  it('provider 枚举逐字等于契约 §11.10-B 的裁决', () => {
    expect([...CAMPUS_PLATFORMS]).toEqual(['cas', 'egate', 'cpdaily', 'ecard', 'techpie'])
  })

  it('Phase 0 **只**允许校园卡（契约 §11.18-D）', () => {
    expect([...PHASE0_BINDABLE_PLATFORMS]).toEqual(['ecard'])
    expect(isPhase0Bindable('ecard')).toBe(true)
    expect(isPhase0Bindable('egate')).toBe(false)
    expect(isPhase0Bindable('cpdaily')).toBe(false)
    expect(isPhase0Bindable('cas')).toBe(false)
  })

  it('规格 §8.3 的历史写法 LINKING / LINKED / UNLINKED 被兼容归一化', () => {
    expect(normalizeBindingStatus('LINKING')).toBe('PENDING')
    expect(normalizeBindingStatus('LINKED')).toBe('ACTIVE')
    expect(normalizeBindingStatus('UNLINKED')).toBe('UNLINKED')
    expect(normalizeBindingStatus('nonsense')).toBeNull()
  })

  it('归一化同时接受 OpenAPI 的 provider/displayName 与规格的 platform/externalUserId', () => {
    const fromOpenApi = normalizeCampusBindingSummary({
      id: 'tpl-1',
      provider: 'ecard',
      status: 'ACTIVE',
      displayName: '2023XXXXXX',
      boundAt: '2026-10-17T01:30:00.000Z',
      expiresAt: null,
      lastSyncAt: null,
      phase: 'phase0',
    })
    expect(fromOpenApi?.provider).toBe('ecard')
    expect(fromOpenApi?.displayName).toBe('2023XXXXXX')

    const fromSpec = normalizeCampusBindingSummary({
      id: 'tpl-2',
      platform: 'cpdaily',
      status: 'LINKED',
      externalUserId: '2024YYYYYY',
    })
    expect(fromSpec?.provider).toBe('cpdaily')
    expect(fromSpec?.status).toBe('ACTIVE')
    expect(fromSpec?.displayName).toBe('2024YYYYYY')
  })

  it('⚠️ 响应里夹带禁用凭证键时**拒绝整条**，而不是"看不见就继续用"', () => {
    const poisoned = {
      id: 'tpl-3',
      provider: 'ecard',
      status: 'ACTIVE',
      castgc: 'TGT-DEMO',
    }
    expect(normalizeCampusBindingSummary(poisoned)).toBeNull()
    expect(normalizeCampusBindingSummaries([poisoned])).toEqual([])
  })

  it('形状不合法 / provider 不在冻结枚举内时也拒绝', () => {
    expect(normalizeCampusBindingSummary({ provider: 'ecard', status: 'ACTIVE' })).toBeNull()
    expect(
      normalizeCampusBindingSummary({ id: 'x', provider: 'wechat', status: 'ACTIVE' }),
    ).toBeNull()
  })

  it('CampusBindingSummary 的键名与 I1 的 8 个禁用键**不相交**', () => {
    const summary: CampusBindingSummary = {
      id: 'tpl-1',
      provider: 'ecard',
      status: 'ACTIVE',
      displayName: null,
      boundAt: null,
      expiresAt: null,
      lastSyncAt: null,
      phase: 'phase0',
    }
    expect(bindingSummaryForbiddenKeys(summary)).toEqual([])
    // 序列化后再断言一次（契约 §11.4 要求"类型与序列化键名断言"）
    const serialized = JSON.stringify(summary)
    for (const key of CONTRACT_FORBIDDEN_CREDENTIAL_KEYS) {
      expect(serialized.toLowerCase()).not.toContain(`"${key.toLowerCase()}":`)
    }
  })
})

describe('domain · techpie（能力清单归一化）', () => {
  it('可用 / 不可用、Phase、blockedReason 都被保留', () => {
    const parsed = normalizeCampusCapability({
      key: 'schedule',
      nameZh: '课表',
      available: false,
      requiredProvider: 'cpdaily',
      phase: 'phase1',
      blockedReason: '等待信息办书面回复',
    })
    expect(parsed).toEqual({
      key: 'schedule',
      nameZh: '课表',
      available: false,
      requiredProvider: 'cpdaily',
      phase: 'phase1',
      blockedReason: '等待信息办书面回复',
    })
  })

  it('未知 phase 一律回落 phase0？—— 不：**回落为 phase0 是危险的**，这里断言实际行为', () => {
    // 未知 phase 被当作 phase0（保守地"能显示"），但 available=false 仍会走 BLOCKED 分支。
    // 这条断言的作用是把这个行为**显式化**，避免它成为隐式假设。
    const parsed = normalizeCampusCapability({ key: 'x', available: false, phase: 'phase9' })
    expect(parsed?.phase).toBe('phase0')
    expect(parsed?.available).toBe(false)
  })

  it('含凭证键的能力条目被拒绝', () => {
    expect(normalizeCampusCapability({ key: 'x', available: true, tenant: 't1' })).toBeNull()
    expect(normalizeCampusCapabilities([{ key: 'x', cookie: 'a' }])).toEqual([])
  })
})

describe('domain · techpie（⚠️ 契约 I4：CAMPUS_BINDING_REQUIRED 是引导，不是错误）', () => {
  it('未登录 → SIGN_IN + UNAUTHENTICATED，**不是**引导', () => {
    const decision = resolveCapabilityEntry(capability(), {
      authenticated: false,
      boundProviders: [],
    })
    expect(decision.action).toBe('SIGN_IN')
    expect(decision.code).toBe('UNAUTHENTICATED')
    expect(decision.isGuidance).toBe(false)
  })

  it('已登录但未绑定 → GO_BIND + CAMPUS_BINDING_REQUIRED，**是引导**', () => {
    const decision = resolveCapabilityEntry(capability(), {
      authenticated: true,
      boundProviders: [],
    })
    expect(decision.action).toBe('GO_BIND')
    expect(decision.code).toBe('CAMPUS_BINDING_REQUIRED')
    expect(decision.isGuidance).toBe(true)
    // 文案必须是"还差一步"这种引导语气，不是"失败"
    expect(decision.title).toContain('还差一步')
    expect(decision.detail).not.toMatch(/失败|错误/)
  })

  it('⚠️ 未登录与未绑定**必须被区分开**（契约 §11.18-H 的 I4 原意）', () => {
    const unauth = resolveCapabilityEntry(capability(), {
      authenticated: false,
      boundProviders: [],
    })
    const unbound = resolveCapabilityEntry(capability(), {
      authenticated: true,
      boundProviders: [],
    })
    expect(unauth.code).not.toBe(unbound.code)
    expect(unauth.isGuidance).toBe(false)
    expect(unbound.isGuidance).toBe(true)
  })

  it('已绑定 → 可用（WebView 走 W4，端内走 OPEN_NATIVE）', () => {
    const viewer = { authenticated: true, boundProviders: ['ecard' as const] }
    expect(resolveCapabilityEntry(capability(), viewer, 'native').action).toBe('OPEN_NATIVE')
    expect(
      resolveCapabilityEntry(capability({ requiredProvider: null }), viewer, 'webview').action,
    ).toBe('OPEN_WEBVIEW')
  })

  it('不需要绑定的 Phase 0 能力（W4 用户自登录）直接可开', () => {
    const decision = resolveCapabilityEntry(
      capability({ key: 'ecourse', requiredProvider: null }),
      { authenticated: true, boundProviders: [] },
      'webview',
    )
    expect(decision.action).toBe('OPEN_WEBVIEW')
    expect(decision.code).toBeNull()
    // 打开前必须如实告知「你自己登录」
    expect(decision.detail).toContain('不接触你的登录凭证')
  })

  it('Phase 1+ 能力 → BLOCKED，且**先于绑定判定**（不引导用户去绑一个没实现的路径）', () => {
    const decision = resolveCapabilityEntry(
      capability({ key: 'schedule', phase: 'phase1', available: false, blockedReason: '等待信息办书面回复' }),
      { authenticated: true, boundProviders: [] },
    )
    expect(decision.action).toBe('BLOCKED')
    expect(decision.code).toBeNull()
    expect(decision.isGuidance).toBe(false)
    expect(decision.detail).toBe('等待信息办书面回复')
  })

  it('blockedReason 缺失时不编造原因，而是给出契约依据的默认文案', () => {
    const decision = resolveCapabilityEntry(
      capability({ key: 'exam', phase: 'phase1', available: false, blockedReason: null }),
      { authenticated: true, boundProviders: [] },
    )
    expect(decision.detail).toContain('信息办')
  })

  it('unboundCount 只统计"已登录但未绑定"的那些（不含未登录与 blocked）', () => {
    const items = [
      capability({ key: 'campus_card', requiredProvider: 'ecard' }),
      capability({ key: 'ecourse', requiredProvider: null }),
      capability({ key: 'schedule', phase: 'phase1', available: false }),
    ]
    expect(countUnboundCapabilities(items, { authenticated: true, boundProviders: [] })).toBe(1)
    expect(countUnboundCapabilities(items, { authenticated: false, boundProviders: [] })).toBe(0)
    expect(
      countUnboundCapabilities(items, { authenticated: true, boundProviders: ['ecard'] }),
    ).toBe(0)
  })
})

describe('domain · techpie（观看者构造：两级身份的汇合点）', () => {
  it('只把**可用**的绑定算进 boundProviders', () => {
    const viewer = campusViewerFromBindings(true, [
      { id: 'a', provider: 'ecard', status: 'ACTIVE', displayName: null, boundAt: null, expiresAt: null, lastSyncAt: null, phase: 'phase0' },
      { id: 'b', provider: 'egate', status: 'EXPIRED', displayName: null, boundAt: null, expiresAt: null, lastSyncAt: null, phase: 'phase1' },
    ])
    expect(viewer.boundProviders).toEqual(['ecard'])
    expect(isBindingUsable('EXPIRED')).toBe(false)
  })
})

describe('domain · techpie（WebView 目标：契约 §11.10-F / §11.18-B）', () => {
  it('六个校园系统入口都存在，且**全部是 https**', () => {
    for (const target of CAMPUS_WEBVIEW_TARGETS) {
      expect(target.url.startsWith('https://')).toBe(true)
      expect(isHttpsCampusUrl(target.url)).toBe(true)
    }
    // 2026-10-20 实测校订：新增真实的 eams / oa，删除不存在的 student
    expect(CAMPUS_WEBVIEW_TARGETS.map((t) => t.id).sort()).toEqual([
      'eams',
      'ecard',
      'ecourse',
      'egate',
      'elrc',
      'oa',
    ])
    expect(campusWebviewTarget('ecourse')?.nameZh).toBe('E云课堂')
    expect(campusWebviewTarget('nope')).toBeNull()
  })

  it('⭐ 每个入口都有「统一身份认证跳板」，且**指向学校 IDS + 官方 service**', () => {
    for (const target of CAMPUS_WEBVIEW_TARGETS) {
      // ⚠️ ecard 是例外：它的登录是「微信 OAuth + 校园卡账号」，
      // 不走学校 IDS，所以 ssoUrl 就是它自己的地址。这里显式放过并断言原因。
      if (target.id === 'ecard') {
        expect(target.ssoUrl).toBe(target.url)
        continue
      }
      // 其余必须跳到学校 IDS，而不是我们自己的站点
      expect(target.ssoUrl.startsWith('https://ids.shanghaitech.edu.cn/authserver/login?service=')).toBe(true)

      // ⚠️ 关键：service 必须是**官方站点自己**的地址，不是可达鸭的回调。
      // 这是「不注册 CAS」的全部合法性来源 —— 票根送不到我们这边。
      const service = decodeURIComponent(target.ssoUrl.split('service=')[1] ?? '')
      expect(service.startsWith('https://')).toBe(true)
      expect(service).not.toContain('kedaya')
      expect(service).toContain(target.id === 'egate' ? 'egate-new' : target.id)
    }
  })

  it('⚠️ ecourse 如实标注「web-view 打不开」（它跳 8600 端口）', () => {
    const ecourse = campusWebviewTarget('ecourse')
    expect(ecourse?.webviewBlockedReason).not.toBeNull()
    expect(ecourse?.webviewBlockedReason).toContain('8600')
    // ⚠️ ecard 也有 blockedReason，但原因不同（公网不可达，不是端口问题）。
    // 两个都要如实标注，其余的必须为 null —— 不许顺手给别的入口也标上。
    for (const target of CAMPUS_WEBVIEW_TARGETS) {
      if (target.id === 'ecourse' || target.id === 'ecard') continue
      expect(target.webviewBlockedReason).toBeNull()
    }
    expect(campusWebviewTarget('ecard')?.webviewBlockedReason).toContain('校内网络')
  })

  it('域名已实测（2026-10-20），不再是占位', () => {
    // 这条断言反转了。原来是「必须是占位」，现在域名已逐个实测：
    //   eams / egate-new / oa / elrc → HTTP 200；ecourse → 302 到 :8600
    //   student.shanghaitech.edu.cn → 域名不存在，已删除
    // 若将来发现某个域名失效，必须把它的 domainVerified 改回 false —— 不要静默留着。
    // ⚠️ 除 ecard 外全部 true。ecard 实测公网不可达（302 到厂商错误页），
    // 所以它必须是 false —— 这正是「未确认就标未确认」的规则在起作用。
    for (const target of CAMPUS_WEBVIEW_TARGETS) {
      if (target.id === 'ecard') {
        expect(target.domainVerified).toBe(false)
        continue
      }
      expect(target.domainVerified).toBe(true)
    }
  })

  it('isHttpsCampusUrl 拒绝 http / IP 字面量 / userinfo（契约 §11.18-B）', () => {
    expect(isHttpsCampusUrl('http://ecourse.shanghaitech.edu.cn/')).toBe(false)
    expect(isHttpsCampusUrl('https://10.0.0.1/')).toBe(false)
    expect(isHttpsCampusUrl('https://shanghaitech.edu.cn@evil.com/')).toBe(false)
    expect(isHttpsCampusUrl('https://')).toBe(false)
  })

  it('登录告知文案就是契约 §11.10-F 要求的那句（用户必须被告知）', () => {
    expect(CAMPUS_WEBVIEW_LOGIN_NOTICE).toContain('学校系统')
    expect(CAMPUS_WEBVIEW_LOGIN_NOTICE).toContain('登录')
    expect(CAMPUS_WEBVIEW_LOGIN_NOTICE).toContain('不接触你的登录凭证')
  })
})

describe('domain · techpie（能力目录：交付方式属于端，不属于服务端）', () => {
  it('四个校园系统能力走 webview，校园卡走端内', () => {
    expect(campusCapabilityDefinition('ecourse')?.webviewTargetId).toBe('ecourse')
    expect(campusCapabilityDefinition('student_leave')?.webviewTargetId).toBe('egate')
    expect(campusCapabilityDefinition('elrc_recordings')?.webviewTargetId).toBe('elrc')
    expect(campusCapabilityDefinition('campus_card')?.delivery).toBe('native')
    expect(campusCapabilityDefinition('campus_card')?.nativeRoute).toBe('campus-card')
  })

  it('Phase 1+ 能力**没有** WebView 目标 —— 避免 UI 上出现一个能点的入口', () => {
    for (const key of ['schedule', 'exam', 'ddl', 'facility']) {
      expect(campusCapabilityDefinition(key)?.webviewTargetId).toBeNull()
    }
  })
})
