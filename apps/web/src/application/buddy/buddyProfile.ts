/**
 * 用例：我的匹配资料（契约 §7：application 层编排，不含 IO）。
 *
 * 隐私要点（规格 §6.3，本文件的 VM 直接把这几条带到界面上）：
 * - `matchEnabled` **默认关闭**：不主动开启就不进推荐池；
 * - 资料对**任何人**都不可见（包括活动的发起人），只被算法使用；
 * - 可随时撤回：关闭开关立即移出推荐池；删除资料是**硬删**（含匹配向量）。
 *
 * 可用时段编辑器支持**跨零点**（例如 23:00–01:00 的夜跑）：
 * `endMin < startMin` 即表示跨到次日，判定逻辑在 `@kedaya/shared`（本端不重写算法）。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, formatRelativeTime, ok, type Result } from '@kedaya/shared';

import {
  BUDDY_ACTIVE_TAGS,
  BUDDY_BIO_MAX_LENGTH,
  BUDDY_DEPARTMENTS,
  BUDDY_DEPARTMENT_MAX_LENGTH,
  BUDDY_LOCATIONS,
  BUDDY_MAX_ACTIVITY_TAGS,
  BUDDY_MAX_INTEREST_TAGS,
  BUDDY_MAX_PREFERRED_AREAS,
  BUDDY_SECTIONS,
  BUDDY_SECTION_DESCRIPTIONS,
  BUDDY_SECTION_LABELS,
  BUDDY_SKILL_LEVELS,
  BUDDY_SKILL_LEVEL_LABELS,
  BUDDY_TAG_GROUP_LABELS,
  BUDDY_TAG_GROUPS,
  BUDDY_WEEKDAY_LABELS,
  BUDDY_WITHDRAW_NOTICE,
  availabilityOverlapsPost,
  describeAvailability,
  emptyBuddyProfile,
  formatAvailabilitySlot,
  hhmmToMinutes,
  isCrossMidnight,
  minutesToHHMM,
  slotLengthMinutes,
  validateBuddyProfileDraft,
  type BuddyAvailabilitySlot,
  type BuddyDraftProblem,
  type BuddyPost,
  type BuddyProfile,
  type BuddyProfileDraft,
  type BuddySection,
  type BuddySkillLevel,
  type BuddyTagDef,
} from '@/domain/models/buddy';
import type { BuddyRepository } from '@/domain/ports/buddy';

import { deriveViewState, type ViewState } from '../viewState';

export const BUDDY_PROFILE_LIMITS = {
  interestMax: BUDDY_MAX_INTEREST_TAGS,
  activityMax: BUDDY_MAX_ACTIVITY_TAGS,
  areaMax: BUDDY_MAX_PREFERRED_AREAS,
  bioMax: BUDDY_BIO_MAX_LENGTH,
  departmentMax: BUDDY_DEPARTMENT_MAX_LENGTH,
} as const;

export interface BuddyTagOptionVM {
  key: string;
  label: string;
  group: string;
  groupLabel: string;
  selected: boolean;
}

export interface BuddyAvailabilitySlotVM {
  index: number;
  dow: number;
  dowLabel: string;
  startMin: number;
  endMin: number;
  /** `HH:MM`，直接喂给 `<input type="time">` */
  start: string;
  end: string;
  crossMidnight: boolean;
  lengthMinutes: number;
  lengthLabel: string;
  /** `周一 08:00–10:00`；跨零点带「次日」 */
  label: string;
}

export interface BuddyProfileVM {
  userId: string;
  matchEnabled: boolean;
  matchEnabledNotice: string;
  sections: { value: BuddySection; label: string; description: string; selected: boolean }[];
  interestOptions: BuddyTagOptionVM[];
  activityOptions: BuddyTagOptionVM[];
  selectedInterestCount: number;
  selectedActivityCount: number;
  skillLevel: BuddySkillLevel;
  skillOptions: { value: BuddySkillLevel; label: string; selected: boolean }[];
  availability: BuddyAvailabilitySlotVM[];
  availabilitySummary: string;
  preferredAreas: { key: string; label: string; selected: boolean }[];
  selectedAreaCount: number;
  department: string | null;
  departmentOptions: readonly string[];
  bio: string | null;
  updatedLabel: string;
  limits: typeof BUDDY_PROFILE_LIMITS;
  withdrawNotice: string;
  privacyNotice: string;
  /** 表单可直接编辑的原始值（避免 UI 从 VM 反向拼装，丢掉未展示的字段） */
  draft: BuddyProfileDraft;
  state: ViewState;
}

/* ------------------------------------------------------------------ *
 * 时段编辑（纯函数）
 * ------------------------------------------------------------------ */

