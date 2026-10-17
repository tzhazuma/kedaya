import type { Metadata } from 'next';

import { PageHeader } from '@/presentation/components/PageHeader';
import { ZoneList } from '@/presentation/components/wildlife/ZoneList';

export const metadata: Metadata = {
  title: '动物活动区域',
  description:
    '校园动物活动区域列表：投喂政策（可投喂 / 不建议 / 禁止）、告示位文案、敏感区（只公开区域，不公开坐标）。',
};

export default function WildlifeZonesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="动物活动区域"
        description="区域由管理端人工定义（与算法聚类出的「热点」不是一回事）：它承载投喂政策、告示位与管理边界。禁投喂区域在区域详情与上报表单里都会显著提示。"
      />
      <ZoneList />
    </div>
  );
}
