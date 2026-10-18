import { Construction, Lock, ShieldCheck, Smartphone } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { deliveryStageLabel } from '@/domain/models/delivery';
import { findPortalModule } from '@/domain/models/module';
import { PORTAL_MODULES } from '@/domain/models/modules';
import { KdyAlert } from '@/presentation/components/KdyAlert';
import { KdyBadge, type KdyBadgeTone } from '@/presentation/components/KdyBadge';
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

const DELIVERY_TONE: Record<string, KdyBadgeTone> = {
  web: 'brand',
  miniapp: 'info',
  'api-only': 'neutral',
};

export default async function ModulePage({ params }: ModulePageProps) {
  const { moduleId } = await params;
  const mod = findPortalModule(PORTAL_MODULES, moduleId);
  if (!mod) notFound();

  const Icon = moduleIcon(mod.icon);
  const { delivery } = mod;
  const delivered = delivery.stage !== 'api-only';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={mod.nameZh}
        description={mod.summary}
        actions={
          <>
            <KdyBadge tone={DELIVERY_TONE[delivery.stage] ?? 'neutral'}>
              {deliveryStageLabel(delivery.stage)}
            </KdyBadge>
            <KdyBadge tone="neutral">{mod.sensitivityLabel}</KdyBadge>
          </>
        }
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

        {delivery.stage === 'miniapp' ? (
          <KdyAlert tone="info" title="已在微信小程序端上线，Web 端页面待做">
            <p className="flex items-start gap-1">
              <Smartphone className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                这个模块在小程序里已经是真实可用的（后端同一套 API）。
                想在浏览器里用，请先在小程序端体验；Web 端页面会随后续切片补齐。
              </span>
            </p>
          </KdyAlert>
        ) : null}

        {delivery.stage === 'api-only' ? (
          <KdyAlert tone="info" title="端上页面尚未实现">
            <p className="flex items-center gap-1">
              <Construction className="size-3.5" aria-hidden />
              本页面由冻结契约的模块注册表自动生成，用于保证 {PORTAL_MODULES.length}{' '}
              个模块入口都可达。该模块目前只有后端脚手架接口，Web 与小程序的页面都还没做，
              不会展示任何伪造数据。
            </p>
          </KdyAlert>
        ) : null}

        {delivery.note ? (
          <div className="flex flex-col gap-2 rounded-md bg-surface-alt p-3">
            <span className="text-xs font-semibold text-muted">端上能力</span>
            <p className="text-sm text-body">{delivery.note}</p>
          </div>
        ) : null}

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
            <dt className="text-xs text-muted">交付状态</dt>
            <dd className="text-body">
              {deliveryStageLabel(delivery.stage)}
              {delivered ? '（可用）' : '（仅接口）'}
            </dd>
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
            不与通用画像互通。小程序端已实现同意门（同意记录落本地 + 服务端）。
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
        {delivery.webHref ? (
          <KdyButton href={delivery.webHref}>在 Web 端使用</KdyButton>
        ) : null}
        <KdyButton href="/groupbuy" variant={delivery.webHref ? 'secondary' : 'primary'}>
          查看已实现的拼单切片
        </KdyButton>
        <KdyButton href="/" variant="secondary">
          返回首页
        </KdyButton>
      </div>

      <p className="text-xs text-muted">
        想看小程序端的模块清单？首页宫格里的交付角标是按端标注的 —— 标着
        <Link href="/" className="mx-1 text-brand-strong hover:underline">
          「小程序已上线」
        </Link>
        的模块都能在微信小程序里真的用起来。
      </p>
    </div>
  );
}