export function toAvailabilitySlotVM(slot: BuddyAvailabilitySlot, index: number): BuddyAvailabilitySlotVM {
  const length = slotLengthMinutes(slot);
  const hours = Math.round((length / 60) * 10) / 10;
  return {
    index,
    dow: slot.dow,
    dowLabel: BUDDY_WEEKDAY_LABELS[slot.dow] ?? `第 ${slot.dow} 天`,
    startMin: slot.startMin,
    endMin: slot.endMin,
    start: minutesToHHMM(slot.startMin),
    end: minutesToHHMM(slot.endMin),
    crossMidnight: isCrossMidnight(slot),
    lengthMinutes: length,
    lengthLabel: `${hours} 小时`,
    label: formatAvailabilitySlot(slot),
  };
}

/** 追加一段（默认周一 19:00–21:00）；返回新数组，不改原数组 */
export function appendAvailabilitySlot(
  slots: readonly BuddyAvailabilitySlot[],
): BuddyAvailabilitySlot[] {
  return [...slots, { dow: 1, startMin: 19 * 60, endMin: 21 * 60 }];
}

export function removeAvailabilitySlot(
  slots: readonly BuddyAvailabilitySlot[],
  index: number,
): BuddyAvailabilitySlot[] {
  return slots.filter((_, i) => i !== index);
}

/** 改一段的任一部分；`hhmm` 非法时**忽略**该次修改（不把 NaN 写进状态） */
export function updateAvailabilitySlot(
  slots: readonly BuddyAvailabilitySlot[],
  index: number,
  patch: { dow?: number; start?: string; end?: string },
): BuddyAvailabilitySlot[] {
  return slots.map((slot, i) => {
    if (i !== index) return slot;
    const next: BuddyAvailabilitySlot = { ...slot };
    if (patch.dow !== undefined) next.dow = patch.dow;
    if (patch.start !== undefined) {
      const minutes = hhmmToMinutes(patch.start);
      if (minutes !== null) next.startMin = minutes;
    }
    if (patch.end !== undefined) {
      const minutes = hhmmToMinutes(patch.end);
      if (minutes !== null) next.endMin = minutes;
    }
    return next;
  });
}

/** 周选择器选项 */
export function weekdayOptions(): { value: number; label: string }[] {
  return BUDDY_WEEKDAY_LABELS.map((label, value) => ({ value, label }));
}

/* ------------------------------------------------------------------ *
 * VM 映射
 * ------------------------------------------------------------------ */

function tagOptions(tags: readonly BuddyTagDef[], selected: readonly string[]): BuddyTagOptionVM[] {
  const chosen = new Set(selected);
  return tags.map((tag) => ({
    key: tag.key,
    label: tag.label,
    group: tag.group,
    groupLabel: BUDDY_TAG_GROUP_LABELS[tag.group],
    selected: chosen.has(tag.key),
  }));
}

/** 按分组返回标签（UI 分栏渲染） */
export function tagGroups(): { group: string; label: string; tags: BuddyTagDef[] }[] {
  return BUDDY_TAG_GROUPS.map((group) => ({
    group,
    label: BUDDY_TAG_GROUP_LABELS[group],
    tags: BUDDY_ACTIVE_TAGS.filter((tag) => tag.group === group),
  }));
}

export function toBuddyProfileVM(
  profile: BuddyProfile,
  options: { now: Date; state?: ViewState },
): BuddyProfileVM {
  const sectionSet = new Set(profile.sections);
  const interestSet = new Set(profile.interestTags);
  const activitySet = new Set(profile.activityTags);
  const areaSet = new Set(profile.preferredAreas);

  return {
    userId: profile.userId,
    matchEnabled: profile.matchEnabled,
    matchEnabledNotice: profile.matchEnabled
      ? '匹配已开启：你的资料会被算法用于排序，但不会展示给任何人。'
      : '匹配已关闭：你不会出现在别人的推荐里，也不会被时间/兴趣过滤掉 —— 但你自己仍然可以主动找搭子。',
    sections: BUDDY_SECTIONS.map((section) => ({
      value: section,
      label: BUDDY_SECTION_LABELS[section],
      description: BUDDY_SECTION_DESCRIPTIONS[section],
      selected: sectionSet.has(section),
    })),
    interestOptions: tagOptions(BUDDY_ACTIVE_TAGS, profile.interestTags),
    activityOptions: tagOptions(BUDDY_ACTIVE_TAGS, profile.activityTags),
    selectedInterestCount: interestSet.size,
    selectedActivityCount: activitySet.size,
    skillLevel: profile.skillLevel,
    skillOptions: BUDDY_SKILL_LEVELS.map((level) => ({
      value: level,
      label: BUDDY_SKILL_LEVEL_LABELS[level],
      selected: level === profile.skillLevel,
    })),
    availability: profile.availability.map((slot, index) => toAvailabilitySlotVM(slot, index)),
    availabilitySummary: describeAvailability(profile.availability),
    preferredAreas: BUDDY_LOCATIONS.map((location) => ({
      key: location.key,
      label: location.label,
      selected: areaSet.has(location.key),
    })),
    selectedAreaCount: areaSet.size,
    department: profile.department,
    departmentOptions: BUDDY_DEPARTMENTS,
    bio: profile.bio,
    updatedLabel: formatRelativeTime(profile.updatedAt, options.now) || '时间未知',
    limits: BUDDY_PROFILE_LIMITS,
    withdrawNotice: BUDDY_WITHDRAW_NOTICE,
    privacyNotice:
      '这份资料只被算法使用：它不会出现在活动详情、申请列表或任何他人可见的响应里。对外只输出聚合后的理由（如「共同兴趣 3 项」）。',
    draft: profileToDraft(profile),
    state: options.state ?? deriveViewState({ isPending: false, isError: false, isEmpty: false }),
  };
}

