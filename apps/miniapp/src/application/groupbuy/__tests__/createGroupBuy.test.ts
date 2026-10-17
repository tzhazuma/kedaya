import { describe, expect, it } from 'vitest'

import { createCreateGroupBuyUseCase, validateGroupBuyDraft } from '../createGroupBuy'
import type { GroupBuyDraft } from '../createGroupBuy'
import { GROUP_BUY_DEADLINE_PRESETS } from '../../../domain/models/groupbuy'
import type { GroupBuy } from '../../../domain/models/groupbuy'
import type { RepositoryError } from '../../../domain/ports/errors'
import type {
  CreateGroupBuyInput,
  GroupBuyPage,
  GroupBuyRepository,
  JoinGroupBuyInput,
} from '../../../domain/ports/groupbuyRepository'
import type { SessionStorePort } from '../../../domain/ports/sessionPort'
import type { Result } from '@kedaya/shared'

/**
 * 「发起拼单」用例测试。
 *
 * 这里守住两条最容易被改坏的东西：
 *   1. **客户端校验与服务端规则一致**（否则用户在本地过了校验、到服务端才被打回，
 *      弱网下体验极差，而且错误信息还看不到具体字段）；
 *   2. **归属只能来自会话**：请求体里没有任何办法指定发起人 —— 拿不到会话就直接拒绝，
 *      不发出注定 403/401 的请求。
 */

const NOW = new Date('2026-10-17T06:00:00.000Z')

function createFakeSession(profileId: string | null, nickname = '测试同学'): SessionStorePort {
  return {
    getSnapshot: () => ({
      tokens:
        profileId === null
          ? null
          : { accessToken: 'a', refreshToken: 'r', expiresAt: '2026-10-18T00:00:00.000Z' },
      profile:
        profileId === null
          ? null
          : {
              id: profileId,
              nickname,
              email: 'demo@kedaya.dev',
              avatarUrl: null,
              studentId: null,
              college: null,
              campusBound: false,
            },
    }),
    setTokens: () => undefined,
    setProfile: () => undefined,
    clear: () => undefined,
    subscribe: () => () => undefined,
    hydrate: () => undefined,
  } as unknown as SessionStorePort
}

interface FakeRepo extends GroupBuyRepository {
  created: CreateGroupBuyInput[]
}

function createFakeRepository(): FakeRepo {
  const repo: FakeRepo = {
    created: [],
    async list(): Promise<Result<GroupBuyPage, RepositoryError>> {
      return { ok: true, value: { items: [], nextCursor: null } }
    },
    async detail(): Promise<Result<GroupBuy, RepositoryError>> {
      return { ok: false, error: { code: 'NOT_FOUND', message: '未实现' } }
    },
    async create(input: CreateGroupBuyInput): Promise<Result<GroupBuy, RepositoryError>> {
      repo.created.push(input)
      return {
        ok: true,
        value: {
          id: 'gb-new-1',
          title: input.title,
          description: input.description ?? '',
          category: input.category,
          initiatorId: input.initiatorId ?? 'unknown',
          initiatorName: input.initiatorName ?? '我',
          priceFen: input.priceFen,
          targetCount: input.targetCount,
          participants: [],
          deadline: input.deadline,
          pickupPlace: input.pickupPlace ?? '',
          status: 'open',
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        },
      }
    },
    async join(_id: string, _input: JoinGroupBuyInput): Promise<Result<GroupBuy, RepositoryError>> {
      return { ok: false, error: { code: 'INTERNAL', message: '未实现' } }
    },
  }
  return repo
}

const VALID_DRAFT: GroupBuyDraft = {
  title: '瑞幸咖啡券拼单',
  description: '四张券凑单，取货在校门口',
  category: 'drink',
  targetCount: 4,
  priceFen: 1250,
  deadlineIso: '2026-10-18T06:00:00.000Z',
  pickupPlace: '一号门',
}

