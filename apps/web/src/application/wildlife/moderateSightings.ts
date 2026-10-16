/**
 * 用例：管理端观测审核（规格 §2.10 / §8 / §10.2）。
 *
 * ⚠️ 审核动作名是契约 §11.2 **已冻结**的 `moderate`（`POST /items/:id/moderate`），
 * 用 body 的 `{ decision: 'PUBLISHED' | 'REJECTED' }` 区分通过/拒绝 —— 不得拆成
 * `publish` / `reject` 两个自创 action（会重复守卫代码）。
 *
 * 三条业务规则必须在这里显式体现（不能只写在文档里）：
 * 1. **保护物种必须两名审核员**（单人通过返回 `FORBIDDEN`）；
 * 2. `PUBLISHED → REJECTED`（事后下架）**必须**填 `rejectReason`；
 * 3. `healthConcern = true` 的记录**排到队首**（受伤动物不能等审核队列）。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, formatRelativeTime, ok, type Result } from '@kedaya/shared';

import {
  MODERATION_DECISION_LABELS,
  moderationPrecondition,
  sortModerationQueue,
  type ModerateSightingInput,
  type ModerationDecision,
  type WildlifeSighting,
} from '@/domain/models/wildlife/sightings';
import { HEALTH_CONCERN_NOTICE } from '@/domain/models/wildlife/ethics';
import type { WildlifeRepository } from '@/domain/ports/wildlife';

import { toSightingListItemVM, type SightingListItemVM, type WildlifeCatalog } from './listSightings';

/** 审核员（占位：真实实现必须来自契约 §5 身份层 + 权限判定） */
export interface WildlifeModerator {
  id: string;
  /** 展示名（脱敏后） */
  label: string;
}

export const DEMO_MODERATOR: WildlifeModerator = { id: 'u_admin_01', label: '社团管理员' };
/** 第二名审核员（演示保护物种的双人复核） */
export const DEMO_SECOND_MODERATOR: WildlifeModerator = { id: 'u_admin_02', label: '生物教师' };

export interface ModerationQueueItemVM extends SightingListItemVM {
  /** 是否保护物种（决定是否需要双人复核） */
  isProtected: boolean;
  /** 双人复核提示 */
  preconditionReason: string | null;
  requiresSecondModerator: boolean;
  /** 该记录是否已由当前审核员投过第一票 */
  awaitingSecondModerator: boolean;
  /** 健康异常说明（队首优先的原因） */
  healthNotice: string | null;
  /** 精确坐标（**仅审核端可见**；公开 API 不含该字段，规格 §2.7） */
  moderatorHint: string;
}

export interface ModerationQueueVM {
  items: ModerationQueueItemVM[];
  total: number;
  pendingCount: number;
  healthConcernCount: number;
  protectedCount: number;
  isEmpty: boolean;
  emptyHint: string;
  /** 审核端专属说明：这里能看到精确坐标，读取会被审计（规格 §2.7） */
  moderatorNotice: string;
}

function toModerationItemVM(
  sighting: WildlifeSighting,
  catalog: WildlifeCatalog,
  moderator: WildlifeModerator,
  now: Date,
): ModerationQueueItemVM {
  const speciesRef = catalog.species.find((s) => s.id === sighting.species);
  const precondition = moderationPrecondition(sighting, speciesRef, moderator.id);
  const base = toSightingListItemVM(sighting, catalog, now);
  return {
    ...base,
    isProtected: Boolean(speciesRef?.isProtected),
    preconditionReason: precondition.reason ?? null,
    requiresSecondModerator: precondition.requiresSecondModerator,
    awaitingSecondModerator: sighting.moderatedBy !== null && sighting.moderatedBy !== undefined,
    healthNotice: sighting.healthConcern ? HEALTH_CONCERN_NOTICE : null,
    moderatorHint:
      '审核端可见该记录的精确坐标与精确发现时间（公开 API 不含这两个字段）；每次读取都会写审计日志。',
  };
}

export function toModerationQueueVM(
  sightings: readonly WildlifeSighting[],
  catalog: WildlifeCatalog,
  moderator: WildlifeModerator,
  now: Date,
): ModerationQueueVM {
  const items = sortModerationQueue(sightings).map((sighting) =>
    toModerationItemVM(sighting, catalog, moderator, now),
  );
  return {
    items,
    total: items.length,
    pendingCount: items.filter((item) => item.status === 'PENDING').length,
    healthConcernCount: items.filter((item) => item.healthConcern).length,
    protectedCount: items.filter((item) => item.isProtected).length,
    isEmpty: items.length === 0,
    emptyHint:
      '审核队列是空的。新的上报（含"新建命名个体"）会进入这里；疑似受伤的记录会排到队首并立即通知社团。',
    moderatorNotice:
      '审核端：本页展示精确坐标与精确时间，普通用户与上报人本人都看不到（规格 §2.7）。任何读取都会落审计日志。',
  };
}

/**
 * 加载审核队列。
 *
 * 契约形状说明（**偏差，已登记**）：规格 §10.1 把 `GET /items` 定义为"仅 `PUBLISHED`"的
 * 公开列表，因此审核队列用 `GET /items?status=PENDING` 表达。服务端需要为审核员放开该过滤，
 * 或另给一个管理端集合路由。详见 `apps/web/README.md` 的偏差表。
 */
export async function loadModerationQueue(
  repository: WildlifeRepository,
  catalog: WildlifeCatalog,
  moderator: WildlifeModerator = DEMO_MODERATOR,
  now: Date = new Date(),
): Promise<Result<ModerationQueueVM, ApiError>> {
  const [pending, published] = await Promise.all([
    repository.sightings({ status: 'PENDING', limit: 50 }),
    repository.sightings({ status: 'PUBLISHED', limit: 20 }),
  ]);
  if (!pending.ok) return err(pending.error);
  if (!published.ok) return err(published.error);
  return ok(
    toModerationQueueVM(
      [...pending.value.items, ...published.value.items],
      catalog,
      moderator,
      now,
    ),
  );
}

export interface ModerationResultVM {
  sightingId: string;
  decision: ModerationDecision;
  decisionLabel: string;
  statusLabel: string;
  /** 给审核员的操作回执（含双人复核等特殊说明） */
  message: string;
  moderatedLabel: string;
}

export async function moderateSighting(
  repository: WildlifeRepository,
  id: string,
  decision: ModerationDecision,
  moderator: WildlifeModerator = DEMO_MODERATOR,
  options: { reason?: string; now?: Date } = {},
): Promise<Result<ModerationResultVM, ApiError>> {
  const now = options.now ?? new Date();

  const input: ModerateSightingInput = {
    decision,
    moderatorId: moderator.id,
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  };

  const result = await repository.moderate(id, input);
  if (!result.ok) return err(result.error);

  const updated = result.value;
  return ok({
    sightingId: updated.id,
    decision,
    decisionLabel: MODERATION_DECISION_LABELS[decision],
    statusLabel: updated.status === 'PUBLISHED' ? '已发布' : '未通过',
    message:
      decision === 'PUBLISHED'
        ? '已通过并发布。公开坐标是模糊化后的值；若为保护物种，本次为双人复核的第二票。'
        : '已拒绝。拒绝理由仅审核端可见，上报人会在自己的记录里看到状态变化。',
    moderatedLabel:
      updated.moderatedAt === null || updated.moderatedAt === undefined
        ? '刚刚'
        : formatRelativeTime(updated.moderatedAt, now) || '刚刚',
  });
}
