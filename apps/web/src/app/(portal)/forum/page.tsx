import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { findPortalModule } from '@/domain/models/module';
import { PORTAL_MODULES } from '@/domain/models/modules';
import { PageHeader } from '@/presentation/components/PageHeader';
import { ForumPostList } from '@/presentation/components/forum/ForumPostList';

/** 模块元数据来自冻结契约的模块注册表（不硬编码模块名） */
const FORUM_MODULE = findPortalModule(PORTAL_MODULES, 'forum');

export const metadata: Metadata = {
  title: FORUM_MODULE?.nameZh ?? '论坛',
  description: `${FORUM_MODULE?.summary ?? '版块、主题、回复、举报与治理'}。支持匿名发帖，被隐藏的主题会显式标注状态。`,
};

export default function ForumPage() {
  if (!FORUM_MODULE) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={FORUM_MODULE.nameZh}
        description={`${FORUM_MODULE.summary}。数据流：presentation（本页）→ application（用例）→ domain（端口/模型）← data（mock / HTTP 适配器）。主题列表使用游标分页。`}
      />
      <ForumPostList />
    </div>
  );
}
