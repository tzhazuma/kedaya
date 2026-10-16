/**
 * 投喂政策徽章（规格 §8.1 E1/E2 / §8.3）。
 *
 * 三值枚举的**色调语义**来自 domain 的 `FEEDING_POLICY_TONES`
 * （allowed→success / discouraged→warning / forbidden→danger），
 * 组件不自己判断颜色 —— 否则改一次政策语义就要改多处。
 */
import { FEEDING_POLICY_LABELS, FEEDING_POLICY_TONES, type FeedingPolicy } from '@/domain/models/wildlife/species';

import { KdyBadge, type KdyBadgeTone } from '../KdyBadge';

/** domain 的语义色调名 → 组件库的徽章色调（映射只写一次，两处不会漂移） */
const TONE_TO_BADGE: Record<'success' | 'warning' | 'danger', KdyBadgeTone> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

export interface FeedingPolicyBadgeProps {
  policy: FeedingPolicy;
  className?: string;
  /** 是否附带说明文字（区域详情页用） */
  withHint?: boolean;
}

export function FeedingPolicyBadge({ policy, className, withHint = false }: FeedingPolicyBadgeProps) {
  const badgeTone = TONE_TO_BADGE[FEEDING_POLICY_TONES[policy]];
  return (
    <span className="inline-flex items-center gap-2">
      <KdyBadge tone={badgeTone} className={className} title={`投喂政策：${policy}`}>
        {FEEDING_POLICY_LABELS[policy]}
      </KdyBadge>
      {withHint && policy === 'forbidden' ? (
        <span className="text-xs text-danger">禁止投喂：人类食物会损害动物健康</span>
      ) : null}
    </span>
  );
}
