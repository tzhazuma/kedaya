/**
 * 伦理提示（规格 §8.2，**硬要求**）。
 *
 * 关键设计：**这不是同意门**。
 * - 位置：上报表单提交按钮上方，折叠展开、默认展开；
 * - 内容：E1–E8 的精简版（≤5 条，每条 ≤20 字）；
 * - 交互：勾选后才允许提交 —— 这是**表单校验**，缺它只拒绝**这一次提交**，
 *   浏览地图/区域/别人的上报完全不受影响（规格 §8.2 明确区分"勾选"与"同意门"）。
 */
import { ETHICS_ACK_LABEL, ETHICS_NOT_CONSENT_NOTICE, ETHICS_RULES } from '@/domain/models/wildlife/ethics';

export interface EthicsNoticeProps {
  acknowledged: boolean;
  onAcknowledgeChange: (next: boolean) => void;
  /** 紧凑模式（详情页只读展示，不给勾选框） */
  readOnly?: boolean;
  className?: string;
}

export function EthicsNotice({
  acknowledged,
  onAcknowledgeChange,
  readOnly = false,
  className,
}: EthicsNoticeProps) {
  return (
    <section
      className={`flex flex-col gap-2 rounded-lg border border-border bg-surface-alt p-4 ${className ?? ''}`}
      aria-labelledby="wildlife-ethics-heading"
      data-testid="wildlife-ethics-notice"
    >
      <h3 id="wildlife-ethics-heading" className="text-sm font-semibold text-body">
        观察伦理守则（{ETHICS_RULES.length} 条）
      </h3>
      <ul className="flex flex-col gap-1 text-sm text-body">
        {ETHICS_RULES.map((rule) => (
          <li key={rule.id} className="flex items-start gap-2">
            <span className="mt-0.5 text-xs text-muted" aria-hidden>
              {rule.id}
            </span>
            <span>{rule.text}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{ETHICS_NOT_CONSENT_NOTICE}</p>
      {readOnly ? null : (
        <label className="flex items-center gap-2 text-sm font-medium text-body">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => onAcknowledgeChange(event.target.checked)}
            data-testid="wildlife-ethics-checkbox"
          />
          {ETHICS_ACK_LABEL}
        </label>
      )}
    </section>
  );
}
