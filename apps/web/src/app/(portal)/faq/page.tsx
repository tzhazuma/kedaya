import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { findPortalModule } from '@/domain/models/module';
import { PORTAL_MODULES } from '@/domain/models/modules';
import { KdyButton } from '@/presentation/components/KdyButton';
import { PageHeader } from '@/presentation/components/PageHeader';
import { FaqBrowser } from '@/presentation/components/faq/FaqBrowser';

/** 模块元数据来自冻结契约的模块注册表（不硬编码模块名） */
const FAQ_MODULE = findPortalModule(PORTAL_MODULES, 'faq');

export const metadata: Metadata = {
  title: FAQ_MODULE?.nameZh ?? '常见问题',
  description: `${FAQ_MODULE?.summary ?? '知识库与工单式自助答疑'}。无需登录即可搜索，条目可标记「有用」。`,
};

export default function FaqPage() {
  if (!FAQ_MODULE) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={`校园服务 · ${FAQ_MODULE.id}`}
        title={FAQ_MODULE.nameZh}
        description={`${FAQ_MODULE.summary}。先搜知识库；没有答案再到工单里提问。`}
        actions={
          <KdyButton href="/faq/tickets" variant="secondary" size="sm">
            我的工单
          </KdyButton>
        }
      />
      <FaqBrowser />
    </div>
  );
}
