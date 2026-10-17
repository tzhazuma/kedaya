import { err, ok, type Result } from '@kedaya/shared'
import type { Page } from '@kedaya/contracts'

import {
  answerProblem,
  categoryProblem,
  normalizeTags,
  questionProblem,
  tagsProblem,
} from '../../domain/models/faq'
import type { CreateFaqEntryInput, FaqEntry } from '../../domain/models/faq'
import type { RepositoryError } from '../../domain/ports/errors'
import type { FaqRepository, ListFaqEntriesQuery } from '../../domain/ports/faqRepository'

/**
 * Mock 常见问题仓储（`TARO_APP_USE_MOCK !== 'false'` 时启用）。
 *
 * 与「假列表」不同，它复刻了后端 `FaqEntryService` + `faq.repository.ts` 的行为：
 *   · 筛选：`category` 精确匹配、`keyword` 同时命中 question 与 answer（大小写不敏感）；
 *   · 排序：`createdAt desc` + `id desc`（与 `buildOrderBy` 同形，游标才不漏读）；
 *   · 分页：游标 = 上一条 id，多取一条判断还有没有下一页；
 *   · 校验：与客户端表单**共用** `domain/models/faq.ts` 的同一批纯函数
 *     （引用关系与 `mockLostFoundRepository` 一致，避免两处规则各自漂移）；
 *   · 「有帮助」是**无脑 +1**，条目不存在返回 NOT_FOUND（不凭空造计数）。
 *
 * 数据集刻意放在**内存**而不是 `CachePort`：
 * FAQ 是「读为主」的共享知识库，演示用的 12 条问答只在 mock 模式下存在，
 * 一旦写进用户本地存储，切到真后端时它会和真实问答混在一起、且界面上
 * 没有清理入口（拼单/失物招领的本地数据有「重置演示数据」按钮兜底）。
 * 代价是：mock 模式下自助新增的条目在重开小程序后消失 —— 这一点在
 * 列表页的「演示数据」说明里如实告知，不假装已经落库。
 */

export interface MockFaqRepositoryOptions {
  latencyMs?: number
  now?: () => Date
}

export interface MockFaqRepository extends FaqRepository {
  readonly kind: 'mock'
  reset(): void
  /** 让接下来 N 次请求失败（页面用它演示错误态，而不是硬编码假状态） */
  failNextRequests(times: number): void
  /** 清空数据集（演示空态）；`reset()` 之后仍能恢复种子 */
  clearAll(): void
  /** 仅供测试 / 演示：直接替换数据集，保证用例确定可复现 */
  seed(items: readonly FaqEntry[]): void
}

const MINUTE = 60_000

/** 「有帮助」的种子计数：让它看起来像真实累积，而不是清一色 0 */
function seedHelpfulCount(index: number): number {
  const values = [46, 38, 33, 27, 22, 18, 15, 11, 8, 6, 4, 2]
  return values[index % values.length] ?? 0
}

/**
 * 确定性种子：12 条**有信息量**的校园问答（一卡通、选课、报修、快递、
 * 图书馆、校园网、学生证…）。答案给的是可执行的步骤与渠道，不是
 * 「请咨询相关老师」这类空话 —— 演示时用户能真的搜到一个答案。
 *
 * 时间按「相对现在」推算（index 越大越旧），因此列表首屏永远看得出
 * 「最新在前」的顺序，不会因为时间流逝全变成「3 年前」。
 */
