'use client';

import { Plus, Trash2 } from 'lucide-react';

import {
  appendAvailabilitySlot,
  removeAvailabilitySlot,
  toAvailabilitySlotVM,
  updateAvailabilitySlot,
  weekdayOptions,
} from '@/application/buddy/buddyProfile';
import { describeAvailability, type BuddyAvailabilitySlot } from '@/domain/models/buddy';

import { KdyButton } from '../KdyButton';

export interface BuddyAvailabilityEditorProps {
  slots: readonly BuddyAvailabilitySlot[];
  onChange: (next: BuddyAvailabilitySlot[]) => void;
  error?: string | null;
  idPrefix: string;
}

const WEEKDAYS = weekdayOptions();

/**
 * 可用时段编辑器（规格 §2.2）。
 *
 * **支持跨零点**：`endMin < startMin` 表示跨到次日（例如 23:00–01:00 的夜跑），
 * 判定由 `@kedaya/shared` 的 `overlapsAvailability` 完成，本组件只负责编辑与提示。
 * 起止时间相同会被 domain 校验拒绝（0 分钟与 24 小时无法区分）。
 */
export function BuddyAvailabilityEditor({
  slots,
  onChange,
  error,
  idPrefix,
}: BuddyAvailabilityEditorProps) {
  const vms = slots.map((slot, index) => toAvailabilitySlotVM(slot, index));

  return (
    <fieldset className="flex flex-col gap-3" data-testid={`${idPrefix}-availability-editor`}>
      <legend className="text-sm font-medium text-body">每周可用时段</legend>
      <p className="text-xs text-muted">
        用来判断「时间能不能碰上」。时段可跨零点（例如 23:00–01:00 表示到次日 01:00）。
        不填也能用 —— 只是推荐里不会出现「时间能碰上」这条理由。
      </p>

      {vms.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted">
          还没有可用时段。点「添加时段」，选好星期与起止时间即可。
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {vms.map((slot) => (
            <li
              key={`${slot.index}-${slot.dow}-${slot.startMin}-${slot.endMin}`}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-2"
            >
              <label className="flex items-center gap-1 text-xs text-muted">
                <span className="sr-only">星期</span>
                <select
                  value={slot.dow}
                  aria-label={`第 ${slot.index + 1} 段可用时段的星期`}
                  onChange={(event) =>
                    onChange(
                      updateAvailabilitySlot(slots, slot.index, { dow: Number(event.target.value) }),
                    )
                  }
                  className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-body"
                >
                  {WEEKDAYS.map((day) => (
                    <option key={day.value} value={day.value}>
                      {day.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-1 text-xs text-muted">
                <span className="sr-only">开始时间</span>
                <input
                  type="time"
                  value={slot.start}
                  aria-label={`第 ${slot.index + 1} 段可用时段的开始时间`}
                  onChange={(event) =>
                    onChange(
                      updateAvailabilitySlot(slots, slot.index, { start: event.target.value }),
                    )
                  }
                  className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-body"
                />
              </label>

              <span className="text-xs text-muted">至</span>

              <label className="flex items-center gap-1 text-xs text-muted">
                <span className="sr-only">结束时间</span>
                <input
                  type="time"
                  value={slot.end}
                  aria-label={`第 ${slot.index + 1} 段可用时段的结束时间`}
                  onChange={(event) =>
                    onChange(updateAvailabilitySlot(slots, slot.index, { end: event.target.value }))
                  }
                  className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-body"
                />
              </label>

              {slot.crossMidnight ? (
                <span className="rounded-pill border border-border bg-surface-alt px-2 py-0.5 text-xs text-info">
                  跨零点 · 次日 {slot.end}
                </span>
              ) : null}

              <span className="text-xs text-muted" data-testid={`${idPrefix}-slot-length-${slot.index}`}>
                共 {slot.lengthLabel}
              </span>

              <KdyButton
                size="sm"
                variant="ghost"
                className="ml-auto"
                aria-label={`删除第 ${slot.index + 1} 段可用时段`}
                onClick={() => onChange(removeAvailabilitySlot(slots, slot.index))}
              >
                <Trash2 className="size-3.5" aria-hidden />
                删除
              </KdyButton>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <KdyButton size="sm" variant="secondary" onClick={() => onChange(appendAvailabilitySlot(slots))}>
          <Plus className="size-3.5" aria-hidden />
          添加时段
        </KdyButton>
        <p className="text-xs text-muted" data-testid={`${idPrefix}-availability-summary`}>
          {describeAvailability(slots)}
        </p>
      </div>

      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
