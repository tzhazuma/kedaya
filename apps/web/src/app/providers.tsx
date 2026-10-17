'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { ThemeProvider } from '@/presentation/theme';

import { createQueryClient } from './query-client';

/**
 * 应用装配（契约 §7：`app/` 负责 DI / Provider 装配）。
 *
 * 启动时序（契约 §8）：Provider 不做任何网络请求，首屏立即渲染；
 * 数据由各页面通过 TanStack Query 在后台并发拉取，失败静默降级为错误态 UI。
 *
 * ⚠️ QueryClient 的配置在 `./query-client.ts`（**独立于 JSX**，便于单测直接断言）。
 * 其中 `networkMode: 'always'` 是一个真实缺陷的修复，改动前请先读那里的注释。
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  );
}
