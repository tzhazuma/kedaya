import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { findPortalModule } from '@/domain/models/module';
import { PORTAL_MODULES } from '@/domain/models/modules';
import { PageHeader } from '@/presentation/components/PageHeader';
import { BuddyPostList } from '@/presentation/components/buddy/BuddyPostList';

/** 模块元数据来自冻结契约的模块注册表（不硬编码模块名） */
const BUDDY_MODULE = findPortalModule(PORTAL_MODULES, 'buddy');

export const metadata: Metadata = {
  title: BUDDY_MODULE?.nameZh ?? '找搭子',
  description: `${BUDDY_MODULE?.summary ?? '运动、自习、吃饭、出行的组队匹配'}。三个板块（自习与学术 / 日常与出行 / 运动组队），封闭标签匹配，游标分页。`,
};

export default function BuddyPage() {
  if (!BUDDY_MODULE) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={BUDDY_MODULE.nameZh}
        description={`${BUDDY_MODULE.summary}。数据流：presentation（本页）→ application（用例）→ domain（端口/模型）← data（mock / HTTP 适配器）。列表使用游标分页，板块由活动类型派生。`}
      />
      <BuddyPostList />
    </div>
  );
}
