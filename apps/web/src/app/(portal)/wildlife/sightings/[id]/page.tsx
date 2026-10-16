import type { Metadata } from 'next';

import { PageHeader } from '@/presentation/components/PageHeader';
import { SightingDetailView } from '@/presentation/components/wildlife/SightingDetailView';

export const metadata: Metadata = {
  title: '观测详情',
  description:
    '动物观测详情：公开时间（已粗化）、所属区域、投喂政策与位置模糊化说明。公开响应不含精确坐标与上报人 id。',
};

export default async function WildlifeSightingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="wildlife · 观测"
        title="观测详情"
        description="这里展示的是公开信息：精确坐标与上报人 id 不在响应里（不是「前端不显示」，而是接口就不返回）。"
      />
      <SightingDetailView sightingId={id} />
    </div>
  );
}
