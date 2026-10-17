'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { useRef, useState } from 'react';

import { loadCapabilities } from '@/application/techpie/capabilities';
import {
  OneTimeTicketHolder,
  WEBVIEW_HONEST_NOTICE,
  WEBVIEW_PHASE0_MODE_NOTE,
  openCampusWebview,
  refuseIfTicketInUrl,
  webviewHostOf,
} from '@/application/techpie/webviewTicket';
import { getRepositories } from '@/data/repositories';
import {
  CAMPUS_TARGET_ALLOWLIST_IS_PLACEHOLDER,
  CAMPUS_TARGET_ALLOWLIST_NOTE,
  type TechpieCapability,
} from '@/domain/models/techpie';

import { queryKeys } from '../../query/keys';
import { shouldRetryQuery } from '../../query/retry';
import { errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { cn } from '../../theme/cn';
import { KdyAlert } from '../KdyAlert';
import { KdyBadge } from '../KdyBadge';
import { KdyButton } from '../KdyButton';
import { KdyCard } from '../KdyCard';
import { KdyCardSkeleton } from '../KdySkeleton';

interface LaunchFeedback {
  tone: 'success' | 'info' | 'danger';
  title: string;
  text: string;
  /** 需要先绑定时给引导（**不是错误**） */
  bindHref: string | null;
}

/**
 * WebView 直连（规格 §8.4 / §9.1 的 W4 方案）。
 *
 * 三条硬约束在这里落地：
 * 1. **目标地址只能来自服务端白名单** —— 本组件没有 URL 输入框，
 *    用户只能从服务端下发的能力列表里挑一个（§11.18-B）；
 * 2. **票据是一次性的** —— 换取后立即兑换，兑换完 `holder.clear()`，
 *    不缓存、不进 URL、不进日志（§8.4 / §10.3）；
 * 3. **如实告知用户** —— 登录发生在学校页面，可达鸭不接触凭证。
 */
export function WebviewLauncher() {
  const repository = getRepositories().techpie;
  const holderRef = useRef<OneTimeTicketHolder | null>(null);
  if (holderRef.current === null) holderRef.current = new OneTimeTicketHolder();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<LaunchFeedback | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.techpie.capabilities,
    queryFn: async () => unwrapOrThrow(await loadCapabilities(repository)),
    retry: shouldRetryQuery,
  });

  const capabilities = (query.data?.items ?? []).filter((item) => item.access === 'webview');
  const selected =
    capabilities.find((item) => item.id === selectedId) ?? capabilities[0] ?? null;

  const launch = async (capability: TechpieCapability): Promise<void> => {
    const holder = holderRef.current;
    if (!holder) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await openCampusWebview(repository, { capability, holder });
      if (!result.ok) {
        const error = result.error;
        // `CAMPUS_BINDING_REQUIRED` 是**合法状态**：给引导，不给红色报错
        if (error.code === 'CAMPUS_BINDING_REQUIRED') {
          setFeedback({
            tone: 'info',
            title: '需要先绑定校园系统',
            text:
              `${error.message} 这是合法状态（你仍然处于登录状态），` +
              '绑定之后即可继续；不绑定也不影响可达鸭的自有功能。',
            bindHref: '/techpie',
          });
        } else {
          setFeedback({
            tone: 'danger',
            title: '打开失败',
            text: error.message,
            bindHref: null,
          });
        }
        return;
      }

      const refusal = refuseIfTicketInUrl(result.value.launch.url);
      if (refusal) {
        setFeedback({ tone: 'danger', title: '已拒绝打开', text: refusal, bindHref: null });
        return;
      }

      // 票据已用后即焚：holder 里不再保留任何东西
      holder.clear();

      // ⚠️ 不能用 `window.open(...) !== null` 判断成功：带 `noopener` 时
      // 浏览器**按规范**返回 `null`（新上下文不可访问），返回值不是成功标志。
      // 真实浏览器验证时踩到过这个坑：标签页明明打开了，提示却说"请手动打开"。
      // 因此这里只区分"调用有没有抛异常"，并始终给出兜底地址（弹出拦截时也能用）。
      let opened = false;
      if (typeof window !== 'undefined') {
        try {
          window.open(result.value.launch.url, '_blank', 'noopener,noreferrer');
          opened = true;
        } catch {
          opened = false;
        }
      }

      setFeedback({
        tone: 'success',
        title: opened ? '已请求在新标签页打开学校系统' : '请手动打开学校系统',
        text:
          `目标：${webviewHostOf(result.value.launch.targetUrl)}（模式：${
            result.value.launch.mode === 'direct' ? '用户自登录' : '服务端注入'
          }）。` +
          '一次性票据已经使用并作废，没有进入浏览器历史、缓存或日志。' +
          ` 若浏览器拦截了新标签页，请手动访问 ${result.value.launch.targetUrl}`,
        bindHref: null,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="techpie-webview-heading">
      <KdyAlert tone="info" title="关于接下来会发生什么" role="status">
        <p data-testid="techpie-webview-notice" className="font-medium text-body">
          {WEBVIEW_HONEST_NOTICE}
        </p>
        <p className="mt-1">{WEBVIEW_PHASE0_MODE_NOTE}</p>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-xs">
          <li>票据是一次性的：用后立即作废，无法重放。</li>
          <li>票据不进 URL 历史：打开的是服务端返回的地址，地址里不含票据。</li>
          <li>票据不进缓存与日志：它只在一处内存里存活，用完即弃。</li>
          <li>票据绑定目标域名：只能用于签发时的那个校园系统。</li>
        </ul>
      </KdyAlert>

      {CAMPUS_TARGET_ALLOWLIST_IS_PLACEHOLDER ? (
        <KdyAlert tone="warning" title="可打开的目标来自服务端白名单（内容为占位）">
          <p>{CAMPUS_TARGET_ALLOWLIST_NOTE}</p>
          <p className="mt-1 text-xs">
            页面不提供"自定义 URL"输入框：客户端不得自行拼接任意 URL，也不允许通配整个
            shanghaitech.edu.cn。
          </p>
        </KdyAlert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <h2 id="techpie-webview-heading" className="mr-auto text-sm font-semibold text-body">
          校园系统直连
        </h2>
        <KdyButton href="/techpie" size="sm" variant="secondary">
          绑定管理
        </KdyButton>
        <KdyButton
          size="sm"
          variant="secondary"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={cn('size-3.5', query.isFetching && 'animate-spin')} aria-hidden />
          刷新目标列表
        </KdyButton>
      </div>

      {query.isPending ? (
        <div aria-busy aria-live="polite" className="flex flex-col gap-3" data-testid="techpie-webview-loading">
          <KdyCardSkeleton />
        </div>
      ) : null}

      {query.isError ? (
        <KdyAlert
          tone="danger"
          title="目标列表加载失败"
          role="alert"
          action={
            <KdyButton size="sm" variant="secondary" onClick={() => void query.refetch()}>
              重试
            </KdyButton>
          }
        >
          <p>{errorMessage(query.error)}</p>
        </KdyAlert>
      ) : null}

      {!query.isPending && !query.isError && capabilities.length === 0 ? (
        <KdyAlert tone="warning" title="服务端没有下发任何可直连的校园系统">
          <p>
            没有目标可打开时，可达鸭不会退化成"随便填一个 URL"——那正是契约 §11.18-B
            要禁止的行为。请稍后重试或联系维护者。
          </p>
        </KdyAlert>
      ) : null}

      {capabilities.length > 0 ? (
        <div className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs text-muted">
              选择一个由服务端登记的目标（{capabilities.length} 个）
            </legend>
            {capabilities.map((capability) => (
              <label
                key={capability.id}
                className={cn(
                  'flex cursor-pointer flex-col gap-1 rounded-lg border p-3',
                  selected?.id === capability.id
                    ? 'border-brand-strong bg-surface'
                    : 'border-border bg-surface-alt',
                )}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <input
                    type="radio"
                    name="techpie-webview-target"
                    value={capability.id}
                    checked={selected?.id === capability.id}
                    onChange={() => setSelectedId(capability.id)}
                  />
                  <span className="text-sm font-semibold text-body">{capability.nameZh}</span>
                  <KdyBadge tone={capability.status === 'AVAILABLE' ? 'success' : 'info'}>
                    {capability.status === 'AVAILABLE' ? '可用' : '需先绑定'}
                  </KdyBadge>
                </span>
                <span className="pl-6 text-xs text-muted">{capability.summary}</span>
                <span className="pl-6 font-mono text-xs text-muted" data-testid={`techpie-target-${capability.id}`}>
                  {capability.targetUrl ?? '（服务端未下发地址）'}
                </span>
              </label>
            ))}
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <KdyButton
              onClick={() => (selected ? void launch(selected) : undefined)}
              disabled={busy || !selected || !selected.targetUrl}
            >
              <KeyRound className="size-3.5" aria-hidden />
              {busy ? '换取票据中…' : '换取一次性票据并打开'}
            </KdyButton>
            <span className="flex items-center gap-1 text-xs text-muted">
              <ShieldCheck className="size-3.5" aria-hidden />
              票据状态：{holderRef.current.state === 'issued' ? '已签发（待兑换）' : '未持有'}
            </span>
          </div>
        </div>
      ) : null}

      {feedback ? (
        <KdyAlert
          tone={feedback.tone}
          title={feedback.title}
          role={feedback.tone === 'danger' ? 'alert' : 'status'}
          action={
            feedback.bindHref ? (
              <KdyButton href={feedback.bindHref} size="sm">
                去绑定
              </KdyButton>
            ) : null
          }
        >
          <p data-testid="techpie-webview-feedback">{feedback.text}</p>
        </KdyAlert>
      ) : null}

      <KdyCard tone="alt" className="flex flex-col gap-2 text-xs text-muted">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-body">
          <ExternalLink className="size-3.5" aria-hidden />
          为什么不在页面里内嵌（iframe）？
        </p>
        <p>
          学校系统普遍禁止被第三方站点 iframe 内嵌（X-Frame-Options / CSP frame-ancestors），
          强行内嵌只会得到一个白屏。新标签页打开是当前唯一稳定的方式，也让地址栏对用户可见 ——
          你能自己确认打开的是学校域名。
        </p>
        <p>
          若浏览器拦截了新标签页，请手动访问上面显示的目标地址。票据不会出现在地址里。
        </p>
      </KdyCard>
    </section>
  );
}

