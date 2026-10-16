import type { Metadata } from 'next';

import { PageHeader } from '@/presentation/components/PageHeader';
import { BuddyComposer } from '@/presentation/components/buddy/BuddyComposer';

export const metadata: Metadata = {
  title: '发布搭子',
  description: '可达鸭找搭子发布：板块、封闭标签、时间、地点、人数与性别偏好。',
};

export default function BuddyNewPostPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="校园服务 · buddy"
        title="发布一个搭子"
        description="标签只能从封闭标签表里选（自由文本无法用于匹配）；正文里不要写联系方式 —— 申请通过后系统会经站内信交换。"
      />
      <BuddyComposer />
    </div>
  );
}