function defaultSeed(now: Date): FaqEntry[] {
  const at = (minutesAgo: number): string => new Date(now.getTime() - minutesAgo * MINUTE).toISOString()

  const drafts: ReadonlyArray<{
    id: string
    question: string
    answer: string
    category: string
    tags: readonly string[]
  }> = [
    {
      id: 'faq-demo-01',
      question: '一卡通（校园卡）丢了怎么补办？',
      answer:
        '先在「校园卡」页点挂失，或到学生服务中心一卡通窗口现场挂失，挂失后原卡立即停止消费。补办要本人带学生证或身份证到学生服务中心一卡通窗口办理，工本费现场缴纳，一般当天可取，开学高峰期可能要次日。新卡启用后原卡余额会在 1–2 个工作日内转入，期间可以先用校园卡页的付款码消费。',
      category: 'campus-card',
      tags: ['校园卡', '补办', '挂失'],
    },
    {
      id: 'faq-demo-02',
      question: '什么时候选课？选课时间在哪里看？',
      answer:
        '一学期通常分三轮：预选、正选（开学前）与补退选（开学后前两周，可自由加退课）。具体日期由教务处每学期公布，教务系统首页与院系通知里都会贴。补退选结束之后再改课就要任课老师和院系签字，会麻烦很多，尽量在前两轮定下来。选课人数超额的课按志愿或抽签处理，结果在教务系统里查。',
      category: 'schedule',
      tags: ['选课', '教务', '时间'],
    },
    {
      id: 'faq-demo-03',
      question: '宿舍东西坏了怎么报修？',
      answer:
        '在宿舍楼一楼值班室登记，或走后勤报修渠道，写清楼栋、房间号、故障描述和可上门时间。漏水、跳闸、停水这类属于急修，一般当天处理；家具、门窗、网口属于普通维修，通常 1–2 个工作日。维修师傅上门前会先打电话，留一个能接通的号码；上课时间没人在房间，可以和宿管约一个时间。',
      category: 'dorm',
      tags: ['宿舍', '报修', '后勤'],
    },
    {
      id: 'faq-demo-04',
      question: '快递在校内哪里取？',
      answer:
        '快递按承运商分流：主流快递送到生活区的快递驿站或快递柜，凭取件码自取，驿站营业时间大约是 08:00–20:00（周末会缩短）。大件和冷链通常放在驿站门口，需要在 24–48 小时内取走，超时可能被退回。收货地址写「校区 + 宿舍楼 + 手机号」就够，快递员一般只送到驿站，不上楼。',
      category: 'dorm',
      tags: ['快递', '生活区'],
    },
    {
      id: 'faq-demo-05',
      question: '图书馆几点开门？',
      answer:
        '学期内工作日 08:00–22:00，周末 09:00–21:00；期末周和考试周通常会延长，以图书馆入口公告为准。法定节假日一般闭馆或只开放自习区，闭馆前一天会在门口贴通知。进馆刷校园卡，校外人员需要登记。图书借期 30 天、可续借两次，逾期会产生滞纳金，还书时在自助机上结算。',
      category: 'library',
      tags: ['图书馆', '开馆时间', '借书'],
    },
    {
      id: 'faq-demo-06',
      question: '校园网认证失败怎么办？',
      answer:
        '先确认连的是校园 SSID（宿舍和教学楼的信号名不一样），再确认账号是学号、密码是校园网密码（和统一身份认证密码不是同一个，最容易混）。常见的三类失败：密码错太多次被临时锁定（等一会儿或去网络中心重置）、同一账号在线设备数超限（先在旧设备上下线）、账号未激活或已停用。还是连不上就带上设备去网络中心，直接报页面上的错误文案，比截图更快定位。',
      category: 'network',
      tags: ['校园网', '认证', '上网'],
    },
    {
      id: 'faq-demo-07',
      question: '学生证丢了怎么补办？',
      answer:
        '先到学院教务员处开补办申请（说明丢失经过），再带一寸照片和身份证到教务处学籍科办理，工本费现场缴纳，一般 3–5 个工作日可取。补办期间要证明在校身份，可以先用教务系统里自行打印的在学证明顶一下。学生证上的火车票优惠卡需要重新录入，和补办一起办掉，不然假期买学生票会卡住。',
      category: 'schedule',
      tags: ['学生证', '补办', '学籍'],
    },
    {
      id: 'faq-demo-08',
      question: '成绩单怎么打印？',
      answer:
        '中英文成绩单可以在教务处的自助打印机上刷校园卡打印，在读生按张收费。需要盖章的密封件要去学籍科窗口办理，一般当场可取。保研、留学申请经常要求由教务处直接寄送，自己拆封过的密封件可能不被认可，寄送前先问清对方学校的要求。',
      category: 'schedule',
      tags: ['成绩单', '教务', '证明'],
    },
    {
      id: 'faq-demo-09',
      question: '怎么找空教室自习？',
      answer:
        '教学楼每层电梯口会贴当天的教室使用表，也可以按自己的课表反推空档。自习高峰是工作日晚上 18:00–21:00 和考试周全天，一楼大教室最先被占满，楼上小教室反而容易有空位。图书馆自习区在期末会延长开放，具体时间看公告；占座不要超过一节课，管理员会清桌。',
      category: 'library',
      tags: ['自习', '空教室', '考试周'],
    },
    {
      id: 'faq-demo-10',
      question: '校园卡余额不足，去哪里充值？',
      answer:
        '三种方式：宿舍楼下的自助圈存机（银行卡转校园卡，工作日实时到账）、校内支付渠道里的校园卡服务号（需先绑定学号，几分钟到账）、学生服务中心一卡通窗口（现金或刷卡，只在工作时间）。线上充值时如果提示「未绑定」，说明一卡通账号还没和支付账号关联，需要先去窗口绑一次，之后就能一直线上充。',
      category: 'campus-card',
      tags: ['校园卡', '充值', '余额'],
    },
    {
      id: 'faq-demo-11',
      question: '缓考和免听怎么申请？',
      answer:
        '缓考：考试前因病因事参加不了，先跟任课老师报备，再在教务系统提交缓考申请并附证明（医院证明要盖公章），由院系审批；批准后一般安排在下学期初补考。免听：已经掌握课程内容可以申请免听，需要任课老师同意，但仍然要参加期末考核。两件事都有截止时间，别拖到考前一天才提交。',
      category: 'schedule',
      tags: ['缓考', '免听', '教务'],
    },
    {
      id: 'faq-demo-12',
      question: '统一身份认证密码忘了怎么办？',
      answer:
        '在统一身份认证登录页点「忘记密码」，用绑定的手机号或邮箱收验证码重置。没绑定、或者手机号已经换掉，就要带学生证到信息办窗口重置。新密码有复杂度要求（长度 8 位以上，含大小写或数字），改完大约 1 分钟后才会同步到教务、校园网等对接系统，这一分钟内登录失败是正常的。不要在学校公共电脑上勾「记住密码」。',
      category: 'auth',
      tags: ['密码', '登录', '统一身份'],
    },
  ]

  return drafts.map((draft, index) => {
    const stamp = at(45 + index * 220)
    return {
      ...draft,
      tags: [...draft.tags],
      helpfulCount: seedHelpfulCount(index),
      createdAt: stamp,
      updatedAt: stamp,
    }
  })
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** 与后端 `createSchema` 同一套校验顺序：问题 → 答案 → 分类 → 标签 */
function validateCreate(input: CreateFaqEntryInput): RepositoryError | null {
  const question = questionProblem(input.question)
  if (question !== null) {
    return { code: 'VALIDATION_FAILED', message: question, details: { field: 'question' } }
  }

  const answer = answerProblem(input.answer)
  if (answer !== null) {
    return { code: 'VALIDATION_FAILED', message: answer, details: { field: 'answer' } }
  }

  /**
   * 分类走**白名单**：真实后端目前只校验长度（见报告里的遗留问题），
   * 这里跟客户端表单同规则，是为了让「mock 里点不出来」提前暴露
   * 白名单漂移，而不是等切到真后端才写进去一个筛选不到的脏分类。
   */
  const category = categoryProblem(input.category)
  if (category !== null) {
    return { code: 'VALIDATION_FAILED', message: category, details: { field: 'category' } }
  }

  const tags = tagsProblem(normalizeTags(input.tags ?? []))
  if (tags !== null) {
    return { code: 'VALIDATION_FAILED', message: tags, details: { field: 'tags' } }
  }

  return null
}

export function createMockFaqRepository(options: MockFaqRepositoryOptions = {}): MockFaqRepository {
  const now = options.now ?? ((): Date => new Date())
  const latencyMs = options.latencyMs ?? 180
  let rows: FaqEntry[] = defaultSeed(now())
  let remainingFailures = 0

  async function guard<T>(work: () => Result<T, RepositoryError>): Promise<Result<T, RepositoryError>> {
    await delay(latencyMs)
    if (remainingFailures > 0) {
      remainingFailures -= 1
      return err({ code: 'UPSTREAM_UNAVAILABLE', message: '（演示）模拟服务端不可用' })
    }
    return work()
  }

  /** 「最新在前」必须带 id 兜底，否则同一毫秒的两条在游标分页里会跳项 */
  function sortNewestFirst(items: readonly FaqEntry[]): FaqEntry[] {
    return [...items].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    )
  }

  return {
    kind: 'mock',

    list(query: ListFaqEntriesQuery): Promise<Result<Page<FaqEntry>, RepositoryError>> {
      return guard(() => {
        let items = sortNewestFirst(rows)

        const { category, keyword } = query.filters
        if (category !== undefined && category.length > 0) {
          items = items.filter((item) => item.category === category)
        }
        if (keyword !== undefined && keyword.trim() !== '') {
          const needle = keyword.trim().toLowerCase()
          items = items.filter(
            (item) =>
              item.question.toLowerCase().includes(needle) ||
              item.answer.toLowerCase().includes(needle),
          )
        }

        const limit = query.limit ?? 20
        const start =
          query.cursor === null
            ? 0
            : Math.max(0, items.findIndex((item) => item.id === query.cursor) + 1)
        const visible = items.slice(start, start + limit)
        const hasMore = start + limit < items.length

        return ok({
          items: visible,
          nextCursor: hasMore ? (visible.at(-1)?.id ?? null) : null,
        })
      })
    },

    detail(id: string): Promise<Result<FaqEntry, RepositoryError>> {
      return guard(() => {
        const found = rows.find((item) => item.id === id) ?? null
        // 文案与后端 CrudService 的 `${resourceName}不存在或已被删除` 一致
        if (found === null) return err({ code: 'NOT_FOUND', message: '常见问题不存在或已被删除' })
        return ok(found)
      })
    },

    create(input: CreateFaqEntryInput): Promise<Result<FaqEntry, RepositoryError>> {
      return guard(() => {
        const problem = validateCreate(input)
        if (problem !== null) return err(problem)

        const timestamp = now().toISOString()
        const entry: FaqEntry = {
          id: `faq-local-${String(now().getTime())}-${Math.random().toString(36).slice(2, 7)}`,
          question: input.question.trim(),
          answer: input.answer.trim(),
          category: input.category.trim(),
          tags: normalizeTags(input.tags ?? []),
          // 与服务端 `@default(0)` 一致：计数只能由 markHelpful 增加
          helpfulCount: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        rows = [entry, ...rows]
        return ok(entry)
      })
    },

    markHelpful(id: string): Promise<Result<FaqEntry, RepositoryError>> {
      return guard(() => {
        const found = rows.find((item) => item.id === id) ?? null
        if (found === null) return err({ code: 'NOT_FOUND', message: '常见问题不存在或已被删除' })

        // 无脑 +1（不是幂等票）：与后端 `{ increment: 1 }` 同语义
        const next: FaqEntry = {
          ...found,
          helpfulCount: found.helpfulCount + 1,
          // Prisma 的 @updatedAt 会在自增时顺带刷新
          updatedAt: now().toISOString(),
        }
        rows = rows.map((item) => (item.id === id ? next : item))
        return ok(next)
      })
    },

    reset(): void {
      remainingFailures = 0
      rows = defaultSeed(now())
    },

    failNextRequests(times: number): void {
      remainingFailures = Math.max(0, Math.floor(times))
    },

    clearAll(): void {
      rows = []
    },

    seed(items: readonly FaqEntry[]): void {
      rows = [...items]
    },
  }
}