export function emptyProfileDraft(): BuddyProfileDraft {
  return {
    sections: [],
    interestTags: [],
    activityTags: [],
    skillLevel: 'casual',
    availability: [],
    preferredAreas: [],
    department: null,
    bio: null,
    matchEnabled: false,
  };
}

export function profileToDraft(profile: BuddyProfile): BuddyProfileDraft {
  return {
    sections: [...profile.sections],
    interestTags: [...profile.interestTags],
    activityTags: [...profile.activityTags],
    skillLevel: profile.skillLevel,
    availability: profile.availability.map((slot) => ({ ...slot })),
    preferredAreas: [...profile.preferredAreas],
    department: profile.department,
    bio: profile.bio,
    matchEnabled: profile.matchEnabled,
  };
}

/** 切换一个标签（返回新数组；受 max 限制，超出时忽略新增） */
export function toggleTag(
  tags: readonly string[],
  key: string,
  max: number,
): string[] {
  if (tags.includes(key)) return tags.filter((tag) => tag !== key);
  if (tags.length >= max) return [...tags];
  return [...tags, key];
}

export function toggleSection(
  sections: readonly BuddySection[],
  section: BuddySection,
): BuddySection[] {
  return sections.includes(section)
    ? sections.filter((item) => item !== section)
    : [...sections, section];
}

export interface BuddyProfileFormVM {
  valid: boolean;
  problems: BuddyDraftProblem[];
  fieldErrors: Record<string, string>;
}

export function validateBuddyProfileForm(draft: BuddyProfileDraft): BuddyProfileFormVM {
  const problems = validateBuddyProfileDraft(draft);
  const fieldErrors: Record<string, string> = {};
  for (const problem of problems) fieldErrors[problem.field] ??= problem.message;
  return { valid: problems.length === 0, problems, fieldErrors };
}

/* ------------------------------------------------------------------ *
 * 用例入口
 * ------------------------------------------------------------------ */

export async function loadBuddyProfile(
  repository: BuddyRepository,
  userId: string,
  now: Date = new Date(),
): Promise<Result<BuddyProfileVM, ApiError>> {
  const result = await repository.getProfile(userId);
  if (!result.ok) return err(result.error);
  return ok(toBuddyProfileVM(result.value, { now }));
}

export async function saveBuddyProfile(
  repository: BuddyRepository,
  input: { userId: string; draft: BuddyProfileDraft; now?: Date },
): Promise<Result<BuddyProfileVM, ApiError>> {
  const now = input.now ?? new Date();
  const form = validateBuddyProfileForm(input.draft);
  if (!form.valid) {
    const first = form.problems[0] as BuddyDraftProblem;
    return err({
      code: 'VALIDATION_FAILED',
      message: first.message,
      details: { reason: first.reason, problems: form.problems },
    });
  }

  const saved = await repository.putProfile({ ...input.draft, userId: input.userId });
  if (!saved.ok) return err(saved.error);
  return ok(toBuddyProfileVM(saved.value, { now }));
}

/** 删除匹配资料（硬删，含匹配向量）—— 立即从推荐池移除（规格 §6.3） */
export async function deleteBuddyProfile(
  repository: BuddyRepository,
  userId: string,
  now: Date = new Date(),
): Promise<Result<BuddyProfileVM, ApiError>> {
  const deleted = await repository.deleteProfile(userId);
  if (!deleted.ok) return err(deleted.error);
  // 删除后展示的是"默认关闭的空资料"，而不是错误态
  return ok(toBuddyProfileVM(emptyBuddyProfile(userId, now), { now }));
}

/** 某个活动的时间窗是否落在我的可用时段内（列表/详情页的「时间能碰上」提示） */
export function overlapsPost(
  profile: Pick<BuddyProfile, 'availability'>,
  post: Pick<BuddyPost, 'startsAt' | 'durationMin'>,
): boolean {
  return availabilityOverlapsPost(profile.availability, post);
}
