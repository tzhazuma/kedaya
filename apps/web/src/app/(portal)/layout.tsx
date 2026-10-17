import type { ReactNode } from 'react';

/** 门户路由组：统一内容宽度与留白。 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-4 py-8">{children}</div>;
}
