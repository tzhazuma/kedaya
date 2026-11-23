import type { Metadata } from 'next';

import { ACTIVITIES_PORTAL_ENTRY } from '@/domain/models/modules';
import { ActivityImport } from '@/features/activity-import/ActivityImport';
import { DeadlineImport } from '@/features/deadline-import/DeadlineImport';
import { KdyBadge } from '@/presentation/components/KdyBadge';
import { PageHeader } from '@/presentation/components/PageHeader';
import { moduleIcon } from '@/presentation/components/icons';

export const metadata: Metadata = {
  title: '导入课程 DDL 与校园活动',
  description:
    '在浏览器里导入课程截止日期，或从单篇公众号文章抽取校园活动候选。活动需逐条确认后才导出 ICS / JSON；不保存正文、不创建账号日程。',
};

const ActivityIcon = moduleIcon(ACTIVITIES_PORTAL_ENTRY.icon);

export default function ImportPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="导入"
        description="两条互不混用的导入路径：课程 DDL 只关心截止日期；校园活动有开始、地点与报名截止，必须先成为候选、再由你确认。"
      />

      <nav aria-label="导入类型" className="min-w-0">
        <ul className="flex flex-wrap gap-2">
          <li>
            <a
              href="#course-deadlines"
              className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-body hover:bg-surface-alt"
            >
              课程 DDL
            </a>
          </li>
          <li>
            <a
              href={ACTIVITIES_PORTAL_ENTRY.href}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-brand-soft bg-brand-soft px-3 text-sm font-medium text-brand-strong hover:bg-surface-alt"
            >
              <ActivityIcon className="size-4" aria-hidden />
              {ACTIVITIES_PORTAL_ENTRY.nameZh}
            </a>
          </li>
        </ul>
      </nav>

      <section
        id="course-deadlines"
        aria-labelledby="course-deadlines-heading"
        className="flex min-w-0 flex-col gap-4 scroll-mt-24"
      >
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="course-deadlines-heading" className="text-xl font-bold text-body">
              课程 DDL
            </h2>
            <p className="text-sm text-muted">
              把 Gradescope / Blackboard / 教务 EAMS 的页面另存为网页，拖进来解析截止日期并导出日历。
              全程在浏览器里完成，不经过服务器。
            </p>
          </div>
          <KdyBadge>仅课程截止</KdyBadge>
        </div>
        <DeadlineImport />
      </section>

      <section
        id="campus-activities"
        aria-labelledby="campus-activities-heading"
        className="flex min-w-0 flex-col gap-4 scroll-mt-24 border-t border-border pt-8"
      >
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2
              id="campus-activities-heading"
              className="flex items-center gap-2 text-xl font-bold text-body"
            >
              <ActivityIcon className="size-5 text-brand-strong" aria-hidden />
              {ACTIVITIES_PORTAL_ENTRY.nameZh}
            </h2>
            <p className="text-sm text-muted">
              用户主动给<strong>单篇</strong>公众号链接，或直接粘贴正文；抽取候选活动、核对原文证据、编辑时间与报名截止，
              逐条确认后导出 ICS / JSON。
            </p>
          </div>
          <KdyBadge tone="warning">无登录 · 仅本次导出</KdyBadge>
        </div>
        <ActivityImport />
      </section>
    </div>
  );
}
