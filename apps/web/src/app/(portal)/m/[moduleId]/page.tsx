import { Construction, Lock, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { findPortalModule } from '@/domain/models/module';
import { PORTAL_MODULES } from '@/domain/models/modules';
import { KdyAlert } from '@/presentation/components/KdyAlert';
import { KdyBadge } from '@/presentation/components/KdyBadge';
import { KdyButton } from '@/presentation/components/KdyButton';
import { KdyCard } from '@/presentation/components/KdyCard';
import { PageHeader } from '@/presentation/components/PageHeader';
import { moduleIcon } from '@/presentation/components/icons';

interface ModulePageProps {
  params: Promise<{ moduleId: string }>;
}

/** 让所有 20 个模块都有可达页面（而非 404），并如实标注"尚未实现"。 */
export function generateStaticParams() {
  return PORTAL_MODULES.map((mod) => ({ moduleId: mod.id }));
}

export async function generateMetadata({ params }: ModulePageProps): Promise<Metadata> {
  const { moduleId } = await params;
  // 变量名不能叫 `module`（@next/next/no-assign-module-variable）
  const mod = findPortalModule(PORTAL_MODULES, moduleId);
  if (!mod) return { title: '模块不存在' };
  return {
    title: mod.nameZh,
    description: `${mod.nameZh}（${mod.nameEn}）：${mod.summary}`,
  };
}

export default async function ModulePlaceholderPage({ params }: ModulePageProps) {
  const { moduleId } = await params;
  const mod = findPortalModule(PORTAL_MODULES, moduleId);
  if (!mod) notFound();

  const Icon = moduleIcon(mod.icon);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={mod.category === 'core' ? '基础能力' : '校园服务'}
        title={mod.nameZh}
        description={mod.summary}
        actions={<KdyBadge tone="neutral">{mod.sensitivityLabel}</KdyBadge>}
      />

      <KdyCard className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-md bg-brand-soft text-brand-strong">
            {/* eslint-disable-next-line react-hooks/static-components --
                这里只是从静态图标映射表里"取出"一个已存在的组件引用（引用稳定），
                并非在渲染期间定义新组件；该规则对 icon-map 模式属误报。 */}
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-body">
              {mod.nameZh} · {mod.nameEn}
            </span>
            <code className="font-mono text-xs text-muted">/api/v1/{mod.route}/items</code>
          </div>
        </div>

        <KdyAlert tone="info" title="该模块尚未实现">
          <p className="flex items-center gap-1">
            <Construction className="size-3.5" aria-hidden />
            本页面由冻结契约的模块注册表自动生成，用于保证 {PORTAL_MODULES.length}{' '}
            个模块入口都可达。业务实现按模块逐个交付。
          </p>
        </KdyAlert>

        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">冻结模块 id</dt>
            <dd className="font-mono text-body">{mod.id}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">API 路由前缀</dt>
            <dd className="font-mono text-body">/api/v1/{mod.route}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">敏感级</dt>
            <dd className="text-body">
              {mod.sensitivityLabel}
              {mod.audited ? '（读写全部落审计）' : ''}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">二次同意</dt>
            <dd className="text-body">{mod.requiresConsent ? '必须显式同意' : '不需要'}</dd>
          </div>
        </dl>
      </KdyCard>

      {mod.requiresConsent ? (
        <KdyAlert tone="warning" title="进入前需要二次同意（契约 §9）">
          <p className="flex items-start gap-1">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            该模块属于高敏感域：首次进入必须显式同意，且可随时撤回；数据采集最小化，
            不与通用画像互通。同意门 UI 尚未实现（见 README「未实现」）。
          </p>
        </KdyAlert>
      ) : null}

      {mod.audited && !mod.requiresConsent ? (
        <KdyAlert tone="info" title="高敏感但无同意门">
          <p className="flex items-start gap-1">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            「{mod.nameZh}」属于高敏感（需审计 + 最小采集），但登录/使用该能力本身即为同意，
            因此不叠加同意门（契约 §9 判定规则）。
          </p>
        </KdyAlert>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <KdyButton href="/groupbuy">查看已实现的拼单切片</KdyButton>
        <KdyButton href="/" variant="secondary">
          返回首页
        </KdyButton>
      </div>
    </div>
  );
}
