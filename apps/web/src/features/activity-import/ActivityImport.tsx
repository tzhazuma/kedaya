'use client';

import { useId, useState } from 'react';

import {
  ACTIVITY_KIND_LABELS,
  ACTIVITY_KINDS,
  ACTIVITY_SOURCE_LABELS,
  ACTIVITY_STATUS_LABELS,
  formatShanghaiInstant,
  fromShanghaiDateTimeLocal,
  toShanghaiDateTimeLocal,
  type ActivityItem,
  type ActivityKind,
  type ActivityStatus,
} from '@/domain/models/activities';
import { fetchWechatArticle } from '@/data/api/wechat-article';

import { KdyBadge, type KdyBadgeTone } from '@/presentation/components/KdyBadge';
import { KdyButton } from '@/presentation/components/KdyButton';
import { KdyCard } from '@/presentation/components/KdyCard';

import {
  ACTIVITY_ARTICLE_TEXT_MAX_CHARS,
  ACTIVITY_DEADLINE_RAW_MAX_CHARS,
  ACTIVITY_TEXT_FIELD_MAX_CHARS,
  ACTIVITY_URL_MAX_CHARS,
  buildActivityIcs,
  buildActivityJson,
  confirmActivity,
  confirmedActivities,
  createManualActivity,
  dismissActivity,
  extractActivities,
  mergeActivityCandidates,
  restoreActivity,
  submitPastedText,
  unconfirmActivity,
  updateActivity,
  validateActivity,
  type ActivityPatch,
  type ActivityValidationErrors,
} from './logic';
import { triggerDownload } from './download';

const INPUT_CLASS =
  'min-h-11 w-full min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-sm text-body';
const ERROR_CLASS = 'text-xs break-words text-danger';
const HELP_CLASS = 'text-xs break-words text-muted';

const STATUS_TONE: Readonly<Record<ActivityStatus, KdyBadgeTone>> = {
  candidate: 'warning',
  confirmed: 'success',
  dismissed: 'neutral',
  archived: 'neutral',
};

type SourceMode = 'url' | 'text';

function timeOrUnknown(iso: string | null): string {
  return iso === null ? '未识别到明确时刻' : `${formatShanghaiInstant(iso)}（北京时间）`;
}

interface CandidateCardProps {
  readonly item: ActivityItem;
  readonly errors: ActivityValidationErrors;
  readonly onPatch: (patch: ActivityPatch) => void;
  readonly onConfirm: () => void;
  readonly onUnconfirm: () => void;
  readonly onDismiss: () => void;
  readonly onRestore: () => void;
}

