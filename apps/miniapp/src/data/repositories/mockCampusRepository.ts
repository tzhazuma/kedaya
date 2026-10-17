import { err, ok, type Result } from '@kedaya/shared'

import type { CardLostReport, CardOverview, CardTransactionView } from '../../domain/models/campusCard'
import { LOW_BALANCE_THRESHOLD_FEN } from '../../domain/models/campusCard'
import type { CampusIdentityView, CampusOverview, CampusPlatform, CampusPlatformStatus } from '../../domain/models/identity'
import { CAMPUS_PLATFORMS } from '../../domain/models/identity'
import type { CreateCourseInput, ScheduleSyncResult, ScheduleTodayView, ScheduleWeekView } from '../../domain/models/schedule'
import { WEEKDAY_LABELS } from '../../domain/models/schedule'
import type { CachePort } from '../../domain/ports/cachePort'
import type { CampusCardRepository } from '../../domain/ports/campusCardRepository'
import type { IdentityRepository } from '../../domain/ports/identityRepository'
import type { ScheduleRepository } from '../../domain/ports/scheduleRepository'
import { StorageKeys } from '../storage/keys'

/**
 * 校园能力（身份 / 课表 / 校园卡）的 **Mock 实现**。
 *
 * 为什么要有一份完整的 mock（而不是"点不通就提示未实现"）：
 *   契约 §7 硬规则 4 要求"无后端也能开发"。身份、课表、校园卡三者互相咬合
 *   （未绑定 → 查不到课表/余额 → 绑定后立刻有数据），只有把这条链路**跑通**，
 *   UI 的空态、绑定态、过期态才有人验证。
 *
 * 数据是**确定性**的（同一个设备标识永远得到同一份课表/余额），
 * 并且与后端 `mock-campus-data.adapter.ts` 的口径一致，便于前后端对照排查。
 *
 * ⚠️ 这里的时间文案（`timeLabel`）在真实后端由服务端下发；
 * mock 里复制一份最简作息表，仅用于离线演示，不参与任何业务判定。
 */

const SLOT_TIMES: readonly { slot: number; start: string; end: string }[] = [
  { slot: 1, start: '08:15', end: '09:05' },
  { slot: 2, start: '09:15', end: '10:05' },
  { slot: 3, start: '10:25', end: '11:15' },
  { slot: 4, start: '11:25', end: '12:15' },
  { slot: 5, start: '13:00', end: '13:50' },
  { slot: 6, start: '14:00', end: '14:50' },
  { slot: 7, start: '15:10', end: '16:00' },
  { slot: 8, start: '16:10', end: '17:00' },
  { slot: 9, start: '18:00', end: '18:50' },
  { slot: 10, start: '19:00', end: '19:50' },
]

const COURSE_POOL: readonly {
  courseName: string
  teacher: string
  location: string
  weekday: number
  startSlot: number
  endSlot: number
}[] = [
  { courseName: '数据结构与算法', teacher: '陆明', location: '信息楼 305', weekday: 1, startSlot: 1, endSlot: 2 },
  { courseName: '线性代数', teacher: '许岚', location: '教学中心 201', weekday: 1, startSlot: 3, endSlot: 4 },
  { courseName: '机器学习导论', teacher: '沈亦航', location: '信息楼 401', weekday: 2, startSlot: 5, endSlot: 6 },
  { courseName: '普通物理学', teacher: '顾远', location: '物质楼 B102', weekday: 2, startSlot: 1, endSlot: 2 },
  { courseName: '计算机系统基础', teacher: '何知微', location: '信息楼 203', weekday: 3, startSlot: 3, endSlot: 4 },
  { courseName: '英语学术写作', teacher: '苏若谷', location: '教学中心 408', weekday: 3, startSlot: 7, endSlot: 8 },
  { courseName: '概率论与数理统计', teacher: '秦怀瑾', location: '教学中心 305', weekday: 4, startSlot: 1, endSlot: 2 },
  { courseName: '操作系统', teacher: '黄一鸣', location: '信息楼 306', weekday: 4, startSlot: 5, endSlot: 6 },
  { courseName: '生物化学实验', teacher: '陆思远', location: '生命楼 L305', weekday: 5, startSlot: 3, endSlot: 5 },
  { courseName: '体育（羽毛球）', teacher: '许子墨', location: '体育馆 2 号场', weekday: 5, startSlot: 7, endSlot: 8 },
]

