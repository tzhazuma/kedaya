import { ShieldQuestion } from 'lucide-react';

import { cn } from '../theme/cn';

/**
 * 「第三方非官方平台」显著声明 —— 契约 §9 硬规则：全站显著标注，不冒充学校官方系统。
 * 放在页脚与首页品牌区，任何页面都不允许隐藏。
 */
export function UnofficialNotice({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        'inline-flex items-start gap-2 rounded-md border border-warning/40 bg-surface-alt px-3 py-2 text-xs text-warning',
        className,
      )}
    >
      <ShieldQuestion className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">本平台为第三方开源项目，非上海科技大学官方系统。</strong>
        所有校园业务以学校官方渠道为准。
      </span>
    </p>
  );
}
