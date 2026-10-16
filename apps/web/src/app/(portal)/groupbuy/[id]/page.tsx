import type { Metadata } from 'next';

import { GroupBuyDetailView } from '@/presentation/components/groupbuy/GroupBuyDetailView';

export const metadata: Metadata = {
  title: '拼单详情',
  description: '可达鸭拼单详情：成团进度、参与者、规则与参团动作。',
};

export default async function GroupBuyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <GroupBuyDetailView id={id} />;
}
