import type { Metadata } from 'next';

import { PageHeader } from '@/presentation/components/PageHeader';
import { BuddyPostDetailView } from '@/presentation/components/buddy/BuddyPostDetailView';

export const metadata: Metadata = {
  title: '搭子详情',
  description: '可达鸭找搭子活动详情：申请加入、发起人审批、关闭招募与隐私说明。',
};

export default async function BuddyPostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="校园服务 · buddy"
        title="活动详情"
        description="申请（join）只是表达意向，不占名额；发起人接受（decide）后才计入人数。联系方式不会出现在这里。"
      />
      <BuddyPostDetailView id={id} />
    </div>
  );
}
