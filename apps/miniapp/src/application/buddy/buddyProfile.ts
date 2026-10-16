import { err, ok, type Result } from '@kedaya/shared'

import {
  BUDDY_BIO_MAX,
  BUDDY_SECTIONS,
  activeBuddyTags,
  BUDDY_TAG_LIMITS,
  PREFERRED_AREA_LIMIT,
  emptyBuddyProfile,
  normalizeAvailability,
  normalizeBuddyProfile,
  validateBuddyProfile,
  validateTagKeys,
} from '../../domain/models/buddy'
import type {
  BuddyAvailabilitySlot,
  BuddyProfile,
  BuddyProfileError,
  BuddySection,
  BuddySkillLevel,
  BuddyTag,
} from '../../domain/models/buddy'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { BuddyRepository } from '../../domain/ports/buddyRepository'
import type { SessionStorePort } from '../../domain/ports/sessionPort'
import { createIdempotencyKey } from '../idempotency'

/**
 * 「我的匹配资料」（`BuddyProfile`）用例 —— 规格 §2.2 / §6.3。
 *
 * 这是 F7 硬过滤（可用时段）与三板块规则分的**唯一数据来源**：
 * 用户必须能真的填「周几 + 起止时间」，否则推荐会退化成纯时间排序。
 *
 * 隐私要点（规格 §6.3，全部落在这里）：
 * - `matchEnabled` **默认关闭**（`emptyBuddyProfile` 即 `false`）；
 * - [withdraw] 调用 `DELETE /buddy/profile`，硬删该行（含 embedding），
 *   服务端会立即把用户移出推荐池；
 * - 资料**不对任何人展示**，页面必须同时渲染 `BUDDY_PRIVACY_NOTICE`。
 *
 * 校验在 domain（`validateBuddyProfile`），页面只展示错误 —— 规则只写一次。
 */

export type BuddyProfileStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface BuddyProfileState {
  status: BuddyProfileStatus
  profile: BuddyProfile
  /** 服务端封闭标签表（资料页的兴趣/活动标签也**必须**从这里选） */
  tags: BuddyTag[]
  tagsLoading: boolean
  tagsError: string | null
  /** 上一次校验的错误（空数组 = 通过） */
  errors: BuddyProfileError[]
  error: string | null
  saving: boolean
  savedAt: string | null
  /** 是否已经存在服务端的资料行（`false` 时页面提示"还没填过"） */
  exists: boolean
  /** 已撤回（删除）匹配资料 */
  withdrawn: boolean
}

export interface BuddyProfileDeps {
  repository: BuddyRepository
  cache: CachePort
  clock: ClockPort
  session: SessionStorePort
  cacheKey: string
}

export interface BuddyProfileUseCase {
  getSnapshot(): BuddyProfileState
  subscribe(listener: () => void): () => void
  hydrate(): BuddyProfileState
  load(): Promise<BuddyProfileState>
  loadTags(): Promise<BuddyProfileState>
  setDepartment(department: string | null): BuddyProfileState
  toggleSection(section: BuddySection): BuddyProfileState
  toggleInterestTag(key: string): BuddyProfileState
  toggleActivityTag(key: string): BuddyProfileState
  addAvailabilitySlot(slot: BuddyAvailabilitySlot): BuddyProfileState
  removeAvailabilitySlot(index: number): BuddyProfileState
  clearAvailability(): BuddyProfileState
  setSkillLevel(level: BuddySkillLevel): BuddyProfileState
  togglePreferredArea(area: string): BuddyProfileState
  setBio(bio: string): BuddyProfileState
  setMatchEnabled(enabled: boolean): BuddyProfileState
  save(): Promise<Result<BuddyProfile, RepositoryError>>
  /** 撤回：硬删匹配资料（含 embedding），立即移出推荐池 */
  withdraw(): Promise<Result<true, RepositoryError>>
  reset(): void
}

function initialProfile(userId: string): BuddyProfile {
  return emptyBuddyProfile(userId)
}

