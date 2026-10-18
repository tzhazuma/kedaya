import type { Metadata } from 'next';

import { PageHeader } from '@/presentation/components/PageHeader';
import { ForumComposer } from '@/presentation/components/forum/ForumComposer';

export const metadata: Metadata = {
  title: '发帖',
  description: '可达鸭论坛发帖：选择版块、撰写正文、添加标签，并可选匿名发布。',
};

export default function ForumNewPostPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="发新主题"
        description="发帖前请确认内容不含他人隐私；命中敏感词会被拦截（不会静默改写）。匿名开关的说明见下方表单。"
      />
      <ForumComposer />
    </div>
  );
}
