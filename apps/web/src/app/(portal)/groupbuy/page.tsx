import type { Metadata } from 'next';

import { PageHeader } from '@/presentation/components/PageHeader';
import { GroupBuyList } from '@/presentation/components/groupbuy/GroupBuyList';

export const metadata: Metadata = {
  title: '拼单',
  description: '可达鸭拼单：拼团凑单、参团、成团与结算。最小可跑通垂直切片（mock 数据）。',
};

export default function GroupBuyPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="垂直切片 · groupbuy"
        title="拼单"
        description="数据流：presentation（本页）→ application（用例）→ domain（端口/模型）← data（mock / HTTP 适配器）。列表使用游标分页，金额一律整数分。"
      />
      <GroupBuyList />
    </div>
  );
}
