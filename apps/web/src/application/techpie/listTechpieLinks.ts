/**
 * 用例：绑定管理（契约 §7：application 层编排，不含 IO）。
 *
 * 依赖方向 `presentation → application → domain ← data`：
 * 本文件只依赖 domain 的模型与端口，仓储实例由调用方注入。
 * 输出是**视图模型**（已本地化文案 / 已判定可否操作），UI 不再做任何计算。
 *
 * 规格 §8.1 端点 1–5 + §11.2 已冻结的 `renew` 动作。
 */
import type { ApiError, Page } from '@kedaya/contracts';
import { err, formatRelativeTime, ok, type Result } from '@kedaya/shared';

import {
  CAMPUS_PLATFORM_ACCESS_MODE,
  CAMPUS_PLATFORM_DESCRIPTIONS,
  CAMPUS_PLATFORM_LABELS,
  CAMPUS_PLATFORM_PHASE,
  PHASE_BLOCKED_REASON,
  PHASE_LABELS,
  TECHPIE_LINK_STATUS_LABELS,
  type CampusBindingSummary,
  type CampusPlatform,
  type TechpieLinkStatus,
} from '@/domain/models/techpie';
import {
  assertPhase0Credential,
  type BindCredential,
  type TechpieLinkListQuery,
  type TechpieRepository,
} from '@/domain/ports/techpie';

import { deriveViewState, type ViewState } from '../viewState';

/** 状态 → 徽章语义色（具体色值由 design-tokens 决定，UI 不写色值） */
const STATUS_TONES: Record<
  TechpieLinkStatus,
  'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger'
> = {
  UNLINKED: 'neutral',
  LINKING: 'info',
  LINKED: 'success',
  EXPIRED: 'warning',
  REVOKED: 'neutral',
};

/** 非 LINKED 状态的显式说明（**不得静默消失**：状态必须能被用户看到） */
const STATUS_NOTICES: Record<TechpieLinkStatus, string | null> = {
  UNLINKED: '尚未发起绑定。',
  LINKING:
    '绑定已发起，正在等待校园系统侧的授权确认。授权完成后状态会变为「已绑定」——请刷新查看。',
  LINKED: null,
  EXPIRED:
    '绑定已过期，需要重新绑定。你的可达鸭登录状态不受影响：校园会话失效与登录过期是两件事。',
  REVOKED: '该绑定已被撤销，可以重新发起。',
};

export interface TechpieLinkVM {
  id: string;
  platform: CampusPlatform;
  platformLabel: string;
  platformDescription: string;
  status: TechpieLinkStatus;
  statusLabel: string;
  statusTone: 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';
  /** 非 LINKED 时必须展示 */
  notice: string | null;
  /** 对端标识（学号等；`null` = 尚未拿到） */
  externalUserId: string | null;
  expiresAtLabel: string;
  lastSyncAtLabel: string;
  /** 是否允许"解绑" */
  canUnbind: boolean;
  /** 是否允许"手动续期" */
  canRenew: boolean;
  /** 该平台是否走 OPENID 通道（校园卡） */
  openIdChannel: boolean;
  phaseLabel: string;
}

export interface TechpieLinkListVM {
  items: TechpieLinkVM[];
  nextCursor: string | null;
  total: number;
  isEmpty: boolean;
  state: ViewState;
  /** 已绑定的平台（能力清单与校园卡页面用它判断"要不要引导去绑定"） */
  linkedPlatforms: CampusPlatform[];
}

/** 时间展示：`10月24日 14:00`（Asia/Shanghai，部件自拼，测试可断言精确字符串） */
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

export function techpieStatusTone(status: TechpieLinkStatus) {
  return STATUS_TONES[status];
}

export function toTechpieLinkVM(
  link: CampusBindingSummary,
  options: { now: Date },
): TechpieLinkVM {
  const platform = link.platform;
  return {
    id: link.id,
    platform,
    platformLabel: CAMPUS_PLATFORM_LABELS[platform],
    platformDescription: CAMPUS_PLATFORM_DESCRIPTIONS[platform],
    status: link.status,
    statusLabel: TECHPIE_LINK_STATUS_LABELS[link.status],
    statusTone: STATUS_TONES[link.status],
    notice: STATUS_NOTICES[link.status],
    externalUserId: link.externalUserId,
    expiresAtLabel: link.expiresAt
      ? `${formatLocalDateTime(link.expiresAt)}（${formatRelativeTime(link.expiresAt, options.now)}）`
      : '无固定有效期',
    lastSyncAtLabel: link.lastSyncAt
      ? `${formatLocalDateTime(link.lastSyncAt)}（${formatRelativeTime(link.lastSyncAt, options.now)}）`
      : '尚未同步',
    canUnbind: link.status !== 'REVOKED',
    // Phase 0 只有校园卡（OPENID 通道）能续期；其余平台的续期依赖上游能力（U8，未确认）
    canRenew: link.status === 'LINKED' || link.status === 'EXPIRED',
    openIdChannel: CAMPUS_PLATFORM_ACCESS_MODE[platform] === 'openid',
    phaseLabel: PHASE_LABELS[CAMPUS_PLATFORM_PHASE[platform]],
  };
}

export function toTechpieLinkListVM(
  page: Page<CampusBindingSummary>,
  options: { now: Date; state?: ViewState },
): TechpieLinkListVM {
  const items = page.items.map((link) => toTechpieLinkVM(link, { now: options.now }));
  return {
    items,
    nextCursor: page.nextCursor,
    total: page.total ?? items.length,
    isEmpty: items.length === 0,
    state:
      options.state ??
      deriveViewState({ isPending: false, isError: false, isEmpty: items.length === 0 }),
    linkedPlatforms: items
      .filter((item) => item.status === 'LINKED')
      .map((item) => item.platform),
  };
}

