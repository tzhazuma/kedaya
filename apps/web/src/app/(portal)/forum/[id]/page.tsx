import type { Metadata } from 'next';

import { ForumPostDetailView } from '@/presentation/components/forum/ForumPostDetailView';

export const metadata: Metadata = {
  title: '主题详情',
  description: '可达鸭论坛主题详情：正文、回复列表、回复框与举报入口。',
};

export default async function ForumPostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ForumPostDetailView id={id} />;
}
