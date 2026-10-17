import { MINIAPP_PAGES } from '@kedaya/contracts'
import { ok, type Result } from '@kedaya/shared'

import type { AgentAction, AgentCapabilities, AgentChatInput, AgentFact, AgentReply } from '../../domain/models/agent'
import type { AgentRepository } from '../../domain/ports/agentRepository'
import type { CampusCardRepository } from '../../domain/ports/campusCardRepository'
import type { IdentityRepository } from '../../domain/ports/identityRepository'
import type { PrivacyRepository } from '../../domain/ports/privacyRepository'
import type { ScheduleRepository } from '../../domain/ports/scheduleRepository'

/**
 * 可达鸭 agent 的 **本地 Mock 实现**。
 *
 * 为什么 agent 也要有 mock，而且不能是"随便答一句"：
 *   · 契约 §7 要求无后端也能开发；agent 是全局入口，它一哑，整个应用看起来就是坏的；
 *   · 更重要的是 —— 它必须**复刻服务端的行为契约**：无 LLM 用规则回答、
 *     未登录拒答并引导登录、上游不可用说"查不到"而不是编一个数字。
 *     这样客户端在 mock 下就验证了降级路径，接真后端时不需要改页面。
 *
 * 与真后端的差别：这里**没有** LLM 选项（本地不做任何模型调用），\n * 因此 `usedModel` 恒为 null、`degraded: true`，页面会如实显示\"规则回答\"。\n */

export interface MockAgentOptions {
  schedule: ScheduleRepository
  campusCard: CampusCardRepository
  identity: IdentityRepository
  privacy: PrivacyRepository
  viewerId: () => string | null
  latencyMs: number
  now: () => Date
}

interface Rule {
  tool: string
  keywords: readonly string[]
  requiresAuth: boolean
  run(userId: string, question: string): Promise<{ facts: AgentFact[]; actions: AgentAction[]; notice?: string }>
}

function navigate(label: string, path: string): AgentAction {
  return { type: 'navigate', label, path }
}

