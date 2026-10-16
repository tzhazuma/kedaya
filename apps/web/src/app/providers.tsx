'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { ThemeProvider } from '@/presentation/theme';

/**
 * 应用装配（契约 §7：`app/` 负责 DI / Provider 装配）。
 *
 * 启动时序（契约 §8）：Provider 不做任何网络请求，首屏立即渲染；
 * 数据由各页面通过 TanStack Query 在后台并发拉取，失败静默降级为错误态 UI。
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  );
}