const MERCHANTS: readonly { merchant: string; minFen: number; maxFen: number }[] = [
  { merchant: '第一食堂 · 二楼', minFen: 800, maxFen: 2600 },
  { merchant: '第三食堂 · 面档', minFen: 600, maxFen: 1800 },
  { merchant: '教学楼自助咖啡', minFen: 900, maxFen: 1800 },
  { merchant: '图书馆打印中心', minFen: 100, maxFen: 900 },
  { merchant: '宿舍洗衣房', minFen: 300, maxFen: 600 },
  { merchant: '校园超市', minFen: 500, maxFen: 4200 },
]

function hashOf(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

function slotTime(slot: number, edge: 'start' | 'end'): string {
  const found = SLOT_TIMES.find((item) => item.slot === slot)
  if (found === undefined) return '--:--'
  return edge === 'start' ? found.start : found.end
}

function timeLabel(startSlot: number, endSlot: number): string {
  return `${slotTime(startSlot, 'start')}–${slotTime(endSlot, 'end')}`
}

function termOf(date: Date): string {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  if (month >= 9) return `${year}-${year + 1}-1`
  if (month === 1) return `${year - 1}-${year}-1`
  return `${year - 1}-${year}-2`
}

function termLabel(term: string): string {
  const match = /^(\d{4})-(\d{4})-([12])$/.exec(term)
  return match === null ? term : `${match[1]}-${match[2]} 学年 ${match[3] === '1' ? '第一' : '第二'}学期`
}

function weekdayOf(date: Date): number {
  const day = date.getDay()
  return day === 0 ? 7 : day
}

export interface MockCampusOptions {
  cache: CachePort
  /** 当前登录用户（决定"我的"课表/流水是否可见） */
  viewerId: () => string | null
  latencyMs: number
  now: () => Date
}

export interface MockCampusRepositories {
  identity: IdentityRepository
  schedule: ScheduleRepository
  campusCard: CampusCardRepository
}

export function createMockCampusRepositories(options: MockCampusOptions): MockCampusRepositories {
  const { cache, viewerId, latencyMs, now } = options

  const delay = async (): Promise<void> => {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs))
  }

  /** 设备/用户标识：未登录时用固定演示标识，保证"未登录也能看到演示链路" */
  const identity = (): string => viewerId() ?? 'demo-device'

  const boundKey = `${StorageKeys.mockCampusBindings}:${identity()}`
  const readBound = (): CampusPlatform[] => cache.read<CampusPlatform[]>(boundKey) ?? []
  const writeBound = (platforms: CampusPlatform[]): void => {
    cache.write(boundKey, platforms)
  }

  const coursesKey = `${StorageKeys.mockCampusCourses}:${identity()}`
  const readCourses = (): typeof COURSE_POOL => cache.read<typeof COURSE_POOL>(coursesKey) ?? []
  const writeCourses = (rows: typeof COURSE_POOL): void => {
    cache.write(coursesKey, rows)
  }

  /** 绑定后按确定性规则"生成"一份课表（与后端 mock 上游口径一致） */
  const seedCourses = (): typeof COURSE_POOL => {
    const seed = hashOf(`${identity()}:schedule`)
    const shift = seed % COURSE_POOL.length
    return [...COURSE_POOL.slice(shift), ...COURSE_POOL.slice(0, shift)].slice(0, 7)
  }

  const statusOf = (platform: CampusPlatform): CampusPlatformStatus => {
    const available = readBound().includes(platform)
    return {
      platform,
      available,
      boundAt: available ? new Date(now().getTime() - 3 * 24 * 3600 * 1000).toISOString() : null,
      expiresAt: available ? new Date(now().getTime() + 4 * 24 * 3600 * 1000).toISOString() : null,
      expired: false,
      simulated: true,
    }
  }

  const identityRepository: IdentityRepository = {
    async overview(): Promise<Result<CampusOverview, never>> {
      await delay()
      return ok({ dataMode: 'mock', platforms: CAMPUS_PLATFORMS.map(statusOf) })
    },

    async identity(reveal: boolean): Promise<Result<CampusIdentityView, never>> {
      await delay()
      const seed = hashOf(`${identity()}:identity`)
      const studentId = `20${24 + (seed % 3)}${String(seed % 100000).padStart(5, '0')}`
      const surnames = ['黄', '沈', '陆', '苏', '顾', '何']
      const givens = ['一鸣', '思远', '子墨', '亦航', '知微', '雨桐']
      const departments = ['信息科学与技术学院', '生命科学与技术学院', '物质科学与技术学院']

      const realName = `${surnames[seed % surnames.length]}${givens[(seed >> 3) % givens.length]}`
      const department = departments[(seed >> 5) % departments.length] ?? departments[0]!
      const email = `${studentId}@shanghaitech.edu.cn`

      return ok({
        platform: 'EGATE',
        masked: !reveal,
        identity: reveal
          ? { studentId, realName, department, email, campus: '张江' }
          : {
              studentId: `${studentId.slice(0, 4)}*****`,
              realName: `${[...realName][0]}***`,
              department,
              email: `${email.slice(0, 1)}***${email.slice(email.indexOf('@'))}`,
              campus: '张江',
            },
        simulated: true,
        dataMode: 'mock',
        fetchedAt: now().toISOString(),
        audited: reveal,
      })
    },

    async bind(platform: CampusPlatform): Promise<Result<{ platform: CampusPlatform }, never>> {
      await delay()
      const bound = new Set(readBound())
      bound.add(platform)
      writeBound([...bound])
      if (platform === 'JWC' && readCourses().length === 0) writeCourses(seedCourses())
      return ok({ platform })
    },

    async unbind(platform: CampusPlatform): Promise<Result<{ platform: CampusPlatform }, never>> {
      await delay()
      writeBound(readBound().filter((item) => item !== platform))
      if (platform === 'JWC') cache.remove(coursesKey)
      return ok({ platform })
    },
  }

  const scheduleRepository: ScheduleRepository = {
    async today(termOverride?: string): Promise<Result<ScheduleTodayView, never>> {
      await delay()
      const term = termOverride ?? termOf(now())
      const today = weekdayOf(now())
      const all = readCourses()
      const rows = all.filter((course) => course.weekday === today)
      const nowMinutes = now().getHours() * 60 + now().getMinutes()

      const toMinutes = (slot: number, edge: 'start' | 'end'): number => {
        const [hour, minute] = slotTime(slot, edge).split(':').map(Number) as [number, number]
        return hour * 60 + minute
      }

      const views = rows.map((course, index) => ({
        id: `mock-${index}-${course.startSlot}`,
        courseName: course.courseName,
        teacher: course.teacher,
        location: course.location,
        weekday: course.weekday,
        startSlot: course.startSlot,
        endSlot: course.endSlot,
        timeLabel: timeLabel(course.startSlot, course.endSlot),
        slotLabel: `第 ${course.startSlot}-${course.endSlot} 节`,
      }))

      const ongoing = views.filter(
        (course) => nowMinutes >= toMinutes(course.startSlot, 'start') && nowMinutes <= toMinutes(course.endSlot, 'end'),
      )
      const upcoming = views
        .filter((course) => toMinutes(course.startSlot, 'start') > nowMinutes)
        .sort((left, right) => left.startSlot - right.startSlot)
      const next = upcoming[0] ?? null

      return ok({
        term,
        termLabel: termLabel(term),
        date: now().toISOString().slice(0, 10),
        weekday: today,
        weekdayLabel: WEEKDAY_LABELS[today - 1] ?? '',
        courses: views,
        ongoing,
        next,
        minutesUntilNext: next === null ? null : Math.max(0, toMinutes(next.startSlot, 'start') - nowMinutes),
        nextStartsAt: null,
        finishedForToday: ongoing.length === 0 && next === null && views.length > 0,
        conflicts: [],
        simulated: true,
        empty: views.length === 0,
      })
    },

    async week(termOverride?: string): Promise<Result<ScheduleWeekView, never>> {
      await delay()
      const term = termOverride ?? termOf(now())
      const today = weekdayOf(now())
      const all = readCourses()

      return ok({
        term,
        termLabel: termLabel(term),
        today,
        days: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          label: WEEKDAY_LABELS[weekday - 1] ?? '',
          relativeLabel: weekday === today ? '今天' : weekday === today + 1 ? '明天' : (WEEKDAY_LABELS[weekday - 1] ?? ''),
          isToday: weekday === today,
          courses: all
            .filter((course) => course.weekday === weekday)
            .map((course, index) => ({
              id: `mock-${weekday}-${index}`,
              courseName: course.courseName,
              teacher: course.teacher,
              location: course.location,
              weekday: course.weekday,
              startSlot: course.startSlot,
              endSlot: course.endSlot,
              timeLabel: timeLabel(course.startSlot, course.endSlot),
              slotLabel: `第 ${course.startSlot}-${course.endSlot} 节`,
            })),
        })),
        conflicts: [],
        totalCount: all.length,
        terms: [term],
        simulated: true,
      })
    },

    async sync(): Promise<Result<ScheduleSyncResult, never>> {
      await delay()
      const term = termOf(now())
      const rows = seedCourses()
      writeCourses(rows)
      return ok({
        term,
        termLabel: termLabel(term),
        imported: rows.length,
        conflicts: [],
        simulated: true,
        syncedAt: now().toISOString(),
      })
    },

    async createCourse(input: CreateCourseInput): Promise<Result<{ id: string }, never>> {
      await delay()
      const rows = [...readCourses(), { ...input }]
      writeCourses(rows)
      return ok({ id: `manual-${rows.length}` })
    },
  }

  const campusCardRepository: CampusCardRepository = {
    async overview(thresholdFen?: number): Promise<Result<CardOverview, never>> {
      await delay()
      const threshold = thresholdFen ?? LOW_BALANCE_THRESHOLD_FEN
      const seed = hashOf(`${identity()}:card`)
      const balanceFen = 3000 + (seed % 22000)
      const count = 12 + (seed % 4)

      let running = balanceFen
      const transactions: CardTransactionView[] = []
      for (let index = 0; index < count; index += 1) {
        const entrySeed = hashOf(`${identity()}:card:${index}`)
        const template = MERCHANTS[entrySeed % MERCHANTS.length]!
        const amountFen = template.minFen + (entrySeed % (template.maxFen - template.minFen + 1))
        const isTopUp = index === count - 1
        const happenedAt = new Date(
          now().getTime() - (index + 1) * 7 * 3600 * 1000 - (entrySeed % 3600) * 1000,
        )

        if (isTopUp) {
          transactions.push({
            id: `mock-in-${index}`,
            amountFen: 20000,
            direction: 'in',
            merchant: '校园卡充值 · 微信支付',
            happenedAt: happenedAt.toISOString(),
            balanceAfterFen: running,
            amountLabel: '+200.00',
          })
          running = Math.max(0, running - 20000)
        } else {
          transactions.push({
            id: `mock-out-${index}`,
            amountFen,
            direction: 'out',
            merchant: template.merchant,
            happenedAt: happenedAt.toISOString(),
            balanceAfterFen: running,
            amountLabel: `−${(amountFen / 100).toFixed(2)}`,
          })
          running += amountFen
        }
      }

      const outs = transactions.filter((item) => item.direction === 'out')
      const dayStart = new Date(now().getFullYear(), now().getMonth(), now().getDate()).getTime()
      const todayOuts = outs.filter((item) => new Date(item.happenedAt).getTime() >= dayStart)
      const weekOuts = outs.filter((item) => new Date(item.happenedAt).getTime() >= dayStart - 6 * 86400000)
      const weekOutFen = weekOuts.reduce((sum, item) => sum + item.amountFen, 0)
      const avgDailyOutFen = Math.round(weekOutFen / 7)

      return ok({
        platform: 'CARD',
        balanceFen,
        thresholdFen: threshold,
        lowBalance: balanceFen < threshold,
        dataAsOf: now().toISOString(),
        syncedAt: now().toISOString(),
        stale: false,
        staleReason: null,
        simulated: true,
        transactions,
        insight: {
          todayOutFen: todayOuts.reduce((sum, item) => sum + item.amountFen, 0),
          todayOutCount: todayOuts.length,
          weekOutFen,
          weekOutCount: weekOuts.length,
          avgDailyOutFen,
          estimatedDaysLeft: avgDailyOutFen <= 0 ? null : Math.ceil(balanceFen / avgDailyOutFen),
          medianOutFen: 1500,
          anomalies: [],
          topMerchants: MERCHANTS.slice(0, 3).map((item) => ({
            merchant: item.merchant,
            totalFen: item.maxFen,
            count: 2,
          })),
        },
      })
    },

    async lostReport(reason?: string): Promise<Result<CardLostReport, never>> {
      await delay()
      return ok({
        accepted: true,
        note: `可达鸭不会、也无法替你挂失（${reason ?? '未填写原因'}）—— 校园卡挂失需要在校园卡系统完成。`,
        steps: [
          '立即在校园卡自助终端或官方渠道办理挂失（冻结卡片）',
          '回忆最后一次刷卡地点，联系该处管理人员登记',
          '挂失 24 小时后仍不放心，可到校园卡服务中心补办并核对流水',
        ],
        channels: [
          { name: '校园卡服务中心', detail: '工作日 08:30–17:00' },
          { name: '校园卡自助终端', detail: '各食堂入口一般都有，24 小时可自助挂失' },
        ],
        audited: true,
      })
    },
  }

  return { identity: identityRepository, schedule: scheduleRepository, campusCard: campusCardRepository }
}

/** 供页面判定"是否已绑定某校园系统"的统一入口（mock 模式下从缓存读） */
export function mockBoundPlatforms(options: MockCampusOptions): CampusPlatform[] {
  return options.cache.read<CampusPlatform[]>(`${StorageKeys.mockCampusBindings}:${options.viewerId() ?? 'demo-device'}`) ?? []
}

/** 让页面测试能够复用同一套确定性数据 */
export function mockNotImplemented(code: string) {
  return err({ code: 'NETWORK', message: `mock 未实现：${code}` } as never)
}
