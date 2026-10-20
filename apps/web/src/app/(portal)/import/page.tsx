import type { Metadata } from 'next';

import { PageHeader } from '@/presentation/components/PageHeader';
import { DeadlineImport } from '@/features/deadline-import/DeadlineImport';

export const metadata: Metadata = {
  title: '导入课程 DDL',
  description:
    '把 Gradescope / Blackboard / 教务 EAMS 的页面另存为网页，拖进来就能解析出截止日期并导出日历。全程在你的浏览器里完成，不经过服务器。',
};

export default function ImportPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="导入课程 DDL"
        description="把平台页面另存为网页，拖进来解析。**不联网、不登录、不经过服务器** —— 所有解析都在你的浏览器里完成。"
      />
      <DeadlineImport />
    </div>
  );
}
