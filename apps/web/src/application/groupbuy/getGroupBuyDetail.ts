/**
 * 用例：加载拼单详情（含参与者与规则）。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, formatRelativeTime, ok, type Result } from '@kedaya/shared';

import { formatFen } from '@/domain/models/groupbuy';
import type { GroupBuyDetail, GroupBuyParticipant } from '@/domain/models/groupbuy';
import type { GroupBuyRepository } from '@/domain/ports/groupbuy';

import { toGroupBuyItemVM, type GroupBuyListItemVM } from './listGroupBuys';

export interface GroupBuyParticipantVM {
  id: string;
  nickname: string;
  quantityLabel: string;
  paidLabel: string;
  joinedLabel: string;
  anonymous: boolean;
}

export interface GroupBuyDetailVM extends GroupBuyListItemVM {
  participants: GroupBuyParticipantVM[];
  rules: string[];
  participantCount: number;
  paidTotalLabel: string;
}

export function toGroupBuyParticipantVM(
  participant: GroupBuyParticipant,
  now: Date,
): GroupBuyParticipantVM {
  return {
    id: participant.id,
    nickname: participant.anonymous ? '匿名同学' : participant.nickname,
    quantityLabel: `${participant.quantity} 份`,
    paidLabel: formatFen(participant.paidFen),
    joinedLabel: formatRelativeTime(participant.joinedAt, now) || '时间未知',
    anonymous: participant.anonymous,
  };
}

export function toGroupBuyDetailVM(detail: GroupBuyDetail, now: Date): GroupBuyDetailVM {
  const base = toGroupBuyItemVM(detail, now);
  const participants = detail.participants.map((p) => toGroupBuyParticipantVM(p, now));
  const paidTotalFen = detail.participants.reduce((sum, p) => sum + p.paidFen, 0);
  return {
    ...base,
    participants,
    rules: detail.rules,
    participantCount: participants.length,
    paidTotalLabel: formatFen(paidTotalFen),
  };
}

export async function loadGroupBuyDetail(
  repository: GroupBuyRepository,
  id: string,
  now: Date = new Date(),
): Promise<Result<GroupBuyDetailVM, ApiError>> {
  const result = await repository.detail(id);
  if (!result.ok) return err(result.error);
  return ok(toGroupBuyDetailVM(result.value, now));
}

/** 参团领域动作（成功后返回最新详情视图模型） */
export async function joinGroupBuy(
  repository: GroupBuyRepository,
  id: string,
  quantity: number,
  now: Date = new Date(),
): Promise<Result<GroupBuyDetailVM, ApiError>> {
  const result = await repository.join(id, quantity);
  if (!result.ok) return err(result.error);
  return ok(toGroupBuyDetailVM(result.value, now));
}
