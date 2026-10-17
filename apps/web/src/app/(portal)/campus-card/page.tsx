import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { findPortalModule } from '@/domain/models/module';
import { PORTAL_MODULES } from '@/domain/models/modules';
import { KdyButton } from '@/presentation/components/KdyButton';
import { PageHeader } from '@/presentation/components/PageHeader';
import { CampusCardPanel } from '@/presentation/components/techpie/CampusCardPanel';
import { TechpieCredentialNotice } from '@/presentation/components/techpie/TechpieCredentialNotice';

/** 模块元数据来自冻结契约的模块注册表（不硬编码模块名） */
const CAMPUS_CARD_MODULE = findPortalModule(PORTAL_MODULES, 'campus-card');

export const metadata: Metadata = {
  title: CAMPUS_CARD_MODULE?.nameZh ?? '校园卡',
  description:
    '校园卡余额、流水与付款码。走 eCard 的独立 OPENID 通道，与 CASTGC 校园会话完全解耦；付款码 60 秒有效、一次性，码值不进日志与审计正文。',
};

export default function CampusCardPage() {
  if (!CAMPUS_CARD_MODULE) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={CAMPUS_CARD_MODULE.nameZh}
        description={`${CAMPUS_CARD_MODULE.summary}。本页属于 TechPie 整合 Phase 0：校园卡走独立的 OPENID 通道（与 eGate / CpDaily 的校园会话不是同一条链路），因此可以在不代持校园会话的前提下独立落地。`}
        actions={
          <KdyButton href="/techpie" variant="secondary" size="sm">
            绑定管理
          </KdyButton>
        }
      />
      <TechpieCredentialNotice compact />
      <CampusCardPanel />
    </div>
  );
}
