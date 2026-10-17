import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { findPortalModule } from '@/domain/models/module';
import { PORTAL_MODULES } from '@/domain/models/modules';
import { CampusMapView } from '@/features/map/CampusMapView';
import { PageHeader } from '@/presentation/components/PageHeader';

/** 模块元数据来自冻结契约的模块注册表（不硬编码模块名） */
const WILDLIFE_MODULE = findPortalModule(PORTAL_MODULES, 'wildlife');

export const metadata: Metadata = {
  title: '校园地图 · 猫鸟黑天鹅',
  description:
    '基于 OpenStreetMap（ODbL）离线渲染的上海科技大学张江校区底图，叠加动物活动区域、聚合热点、推断轨迹与已模糊化的观测点；标注 25 个校园地点并逐项注明定位依据。',
};

export default function CampusMapPage() {
  if (!WILDLIFE_MODULE) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={`校园服务 · ${WILDLIFE_MODULE.id} · map`}
        title="校园地图"
        description="底图来自 OpenStreetMap（ODbL 1.0，需署名），由仓库内脚本离线渲染为 SVG/GeoJSON，不依赖在线瓦片 —— 小程序 web-view 与离线场景都能用。坐标链路：WGS84 → 本地等距平面 → 底图像素，不经过 GCJ-02。地点标注逐项区分「已确证 / 推断 / 近似」，并公开数据来源、快照时间与精度。"
        actions={undefined}
      />
      <CampusMapView />
    </div>
  );
}
