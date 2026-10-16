import { err, ok, type Result } from '@kedaya/shared'

import {
  BUDDY_ACTIVITIES,
  BUDDY_SECTIONS,
  activeBuddyTags,
  BUDDY_TAG_LIMITS,
  EMPTY_BUDDY_POST_DRAFT,
  parseShanghaiLocal,
  sectionOf,
  validateBuddyPostDraft,
  validateTagKeys,
} from '../../domain/models/buddy'
import type {
  BuddyActivity,
  BuddyPostDraft,
  BuddyPostDraftError,
  BuddySection,
  BuddyTag,
} from '../../domain/models/buddy'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { BuddyRepository } from '../../domain/ports/buddyRepository'
import type { SessionStorePort } from '../../domain/ports/sessionPort'
import { createIdempotencyKey } from '../idempotency'

/**
 * 发布搭子用例（规格 §5.4）。
 *
 * ⚠️ **本用例最重要的一条约束：标签必须来自服务端的封闭标签表**
 * （规格 §3.2）。自由文本会让「羽毛球」/「打羽毛球」/「badminton」互不匹配，
 * 而「共同标签数」是本模块最精确、最可解释的匹配特征 —— 一旦被自由文本污染就彻底失效。
 *
 * 因此：
 * - 页面**只能**从 `loadTags()` 拿到的表里选（chips，没有自由输入框）；
 * - [addTagByText] 是唯一能"输入"标签的入口，它对每个 key 调
 *   `validateTagKeys()` —— 未登记的字符串被**拒绝**并给出中文原因；
 * - `submit()` 再校验一次（纵深防御：UI 可以被绕过，用例不能）。
 *
 * 标签表来自 `GET /api/v1/buddy/tags`（契约 §11.11 的附属集合形状，
 * **不需要**登记动作名）。拉取失败时保留上次缓存 / 空表，并如实提示，
 * **绝不**退化成自由输入。
 */

export type CreateBuddyStatus = 'editing' | 'loading' | 'submitting' | 'submitted' | 'error'

export interface CreateBuddyState {
  status: CreateBuddyStatus
  /** 服务端封闭标签表（仅 `isActive`） */
  tags: BuddyTag[]
  tagsLoading: boolean
  /** 标签表拉取失败的文案（不影响已缓存的标签） */
  tagsError: string | null
  draft: BuddyPostDraft
  /** 上一次校验的错误（空数组 = 通过） */
  errors: BuddyPostDraftError[]
  /** 标签相关的即时错误（自由文本被拒的提示落在这里） */
  tagError: string | null
  /** 提交失败的文案 */
  error: string | null
  /** 提交成功后的记录 id */
  submittedId: string | null
}

export interface CreateBuddyPostDeps {
  repository: BuddyRepository
  session: SessionStorePort
  clock: ClockPort
}

export interface CreateBuddyPostUseCase {
  getSnapshot(): CreateBuddyState
  subscribe(listener: () => void): () => void
  loadTags(): Promise<CreateBuddyState>
  setActivity(activity: BuddyActivity): CreateBuddyState
  setSection(section: BuddySection): CreateBuddyState
  setTitle(title: string): CreateBuddyState
  setDescription(description: string): CreateBuddyState
  setLocation(location: string): CreateBuddyState
  setStartDate(date: string): CreateBuddyState
  setStartTime(time: string): CreateBuddyState
  setDuration(durationMin: number): CreateBuddyState
  setCapacity(capacity: number): CreateBuddyState
  setGenderPreference(preference: BuddyPostDraft['genderPreference']): CreateBuddyState
  setMinSkillLevel(level: BuddyPostDraft['minSkillLevel']): CreateBuddyState
  /** 按标签 key 切换选中（来自标签表，永远合法） */
  toggleTag(key: string): CreateBuddyState
  /**
   * 按**文本**添加标签 —— 唯一能"输入"标签的入口。
   * 未登记的字符串会被拒绝（这就是「自由文本被拒」的落点）。
   */
  addTagByText(raw: string): CreateBuddyState
  removeTag(key: string): CreateBuddyState
  submit(): Promise<Result<string, RepositoryError>>
  reset(): CreateBuddyState
}

const INITIAL_STATE: CreateBuddyState = {
  status: 'editing',
  tags: [],
  tagsLoading: false,
  tagsError: null,
  draft: EMPTY_BUDDY_POST_DRAFT,
  errors: [],
  tagError: null,
  error: null,
  submittedId: null,
}