/** 用例入口：加载我的全部绑定 */
export async function loadTechpieLinks(
  repository: TechpieRepository,
  query: TechpieLinkListQuery,
  options: { now?: Date } = {},
): Promise<Result<TechpieLinkListVM, ApiError>> {
  const result = await repository.listLinks(query);
  if (!result.ok) return err(result.error);
  return ok(toTechpieLinkListVM(result.value, { now: options.now ?? new Date() }));
}

/** 供页面把 query 状态映射成四态 */
export function techpieLinkListState(input: {
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

/* ------------------------------------------------------------------ *
 * 发起绑定 / 解绑 / 续期
 * ------------------------------------------------------------------ */

export interface BindPlatformResult {
  link: CampusBindingSummary;
  /** 需要用户在**校园系统侧**完成的下一步（如 OPENID 授权） */
  nextStep: string | null;
}

/**
 * 用例：发起绑定。
 *
 * ⚠️ 三条**客户端闸门**在发请求之前执行（§11.18-D / E）：
 * 1. `password` 凭证一律拒绝 —— Web 端绝不发送明文密码；
 * 2. 非 Phase 0 平台一律拒绝 —— Phase 1–3 本轮不实现；
 * 3. 非 OPENID 通道的 Phase 0 平台也拒绝（当前不存在这种平台，但闸门要显式）。
 *
 * 这样"不实现 Phase 1"不是一句注释，而是**调用方拿不到那个请求**。
 */
export async function bindCampusPlatform(
  repository: TechpieRepository,
  input: { platform: CampusPlatform; credential: BindCredential; idempotencyKey?: string },
): Promise<Result<BindPlatformResult, ApiError>> {
  const blocked = assertPhase0Credential({
    platform: input.platform,
    credential: input.credential,
  });
  if (blocked) {
    return err({ code: 'FORBIDDEN', message: blocked, details: { reason: 'PHASE_1_NOT_IMPLEMENTED' } });
  }

  const result = await repository.createLink({
    platform: input.platform,
    credential: input.credential,
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
  });
  if (!result.ok) return err(result.error);

  const nextStep =
    result.value.status === 'LINKING'
      ? `请在「${CAMPUS_PLATFORM_LABELS[input.platform]}」侧完成 OPENID 授权，然后刷新本页。` +
        '授权发生在学校/微信侧，可达鸭不接触你的登录凭证。'
      : null;

  return ok({ link: result.value, nextStep });
}

/** 用例：解绑（DELETE） */
export async function unbindCampusLink(
  repository: TechpieRepository,
  linkId: string,
): Promise<Result<{ deleted: true }, ApiError>> {
  return repository.deleteLink(linkId);
}

/**
 * 用例：手动续期（**已冻结 action** `POST /links/:id/renew`）。
 *
 * F3：上游不支持续期时服务端返回 `CONFLICT` / `RENEW_NOT_SUPPORTED`，
 * UI 必须**如实**说"该功能暂不可用"，**不得**谎称"已续期"。
 */
export async function renewCampusLink(
  repository: TechpieRepository,
  linkId: string,
): Promise<Result<CampusBindingSummary, ApiError>> {
  return repository.renewLink(linkId);
}

/** 续期失败时的诚实文案（不谎称成功） */
export function renewFailureMessage(error: ApiError): string {
  const details = error.details;
  const reason =
    details && typeof details === 'object' && 'reason' in details
      ? (details as { reason?: unknown }).reason
      : undefined;
  if (reason === 'RENEW_NOT_SUPPORTED') {
    return '该平台的续期能力尚未确认，可达鸭不会假装续期成功。绑定状态保持原样，你可以稍后重试或重新绑定。';
  }
  return error.message;
}

/**
 * 可发起绑定的平台清单（**数据驱动**，不硬编码在组件里）。
 * Phase 0 可绑的只有校园卡；其余平台照常展示，但按钮是"未开放"并给出阻塞原因。
 */
export interface BindablePlatformVM {
  platform: CampusPlatform;
  label: string;
  description: string;
  phaseLabel: string;
  /** 本轮是否可发起 */
  available: boolean;
  /** 不可发起时的原因（可直接渲染） */
  blockedReason: string | null;
  openIdChannel: boolean;
}

export function bindablePlatforms(
  links: readonly Pick<CampusBindingSummary, 'platform' | 'status'>[],
): BindablePlatformVM[] {
  const bound = new Set(
    links.filter((link) => link.status === 'LINKED' || link.status === 'LINKING').map((l) => l.platform),
  );
  return (Object.keys(CAMPUS_PLATFORM_LABELS) as CampusPlatform[]).map((platform) => {
    const phase = CAMPUS_PLATFORM_PHASE[platform];
    const available = phase === 'phase0' && !bound.has(platform);
    let blockedReason: string | null = null;
    if (phase !== 'phase0') blockedReason = PHASE_BLOCKED_REASON;
    else if (bound.has(platform)) blockedReason = '已绑定。需要更换时先解绑再重新绑定。';
    return {
      platform,
      label: CAMPUS_PLATFORM_LABELS[platform],
      description: CAMPUS_PLATFORM_DESCRIPTIONS[platform],
      phaseLabel: PHASE_LABELS[phase],
      available,
      blockedReason,
      openIdChannel: CAMPUS_PLATFORM_ACCESS_MODE[platform] === 'openid',
    };
  });
}
