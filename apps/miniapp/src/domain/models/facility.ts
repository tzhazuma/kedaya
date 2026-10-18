/**
 * 场馆预约（`facility`）领域模型 —— 纯 TypeScript，零框架依赖（契约 §7）。
 *
 * 与后端 `services/api/src/modules/facility/domain/facility.domain.ts` 及
 * `facility.service.ts` 逐条对齐：
 *   · 状态机 `booked → cancelled`（**单向**，取消后不能恢复 —— 那个时段已经放出去了，
 *     恢复会让别人刚约上的时段被顶掉）；
 *   · 取消前置条件：`status === 'booked'`，否则 `CONFLICT`；
 *   · 时段冲突由**服务端**判定（`findOverlapping`），客户端只做展示与前置校验。
 *
 * ⚠️ **冲突判定不在客户端**。原因：客户端看到的列表是分页的，
 * 它不知道完整占用情况；在客户端"算出"没冲突然后提交，只会换来一个 409。
 * 所以这里**不实现**冲突算法，只在收到 409 时给出可读文案。
 */

/* ------------------------------------------------------------------ *
 * 状态
 * ------------------------------------------------------------------ */

export const FACILITY_STATUS = {
  booked: 'booked',
  cancelled: 'cancelled',
} as const;
export type FacilityStatus = (typeof FACILITY_STATUS)[keyof typeof FACILITY_STATUS];

export const FACILITY_STATUSES = [FACILITY_STATUS.booked, FACILITY_STATUS.cancelled] as const;

export const FACILITY_STATUS_LABELS: Readonly<Record<string, string>> = {
  booked: '已预约',
  cancelled: '已取消',
};

/** 状态 → 徽章色调（由 `KdyTag` 的 tone 消费，不在这里写色值） */
export const FACILITY_STATUS_TONES: Readonly<Record<string, 'brand' | 'success' | 'neutral'>> = {
  booked: 'brand',
  cancelled: 'neutral',
};

/* ------------------------------------------------------------------ *
 * 场馆种类
 * ------------------------------------------------------------------ */

/**
 * 场馆种类白名单。
 *
 * 这是**客户端预设**，不是硬约束 —— 后端 `kind` 是自由字符串（`z.string().min(1).max(500)`），
 * 所以新增种类不需要改后端。这里列出的只是"能一键选"的常见项，
 * 用户仍可手填。**不要把这里当成契约**。
 */
export const FACILITY_KINDS = [
  '体育馆',
  '健身房',
  '羽毛球馆',
  '篮球场',
  '网球场',
  '游泳馆',
  '乒乓球室',
  '会议室',
  '琴房',
  '其他',
] as const;
export type FacilityKind = (typeof FACILITY_KINDS)[number];

/** 可预约场馆名的建议值（同样只是建议，用户可手填） */
export const FACILITY_NAME_SUGGESTIONS: readonly string[] = [
  '上海科技大学体育馆',
  '游泳馆',
  '羽毛球馆',
  '风雨操场',
  '学生活动中心 201',
  '图书馆研讨间',
];

/* ------------------------------------------------------------------ *
 * 字段上限（与后端 Zod / 数据库列宽对齐）
 * ------------------------------------------------------------------ */

export const FACILITY_KIND_MAX = 60;
export const FACILITY_NAME_MAX = 80;
/** 单次预约最长时长：4 小时（超过这个基本都是误填，或应该走场馆办公室） */
export const FACILITY_MAX_DURATION_MINUTES = 4 * 60;
/** 提前预约的最远天数：30 天（再远的时间场馆自己也还没排期） */
export const FACILITY_MAX_DAYS_AHEAD = 30;

/* ------------------------------------------------------------------ *
 * 数据形状
 * ------------------------------------------------------------------ */

