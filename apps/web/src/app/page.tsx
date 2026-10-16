import { ArrowRight, Layers, Lock, Ruler, ShieldCheck, Wallet } from 'lucide-react';
import Link from 'next/link';

import {
  AUDITED_MODULES,
  CONSENT_GATED_MODULES,
  PORTAL_MODULES,
  PORTAL_MODULE_GROUPS,
} from '@/domain/models/modules';
import { categoryLabel } from '@/domain/models/module';
import { KdyBadge } from '@/presentation/components/KdyBadge';
import { KdyButton } from '@/presentation/components/KdyButton';
import { KdyCard } from '@/presentation/components/KdyCard';
import { ModuleGrid } from '@/presentation/components/ModuleGrid';
import { UnofficialNotice } from '@/presentation/components/UnofficialNotice';

const CAPABILITIES = [
  {
    Icon: Layers,
    title: '六边形分层',
    body: 'presentation → application → domain ← data。domain 零框架依赖，端口由 data 实现，mock 与真实后端可无缝互换。',
  },
  {
    Icon: ShieldCheck,
    title: '统一响应信封',
    body: '所有响应收敛为 ApiEnvelope<T>，错误码冻结；网络层把信封解包成显式 Result，UI 不再 try/catch。',
  },
  {
    Icon: Ruler,
    title: '游标分页',
    body: '列表一律 cursor / limit，不用 offset；分页游标在 mock 与 HTTP 适配器里行为一致。',
  },
  {
    Icon: Wallet,
    title: '金额整数分',
    body: '全链路 amountFen / priceFen 整数分，只在展示层转元，浮点绝不参与金额运算。',
  },
  {
    Icon: Lock,
    title: '隐私与审计',
    body: '敏感模块独立二次同意、数据最小化、匿名与实名解耦；高敏感读写全部落审计日志。',
  },
] as const;

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-8">
      {/* ---------------- 品牌区 ---------------- */}
      <section className="kdy-brand-gradient flex flex-col gap-6 rounded-xl border border-brand-soft p-6 shadow-sm lg:flex-row lg:items-center lg:gap-10 lg:p-8">
        <div className="flex flex-1 flex-col gap-4">
          <span className="inline-flex w-fit items-center gap-2 rounded-pill border border-brand-soft bg-surface px-3 py-1 text-xs font-medium text-brand-strong">
            第三方开源 · 非官方
          </span>
          <h1 className="text-display font-bold leading-tight text-ink">
            可达鸭
            <span className="mt-1 block text-lg font-medium text-ink-soft">
              上科大，什么需求都可以到达
            </span>
          </h1>
          <p className="max-w-xl text-sm text-muted">
            上海科技大学统一校园服务平台：把散落在各处的校园服务入口聚合成一个门户 ——
            拼单、偷外卖、跳蚤、宿舍矛盾、跑腿、找搭子、失物招领、食堂营养、论坛、心理治疗……
            共 {PORTAL_MODULES.length} 个模块（{PORTAL_MODULE_GROUPS.core.length} 基础 +{' '}
            {PORTAL_MODULE_GROUPS.business.length} 业务）。
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <KdyButton href="/groupbuy">
              进入拼单垂直切片
              <ArrowRight className="size-4" aria-hidden />
            </KdyButton>
            <KdyButton href="/admin" variant="secondary">
              管理后台占位
            </KdyButton>
          </div>
          <UnofficialNotice className="mt-1" />
        </div>

        <div className="flex shrink-0 items-center justify-center">
          {/* 品牌图：assets/brand/kedaya-cover.svg（已复制到 public/brand）。
              同上：SVG 静态资源用原生 <img>，不引入 next/image 优化器。 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/kedaya-cover.svg"
            alt="可达鸭品牌插画"
            className="w-full max-w-md rounded-lg border border-brand-soft shadow-md"
          />
        </div>
      </section>

      {/* ---------------- 20 个模块宫格（契约 §4 + §11.10-C） ---------------- */}
      <section className="flex flex-col gap-4" aria-labelledby="modules-heading">
        <header className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="modules-heading" className="text-xxl font-bold text-body">
              全部模块
            </h2>
            <p className="text-sm text-muted">
              宫格完全由 <code className="font-mono">@kedaya/contracts</code> 的模块注册表驱动
              （契约 §4），没有任何硬编码清单。
            </p>
          </div>
          <KdyBadge tone="brand">{PORTAL_MODULES.length} 个模块</KdyBadge>
        </header>

        {(['core', 'business'] as const).map((group) => (
          <div key={group} className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-muted">
              {categoryLabel(group)}（{PORTAL_MODULE_GROUPS[group].length}）
            </h3>
            <ModuleGrid modules={PORTAL_MODULE_GROUPS[group]} />
          </div>
        ))}
      </section>

      {/* ---------------- 隐私与合规 ---------------- */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading" className="sr-only">
          隐私与合规
        </h2>
        <KdyCard tone="alt" className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-md font-semibold text-body">
            <Lock className="size-4 text-warning" aria-hidden />
            需要二次同意的模块
          </h3>
          <p className="text-xs text-muted">
            首次进入必须显式同意，且可随时撤回；心理与宿舍矛盾数据不进入通用画像。
          </p>
          <ul className="flex flex-col gap-2">
            {CONSENT_GATED_MODULES.map((module) => (
              <li key={module.id} className="flex items-center justify-between gap-2 text-sm">
                <Link href={module.href} className="text-body hover:text-brand-strong">
                  {module.nameZh}
                </Link>
                <KdyBadge tone="warning">{module.sensitivityLabel}</KdyBadge>
              </li>
            ))}
          </ul>
        </KdyCard>

        <KdyCard tone="alt" className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-md font-semibold text-body">
            <ShieldCheck className="size-4 text-info" aria-hidden />
            审计范围内的模块
          </h3>
          <p className="text-xs text-muted">
            高敏感（high / critical）模块的读写全部落审计日志；注意「身份」「校园卡」属高敏感但
            <strong className="font-medium">不设同意门</strong> —— 登录/开卡本身就是同意。
          </p>
          <ul className="flex flex-wrap gap-2">
            {AUDITED_MODULES.map((module) => (
              <li key={module.id}>
                <KdyBadge tone={module.consentBadge ? 'warning' : 'info'}>
                  {module.nameZh}
                  {module.consentBadge ? ' · 需同意' : ''}
                </KdyBadge>
              </li>
            ))}
          </ul>
        </KdyCard>
      </section>

      {/* ---------------- 平台能力 ---------------- */}
      <section className="flex flex-col gap-4" aria-labelledby="capabilities-heading">
        <h2 id="capabilities-heading" className="text-xxl font-bold text-body">
          平台能力
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(({ Icon, title, body }) => (
            <KdyCard key={title} interactive className="flex flex-col gap-2">
              <span className="flex size-9 items-center justify-center rounded-md bg-brand-soft text-brand-strong">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="text-sm font-semibold text-body">{title}</h3>
              <p className="text-xs text-muted">{body}</p>
            </KdyCard>
          ))}
        </div>
      </section>
    </div>
  );
}