describe('validateGroupBuyDraft', () => {
  it('合法草稿没有任何问题', () => {
    expect(validateGroupBuyDraft(VALID_DRAFT, NOW)).toEqual([])
  })

  it('标题/分类/份数/单价/截止时间都会拦下来', () => {
    const problems = validateGroupBuyDraft(
      {
        ...VALID_DRAFT,
        title: '   ',
        category: 'not-a-category',
        targetCount: 1,
        priceFen: -1,
        deadlineIso: '2026-10-16T06:00:00.000Z',
      },
      NOW,
    )
    expect(problems).toContain('请填写拼单标题')
    expect(problems).toContain('请选择分类')
    expect(problems).toContain('成团份数至少 2 份')
    expect(problems).toContain('单价不能是负数')
    expect(problems).toContain('截止时间必须晚于现在')
  })

  it('到期时间恰好等于现在也算非法（服务端就是这么判的）', () => {
    expect(
      validateGroupBuyDraft({ ...VALID_DRAFT, deadlineIso: NOW.toISOString() }, NOW),
    ).toContain('截止时间必须晚于现在')
  })

  it('成团份数上限与服务端一致（99）', () => {
    expect(validateGroupBuyDraft({ ...VALID_DRAFT, targetCount: 100 }, NOW)).toContain(
      '成团份数最多 99 份',
    )
  })
})

describe('createCreateGroupBuyUseCase', () => {
  it('未登录直接拒绝，且**不发请求**', async () => {
    const repository = createFakeRepository()
    const useCase = createCreateGroupBuyUseCase({
      repository,
      session: createFakeSession(null),
      clock: { now: () => NOW },
    })

    const result = await useCase.create(VALID_DRAFT)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error.code).toBe('UNAUTHENTICATED')
    expect(repository.created).toHaveLength(0)
  })

  it('发起人来自会话，草稿里填什么都不影响归属', async () => {
    const repository = createFakeRepository()
    const useCase = createCreateGroupBuyUseCase({
      repository,
      session: createFakeSession('u-me', '可达鸭测试号'),
      clock: { now: () => NOW },
    })

    const result = await useCase.create(VALID_DRAFT)
    expect(result.ok).toBe(true)
    expect(repository.created).toHaveLength(1)
    expect(repository.created[0]?.initiatorId).toBe('u-me')
    expect(repository.created[0]?.initiatorName).toBe('可达鸭测试号')
    // 返回的富视图可以直接给详情页用
    expect(result.ok ? result.value.summary.initiatorName : '').toBe('可达鸭测试号')
  })

  it('本地校验不通过时拒绝，并且不发请求', async () => {
    const repository = createFakeRepository()
    const useCase = createCreateGroupBuyUseCase({
      repository,
      session: createFakeSession('u-me'),
      clock: { now: () => NOW },
    })

    const result = await useCase.create({ ...VALID_DRAFT, targetCount: 1 })
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error.code).toBe('VALIDATION_FAILED')
    expect(repository.created).toHaveLength(0)
  })

  it('空说明 / 空取货地点传 null，而不是空字符串（服务端字段是可空）', async () => {
    const repository = createFakeRepository()
    const useCase = createCreateGroupBuyUseCase({
      repository,
      session: createFakeSession('u-me'),
      clock: { now: () => NOW },
    })

    await useCase.create({ ...VALID_DRAFT, description: '  ', pickupPlace: '' })
    expect(repository.created[0]?.description).toBeNull()
    expect(repository.created[0]?.pickupPlace).toBeNull()
  })

  it('创建成功后回调装配层的 onCreated（列表缓存要作废）', async () => {
    const repository = createFakeRepository()
    let createdCalls = 0
    const useCase = createCreateGroupBuyUseCase({
      repository,
      session: createFakeSession('u-me'),
      clock: { now: () => NOW },
      onCreated: () => {
        createdCalls += 1
      },
    })

    await useCase.create(VALID_DRAFT)
    expect(createdCalls).toBe(1)
  })
})

describe('截止时间预设', () => {
  it('预设都是正偏移 —— 相对时间天然不会选中过去', () => {
    expect(GROUP_BUY_DEADLINE_PRESETS.length).toBeGreaterThan(0)
    for (const preset of GROUP_BUY_DEADLINE_PRESETS) {
      expect(preset.offsetMinutes).toBeGreaterThan(0)
    }
  })
})