export function createBuddyProfileUseCase(deps: BuddyProfileDeps): BuddyProfileUseCase {
  const { repository, cache, clock, session, cacheKey } = deps

  let state: BuddyProfileState = {
    status: 'idle',
    profile: initialProfile(session.getSnapshot().profile?.id ?? ''),
    tags: [],
    tagsLoading: false,
    tagsError: null,
    errors: [],
    error: null,
    saving: false,
    savedAt: null,
    exists: false,
    withdrawn: false,
  }
  let hydrated = false
  const listeners = new Set<() => void>()

  function patch(next: Partial<BuddyProfileState>): BuddyProfileState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function patchProfile(next: Partial<BuddyProfile>): BuddyProfileState {
    return patch({
      profile: { ...state.profile, ...next },
      errors: [],
      error: null,
      withdrawn: false,
    })
  }

  function writeCache(profile: BuddyProfile | null): void {
    cache.write(cacheKey, { profile, updatedAt: clock.now().toISOString() })
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    hydrate(): BuddyProfileState {
      if (hydrated) return state
      hydrated = true

      const cached = cache.read<{ profile: BuddyProfile | null; updatedAt: string } | null>(
        cacheKey,
      )
      if (cached === null || typeof cached !== 'object' || cached.profile == null) return state

      return patch({
        status: 'ready',
        profile: normalizeBuddyProfile(cached.profile),
        exists: true,
        savedAt: cached.updatedAt,
        errors: [],
        error: null,
      })
    },

    async load(): Promise<BuddyProfileState> {
      patch({ status: state.exists ? 'ready' : 'loading', error: null })

      const result = await repository.getProfile()
      if (!result.ok) {
        return patch({
          status: state.exists ? 'ready' : 'error',
          error: result.error.message,
        })
      }

      if (result.value === null) {
        const viewerId = session.getSnapshot().profile?.id ?? ''
        writeCache(null)
        return patch({
          status: 'ready',
          profile: initialProfile(viewerId),
          exists: false,
          errors: [],
          error: null,
          withdrawn: false,
        })
      }

      const profile = normalizeBuddyProfile(result.value)
      writeCache(profile)
      return patch({
        status: 'ready',
        profile,
        exists: true,
        errors: [],
        error: null,
        savedAt: profile.updatedAt,
        withdrawn: false,
      })
    },

    async loadTags(): Promise<BuddyProfileState> {
      patch({ tagsLoading: true, tagsError: null })
      const result = await repository.listTags()
      if (!result.ok) {
        // 与发布页同款回落：拉不到服务端标签表时用本端镜像（封闭表，不是自由输入）
        return patch({
          tagsLoading: false,
          tags: activeBuddyTags(),
          tagsError: `${result.error.message}（已回落到内置的封闭标签表）`,
        })
      }
      return patch({ tagsLoading: false, tags: result.value, tagsError: null })
    },

    setDepartment(department) {
      return patchProfile({ department })
    },

    toggleSection(section) {
      const has = state.profile.sections.includes(section)
      const sections = has
        ? state.profile.sections.filter((s) => s !== section)
        : BUDDY_SECTIONS.filter((s) => s === section || state.profile.sections.includes(s))
      return patchProfile({ sections })
    },

    toggleInterestTag(key) {
      const selected = state.profile.interestTags
      if (selected.includes(key)) {
        return patchProfile({ interestTags: selected.filter((t) => t !== key) })
      }
      const check = validateTagKeys([...selected, key], BUDDY_TAG_LIMITS.interestTags)
      if (!check.ok) return patch({ error: check.error.message, errors: [] })
      return patchProfile({ interestTags: check.value })
    },

    toggleActivityTag(key) {
      const selected = state.profile.activityTags
      if (selected.includes(key)) {
        return patchProfile({ activityTags: selected.filter((t) => t !== key) })
      }
      const check = validateTagKeys([...selected, key], BUDDY_TAG_LIMITS.activityTags)
      if (!check.ok) return patch({ error: check.error.message, errors: [] })
      return patchProfile({ activityTags: check.value })
    },

    addAvailabilitySlot(slot) {
      return patchProfile({
        availability: normalizeAvailability([...state.profile.availability, slot]),
      })
    },

    removeAvailabilitySlot(index) {
      return patchProfile({
        availability: state.profile.availability.filter((_, i) => i !== index),
      })
    },

    clearAvailability() {
      return patchProfile({ availability: [] })
    },

    setSkillLevel(level) {
      return patchProfile({ skillLevel: level })
    },

    togglePreferredArea(area) {
      const selected = state.profile.preferredAreas
      if (selected.includes(area)) {
        return patchProfile({ preferredAreas: selected.filter((a) => a !== area) })
      }
      if (selected.length >= PREFERRED_AREA_LIMIT) {
        return patch({
          error: `常去区域最多选 ${PREFERRED_AREA_LIMIT} 个`,
          errors: [],
        })
      }
      return patchProfile({ preferredAreas: [...selected, area] })
    },

    setBio(bio) {
      return patchProfile({ bio: bio === '' ? null : bio })
    },

    setMatchEnabled(enabled) {
      return patchProfile({ matchEnabled: enabled })
    },

    async save(): Promise<Result<BuddyProfile, RepositoryError>> {
      const viewerId = session.getSnapshot().profile?.id
      if (viewerId === undefined) {
        const error: RepositoryError = { code: 'UNAUTHENTICATED', message: '请先登录后再保存' }
        patch({ error: error.message })
        return err(error)
      }

      const candidate = normalizeBuddyProfile({ ...state.profile, userId: viewerId })
      const validation = validateBuddyProfile(candidate)
      if (!validation.ok) {
        const first = validation.errors[0]
        patch({
          status: 'ready',
          errors: validation.errors,
          error: first?.message ?? '匹配资料不合法',
        })
        return err({
          code: 'VALIDATION_FAILED',
          message: first?.message ?? '匹配资料不合法',
          details: { field: first?.field ?? 'unknown' },
        })
      }

      patch({ saving: true, error: null, errors: [] })
      const saved = await repository.putProfile(
        candidate,
        createIdempotencyKey('buddy-profile', clock.now()),
      )
      if (!saved.ok) {
        patch({ saving: false, status: 'ready', error: saved.error.message })
        return err(saved.error)
      }

      const profile = normalizeBuddyProfile(saved.value)
      writeCache(profile)
      patch({
        saving: false,
        status: 'ready',
        profile,
        exists: true,
        savedAt: profile.updatedAt,
        error: null,
        errors: [],
        withdrawn: false,
      })
      return ok(profile)
    },

    async withdraw(): Promise<Result<true, RepositoryError>> {
      const viewerId = session.getSnapshot().profile?.id
      if (viewerId === undefined) {
        const error: RepositoryError = { code: 'UNAUTHENTICATED', message: '请先登录后再操作' }
        patch({ error: error.message })
        return err(error)
      }

      patch({ saving: true, error: null })
      const deleted = await repository.deleteProfile()
      if (!deleted.ok) {
        patch({ saving: false, error: deleted.error.message })
        return err(deleted.error)
      }

      writeCache(null)
      patch({
        saving: false,
        status: 'ready',
        profile: initialProfile(viewerId),
        exists: false,
        savedAt: null,
        errors: [],
        error: null,
        withdrawn: true,
      })
      return ok(true)
    },

    reset(): void {
      hydrated = false
      state = {
        ...state,
        status: 'idle',
        profile: initialProfile(session.getSnapshot().profile?.id ?? ''),
        errors: [],
        error: null,
        saving: false,
        exists: false,
        withdrawn: false,
      }
      for (const listener of listeners) listener()
    },
  }
}

/** 资料页展示用的上限常量（页面不要自己写数字） */
export const BUDDY_PROFILE_LIMITS = {
  interestTags: BUDDY_TAG_LIMITS.interestTags,
  activityTags: BUDDY_TAG_LIMITS.activityTags,
  preferredAreas: PREFERRED_AREA_LIMIT,
  bio: BUDDY_BIO_MAX,
} as const
