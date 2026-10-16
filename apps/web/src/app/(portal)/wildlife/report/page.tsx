import type { Metadata } from 'next';

import { PageHeader } from '@/presentation/components/PageHeader';
import { KdyAlert } from '@/presentation/components/KdyAlert';
import { SightingReportForm } from '@/presentation/components/wildlife/SightingReportForm';

export const metadata: Metadata = {
  title: '上报动物观测',
  description:
    '上报校园动物观测：上传照片（服务端强制剥离 EXIF）、地图点选地点、填写发现时间、自动分类建议 + 手动选物种、可选给个体起名。位置会被模糊化，敏感区不公开坐标。',
};

export default function WildlifeReportPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="wildlife · 上报"
        title="上报一条动物观测"
        description="发现时间与上报时间是两个字段：请填写你实际看到动物的时间。分类是增强而不是前置条件 —— 没有自动识别也能完整上报。"
      />
      <KdyAlert tone="info" title="平台定位">
        <p>
          可达鸭是第三方非官方平台。本模块只做校园动物的信息记录与展示，不代表学校发布任何管理规定；
          黑天鹅等校方管理动物由校方处置，平台不做任何救助决策。
        </p>
      </KdyAlert>
      <SightingReportForm />
    </div>
  );
}
