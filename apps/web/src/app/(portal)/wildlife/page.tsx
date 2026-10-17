import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { findPortalModule } from '@/domain/models/module';
import { PORTAL_MODULES } from '@/domain/models/modules';
import { PageHeader } from '@/presentation/components/PageHeader';
import { WildlifeExplorer } from '@/presentation/components/wildlife/WildlifeExplorer';

/** 模块元数据来自冻结契约的模块注册表（不硬编码模块名） */
const WILDLIFE_MODULE = findPortalModule(PORTAL_MODULES, 'wildlife');

export const metadata: Metadata = {
  title: WILDLIFE_MODULE?.nameZh ?? '野生动物',
  description:
    '校园动物活动区域与推断轨迹：静态校园平面图 + 叠加层（活动区域 / 聚合热点 / 推断轨迹 / 观测点）。位置已模糊化，热点为历史聚合，非实时位置。',
};

export default function WildlifePage() {
  if (!WILDLIFE_MODULE) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={WILDLIFE_MODULE.nameZh}
        description={`${WILDLIFE_MODULE.summary}。底图方案：静态校园平面图 + SVG 叠加层（校园尺度下街道图信息密度更低，且绕开 GCJ-02 坐标系问题）。数据流：presentation（本页）→ application（用例）→ domain（端口/模型）← data（mock / HTTP 适配器）。`}
        actions={undefined}
      />
      <WildlifeExplorer />
    </div>
  );
}
