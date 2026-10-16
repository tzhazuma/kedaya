/**
 * 用例：加载搭子广场列表（契约 §7：application 层编排，不含 IO）。
 *
 * 依赖方向 `presentation → application → domain ← data`：
 * 本文件只依赖 domain 的模型与端口，仓储实例由调用方注入。
 * 输出是**视图模型**（已本地化文案 / 已判定可否申请），UI 不再做任何计算。
 *
 * 板块分栏：`academic` / `daily` / `sport` 三个板块由 `sectionOf(activity)` 派生，
 * **没有第四个**（契约 §11.10-G）。
 */
import type { ApiError, Page } from '@kedaya/contracts';
import { err, formatRelativeTime, ok, type Result } from '@kedaya/shared';

import {
  BUDDY_ACTIVITY_LABELS,
  BUDDY_APPLICATION_STATUS_LABELS,
  BUDDY_GENDER_PREFERENCE_LABELS,
  BUDDY_POST_STATUS_LABELS,
  BUDDY_SECTION_DESCRIPTIONS,
  BUDDY_SECTION_LABELS,
  BUDDY_SECTIONS,
  BUDDY_SKILL_LEVEL_LABELS,
  joinBlockedReason,
  locationLabel,
  progressPercent,
  remainingSlots,
  sectionOf,
  tagLabel,
  type BuddyActivity,
  type BuddyApplicationStatus,
  type BuddyPost,
  type BuddyPostStatus,
  type BuddySection,
} from '@/domain/models/buddy';
import type { BuddyPostListQuery, BuddyRepository } from '@/domain/ports/buddy';

import { deriveViewState, type ViewState } from '../viewState';

/** 状态 → 徽章语义色（具体色值由 design-tokens 决定，UI 不写色值） */
const STATUS_TONES: Record<
  BuddyPostStatus,
  'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger'
> = {
  OPEN: 'brand',
  FULL: 'warning',
  CLOSED: 'neutral',
  EXPIRED: 'neutral',
  CANCELLED: 'danger',
};

/** 非 OPEN 状态的显式说明（**不得静默消失**：状态必须能被用户看到） */
const STATUS_NOTICES: Record<BuddyPostStatus, string | null> = {
  OPEN: null,
  FULL: '名额已满：仍可查看详情，但不能再申请。有人退出后会重新开放。',
  CLOSED: '发起人已关闭这条招募，不再接受申请。',
  EXPIRED: '活动时间已过，这条招募已过期。',
  CANCELLED: '这条招募已被发起人取消。',
};

export interface BuddySectionVM {
  value: BuddySection;
  label: string;
  description: string;
  count: number;
}

export interface BuddyTagChipVM {
  key: string;
  label: string;
}

export interface BuddyPostCardVM {
  id: string;
  title: string;
  section: BuddySection;
  sectionLabel: string;
  activity: BuddyActivity;
  activityLabel: string;
  status: BuddyPostStatus;
  statusLabel: string;
  statusTone: 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';
  /** 非 OPEN 时必须展示 */
  notice: string | null;
  locationLabel: string;
  /** 绝对时间（`10月24日 14:00`，Asia/Shanghai） */
  startsAtLabel: string;
  /** 相对时间（`3 天后`） */
  startsInLabel: string;
  durationLabel: string;
  capacityLabel: string;
  remainingLabel: string;
  progress: number;
  tags: BuddyTagChipVM[];
  creatorLabel: string;
  genderPreferenceLabel: string;
  skillLabel: string | null;
  joinable: boolean;
  /** 不能申请的原因（中文，UI 直接展示；`null` 表示可以申请） */
  blockedReason: string | null;
  isMine: boolean;
  /** 我对这条活动的申请状态（没有则 null） */
  myApplicationStatus: BuddyApplicationStatus | null;
  myApplicationLabel: string | null;
  createdLabel: string;
}

export interface BuddyPostListVM {
  items: BuddyPostCardVM[];
  sections: BuddySectionVM[];
  nextCursor: string | null;
  total: number;
  /** 当前筛选的板块（null = 全部） */
  activeSection: BuddySection | null;
  activeTags: string[];
  isEmpty: boolean;
  joinableCount: number;
  state: ViewState;
}

/* ------------------------------------------------------------------ *
 * 展示层格式化（纯函数，可单测）
 * ------------------------------------------------------------------ */

/**
 * 绝对时间：`10月24日 14:00`。
 * 用 `Intl.DateTimeFormat` 取目标时区的**部件**再自己拼 —— 不依赖 ICU 的输出格式，
 * 因此测试可以断言精确字符串（同 `@kedaya/shared` 的 `zonedDowAndMinute` 手法）。
 */
export function formatLocalDateTime(iso: string, tz = 'Asia/Shanghai'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '时间未知';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  const month = String(Number(pick('month')));
  const day = String(Number(pick('day')));
  const hour = pick('hour') === '24' ? '00' : pick('hour');
  return `${month}月${day}日 ${hour}:${pick('minute')}`;
}

/** 时长：`2 小时` / `1 小时 30 分钟` / `45 分钟` */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '时长未知';
  const whole = Math.trunc(minutes);
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  if (h === 0) return `${m} 分钟`;
  if (m === 0) return `${h} 小时`;
  return `${h} 小时 ${m} 分钟`;
}

export function buddyStatusTone(status: BuddyPostStatus) {
  return STATUS_TONES[status];
}

/* ------------------------------------------------------------------ *
 * VM 映射
 * ------------------------------------------------------------------ */

