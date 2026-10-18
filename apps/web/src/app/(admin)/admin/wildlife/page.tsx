import type { Metadata } from 'next';

import { WildlifeModerationQueue } from '@/presentation/components/admin/WildlifeModerationQueue';
import { KdyAlert } from '@/presentation/components/KdyAlert';
import { PageHeader } from '@/presentation/components/PageHeader';

export const metadata: Metadata = {
  title: '动物观测审核',
  description:
    '可达鸭管理后台 · 校园动物观测审核队列：通过/拒绝（契约 §11.2 冻结动作 moderate）、保护物种双人复核、疑似受伤优先。',
  robots: { index: false, follow: false },
};

export default function AdminWildlifePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="动物观测审核"
        description="审核队列按「疑似受伤优先」排序；保护物种必须两名审核员复核；拒绝必须填写理由（仅审核端可见）。"
      />
      <KdyAlert tone="warning" title="占位实现：审核员身份是硬编码的">
        <p>
          当前审核员为演示常量（`DEMO_MODERATOR` / `DEMO_SECOND_MODERATOR`），未接契约 §5 的第一级身份层，
          也没有真实的角色判定。真实实现必须由服务端返回 403 FORBIDDEN 作为最终边界 ——
          前端的按钮禁用只是体验，不是权限。
        </p>
      </KdyAlert>
      <WildlifeModerationQueue />
    </div>
  );
}
