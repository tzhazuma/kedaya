import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { findPortalModule } from '@/domain/models/module';
import { PORTAL_MODULES } from '@/domain/models/modules';
import { KdyButton } from '@/presentation/components/KdyButton';
import { PageHeader } from '@/presentation/components/PageHeader';
import { WebviewLauncher } from '@/presentation/components/techpie/WebviewLauncher';

const TECHPIE_MODULE = findPortalModule(PORTAL_MODULES, 'techpie');

export const metadata: Metadata = {
  title: '校园系统直连',
  description:
    '用一次性票据打开学校系统：接下来的页面由学校系统提供，请在那里登录；可达鸭只转发一次性的访问票据，不接触你的登录凭证。',
};

export default function TechpieWebviewPage() {
  if (!TECHPIE_MODULE) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={`校园服务 · ${TECHPIE_MODULE.id}`}
        title="校园系统直连"
        description="Phase 0 的 WebView 直连（规格 §8.4 的 W4 方案）：可达鸭换取一张一次性票据，用它打开学校系统；登录在学校页面完成，我们不注入 cookie、不接触你的登录凭证。可打开的目标只能来自服务端白名单，页面不提供自定义 URL。"
        actions={
          <KdyButton href="/techpie" variant="secondary" size="sm">
            绑定管理
          </KdyButton>
        }
      />
      <WebviewLauncher />
    </div>
  );
}
