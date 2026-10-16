import type { Metadata } from 'next';

import { PageHeader } from '@/presentation/components/PageHeader';
import { TrackList } from '@/presentation/components/wildlife/TrackList';

export const metadata: Metadata = {
  title: '推断轨迹',
  description:
    '动物活动轨迹：由同学偶发上报推断得出的活动范围与走廊，并非实测运动路径。页面显著标注「推断轨迹，非实测路径」。',
};

export default function WildlifeTracksPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="wildlife · 轨迹"
        title="推断轨迹（非实测路径）"
        description="数据来自同学偶发上报，不是 GPS 项圈：无法重建真实运动路径。轨迹由 DBSCAN 聚类 + 走廊连接生成，只连直线，不做插值、平滑或地图匹配 —— 宁可轨迹断裂，也不编造。"
      />
      <TrackList />
    </div>
  );
}
