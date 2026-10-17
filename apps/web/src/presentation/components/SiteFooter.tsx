import { UnofficialNotice } from './UnofficialNotice';

export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-border bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 text-xs text-muted">
        <UnofficialNotice />
        <p>
          可达鸭 · 上海科技大学统一校园服务平台（KedaYa）—— 开源项目 · 上科大，什么需求都可以到达
        </p>
        <p>
          吉祥物与视觉素材为原创美术（<code className="font-mono">assets/brand/</code>
          ），与任何第三方角色形象无关。
        </p>
      </div>
    </footer>
  );
}