/** 一条预约（对应后端 `FacilityBookingModel` 的 wire 形态） */
export interface FacilityBooking {
  readonly id: string;
  /** 发起人 userId —— 取消按钮的显示依据（与当前登录用户比对） */
  readonly ownerId: string;
  readonly kind: string;
  readonly facilityName: string | null;
  /** ISO 8601 字符串（wire 层统一用字符串，不强加 Date） */
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: string;
  /** 费用，**分**（契约：金额一律整数分） */
  readonly feeFen: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 列表项（卡片直接可读） */
export interface FacilityBookingSummary {
  readonly id: string;
  readonly kind: string;
  readonly facilityName: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: string;
  readonly feeFen: number;
  readonly isMine: boolean;
}

/** 创建输入 */
export interface CreateFacilityBookingInput {
  readonly kind: string;
  readonly facilityName?: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly feeFen: number;
}

/* ------------------------------------------------------------------ *
 * 校验
 * ------------------------------------------------------------------ */

/** 校验结果：`null` 表示没问题，否则是给人看的文案 */
export type Problem = string | null;

export function kindProblem(kind: string): Problem {
  const value = kind.trim();
  if (value.length === 0) return '请填写场馆种类';
  if (value.length > FACILITY_KIND_MAX) return `场馆种类最多 ${FACILITY_KIND_MAX} 个字`;
  return null;
}

export function facilityNameProblem(name: string | null | undefined): Problem {
  if (name === null || name === undefined) return null; // 可选
  const value = name.trim();
  if (value.length === 0) return null;
  if (value.length > FACILITY_NAME_MAX) return `场馆名称最多 ${FACILITY_NAME_MAX} 个字`;
  return null;
}

/**
 * 时段校验。
 *
 * ⚠️ 这里**不判冲突**（那是服务端的事），只判「这个时段本身说不说得通」：
 * 结束必须晚于开始、时长不超过 4 小时、不能约在过去、不能超过 30 天。
 */
export function timeRangeProblem(
  startsAt: string,
  endsAt: string,
  now: Date = new Date(),
): Problem {
  const start = new Date(startsAt);
  const end = new Date(endsAt);

  if (Number.isNaN(start.getTime())) return '请选择开始时间';
  if (Number.isNaN(end.getTime())) return '请选择结束时间';
  if (end.getTime() <= start.getTime()) return '结束时间必须晚于开始时间';

  const durationMinutes = (end.getTime() - start.getTime()) / 60_000;
  if (durationMinutes > FACILITY_MAX_DURATION_MINUTES) {
    return `单次预约最长 ${FACILITY_MAX_DURATION_MINUTES / 60} 小时`;
  }

  // 允许 5 分钟时钟偏差：手机时间略快不该导致提交失败
  const skewMs = 5 * 60 * 1000;
  if (start.getTime() < now.getTime() - skewMs) return '不能预约过去的时间';

  const maxAheadMs = FACILITY_MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000;
  if (start.getTime() > now.getTime() + maxAheadMs) {
    return `最多提前 ${FACILITY_MAX_DAYS_AHEAD} 天预约`;
  }

  return null;
}

export function feeProblem(feeFen: number): Problem {
  if (!Number.isInteger(feeFen)) return '费用必须是整数分';
  if (feeFen < 0) return '费用不能为负';
  return null;
}

/** 取消闸门：只有 `booked` 且是本人才能取消（与服务端一致） */
export function canCancel(booking: Pick<FacilityBooking, 'status' | 'ownerId'>, currentUserId: string | null): boolean {
  if (currentUserId === null) return false;
  if (booking.ownerId !== currentUserId) return false;
  return booking.status === FACILITY_STATUS.booked;
}

/* ------------------------------------------------------------------ *
 * 展示
 * ------------------------------------------------------------------ */

/** 时长（分钟） */
export function durationMinutes(booking: Pick<FacilityBooking, 'startsAt' | 'endsAt'>): number {
  const start = new Date(booking.startsAt).getTime();
  const end = new Date(booking.endsAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 60_000));
}

/** 把金额（分）格式化成 `¥12.50`；`0` 显示「免费」 */
export function formatFeeFen(feeFen: number): string {
  if (feeFen === 0) return '免费';
  return `¥${(feeFen / 100).toFixed(2)}`;
}

/** 行数据 → 卡片摘要 */
export function summarize(
  booking: FacilityBooking,
  currentUserId: string | null,
): FacilityBookingSummary {
  return {
    id: booking.id,
    kind: booking.kind,
    facilityName: booking.facilityName,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    status: booking.status,
    feeFen: booking.feeFen,
    isMine: currentUserId !== null && booking.ownerId === currentUserId,
  };
}
