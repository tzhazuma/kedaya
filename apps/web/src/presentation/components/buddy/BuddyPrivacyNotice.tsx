import type { BuddyPrivacyItemVM } from '@/application/buddy/getBuddyPostDetail';

import { KdyBadge } from '../KdyBadge';
import { KdyCard } from '../KdyCard';

export interface BuddyPrivacySummary {
  publicNotice: string;
  hiddenNotice: string;
  contactExchange: string;
  withdrawal: string;
}

export interface BuddyPrivacyNoticeProps {
  items: readonly BuddyPrivacyItemVM[];
  summary: BuddyPrivacySummary;
  /** 紧凑模式：只显示四条硬要求（列表页用） */
  compact?: boolean;
  title?: string;
  className?: string;
}

const TONE_BY_VISIBILITY = {
  public: 'neutral',
  'algorithm-only': 'info',
  'after-accepted': 'brand',
  never: 'warning',
} as const;

/**
 * 找搭子隐私说明（**硬要求**）—— 四件事必须写清楚：
 * 哪些信息公开、联系方式怎么交换、匹配资料谁能看到、资料如何撤回。
 *
 * 刻意**不**声称"完全匿名"：活动本身是公开招募，发起人昵称可见。
 */
export function BuddyPrivacyNotice({
  items,
  summary,
  compact = false,
  title = '隐私说明：哪些信息公开、资料怎么撤回',
  className,
}: BuddyPrivacyNoticeProps) {
  return (
    <KdyCard tone="alt" className={className}>
      <section aria-labelledby="buddy-privacy-heading" className="flex flex-col gap-3">
        <h2 id="buddy-privacy-heading" className="text-sm font-semibold text-body">
          {title}
        </h2>

        <ul className="flex flex-col gap-2 text-sm text-muted">
          <li>
            <strong className="font-medium text-body">公开：</strong>
            {summary.publicNotice}
          </li>
          <li>
            <strong className="font-medium text-body">不公开：</strong>
            {summary.hiddenNotice}
          </li>
          <li>
            <strong className="font-medium text-body">联系方式：</strong>
            {summary.contactExchange}
          </li>
          <li>
            <strong className="font-medium text-body">可撤回：</strong>
            {summary.withdrawal}
          </li>
        </ul>

        {compact ? null : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs" data-testid="buddy-privacy-table">
              <caption className="sr-only">找搭子数据可见性矩阵</caption>
              <thead>
                <tr className="text-muted">
                  <th scope="col" className="border-b border-border py-2 pr-3 font-medium">
                    数据
                  </th>
                  <th scope="col" className="border-b border-border py-2 pr-3 font-medium">
                    可见性
                  </th>
                  <th scope="col" className="border-b border-border py-2 font-medium">
                    说明
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.topic} className="align-top">
                    <th scope="row" className="border-b border-border py-2 pr-3 font-normal text-body">
                      {item.topic}
                    </th>
                    <td className="border-b border-border py-2 pr-3">
                      <KdyBadge tone={TONE_BY_VISIBILITY[item.visibility]}>
                        {item.visibilityLabel}
                      </KdyBadge>
                    </td>
                    <td className="border-b border-border py-2 text-muted">{item.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-muted">
          说明：找搭子是事务性组队，不是交友/约会板块（契约 §11.10-G）。平台不采集性别与年龄用于匹配，
          性别偏好只作为发起人的准入约束。
        </p>
      </section>
    </KdyCard>
  );
}
