import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { findPortalModule } from '@/domain/models/module';
import { PORTAL_MODULES } from '@/domain/models/modules';
import { CampusBasemapToggle } from '@/features/map/CampusBasemapToggle';
import { CampusMapView } from '@/features/map/CampusMapView';
import { PageHeader } from '@/presentation/components/PageHeader';

/** 模块元数据来自冻结契约的模块注册表（不硬编码模块名） */
const WILDLIFE_MODULE = findPortalModule(PORTAL_MODULES, 'wildlife');

export const metadata: Metadata = {
  title: '校园地图 · 野生动物',
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
        description="默认使用仓库内离线渲染的 SVG/GeoJSON 底图（断网可用、校园尺度更细，不依赖在线瓦片）；也可切到 OpenStreetMap 在线瓦片看清校园在张江的位置。两者都用 WGS84，不经过 GCJ-02。地点标注逐项区分「已确证 / 推断 / 近似」，并公开数据来源与精度。"
        actions={undefined}
      />
      {/* 默认「离线底图」（仓库内 SVG/GeoJSON，断网可用）；
          「在线地图」是可选增强（Leaflet + OSM 瓦片，需要网络）。 */}
      <CampusBasemapToggle offlineView={<CampusMapView />} />
    </div>
  );
}
