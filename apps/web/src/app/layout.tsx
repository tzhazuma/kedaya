import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { SiteFooter } from '@/presentation/components/SiteFooter';
import { SiteHeader } from '@/presentation/components/SiteHeader';

import './globals.css';
import { Providers } from './providers';

const TITLE = '可达鸭 · 上海科技大学统一校园服务平台';
const DESCRIPTION =
  '可达鸭（KedaYa）—— 上科大，什么需求都可以到达。第三方开源校园服务平台，聚合拼单、跑腿、失物招领、论坛等校内分散服务入口。';

export const metadata: Metadata = {
  // openGraph / twitter 图片需要绝对地址；部署时用 NEXT_PUBLIC_KEDAYA_SITE_URL 覆盖
  metadataBase: new URL(process.env.NEXT_PUBLIC_KEDAYA_SITE_URL ?? 'http://localhost:3000'),
  title: {
    default: TITLE,
    template: '%s · 可达鸭',
  },
  description: DESCRIPTION,
  applicationName: '可达鸭',
  keywords: ['上海科技大学', '上科大', '校园服务', '拼单', '跑腿', '可达鸭', 'KedaYa'],
  openGraph: {
    type: 'website',
    locale: 'zh_CN',
    siteName: '可达鸭',
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: '/brand/cover.png',
        width: 1200,
        height: 630,
        alt: '可达鸭 · 上海科技大学统一校园服务平台',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/brand/cover.png'],
  },
  icons: {
    icon: '/brand/kedaya-mascot.svg',
    apple: '/brand/kedaya-mascot.svg',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning：ThemeProvider 会在客户端切换 <html> 的 class / color-scheme
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-dvh bg-canvas text-body antialiased">
        <Providers>
          <div className="flex min-h-dvh flex-col">
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </div>
        </Providers>
      </body>
    </html>
  );
}
