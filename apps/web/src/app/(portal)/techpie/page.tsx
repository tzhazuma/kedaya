import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { findPortalModule } from '@/domain/models/module';
import { PORTAL_MODULES } from '@/domain/models/modules';
import { PageHeader } from '@/presentation/components/PageHeader';
import { TechpieCredentialNotice } from '@/presentation/components/techpie/TechpieCredentialNotice';
import { TechpieLinkList } from '@/presentation/components/techpie/TechpieLinkList';

/** 模块元数据来自冻结契约的模块注册表（不硬编码模块名） */
const TECHPIE_MODULE = findPortalModule(PORTAL_MODULES, 'techpie');

export const metadata: Metadata = {
  title: TECHPIE_MODULE?.nameZh ?? 'TechPie 整合',
  description:
    '校园系统绑定管理：列出全部绑定（不含凭证）、发起绑定、解绑、手动续期。Phase 0 只接入零合规风险入口 —— 校园卡走独立 OPENID 通道，WebView 由用户在学校页面自登录。',
};

export default function TechpiePage() {
  if (!TECHPIE_MODULE) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={TECHPIE_MODULE.nameZh}
        description={`${TECHPIE_MODULE.summary}。本页是 Phase 0：绑定列表（GET /techpie/links，响应不含凭证）、发起绑定（POST /techpie/links）、解绑（DELETE）、手动续期（POST /techpie/links/:id/renew，已冻结动作）。结构化校园数据（课表 / 考试 / DDL）与场馆预约属于 Phase 1–2，阻塞于学校信息办的书面确认，本轮不实现。`}
        actions={undefined}
      />
      <TechpieCredentialNotice />
      <TechpieLinkList />
    </div>
  );
}
