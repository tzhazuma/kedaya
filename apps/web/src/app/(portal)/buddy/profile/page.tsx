import type { Metadata } from 'next';

import { PageHeader } from '@/presentation/components/PageHeader';
import { BuddyProfileEditor } from '@/presentation/components/buddy/BuddyProfileEditor';

export const metadata: Metadata = {
  title: '我的匹配资料',
  description:
    '可达鸭找搭子匹配资料：院系、兴趣与活动标签、每周可用时段（支持跨零点）、常去区域与运动水平。默认不参与匹配，可随时撤回。',
};

export default function BuddyProfilePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="校园服务 · buddy"
        title="我的匹配资料"
        description="这份资料只被算法使用：它不会展示给任何人（包括你申请活动的发起人），对外只输出聚合后的理由。默认关闭匹配，可随时撤回或删除。"
      />
      <BuddyProfileEditor />
    </div>
  );
}
