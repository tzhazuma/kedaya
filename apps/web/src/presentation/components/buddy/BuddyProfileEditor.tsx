'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';

import {
  BUDDY_PROFILE_LIMITS,
  deleteBuddyProfile,
  emptyProfileDraft,
  loadBuddyProfile,
  saveBuddyProfile,
  tagGroups,
  toggleSection,
  toggleTag,
  validateBuddyProfileForm,
  type BuddyProfileVM,
} from '@/application/buddy/buddyProfile';
import { DEMO_BUDDY_SESSION } from '@/application/buddy/session';
import { getRepositories } from '@/data/repositories';
import {
  BUDDY_SKILL_LEVELS,
  BUDDY_SKILL_LEVEL_LABELS,
  type BuddyProfileDraft,
  type BuddySection,
} from '@/domain/models/buddy';

import { queryKeys } from '../../query/keys';
import { errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { cn } from '../../theme/cn';
import { KdyAlert } from '../KdyAlert';
import { KdyBadge } from '../KdyBadge';
import { KdyButton } from '../KdyButton';
import { KdyCard } from '../KdyCard';
import { KdyCardSkeleton } from '../KdySkeleton';
import { BuddyAvailabilityEditor } from './BuddyAvailabilityEditor';
import { BuddyTagPicker } from './BuddyTagPicker';

const TAG_GROUPS = tagGroups();

/**
 * 我的匹配资料（规格 §2.2 / §6.3）。
 *
 * 三件事必须显式：
 * 1. `matchEnabled` **默认关闭**，开启后才会进推荐池；
 * 2. 资料对**任何人**不可见（包括活动发起人），只被算法使用；
 * 3. 可随时**撤回**：关闭开关立即移出推荐池；删除资料是硬删（含匹配向量）。
 */
export function BuddyProfileEditor() {
  const repository = getRepositories().buddy;
  const userId = DEMO_BUDDY_SESSION.userId;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.buddy.profile(userId),
    queryFn: async () => unwrapOrThrow(await loadBuddyProfile(repository, userId)),
  });

  // 不用 effect 同步：`draftOverride` 为 null 时直接派生自服务端数据（避免 set-state-in-effect）
  const [draftOverride, setDraftOverride] = useState<BuddyProfileDraft | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const draft: BuddyProfileDraft | null = draftOverride ?? query.data?.draft ?? null;

  const setDraft = (next: BuddyProfileDraft): void => setDraftOverride(next);

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.buddy.root });
  };

  const saveMutation = useMutation({
    mutationFn: async (input: BuddyProfileDraft) =>
      saveBuddyProfile(repository, { userId, draft: input }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => deleteBuddyProfile(repository, userId),
  });

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy aria-live="polite" data-testid="buddy-profile-loading">
        <KdyCardSkeleton />
        <KdyCardSkeleton />
      </div>
    );
  }

  if (query.isError) {
    return (
      <KdyAlert
        tone="danger"
        title="匹配资料加载失败"
        role="alert"
        action={
          <KdyButton size="sm" variant="secondary" onClick={() => void query.refetch()}>
            <RefreshCw className={cn('size-3.5', query.isFetching && 'animate-spin')} aria-hidden />
            重试
          </KdyButton>
        }
      >
        <p>{errorMessage(query.error)}</p>
      </KdyAlert>
    );
  }

  if (!draft) return null;

  const vm: BuddyProfileVM = query.data;

  const save = (): void => {
    setReceipt(null);
    setActionError(null);
    const form = validateBuddyProfileForm(draft);
    setProblems(form.fieldErrors);
    if (!form.valid) return;

    saveMutation
      .mutateAsync(draft)
      .then((result) => {
        if (!result.ok) {
          const details = result.error.details as
            | { problems?: { field: string; message: string }[] }
            | undefined;
          setProblems(
            Object.fromEntries((details?.problems ?? []).map((p) => [p.field, p.message])),
          );
          setActionError(result.error.message);
          return;
        }
        setDraftOverride(result.value.draft);
        setProblems({});
        setReceipt('匹配资料已保存。');
        return invalidate();
      })
      .catch((error: unknown) => setActionError(errorMessage(error)));
  };

  const remove = (): void => {
    setReceipt(null);
    setActionError(null);
    deleteMutation
      .mutateAsync()
      .then((result) => {
        if (!result.ok) {
          setActionError(result.error.message);
          return;
        }
        setDraftOverride(emptyProfileDraft());
        setConfirmDelete(false);
        setReceipt('匹配资料已删除（硬删，含匹配向量）。你不会再出现在推荐池里。');
        return invalidate();
      })
      .catch((error: unknown) => setActionError(errorMessage(error)));
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {receipt ? (
        <KdyAlert tone="success" title="操作已完成" role="status">
          <p data-testid="buddy-profile-receipt">{receipt}</p>
        </KdyAlert>
      ) : null}
      {actionError ? (
        <KdyAlert tone="danger" title="操作失败" role="alert">
          <p data-testid="buddy-profile-error">{actionError}</p>
        </KdyAlert>
      ) : null}

      <KdyCard className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-body">
            <input
              type="checkbox"
              checked={draft.matchEnabled}
              onChange={(event) => setDraft({ ...draft, matchEnabled: event.target.checked })}
              data-testid="buddy-match-enabled"
            />
            开启匹配（默认关闭）
          </label>
          <KdyBadge tone={draft.matchEnabled ? 'success' : 'neutral'}>
            {draft.matchEnabled ? '已进入推荐池' : '未进入推荐池'}
          </KdyBadge>
          <span className="text-xs text-muted">
            上次更新：{vm.updatedLabel}
          </span>
        </div>
        <p className="text-xs text-muted">
          {draft.matchEnabled
            ? '匹配已开启：资料只被算法使用，不会展示给任何人。'
            : '匹配已关闭：你不会出现在别人的推荐里；但你仍然可以主动找搭子、发布活动。'}
        </p>
        {problems.matchEnabled ? (
          <p className="text-xs text-danger" role="alert">
            {problems.matchEnabled}
          </p>
        ) : null}
      </KdyCard>

      <KdyCard className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-body">参与板块（至少 1 个）</legend>
          <div className="flex flex-wrap gap-2">
            {vm.sections.map((section) => (
              <button
                key={section.value}
                type="button"
                aria-pressed={section.selected}
                title={section.description}
                onClick={() =>
                  setDraft({
                    ...draft,
                    sections: toggleSection(draft.sections, section.value as BuddySection),
                  })
                }
                className={cn(
                  'rounded-pill border px-3 py-1 text-xs transition-colors',
                  section.selected
                    ? 'border-brand-soft bg-brand-soft text-brand-strong'
                    : 'border-border bg-surface text-muted hover:bg-surface-alt',
                )}
              >
                {section.label}
              </button>
            ))}
          </div>
          {problems.sections ? (
            <p className="text-xs text-danger" role="alert">
              {problems.sections}
            </p>
          ) : null}
        </fieldset>

        <label className="flex flex-col gap-1 text-sm text-body">
          院系（唯一与「我的」资料重叠的字段，用于 academic 板块）
          <select
            value={draft.department ?? ''}
            onChange={(event) => setDraft({ ...draft, department: event.target.value || null })}
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-body"
          >
            <option value="">不填写</option>
            {vm.departmentOptions.map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </select>
          {problems.department ? (
            <p className="text-xs text-danger" role="alert">
              {problems.department}
            </p>
          ) : null}
        </label>

        <BuddyTagPicker
          idPrefix="buddy-profile-interest"
          legend={`兴趣标签（≤${BUDDY_PROFILE_LIMITS.interestMax}）`}
          groups={TAG_GROUPS}
          selected={draft.interestTags}
          max={BUDDY_PROFILE_LIMITS.interestMax}
          onChange={(interestTags) => setDraft({ ...draft, interestTags })}
          hint="「共同兴趣 N 项」这条理由就是从这些标签算出来的。"
          error={problems.interestTags ?? null}
        />

        <BuddyTagPicker
          idPrefix="buddy-profile-activity"
          legend={`想做的活动（≤${BUDDY_PROFILE_LIMITS.activityMax}）`}
          groups={TAG_GROUPS}
          selected={draft.activityTags}
          max={BUDDY_PROFILE_LIMITS.activityMax}
          onChange={(activityTags) => setDraft({ ...draft, activityTags })}
          hint="与活动标签的重合度决定「共同活动 N 项」。"
          error={problems.activityTags ?? null}
        />

        <label className="flex flex-col gap-1 text-sm text-body">
          运动水平（仅 sport 板块使用；同时是硬过滤的依据）
          <select
            value={draft.skillLevel}
            onChange={(event) =>
              setDraft({ ...draft, skillLevel: event.target.value as BuddyPostDraftSkill })
            }
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-body"
          >
            {BUDDY_SKILL_LEVELS.map((level) => (
              <option key={level} value={level}>
                {BUDDY_SKILL_LEVEL_LABELS[level]}
              </option>
            ))}
          </select>
          {problems.skillLevel ? (
            <p className="text-xs text-danger" role="alert">
              {problems.skillLevel}
            </p>
          ) : null}
        </label>

        <BuddyAvailabilityEditor
          idPrefix="buddy-profile"
          slots={draft.availability}
          onChange={(availability) => setDraft({ ...draft, availability })}
          error={problems.availability ?? null}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-body">
            常去区域（≤{BUDDY_PROFILE_LIMITS.areaMax}，只到地点粒度）
          </legend>
          <p className="text-xs text-muted">
            不采集精确坐标：区域只用于「常在同一个区域」这条理由。
          </p>
          <div className="flex flex-wrap gap-2">
            {vm.preferredAreas.map((area) => {
              const selected = draft.preferredAreas.includes(area.key);
              const blocked = !selected && draft.preferredAreas.length >= BUDDY_PROFILE_LIMITS.areaMax;
              return (
                <button
                  key={area.key}
                  type="button"
                  aria-pressed={selected}
                  disabled={blocked}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      preferredAreas: toggleTag(
                        draft.preferredAreas,
                        area.key,
                        BUDDY_PROFILE_LIMITS.areaMax,
                      ),
                    })
                  }
                  className={cn(
                    'rounded-pill border px-3 py-1 text-xs transition-colors',
                    selected
                      ? 'border-brand-soft bg-brand-soft text-brand-strong'
                      : 'border-border bg-surface text-muted hover:bg-surface-alt',
                    blocked && 'cursor-not-allowed opacity-50',
                  )}
                >
                  {area.label}
                </button>
              );
            })}
          </div>
          {problems.preferredAreas ? (
            <p className="text-xs text-danger" role="alert">
              {problems.preferredAreas}
            </p>
          ) : null}
        </fieldset>

        <label className="flex flex-col gap-1 text-sm text-body">
          一句话自述（≤{BUDDY_PROFILE_LIMITS.bioMax} 字）
          <textarea
            value={draft.bio ?? ''}
            rows={2}
            maxLength={BUDDY_PROFILE_LIMITS.bioMax}
            onChange={(event) => setDraft({ ...draft, bio: event.target.value || null })}
            placeholder="例如：常驻图书馆四楼，晚上在体育馆。"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-body"
          />
          {problems.bio ? (
            <p className="text-xs text-danger" role="alert">
              {problems.bio}
            </p>
          ) : null}
        </label>
      </KdyCard>

      <div className="flex flex-wrap items-center gap-3">
        <KdyButton type="submit" disabled={saveMutation.isPending}>
          <Save className="size-3.5" aria-hidden />
          {saveMutation.isPending ? '保存中…' : '保存资料'}
        </KdyButton>

        {confirmDelete ? (
          <span className="flex items-center gap-2">
            <KdyButton
              size="sm"
              variant="danger"
              disabled={deleteMutation.isPending}
              onClick={remove}
            >
              确认删除
            </KdyButton>
            <KdyButton size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              取消
            </KdyButton>
          </span>
        ) : (
          <KdyButton size="sm" variant="secondary" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-3.5" aria-hidden />
            删除匹配资料
          </KdyButton>
        )}
      </div>

      <KdyAlert tone="warning" title="资料可撤回（规格 §6.3）">
        <ul className="list-disc pl-4">
          <li>关闭匹配开关：立即从推荐池移除，但资料还在，随时可以再开。</li>
          <li>删除匹配资料：硬删该行（含匹配向量），不影响账号资料与你发布过的活动。</li>
          <li>资料对任何人不可见：活动详情、申请列表、推荐理由里都不会出现你的完整标签集。</li>
          <li>不采集性别与年龄，也不采集精确坐标。</li>
        </ul>
      </KdyAlert>
    </form>
  );
}

/** 局部类型别名：避免把 domain 的类型名带进表单的泛型位置 */
type BuddyPostDraftSkill = BuddyProfileDraft['skillLevel'];
