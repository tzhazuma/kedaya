import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { findPortalModule } from '@/domain/models/module';
import { PORTAL_MODULES } from '@/domain/models/modules';
import { KdyButton } from '@/presentation/components/KdyButton';
import { PageHeader } from '@/presentation/components/PageHeader';
import { TechpieCapabilityList } from '@/presentation/components/techpie/TechpieCapabilityList';

const TECHPIE_MODULE = findPortalModule(PORTAL_MODULES, 'techpie');

export const metadata: Metadata = {
  title: '校园能力清单',
  description:
    '当前账号可用的校园能力清单。未绑定的能力显示 CAMPUS_BINDING_REQUIRED 引导（不是报错）；Phase 1+ 的能力如实标注为尚未开放。',
};

export default function TechpieCapabilitiesPage() {
  if (!TECHPIE_MODULE) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={`校园服务 · ${TECHPIE_MODULE.id}`}
        title="校园能力清单"
        description="按绑定状态分组：可用 / 需要先绑定 / 尚未开放。未绑定项显示的是引导而不是错误 —— 「已登录但未绑定」是契约 §5 明确承认的合法状态，不绑定不影响可达鸭的自有功能。"
        actions={
          <KdyButton href="/techpie" variant="secondary" size="sm">
            绑定管理
          </KdyButton>
        }
      />
      <TechpieCapabilityList />
    </div>
  );
}
