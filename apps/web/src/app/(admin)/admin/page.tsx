import type { Metadata } from 'next';
import Link from 'next/link';

import { AdminDashboard } from '@/presentation/components/admin/AdminDashboard';
import { PageHeader } from '@/presentation/components/PageHeader';

export const metadata: Metadata = {
  title: '管理后台',
  description: '可达鸭管理后台占位：模块开关表与审计日志表（体现契约 §9 的审计字段）。',
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="模块开关与审计"
        description="演示契约 §9 的合规要求：敏感模块的开关受权限约束，任何开关操作（含被拒）都会落审计日志；审计主体标识默认脱敏。"
      />
      <nav aria-label="后台功能" className="flex flex-wrap gap-2 text-xs">
        <Link
          href="/admin/dishes"
          className="rounded-md bg-brand px-3 py-1.5 font-medium text-ink hover:bg-brand-strong hover:text-inverse"
        >
          菜品营养数据管理 · 营养管家 →
        </Link>
      </nav>
      <AdminDashboard />
    </div>
  );
}