export function createCreateBuddyPostUseCase(deps: CreateBuddyPostDeps): CreateBuddyPostUseCase {
  const { repository, session, clock } = deps

  let state: CreateBuddyState = INITIAL_STATE
  /** 提交的幂等键：同一次表单内容复用同一个 key（弱网重试不会重复发帖） */
  let submitKey: string | null = null
  const listeners = new Set<() => void>()

  function patch(next: Partial<CreateBuddyState>): CreateBuddyState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function patchDraft(next: Partial<BuddyPostDraft>): CreateBuddyState {
    // 内容变了 → 幂等键必须换（否则改完再提交会命中旧 key 被服务端拒绝）
    submitKey = null
    return patch({
      draft: { ...state.draft, ...next },
      errors: [],
      tagError: null,
      error: null,
    })
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    async loadTags(): Promise<CreateBuddyState> {
      patch({ tagsLoading: true, tagsError: null })
      const result = await repository.listTags()
      if (!result.ok) {
        /**
         * ⚠️ **回落到本端镜像，而不是把标签列表清空。**
         *
         * 服务端当前**没有** `GET /buddy/tags`（见交付说明的跨端缺口），
         * 真后端模式下这里必然失败。镜像就是服务端权威表的逐字副本，
         * 用它选出来的 key 服务端一定认 —— 因此"拉不到表"不应该让用户
         * 连标签都选不了，更**绝不**能退化成自由输入框。
         */
        return patch({
          tagsLoading: false,
          tags: activeBuddyTags(),
          tagsError: `${result.error.message}（已回落到内置的封闭标签表，仍然不允许自由输入）`,
        })
      }
      return patch({ tagsLoading: false, tags: result.value, tagsError: null })
    },

    setActivity(activity) {
      return patchDraft({
        activity,
        // 换活动类型后，原先的「运动水平要求」可能不再适用（仅 sport 有意义）
        minSkillLevel: sectionOf(activity) === 'sport' ? state.draft.minSkillLevel : null,
      })
    },

    setSection(section) {
      // 板块由 activity 派生（规格 §2.3）—— 切板块就是切到一个属于该板块的活动类型
      const next = BUDDY_ACTIVITIES.find((a) => sectionOf(a) === section)
      return next === undefined ? state : patchDraft({ activity: next, minSkillLevel: null })
    },

    setTitle(title) {
      return patchDraft({ title })
    },

    setDescription(description) {
      return patchDraft({ description })
    },

    setLocation(location) {
      return patchDraft({ location })
    },

    setStartDate(date) {
      const time = state.draft.startsAtLocal.slice(11) || '19:00'
      return patchDraft({ startsAtLocal: `${date}T${time}` })
    },

    setStartTime(time) {
      const date = state.draft.startsAtLocal.slice(0, 10)
      return patchDraft({ startsAtLocal: date === '' ? '' : `${date}T${time}` })
    },

    setDuration(durationMin) {
      return patchDraft({ durationMin })
    },

    setCapacity(capacity) {
      return patchDraft({ capacity })
    },

    setGenderPreference(genderPreference) {
      return patchDraft({ genderPreference })
    },

    setMinSkillLevel(minSkillLevel) {
      return patchDraft({
        minSkillLevel: sectionOf(state.draft.activity) === 'sport' ? minSkillLevel : null,
      })
    },

    toggleTag(key) {
      const selected = state.draft.tags
      if (selected.includes(key)) {
        return patchDraft({ tags: selected.filter((t) => t !== key) })
      }
      const check = validateTagKeys([...selected, key], BUDDY_TAG_LIMITS.postTags)
      if (!check.ok) {
        return patch({ tagError: check.error.message, error: null })
      }
      return patchDraft({ tags: check.value })
    },

    addTagByText(raw) {
      // ⚠️ 封闭标签校验 —— 自由文本在这里被拒（规格 §3.2）
      const check = validateTagKeys([...state.draft.tags, raw], BUDDY_TAG_LIMITS.postTags)
      if (!check.ok) {
        return patch({
          tagError: check.error.message ?? '标签不合法',
          errors: [],
          error: null,
        })
      }
      return patchDraft({ tags: check.value })
    },

    removeTag(key) {
      return patchDraft({ tags: state.draft.tags.filter((t) => t !== key) })
    },

    async submit(): Promise<Result<string, RepositoryError>> {
      const profile = session.getSnapshot().profile
      if (profile === null) {
        const error: RepositoryError = { code: 'UNAUTHENTICATED', message: '请先登录后再发布' }
        patch({ status: 'editing', error: error.message })
        return err(error)
      }

      const now = clock.now()
      const errors = validateBuddyPostDraft(state.draft, now)
      if (errors.length > 0) {
        patch({ status: 'editing', errors, error: errors[0]?.message ?? '表单校验未通过' })
        return err({
          code: 'VALIDATION_FAILED',
          message: errors[0]?.message ?? '表单校验未通过',
          details: { field: errors[0]?.field ?? 'unknown' },
        })
      }

      const startsAt = parseShanghaiLocal({
        date: state.draft.startsAtLocal.slice(0, 10),
        time: state.draft.startsAtLocal.slice(11),
      })
      /* c8 ignore next 3 -- 上面的 validateBuddyPostDraft 已经保证可解析 */
      if (startsAt === null) {
        return err({ code: 'VALIDATION_FAILED', message: '活动时间格式不正确' })
      }

      patch({ status: 'submitting', errors: [], error: null })

      submitKey = submitKey ?? createIdempotencyKey('buddy-create', now)
      const created = await repository.createItem(
        {
          activity: state.draft.activity,
          title: state.draft.title.trim(),
          description: state.draft.description.trim() === '' ? null : state.draft.description.trim(),
          location: state.draft.location,
          startsAt: startsAt.toISOString(),
          durationMin: state.draft.durationMin,
          capacity: state.draft.capacity,
          genderPreference: state.draft.genderPreference,
          tags: state.draft.tags,
          minSkillLevel:
            sectionOf(state.draft.activity) === 'sport' ? state.draft.minSkillLevel : null,
        },
        submitKey,
      )

      if (!created.ok) {
        patch({ status: 'error', error: created.error.message })
        return err(created.error)
      }

      patch({ status: 'submitted', submittedId: created.value.id, error: null })
      return ok(created.value.id)
    },

    reset(): CreateBuddyState {
      submitKey = null
      state = { ...INITIAL_STATE, tags: state.tags }
      for (const listener of listeners) listener()
      return state
    },
  }
}

/** 三板块的发布入口（页面用；避免在组件里硬编码板块清单） */
export const BUDDY_CREATE_SECTIONS: readonly BuddySection[] = BUDDY_SECTIONS
