import type { Metadata } from 'next';

import { PageHeader } from '@/presentation/components/PageHeader';
import { BuddyRecommendations } from '@/presentation/components/buddy/BuddyRecommendations';

export const metadata: Metadata = {
  title: '搭子推荐',
  description:
    '可达鸭找搭子推荐：每条推荐都给出可解释的中文理由（同一个院系 / 共同兴趣 N 项 / 时间能碰上），并标注当前匹配模式。',
};

export default function BuddyRecommendationsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="校园服务 · buddy"
        title="搭子推荐"
        description="推荐是可解释的：每条都列出为什么推荐给你。没有开启匹配资料时会降级为「按时间排序」，页面会明确标出来，不会假装是个性化推荐。"
      />
      <BuddyRecommendations />
    </div>
  );
}