function CandidateCard({
  item,
  errors,
  onPatch,
  onConfirm,
  onUnconfirm,
  onDismiss,
  onRestore,
}: CandidateCardProps) {
  const fieldId = useId();
  const headingId = `${fieldId}-heading`;
  const titleId = `${fieldId}-title`;
  const kindId = `${fieldId}-kind`;
  const startsAtId = `${fieldId}-starts-at`;
  const endsAtId = `${fieldId}-ends-at`;
  const locationId = `${fieldId}-location`;
  const organizerId = `${fieldId}-organizer`;
  const deadlineId = `${fieldId}-deadline`;
  const deadlineRawId = `${fieldId}-deadline-raw`;
  const registrationUrlId = `${fieldId}-registration-url`;
  const timeHelpId = `${fieldId}-time-help`;
  const rawHelpId = `${fieldId}-raw-help`;
  const urlHelpId = `${fieldId}-url-help`;
  const errorId = `${fieldId}-error`;

  const errorMessages = Object.values(errors);
  const sourceText =
    item.source === 'manual'
      ? ACTIVITY_SOURCE_LABELS[item.source]
      : `${ACTIVITY_SOURCE_LABELS[item.source]} · ${item.sourceLabel ?? '来源未知'}`;
  const deadlineText =
    item.registrationDeadlineAt !== null
      ? timeOrUnknown(item.registrationDeadlineAt)
      : item.registrationDeadlineRaw !== null && item.registrationDeadlineRaw !== ''
        ? `原文：${item.registrationDeadlineRaw}（未解析为具体时刻，不补 23:59）`
        : '未识别';

  return (
    <KdyCard className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id={headingId} className="text-md font-semibold break-words text-body">
            {item.title.trim() === '' ? '（未命名活动）' : item.title}
          </h4>
          <p className="text-xs break-words text-muted">
            {sourceText}
            {item.publishedAt === null
              ? ''
              : ` · 发布于 ${formatShanghaiInstant(item.publishedAt)}（北京时间）`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <KdyBadge tone={STATUS_TONE[item.status]}>{ACTIVITY_STATUS_LABELS[item.status]}</KdyBadge>
          <KdyBadge>{ACTIVITY_KIND_LABELS[item.kind]}</KdyBadge>
          {item.source === 'manual' ? null : (
            <KdyBadge title="启发式置信度；不能替代你的确认">
              置信度 {Math.round(item.confidence * 100)}%
            </KdyBadge>
          )}
        </div>
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted">开始</dt>
          <dd className="break-words">{timeOrUnknown(item.startsAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">报名截止</dt>
          <dd className="break-words">{deadlineText}</dd>
        </div>
      </dl>

      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-xs font-medium text-body">原文证据（≤200 字）</p>
        {item.evidenceText.trim() === '' ? (
          <p className={HELP_CLASS}>
            手动新增，没有原文证据片段；请自行核对活动信息与来源。
          </p>
        ) : (
          <blockquote className="rounded-md border border-border bg-surface-alt px-3 py-2 text-sm break-words whitespace-pre-wrap text-body">
            {item.evidenceText}
          </blockquote>
        )}
        {item.sourceUrl === null ? null : (
          <a
            className="text-xs break-all text-info underline underline-offset-2"
            href={item.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            打开原文（{item.sourceUrl}）
          </a>
        )}
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <label className="text-xs font-medium" htmlFor={titleId}>
            活动标题
          </label>
          <input
            id={titleId}
            name={`activity-title-${item.id}`}
            type="text"
            className={INPUT_CLASS}
            value={item.title}
            maxLength={ACTIVITY_TEXT_FIELD_MAX_CHARS}
            onChange={(event) => onPatch({ title: event.target.value })}
            required
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <label className="text-xs font-medium" htmlFor={kindId}>
            活动类型
          </label>
          <select
            id={kindId}
            name={`activity-kind-${item.id}`}
            className={INPUT_CLASS}
            value={item.kind}
            onChange={(event) => onPatch({ kind: event.target.value as ActivityKind })}
          >
            {ACTIVITY_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {ACTIVITY_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <label className="text-xs font-medium" htmlFor={startsAtId}>
            开始时间
          </label>
          <input
            id={startsAtId}
            name={`activity-starts-at-${item.id}`}
            type="datetime-local"
            className={INPUT_CLASS}
            value={toShanghaiDateTimeLocal(item.startsAt)}
            onChange={(event) => {
              const value = event.target.value;
              if (value === '') {
                onPatch({ startsAt: null });
                return;
              }
              const iso = fromShanghaiDateTimeLocal(value);
              if (iso !== null) onPatch({ startsAt: iso });
            }}
            aria-describedby={timeHelpId}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <label className="text-xs font-medium" htmlFor={endsAtId}>
            结束时间
          </label>
          <input
            id={endsAtId}
            name={`activity-ends-at-${item.id}`}
            type="datetime-local"
            className={INPUT_CLASS}
            value={toShanghaiDateTimeLocal(item.endsAt)}
            onChange={(event) => {
              const value = event.target.value;
              if (value === '') {
                onPatch({ endsAt: null });
                return;
              }
              const iso = fromShanghaiDateTimeLocal(value);
              if (iso !== null) onPatch({ endsAt: iso });
            }}
            aria-describedby={timeHelpId}
          />
        </div>

        <p id={timeHelpId} className={HELP_CLASS}>
          时间按北京时间填写；留空表示无法确定，不会自动补 23:59。
        </p>

        <div className="flex min-w-0 flex-col gap-1">
          <label className="text-xs font-medium" htmlFor={locationId}>
            地点
          </label>
          <input
            id={locationId}
            name={`activity-location-${item.id}`}
            type="text"
            className={INPUT_CLASS}
            value={item.location ?? ''}
            maxLength={ACTIVITY_TEXT_FIELD_MAX_CHARS}
            onChange={(event) =>
              onPatch({ location: event.target.value === '' ? null : event.target.value })
            }
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <label className="text-xs font-medium" htmlFor={organizerId}>
            主办方
          </label>
          <input
            id={organizerId}
            name={`activity-organizer-${item.id}`}
            type="text"
            className={INPUT_CLASS}
            value={item.organizer ?? ''}
            maxLength={ACTIVITY_TEXT_FIELD_MAX_CHARS}
            onChange={(event) =>
              onPatch({ organizer: event.target.value === '' ? null : event.target.value })
            }
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <label className="text-xs font-medium" htmlFor={deadlineId}>
            报名截止时间
          </label>
          <input
            id={deadlineId}
            name={`activity-deadline-${item.id}`}
            type="datetime-local"
            className={INPUT_CLASS}
            value={toShanghaiDateTimeLocal(item.registrationDeadlineAt)}
            onChange={(event) => {
              const value = event.target.value;
              if (value === '') {
                onPatch({ registrationDeadlineAt: null });
                return;
              }
              const iso = fromShanghaiDateTimeLocal(value);
              if (iso !== null) onPatch({ registrationDeadlineAt: iso });
            }}
            aria-describedby={timeHelpId}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <label className="text-xs font-medium" htmlFor={deadlineRawId}>
            报名截止原文
          </label>
          <input
            id={deadlineRawId}
            name={`activity-deadline-raw-${item.id}`}
            type="text"
            className={INPUT_CLASS}
            value={item.registrationDeadlineRaw ?? ''}
            maxLength={ACTIVITY_DEADLINE_RAW_MAX_CHARS}
            onChange={(event) =>
              onPatch({
                registrationDeadlineRaw:
                  event.target.value === '' ? null : event.target.value,
              })
            }
            aria-describedby={rawHelpId}
          />
          <p id={rawHelpId} className={HELP_CLASS}>
            原文只写日期时会保留在这里；不会被自动补成 23:59。
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
          <label className="text-xs font-medium" htmlFor={registrationUrlId}>
            报名链接
          </label>
          <input
            id={registrationUrlId}
            name={`activity-registration-url-${item.id}`}
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className={INPUT_CLASS}
            value={item.registrationUrl ?? ''}
            maxLength={ACTIVITY_URL_MAX_CHARS}
            onChange={(event) =>
              onPatch({
                registrationUrl: event.target.value === '' ? null : event.target.value,
              })
            }
            aria-describedby={urlHelpId}
          />
          <p id={urlHelpId} className={HELP_CLASS}>
            只保留 http(s) 链接；保存前会去掉会话参数。
          </p>
        </div>
      </div>

      {errorMessages.length === 0 ? null : (
        <p id={errorId} role="alert" className={ERROR_CLASS}>
          {errorMessages.join(' ')}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {item.status === 'candidate' ? (
          <KdyButton type="button" className="min-h-11" onClick={onConfirm}>
            确认用于本次导出
          </KdyButton>
        ) : null}
        {item.status === 'confirmed' ? (
          <KdyButton type="button" variant="secondary" className="min-h-11" onClick={onUnconfirm}>
            取消确认
          </KdyButton>
        ) : null}
        {item.status === 'dismissed' ? (
          <KdyButton type="button" variant="secondary" className="min-h-11" onClick={onRestore}>
            恢复为候选
          </KdyButton>
        ) : null}
        {item.status === 'candidate' || item.status === 'confirmed' ? (
          <KdyButton type="button" variant="secondary" className="min-h-11" onClick={onDismiss}>
            忽略
          </KdyButton>
        ) : null}
      </div>
    </KdyCard>
  );
}

/**
 * 校园活动导入。
 *
 * 无状态：不写 localStorage、不调用日程/提醒接口。确认只在当前页面有效，
 * 导出 ICS / JSON 是唯一出口。页面刷新后候选消失是**预期行为**。
 */
export function ActivityImport(): React.ReactElement {
  const [mode, setMode] = useState<SourceMode>('url');
  const [url, setUrl] = useState('');
  const [articleText, setArticleText] = useState('');
  const [items, setItems] = useState<readonly ActivityItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Readonly<Record<string, ActivityValidationErrors>>>({});

  const formId = useId();
  const urlId = `${formId}-url`;
  const urlHelpId = `${formId}-url-help`;
  const urlErrorId = `${formId}-url-error`;
  const textId = `${formId}-text`;
  const textHelpId = `${formId}-text-help`;
  const textErrorId = `${formId}-text-error`;
  const listHeadingId = `${formId}-list-heading`;
  const exportHeadingId = `${formId}-export-heading`;

  const clearMessages = (): void => {
    setNotice(null);
    setExportError(null);
    setExportNotice(null);
  };

  function acceptCandidates(next: readonly ActivityItem[], title: string): void {
    const added = next.filter(
      (item) => !items.some((existing) => existing.id === item.id),
    );
    setItems(mergeActivityCandidates(items, next));
    setCardErrors({});
    setExportError(null);
    setExportNotice(null);
    if (added.length === 0) {
      setNotice(`《${title}》里的候选已经在列表中了，没有重复添加。`);
      return;
    }
    setNotice(
      `已从《${title}》新增 ${added.length} 条候选（当前共 ${items.length + added.length} 条）。`
        + '正文没有保存，请逐条核对后确认。',
    );
  }

  async function handleUrlSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    clearMessages();
    setUrlError(null);

    const raw = url.trim();
    if (raw === '') {
      setUrlError('请先粘贴一篇公众号文章链接。');
      return;
    }

    setBusy(true);
    try {
      const fetched = await fetchWechatArticle(raw);
      if (!fetched.ok) {
        setUrlError(fetched.error.message);
        return;
      }

      const candidates = extractActivities(fetched.value, { now: new Date() });
      if (candidates.length === 0) {
        setUrlError(
          '这篇文章里没有找到可核对的活动时间或报名截止。可以改用「粘贴正文」，或点下方「手动新增活动」补一条。',
        );
        return;
      }
      setUrl('');
      acceptCandidates(candidates, fetched.value.title);
    } catch {
      setUrlError('读取文章时出了点问题，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  function handleTextSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    clearMessages();
    setTextError(null);

    const submission = submitPastedText(articleText, { now: new Date() });
    // 失败时 submission.draft 仍是用户原文：正文不能因为一次抽取失败就被清掉。
    setArticleText(submission.draft);
    if (submission.error !== null) {
      setTextError(submission.error);
      return;
    }
    acceptCandidates(submission.candidates, submission.title);
  }

  function replaceItem(next: ActivityItem): void {
    setItems((current) => current.map((item) => (item.id === next.id ? next : item)));
  }

  function addManualActivity(): void {
    const item = createManualActivity(new Date());
    setItems((current) => [...current, item]);
    setCardErrors({});
    setNotice('已新增一条空白活动。请填写标题与至少一个时间，核对后再确认。');
    setExportError(null);
    setExportNotice(null);
  }

  function clearCardError(id: string): void {
    setCardErrors((current) => {
      if (current[id] === undefined) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function patchItem(id: string, patch: ActivityPatch): void {
    const item = items.find((candidate) => candidate.id === id);
    if (item === undefined) return;
    clearCardError(id);
    clearMessages();
    replaceItem(updateActivity(item, patch));
  }

  function confirmItem(id: string): void {
    const item = items.find((candidate) => candidate.id === id);
    if (item === undefined) return;
    const errors = validateActivity(item);
    if (Object.keys(errors).length > 0) {
      setCardErrors((current) => ({ ...current, [id]: errors }));
      setNotice(null);
      return;
    }
    clearCardError(id);
    replaceItem(confirmActivity(item));
    setNotice(`已确认《${item.title}》。确认只在本次页面有效，刷新后不会保留。`);
    setExportError(null);
    setExportNotice(null);
  }

  function unconfirmItem(id: string): void {
    const item = items.find((candidate) => candidate.id === id);
    if (item === undefined) return;
    replaceItem(unconfirmActivity(item));
    setNotice(`已取消确认《${item.title}》。`);
    setExportError(null);
    setExportNotice(null);
  }

  function dismissItem(id: string): void {
    const item = items.find((candidate) => candidate.id === id);
    if (item === undefined) return;
    replaceItem(dismissActivity(item));
    setNotice(`已忽略《${item.title}》，它不会进入导出。`);
    setExportError(null);
    setExportNotice(null);
  }

  function restoreItem(id: string): void {
    const item = items.find((candidate) => candidate.id === id);
    if (item === undefined) return;
    replaceItem(restoreActivity(item));
    setNotice(`已把《${item.title}》恢复为候选，请重新核对后确认。`);
    setExportError(null);
    setExportNotice(null);
  }

  function handleExport(format: 'ics' | 'json'): void {
    const confirmed = confirmedActivities(items);
    if (confirmed.length === 0) {
      setExportError('还没有确认任何活动。请先逐条核对并点「确认用于本次导出」。');
      setExportNotice(null);
      return;
    }

    const invalid = confirmed
      .map((item) => ({ item, errors: validateActivity(item) }))
      .filter((entry) => Object.keys(entry.errors).length > 0);
    if (invalid.length > 0) {
      setExportError(
        `有 ${invalid.length} 条已确认活动还缺字段：${invalid
          .map((entry) => `《${entry.item.title}》${Object.values(entry.errors).join(' ')}`)
          .join('；')}`,
      );
      setExportNotice(null);
      return;
    }

    try {
      if (format === 'ics') {
        triggerDownload(
          'kedaya-activities.ics',
          buildActivityIcs(confirmed, { calendarName: '可达鸭校园活动', now: new Date() }),
          'text/calendar;charset=utf-8',
        );
      } else {
        triggerDownload(
          'kedaya-activities.json',
          buildActivityJson(confirmed),
          'application/json;charset=utf-8',
        );
      }
    } catch {
      setExportNotice(null);
      setExportError('导出失败：生成或下载文件时出了点问题。请稍后重试，或换用其他浏览器。');
      return;
    }
    setExportError(null);
    setExportNotice(
      `已导出 ${confirmed.length} 条已确认活动（${format.toUpperCase()}）。文件只含活动字段与证据片段，不含文章正文。`,
    );
  }

  const confirmedCount = confirmedActivities(items).length;

  return (
    <div className="flex min-w-0 flex-col gap-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="rounded-lg border border-border bg-surface-alt p-4 text-sm text-body">
        <p className="font-semibold">只处理你主动给的单篇内容</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
          <li>支持单篇公众号链接，或直接粘贴文章正文；不自动发现、不批量抓取历史文章。</li>
          <li>不绕过微信验证，也不要求你登录微信。</li>
          <li>只保留活动字段与 ≤200 字证据片段，不保存邮件正文、附件或公众号全文。</li>
          <li>
            Web 暂无真实登录：确认只在当前页面有效，不会写入账号日程或创建提醒；刷新后候选会清空。
          </li>
        </ul>
      </div>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="text-sm font-semibold text-body">1. 选择来源</legend>
        <div className="flex flex-wrap gap-3">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm">
            <input
              type="radio"
              name="activity-source"
              value="url"
              checked={mode === 'url'}
              onChange={() => {
                setMode('url');
                setUrlError(null);
                setTextError(null);
              }}
            />
            单篇链接
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm">
            <input
              type="radio"
              name="activity-source"
              value="text"
              checked={mode === 'text'}
              onChange={() => {
                setMode('text');
                setUrlError(null);
                setTextError(null);
              }}
            />
            粘贴正文
          </label>
        </div>
      </fieldset>

      {mode === 'url' ? (
        <form
          className="flex min-w-0 flex-col gap-2"
          onSubmit={(event) => void handleUrlSubmit(event)}
          noValidate
          aria-busy={busy}
        >
          <h3 className="text-sm font-semibold text-body">2. 粘贴单篇公众号链接</h3>
          <label className="text-xs font-medium" htmlFor={urlId}>
            公众号文章链接
          </label>
          <input
            id={urlId}
            name="wechatUrl"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            required
            maxLength={ACTIVITY_URL_MAX_CHARS}
            className={INPUT_CLASS}
            placeholder="https://mp.weixin.qq.com/s/..."
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            aria-invalid={urlError !== null}
            aria-describedby={`${urlHelpId} ${urlErrorId}`}
          />
          <p id={urlHelpId} className={HELP_CLASS}>
            只接受 https://mp.weixin.qq.com/s/… 的单篇文章。我们只读这一篇，不抓公众号历史列表。
          </p>
          <p id={urlErrorId} role="alert" className={urlError === null ? 'sr-only' : ERROR_CLASS}>
            {urlError ?? ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <KdyButton type="submit" className="min-h-11" disabled={busy}>
              {busy ? '正在读取文章…' : '读取并抽取候选'}
            </KdyButton>
            <KdyButton
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={() => {
                setUrl('');
                setUrlError(null);
              }}
              disabled={busy}
            >
              清空链接
            </KdyButton>
          </div>
        </form>
      ) : (
        <form className="flex min-w-0 flex-col gap-2" onSubmit={handleTextSubmit}>
          <h3 className="text-sm font-semibold text-body">2. 粘贴文章正文</h3>
          <label className="text-xs font-medium" htmlFor={textId}>
            文章正文
          </label>
          <textarea
            id={textId}
            name="articleText"
            rows={10}
            autoComplete="off"
            spellCheck={false}
            maxLength={ACTIVITY_ARTICLE_TEXT_MAX_CHARS}
            className={`${INPUT_CLASS} min-h-40 resize-y font-mono`}
            placeholder="把公众号文章的标题与正文粘到这里（只在本机解析）"
            value={articleText}
            onChange={(event) => setArticleText(event.target.value)}
            aria-invalid={textError !== null}
            aria-describedby={`${textHelpId} ${textErrorId}`}
          />
          <p id={textHelpId} className={HELP_CLASS}>
            只在本机解析，不上传、不保存正文；抽取完成后输入框会立即清空。
          </p>
          <p id={textErrorId} role="alert" className={textError === null ? 'sr-only' : ERROR_CLASS}>
            {textError ?? ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <KdyButton type="submit" className="min-h-11">
              在本机抽取候选
            </KdyButton>
            <KdyButton
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={() => {
                setArticleText('');
                setTextError(null);
              }}
            >
              清空正文
            </KdyButton>
          </div>
        </form>
      )}

      {notice === null ? null : (
        <p role="status" aria-live="polite" className="rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-body">
          {notice}
        </p>
      )}

      <section className="flex min-w-0 flex-col gap-3" aria-labelledby={listHeadingId}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 id={listHeadingId} className="text-sm font-semibold text-body">
              3. 候选活动（{items.length}）
            </h3>
            <p className="text-xs text-muted">
              逐条核对原文证据与时间。新导入会追加到当前候选，重复条目会跳过；候选不会自动加入日程，也不会触发提醒。
            </p>
          </div>
          {items.length === 0 ? null : (
            <div className="flex flex-wrap gap-2">
              <KdyButton
                type="button"
                variant="secondary"
                className="min-h-11"
                onClick={addManualActivity}
              >
                手动新增活动
              </KdyButton>
              <KdyButton
                type="button"
                variant="ghost"
                className="min-h-11"
                onClick={() => {
                  setItems([]);
                  setCardErrors({});
                  setNotice(null);
                  setExportError(null);
                  setExportNotice(null);
                }}
              >
                清空本次候选
              </KdyButton>
            </div>
          )}
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-sm text-muted">
            <p>
              还没有候选。先在上面给一篇公众号链接或粘贴正文；抽取失败时正文会保留，改好再试。
              也可以直接手动新增一条。
            </p>
            <KdyButton
              type="button"
              className="min-h-11 self-start"
              onClick={addManualActivity}
            >
              手动新增活动
            </KdyButton>
          </div>
        ) : (
          <ul className="flex min-w-0 flex-col gap-3">
            {items.map((item) => (
              <li key={item.id} className="min-w-0">
                <CandidateCard
                  item={item}
                  errors={cardErrors[item.id] ?? {}}
                  onPatch={(patch) => patchItem(item.id, patch)}
                  onConfirm={() => confirmItem(item.id)}
                  onUnconfirm={() => unconfirmItem(item.id)}
                  onDismiss={() => dismissItem(item.id)}
                  onRestore={() => restoreItem(item.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-2" aria-labelledby={exportHeadingId}>
        <h3 id={exportHeadingId} className="text-sm font-semibold text-body">
          4. 导出（已确认 {confirmedCount} 条）
        </h3>
        <p className="text-xs text-muted">
          ICS 可直接导入系统日历；JSON 带回小程序或留档。导出只包含已确认活动与 ≤200 字证据片段。
        </p>
        <div className="flex flex-wrap gap-2">
          <KdyButton type="button" className="min-h-11" onClick={() => handleExport('ics')}>
            导出 ICS
          </KdyButton>
          <KdyButton
            type="button"
            variant="secondary"
            className="min-h-11"
            onClick={() => handleExport('json')}
          >
            导出 JSON
          </KdyButton>
        </div>
        {exportError === null ? null : (
          <p role="alert" className={ERROR_CLASS}>
            {exportError}
          </p>
        )}
        {exportNotice === null ? null : (
          <p role="status" aria-live="polite" className="text-xs text-success">
            {exportNotice}
          </p>
        )}
      </section>
    </div>
  );
}