export function createMockAgentRepository(options: MockAgentOptions): AgentRepository {
  const { schedule, campusCard, identity, privacy, viewerId, latencyMs, now } = options

  const delay = async (): Promise<void> => {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs))
  }

  const needLogin = (what: string) => ({
    facts: [{ tool: 'auth.required', label: '需要先登录', value: `要${what}需要先登录 —— 我不会用别人的数据来回答你。` }],
    actions: [navigate('去登录', MINIAPP_PAGES.authLogin)],
  })

  const rules: Rule[] = [
    {
      tool: 'schedule.next',
      keywords: ['下一节', '下节课', '接下来', '还有多久', '几点上课', '几点有课'],
      requiresAuth: true,
      run: async (userId) => {
        if (userId === '') return needLogin('查课表')
        const result = await schedule.today()
        if (!result.ok) return { facts: [], actions: [] }
        const view = result.value
        const facts: AgentFact[] = []
        if (view.next !== null) {
          facts.push({
            tool: 'schedule.next',
            label: '下一节课',
            value: `${view.next.courseName} · ${view.next.timeLabel}${view.next.location === null ? '' : ` @ ${view.next.location}`}，${view.minutesUntilNext ?? 0} 分钟后开始`,
            simulated: true,
          })
        } else {
          facts.push({ tool: 'schedule.next', label: '今天的课', value: '今天已经没有排课了' })
        }
        return { facts, actions: [navigate('打开课表', MINIAPP_PAGES.schedule)] }
      },
    },
    {
      tool: 'schedule.today',
      keywords: ['课表', '有课', '上课', '教室', '在哪上', '课程'],
      requiresAuth: true,
      run: async (userId) => {
        if (userId === '') return needLogin('查课表')
        const result = await schedule.today()
        if (!result.ok) return { facts: [], actions: [] }
        const view = result.value
        if (view.empty) {
          return {
            facts: [{ tool: 'schedule.today', label: '今日课表', value: `今天（${view.weekdayLabel}）没有课。如果这不对，可能是还没绑定教务系统。`, simulated: true }],
            actions: [navigate('去绑定教务系统', MINIAPP_PAGES.identity)],
          }
        }
        return {
          facts: [
            {
              tool: 'schedule.today',
              label: `今日课表（${view.weekdayLabel}，共 ${view.courses.length} 节）`,
              value: view.courses.map((course) => `${course.timeLabel} ${course.courseName}${course.location === null ? '' : ` @ ${course.location}`}`).join('；'),
              simulated: true,
            },
          ],
          actions: [navigate('打开课表', MINIAPP_PAGES.schedule)],
        }
      },
    },
    {
      tool: 'card.overview',
      keywords: ['余额', '校园卡', '卡里', '花了', '消费', '充值', '还能撑', '钱', '扣款', '挂失', '丢了'],
      requiresAuth: true,
      run: async (userId) => {
        if (userId === '') return needLogin('查校园卡')
        const result = await campusCard.overview()
        if (!result.ok) {
          return {
            facts: [{ tool: 'card.overview', label: '校园卡', value: '校园卡系统暂时不可用，我不会瞎猜一个余额给你。' }],
            actions: [navigate('打开校园卡', MINIAPP_PAGES.campusCard)],
          }
        }
        const view = result.value
        const facts: AgentFact[] = [
          {
            tool: 'card.overview',
            label: '余额',
            value:
              `¥${(view.balanceFen / 100).toFixed(2)}` +
              (view.lowBalance ? '（已低于提醒阈值，建议尽快充值）' : '') +
              (view.insight.estimatedDaysLeft === null ? '' : `，按最近 7 天消费大概还能撑 ${view.insight.estimatedDaysLeft} 天`),
            simulated: true,
          },
        ]
        return { facts, actions: [navigate('打开校园卡', MINIAPP_PAGES.campusCard)] }
      },
    },
    {
      tool: 'identity.view',
      keywords: ['实名', '我是谁', '学号', '姓名', '院系', '身份', '绑定'],
      requiresAuth: true,
      run: async (userId) => {
        if (userId === '') return needLogin('查看身份信息')
        const overview = await identity.overview()
        const facts: AgentFact[] = []
        if (overview.ok) {
          const available = overview.value.platforms.filter((item) => item.available)
          facts.push({
            tool: 'identity.view',
            label: '校园系统绑定',
            value: available.length === 0 ? '还没有绑定任何校园系统，所以查不到课表和校园卡' : available.map((item) => item.platform).join('、'),
            simulated: true,
          })
        }
        const view = await identity.identity(false)
        if (view.ok) {
          facts.push({
            tool: 'identity.view',
            label: '实名信息（已打码）',
            value: `${view.value.identity.realName} · ${view.value.identity.studentId}`,
            simulated: true,
          })
        }
        return { facts, actions: [navigate('打开身份页面', MINIAPP_PAGES.identity)] }
      },
    },
    {
      tool: 'profile.consents',
      keywords: ['同意', '授权', '隐私', '画像', '撤回', '导出', '开关'],
      requiresAuth: true,
      run: async (userId) => {
        if (userId === '') return needLogin('查看隐私设置')
        const [consents, settings] = await Promise.all([privacy.consents(), privacy.settings()])
        const facts: AgentFact[] = []
        if (consents.ok) {
          const gated = consents.value.filter((item) => item.gated)
          const active = gated.filter((item) => item.active)
          facts.push({
            tool: 'profile.consents',
            label: '需要单独同意的模块',
            value: gated.length === 0 ? '当前没有需要二次同意的模块' : `${gated.length} 个，已授权 ${active.length} 个：` + gated.map((item) => `${item.nameZh}${item.active ? '（已授权）' : '（未授权）'}`).join('、'),
          })
        }
        if (settings.ok) {
          facts.push({
            tool: 'profile.consents',
            label: '隐私开关',
            value: `AI 画像：${settings.value.allowAiPortrait ? '已开启' : '已关闭'}；心理健康：${settings.value.allowWellbeing ? '已开启' : '已关闭'}；实名展示：${settings.value.showRealName ? '开启' : '关闭'}`,
          })
        }
        return { facts, actions: [navigate('打开隐私与数据', MINIAPP_PAGES.profileSettings)] }
      },
    },
    {
      tool: 'account.guide',
      keywords: ['登录', '注册', '密码', '邮箱', '微信登录', '绑定邮箱', '解绑', '账号'],
      requiresAuth: false,
      run: async () => ({ facts: [], actions: [navigate('去登录 / 注册', MINIAPP_PAGES.authLogin), navigate('绑定邮箱', MINIAPP_PAGES.authBindEmail)] }),
    },
  ]

  const LOCAL_ANSWERS: readonly { keywords: string[]; answer: string; source: string; path?: string }[] = [
    {
      keywords: ['课表', '同步'],
      answer: '课表页会先显示本地缓存（离线也能看今天上什么），点「同步」会去教务系统整体拉取并覆盖本地课表。如果教务系统暂时不可用，本地课表不会被清空 —— 你会看到上一次成功同步的结果和同步时间。',
      source: '课表怎么同步、会不会丢',
      path: MINIAPP_PAGES.schedule,
    },
    {
      keywords: ['挂失', '丢'],
      answer: '可达鸭不能替你挂失（对校园卡系统没有写权限）。最快的做法是到校园卡自助终端或服务中心办理挂失，再回忆最后一次刷卡地点登记；若发现非本人消费，带上流水截图找服务中心申诉。',
      source: '校园卡丢了怎么办',
      path: MINIAPP_PAGES.campusCard,
    },
    {
      keywords: ['登录', '注册'],
      answer: '可达鸭支持三条登录入口：校园统一身份认证、邮箱 + 密码、微信小程序快捷登录。三条入口登录后是同一个账号，建议微信登录后再补绑邮箱密码，避免换设备时进不来。',
      source: '三种登录方式',
      path: MINIAPP_PAGES.authLogin,
    },
    {
      keywords: ['隐私', '同意', '删除', '导出'],
      answer: '在「我的 → 隐私与数据」里可以逐个模块授权或随时撤回同意（撤回后该模块立即不可用），也可以关闭 AI 画像等敏感开关，或导出你的账号档案与内容条数。',
      source: '隐私开关、同意与数据导出',
      path: MINIAPP_PAGES.profileSettings,
    },
    {
      keywords: ['演示', '模拟', '假'],
      answer: '本地开发环境（以及尚未拿到校方授权时）课表、校园卡、实名信息来自模拟数据源，界面与响应都会标注「演示数据」。同一个账号每次看到的一样，便于排查问题。',
      source: '什么时候看到的是演示数据',
    },
  ]

  return {
    async chat(input: AgentChatInput): Promise<Result<AgentReply, never>> {
      const startedAt = now().getTime()
      await delay()

      const question = input.question.toLowerCase()
      const userId = viewerId() ?? ''
      const matched = rules.filter((rule) => rule.keywords.some((keyword) => question.includes(keyword))).slice(0, 2)

      const facts: AgentFact[] = []
      const actions: AgentAction[] = []
      const steps: { tool: string; ok: boolean }[] = []
      const notices: string[] = []

      for (const rule of matched) {
        try {
          const result = await rule.run(userId, input.question)
          facts.push(...result.facts)
          actions.push(...result.actions)
          if (result.notice !== undefined) notices.push(result.notice)
          steps.push({ tool: rule.tool, ok: true })
        } catch {
          steps.push({ tool: rule.tool, ok: false })
          notices.push(`「${rule.tool}」暂时查不到，下面是我能确定的部分。`)
        }
      }

      const knowledge = LOCAL_ANSWERS.find((entry) => entry.keywords.some((keyword) => question.includes(keyword)))
      const sources = knowledge === undefined ? [] : [{ id: `guide:${knowledge.source}`, title: knowledge.source, kind: 'guide' as const, updatedAt: null }]
      if (knowledge?.path !== undefined && !actions.some((action) => action.path === knowledge.path)) {
        actions.push(navigate('打开相关页面', knowledge.path))
      }

      // 与服务端 `composeDeterministic` 同一条规则：匿名问"怎么做"时，
      // 先给做法（知识条目），再补登录门槛 —— 否则用户会以为可达鸭答非所问
      const factLines = facts.map(
        (fact) => `【${fact.label}】${fact.value}${fact.simulated === true ? '（演示数据）' : ''}`,
      )
      const loginGated = facts.some((fact) => fact.tool === 'auth.required')
      const lines: string[] = []
      if (loginGated && knowledge !== undefined) {
        lines.push(knowledge.answer)
        lines.push(...factLines)
      } else {
        lines.push(...factLines)
        if (knowledge !== undefined) {
          lines.push(facts.length > 0 ? `补充：${knowledge.answer}` : knowledge.answer)
        }
      }
      lines.push(...notices)
      if (lines.length === 0) {
        lines.push('这个问题我还不太会答。可以试着问我：今天有哪些课、校园卡还剩多少钱、怎么绑定校园系统、我授权了哪些模块 —— 或者换个说法再问我一次。')
      }

      const uniqueActions = actions.filter((action, index) => actions.findIndex((item) => item.path === action.path) === index).slice(0, 3)

      return ok({
        answer: lines.join('\n'),
        sources,
        actions: uniqueActions,
        facts,
        steps,
        // 本地 mock 不调用任何模型：如实标成规则回答 + 降级，页面会显示对应提示
        usedModel: null,
        degraded: true,
        simulated: facts.some((fact) => fact.simulated === true),
        latencyMs: Math.max(0, now().getTime() - startedAt),
      })
    },

    async suggestions(page?: string, module?: string): Promise<Result<string[], never>> {
      await delay()
      const key = module ?? (page === undefined ? undefined : page.split('/').filter(Boolean).at(-2))
      const byModule: Record<string, string[]> = {
        schedule: ['今天还有课吗？', '下一节课在哪上？', '课表怎么同步？'],
        campusCard: ['我卡里还有多少钱？', '校园卡丢了怎么办？'],
        identity: ['我绑定了哪些校园系统？', '实名信息为什么要打码？'],
        profile: ['我授权了哪些敏感模块？', '怎么导出我的数据？'],
      }
      const resolved = key === 'campusCard' ? 'campusCard' : key
      return ok([...(resolved === undefined ? [] : (byModule[resolved] ?? [])), '这个页面是干什么的？', '我还能用哪些功能？', '我的数据安全吗？'].slice(0, 5))
    },

    async capabilities(): Promise<Result<AgentCapabilities, never>> {
      await delay()
      return ok({
        persona: '可达鸭',
        model: null,
        mode: 'rules',
        tools: rules.map((rule) => ({ name: rule.tool, description: rule.tool, requiresAuth: rule.requiresAuth })),
        knowledgeSources: ['模块说明（冻结契约 §4）', '内置使用指南', '帮助中心 FAQ'],
        notIndexed: ['个人课表', '校园卡流水', '实名信息', '心理与宿舍矛盾记录', '账号凭据'],
      })
    },
  }
}
