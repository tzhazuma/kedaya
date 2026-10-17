import Link from 'next/link';
import type { ReactNode } from 'react';

/** 管理后台路由组：独立布局 + 显著的非官方/占位提示。 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8">
      <nav aria-label="管理后台导航" className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <Link href="/admin" className="rounded-md bg-surface-alt px-3 py-1 hover:text-body">
          概览
        </Link>
        <Link href="/" className="rounded-md px-3 py-1 hover:text-body">
          返回门户
        </Link>
        <span className="ml-auto rounded-md border border-warning/40 px-2 py-1 text-warning">
          占位实现 · 数据来自 mock，未接真实鉴权
        </span>
      </nav>
      {children}
    </div>
  );
}
