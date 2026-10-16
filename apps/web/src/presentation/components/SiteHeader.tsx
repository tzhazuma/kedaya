'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '../theme/cn';
import { ThemeToggle } from '../theme/ThemeToggle';

const NAV = [
  { href: '/', label: '首页' },
  { href: '/groupbuy', label: '拼单' },
  { href: '/buddy', label: '找搭子' },
  { href: '/admin', label: '管理后台' },
] as const;

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          {/* 品牌图来自 assets/brand（已复制到 public/brand）。
              用原生 <img> 而非 next/image：SVG 走优化器需开 dangerouslyAllowSVG，
              对本地可信静态资源没有必要（此处为 next/image 规则的显式豁免）。 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/kedaya-mascot.svg" alt="可达鸭吉祥物" className="size-8" />
          <span className="flex flex-col leading-none">
            <span className="text-sm font-bold text-body">可达鸭</span>
            <span className="text-xs text-muted">上海科技大学</span>
          </span>
        </Link>

        <nav aria-label="主导航" className="ml-2 flex items-center gap-1">
          {NAV.map((item) => {
            const active =
              item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm transition-colors',
                  active ? 'bg-brand-soft text-brand-strong' : 'text-muted hover:bg-surface-alt',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
