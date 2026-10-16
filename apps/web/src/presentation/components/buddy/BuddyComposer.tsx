'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { newIdempotencyKey } from '@/application/buddy/ids';
import {
  BUDDY_POST_FORM_LIMITS,
  BUDDY_POST_SECTION_OPTIONS,
  BUDDY_SKILL_OPTIONS,
  emptyBuddyPostForm,
  publishBuddyPost,
  validateBuddyPostForm,
} from '@/application/buddy/publishBuddyPost';
import { DEMO_BUDDY_SESSION } from '@/application/buddy/session';
import { tagGroups } from '@/application/buddy/buddyProfile';
import { getRepositories } from '@/data/repositories';
import {
  BUDDY_CAPACITY_MAX,
  BUDDY_CAPACITY_MIN,
  BUDDY_DURATION_MAX,
  BUDDY_DURATION_MIN,
  BUDDY_GENDER_PREFERENCE_LABELS,
  BUDDY_LOCATIONS,
  BUDDY_SECTION_LABELS,
  BUDDY_TITLE_MAX_LENGTH,
  sectionOf,
  type BuddyGenderPreference,
  type BuddyPostDraft,
  type BuddySection,
  type BuddySkillLevel,
} from '@/domain/models/buddy';

import { asApiError } from '../../query/unwrap';
import { KdyAlert } from '../KdyAlert';
import { KdyButton } from '../KdyButton';
import { KdyCard } from '../KdyCard';
import { BuddyTagPicker } from './BuddyTagPicker';

const TAG_GROUPS = tagGroups();

const DURATION_OPTIONS = [30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480];

const GENDER_OPTIONS: BuddyGenderPreference[] = ['any', 'same', 'other'];

/**
 * 发布搭子活动。
 *
 * 两处硬约束（都在 domain，UI 只展示结果）：
 * - **封闭标签**：没有自由文本输入框，只能从标签表里选（规格 §3.2）；
 * - **联系方式**：正文命中手机号 / 微信 / QQ / 邮箱即拒绝（规格 §6.4），
 *   正确路径是"申请通过后经站内信交换"。
 */