export interface ToCardOptions {
  now: Date;
  viewerId: string;
  /** 我对这条活动的申请（由列表端点或本地申请列表提供） */
  myApplicationStatus?: BuddyApplicationStatus | null;
}

export function toBuddyPostCardVM(post: BuddyPost, options: ToCardOptions): BuddyPostCardVM {
  const section = sectionOf(post.activity);
  const isMine = post.creator.id === options.viewerId;
  const remaining = remainingSlots(post);
  const myStatus = options.myApplicationStatus ?? null;

  const baseBlocked = joinBlockedReason(post, options.viewerId, options.now);
  let blockedReason = baseBlocked;
  if (myStatus === 'PENDING') blockedReason = '已提交申请，等待发起人审批。';
  if (myStatus === 'ACCEPTED') blockedReason = '申请已通过，可以按活动时间前往。';

  return {
    id: post.id,
    title: post.title,
    section,
    sectionLabel: BUDDY_SECTION_LABELS[section],
    activity: post.activity,
    activityLabel: BUDDY_ACTIVITY_LABELS[post.activity],
    status: post.status,
    statusLabel: BUDDY_POST_STATUS_LABELS[post.status],
    statusTone: STATUS_TONES[post.status],
    notice: STATUS_NOTICES[post.status],
    locationLabel: locationLabel(post.location),
    startsAtLabel: formatLocalDateTime(post.startsAt),
    startsInLabel: formatRelativeTime(post.startsAt, options.now) || '时间未知',
    durationLabel: formatDuration(post.durationMin),
    capacityLabel: `${post.joinedCount}/${post.capacity} 人`,
    remainingLabel: remaining > 0 ? `还差 ${remaining} 人` : '已满员',
    progress: progressPercent(post),
    tags: post.tags.map((key) => ({ key, label: tagLabel(key) })),
    creatorLabel: post.creator.nickname,
    genderPreferenceLabel: BUDDY_GENDER_PREFERENCE_LABELS[post.genderPreference],
    skillLabel: post.minSkillLevel
      ? `要求${BUDDY_SKILL_LEVEL_LABELS[post.minSkillLevel]}及以上`
      : null,
    joinable: blockedReason === null,
    blockedReason,
    isMine,
    myApplicationStatus: myStatus,
    myApplicationLabel: myStatus ? BUDDY_APPLICATION_STATUS_LABELS[myStatus] : null,
    createdLabel: formatRelativeTime(post.createdAt, options.now) || '时间未知',
  };
}

export function toBuddyPostListVM(
  page: Page<BuddyPost>,
  options: {
    now: Date;
    viewerId: string;
    activeSection?: BuddySection | null;
    activeTags?: string[];
    applicationsByPost?: ReadonlyMap<string, BuddyApplicationStatus>;
    state?: ViewState;
  },
): BuddyPostListVM {
  const items = page.items.map((post) =>
    toBuddyPostCardVM(post, {
      now: options.now,
      viewerId: options.viewerId,
      myApplicationStatus: options.applicationsByPost?.get(post.id) ?? null,
    }),
  );

  const counts: Record<BuddySection, number> = { academic: 0, daily: 0, sport: 0 };
  for (const item of items) counts[item.section] += 1;

  return {
    items,
    sections: BUDDY_SECTIONS.map((section) => ({
      value: section,
      label: BUDDY_SECTION_LABELS[section],
      description: BUDDY_SECTION_DESCRIPTIONS[section],
      count: counts[section],
    })),
    nextCursor: page.nextCursor,
    total: page.total ?? items.length,
    activeSection: options.activeSection ?? null,
    activeTags: [...(options.activeTags ?? [])],
    isEmpty: items.length === 0,
    joinableCount: items.filter((item) => item.joinable).length,
    state:
      options.state ??
      deriveViewState({ isPending: false, isError: false, isEmpty: items.length === 0 }),
  };
}

/** 用例入口：列表 + 我的申请（一次调用拿齐，UI 不必自己 join） */
export async function loadBuddyPostList(
  repository: BuddyRepository,
  query: BuddyPostListQuery,
  options: { viewerId: string; now?: Date; authenticated?: boolean },
): Promise<Result<BuddyPostListVM, ApiError>> {
  const now = options.now ?? new Date();

  const listResult = await repository.listPosts(query);
  if (!listResult.ok) return err(listResult.error);

  const applicationsByPost = new Map<string, BuddyApplicationStatus>();
  if (options.authenticated !== false) {
    const applications = await repository.listMyApplications(options.viewerId);
    if (applications.ok) {
      for (const application of applications.value) {
        // 同一帖子可能有多条历史记录（撤回后重新申请复用同一行，但 mock 允许历史）
        const current = applicationsByPost.get(application.postId);
        if (!current || application.status === 'PENDING' || application.status === 'ACCEPTED') {
          applicationsByPost.set(application.postId, application.status);
        }
      }
    }
    // 我的申请拉取失败**不阻塞**列表（列表是主内容，申请状态是装饰）
  }

  return ok(
    toBuddyPostListVM(listResult.value, {
      now,
      viewerId: options.viewerId,
      activeSection: query.section ?? null,
      activeTags: query.tags ?? [],
      applicationsByPost,
    }),
  );
}

/** 供页面把 query 状态映射成四态 */
export function buddyListState(input: {
  isPending: boolean;
  isError: boolean;
  itemCount: number;
}): ViewState {
  return deriveViewState({
    isPending: input.isPending,
    isError: input.isError,
    isEmpty: input.itemCount === 0,
  });
}