export function BuddyComposer() {
  const now = new Date();
  const [draft, setDraft] = useState<BuddyPostDraft>(() => emptyBuddyPostForm(now));
  const [section, setSection] = useState<BuddySection>(() => sectionOf('study'));
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [createdId, setCreatedId] = useState<string | null>(null);
  const repository = getRepositories().buddy;

  const mutation = useMutation({
    mutationFn: async (input: BuddyPostDraft) =>
      publishBuddyPost(repository, { draft: input, session: DEMO_BUDDY_SESSION }),
  });

  const patch = (next: Partial<BuddyPostDraft>): void => {
    setDraft((current) => ({ ...current, ...next }));
  };

  const selectSection = (next: BuddySection): void => {
    setSection(next);
    const first = BUDDY_POST_SECTION_OPTIONS.find((option) => option.value === next)?.activities[0];
    if (first) {
      patch({
        activity: first.value,
        // 换板块时清掉只在 sport 生效的门槛，避免提交出 INVALID_SKILL_LEVEL
        minSkillLevel: next === 'sport' ? draft.minSkillLevel : null,
      });
    }
  };

  const submit = (): void => {
    setCreatedId(null);
    const form = validateBuddyPostForm(draft, new Date());
    setProblems(form.fieldErrors);
    if (!form.valid) return;

    mutation
      .mutateAsync(draft)
      .then((result) => {
        if (!result.ok) {
          setProblems(
            Object.fromEntries(
              (
                (result.error.details as { problems?: { field: string; message: string }[] })
                  ?.problems ?? []
              ).map((problem) => [problem.field, problem.message]),
            ),
          );
          return;
        }
        setCreatedId(result.value.id);
        setDraft(emptyBuddyPostForm(new Date()));
        setProblems({});
      })
      .catch((error: unknown) => {
        setProblems({ form: asApiError(error).message });
      });
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {createdId ? (
        <KdyAlert tone="success" title="发布成功" role="status">
          <p data-testid="buddy-publish-receipt">
            活动已发布，编号 <code>{createdId}</code>。
          </p>
          <p className="mt-1">
            <Link href={`/buddy/${createdId}`} className="text-brand-strong underline">
              查看详情
            </Link>
            {' · '}
            <Link href="/buddy" className="text-brand-strong underline">
              回到搭子广场
            </Link>
          </p>
        </KdyAlert>
      ) : null}

      {problems.form ? (
        <KdyAlert tone="danger" title="发布失败" role="alert">
          <p>{problems.form}</p>
        </KdyAlert>
      ) : null}

      <KdyCard className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-body">板块</legend>
          <p className="text-xs text-muted">
            板块由活动类型派生（`study → 自习与学术`、`meal/travel/other → 日常与出行`、
            `sport/game → 运动组队`），不单独存储，避免同一信息两处不一致。
          </p>
          <div className="flex flex-wrap gap-2">
            {BUDDY_POST_SECTION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={section === option.value}
                onClick={() => selectSection(option.value)}
                className={
                  section === option.value
                    ? 'rounded-pill border border-brand-soft bg-brand-soft px-3 py-1 text-xs text-brand-strong'
                    : 'rounded-pill border border-border bg-surface px-3 py-1 text-xs text-muted hover:bg-surface-alt'
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1 text-sm text-body">
          活动类型
          <select
            value={draft.activity}
            onChange={(event) => patch({ activity: event.target.value as BuddyPostDraft['activity'] })}
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-body"
          >
            {BUDDY_POST_SECTION_OPTIONS.filter((option) => option.value === section).flatMap(
              (option) =>
                option.activities.map((activity) => (
                  <option key={activity.value} value={activity.value}>
                    {activity.label}
                  </option>
                )),
            )}
          </select>
          <span className="text-xs text-muted">
            当前板块：{BUDDY_SECTION_LABELS[sectionOf(draft.activity)]}
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm text-body">
          标题（≤{BUDDY_TITLE_MAX_LENGTH} 字）
          <input
            type="text"
            value={draft.title}
            maxLength={BUDDY_TITLE_MAX_LENGTH}
            onChange={(event) => patch({ title: event.target.value })}
            placeholder="例如：周六下午羽毛球，缺 2 人"
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-body"
          />
          {problems.title ? (
            <span className="text-xs text-danger" role="alert">
              {problems.title}
            </span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1 text-sm text-body">
          描述（≤{BUDDY_POST_FORM_LIMITS.descriptionMax} 字，不要写联系方式）
          <textarea
            value={draft.description}
            rows={3}
            maxLength={BUDDY_POST_FORM_LIMITS.descriptionMax}
            onChange={(event) => patch({ description: event.target.value })}
            placeholder="场地、水平要求、集合方式都可以写；手机号 / 微信 / QQ / 邮箱会被拒绝。"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-body"
          />
          {problems.description ? (
            <span className="text-xs text-danger" role="alert">
              {problems.description}
            </span>
          ) : null}
        </label>

        <BuddyTagPicker
          idPrefix="buddy-publish"
          legend="活动标签（封闭标签表）"
          groups={TAG_GROUPS}
          selected={draft.tags}
          max={BUDDY_POST_FORM_LIMITS.tagsMax}
          onChange={(tags) => patch({ tags })}
          hint="标签是匹配打分的主特征，只能从白名单里选。"
          error={problems.tags ?? null}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-body">
            地点（校园地点白名单）
            <select
              value={draft.location}
              onChange={(event) => patch({ location: event.target.value })}
              className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-body"
            >
              {BUDDY_LOCATIONS.map((location) => (
                <option key={location.key} value={location.key}>
                  {location.label}
                </option>
              ))}
            </select>
            {problems.location ? (
              <span className="text-xs text-danger" role="alert">
                {problems.location}
              </span>
            ) : null}
          </label>

          <label className="flex flex-col gap-1 text-sm text-body">
            开始时间
            <input
              type="datetime-local"
              value={draft.startsAt}
              onChange={(event) => patch({ startsAt: event.target.value })}
              className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-body"
            />
            {problems.startsAt ? (
              <span className="text-xs text-danger" role="alert">
                {problems.startsAt}
              </span>
            ) : null}
          </label>

          <label className="flex flex-col gap-1 text-sm text-body">
            预计时长
            <select
              value={draft.durationMin}
              onChange={(event) => patch({ durationMin: Number(event.target.value) })}
              className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-body"
            >
              {DURATION_OPTIONS.filter(
                (value) => value >= BUDDY_DURATION_MIN && value <= BUDDY_DURATION_MAX,
              ).map((value) => (
                <option key={value} value={value}>
                  {value} 分钟
                </option>
              ))}
            </select>
            {problems.durationMin ? (
              <span className="text-xs text-danger" role="alert">
                {problems.durationMin}
              </span>
            ) : null}
          </label>

          <label className="flex flex-col gap-1 text-sm text-body">
            人数（含你自己，{BUDDY_CAPACITY_MIN}–{BUDDY_CAPACITY_MAX}）
            <input
              type="number"
              min={BUDDY_CAPACITY_MIN}
              max={BUDDY_CAPACITY_MAX}
              value={draft.capacity}
              onChange={(event) => patch({ capacity: Number(event.target.value) })}
              className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-body"
            />
            {problems.capacity ? (
              <span className="text-xs text-danger" role="alert">
                {problems.capacity}
              </span>
            ) : null}
          </label>

          <label className="flex flex-col gap-1 text-sm text-body">
            性别偏好（准入约束，不参与打分）
            <select
              value={draft.genderPreference}
              onChange={(event) =>
                patch({ genderPreference: event.target.value as BuddyGenderPreference })
              }
              className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-body"
            >
              {GENDER_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {BUDDY_GENDER_PREFERENCE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          {sectionOf(draft.activity) === 'sport' ? (
            <label className="flex flex-col gap-1 text-sm text-body">
              运动水平门槛（仅运动板块，作为硬过滤）
              <select
                value={draft.minSkillLevel ?? ''}
                onChange={(event) =>
                  patch({
                    minSkillLevel: (event.target.value || null) as BuddySkillLevel | null,
                  })
                }
                className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-body"
              >
                <option value="">不设门槛</option>
                {BUDDY_SKILL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}及以上
                  </option>
                ))}
              </select>
              {problems.minSkillLevel ? (
                <span className="text-xs text-danger" role="alert">
                  {problems.minSkillLevel}
                </span>
              ) : null}
            </label>
          ) : null}
        </div>
      </KdyCard>

      <div className="flex flex-wrap items-center gap-3">
        <KdyButton type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? '发布中…' : '发布搭子'}
        </KdyButton>
        <p className="text-xs text-muted">
          发布需要 Idempotency-Key（契约 §11.3）：重复点击不会产生两条活动。
          当前键：<code>{newIdempotencyKey().slice(0, 8)}…</code>
        </p>
      </div>

      <KdyAlert tone="info" title="发布后会发生什么">
        <ul className="list-disc pl-4">
          <li>活动进入对应板块的公开列表；发起人昵称可见，联系方式不可见。</li>
          <li>同学提交的是申请，不占名额；你接受之后才计入人数。</li>
          <li>你可以随时关闭招募（`close` → CLOSED），也可以删除取消。</li>
        </ul>
      </KdyAlert>
    </form>
  );
}
