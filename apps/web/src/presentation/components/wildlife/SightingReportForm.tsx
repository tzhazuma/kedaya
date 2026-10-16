'use client';

/**
 * 上报观测表单（`/wildlife/report`）—— 规格 §4 / §5 / §8 / §10.3 的完整链路。
 *
 * ```
 * 选照片（<input type="file">）→ 客户端预校验 → POST /media（服务端剥离 EXIF）
 *   → POST /classify（**无能力时返回空 → 静默降级为手动选择**）
 *   → 地图点选地点（自动判定落在哪个区域 + 投喂政策）
 *   → 填发现时间（**不是**上报时间）→ 选物种（建议可覆盖）→ 可选给个体起名
 *   → 勾选伦理守则（表单校验，**不是同意门**）→ POST /items
 * ```
 *
 * 三态：字典加载中（骨架）/ 失败（可重试）/ 成功（表单）。
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { RefreshCw, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';

import { loadWildlifeCatalog } from '@/application/wildlife/loadWildlifeCatalog';
import { toBasemapVM } from '@/application/wildlife/wildlifeMap';
import {
  applySuggestion,
  createClientPhotoId,
  correctSpecies,
  isCorrection,
  reportProgressHint,
  submitSighting,
  suggestSpeciesForMedia,
  uploadSightingMedia,
  validateMediaFile,
  type ClassifierOutcome,
} from '@/application/wildlife/reportSighting';
import { getRepositories } from '@/data/repositories';
import { isInCampus } from '@/domain/models/wildlife/basemap';
import { zoneToOverlay } from '@/domain/models/wildlife/geometry';
import { circleContainsPoint, forbiddenZoneWarning } from '@/domain/models/wildlife/species';
import {
  createEmptySightingDraft,
  SIGHTING_LIMITS,
  validateSightingDraft,
  type SightingDraft,
} from '@/domain/models/wildlife/sightings';
import { individualsForSpecies } from '@/domain/models/wildlife/tracks';

import { queryKeys } from '../../query/keys';
import { errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { cn } from '../../theme/cn';
import { KdyAlert } from '../KdyAlert';
import { KdyBadge } from '../KdyBadge';
import { KdyButton } from '../KdyButton';
import { KdyCard } from '../KdyCard';
import { KdySkeleton } from '../KdySkeleton';
import { EthicsNotice } from './EthicsNotice';
import { FeedingPolicyBadge } from './FeedingPolicyBadge';
import { WildlifeBasemapMap, type PickedPoint } from './WildlifeBasemapMap';

export function SightingReportForm() {
  const repository = getRepositories().wildlife;
  const [draft, setDraft] = useState<SightingDraft>(() => createEmptySightingDraft());
  const [picked, setPicked] = useState<PickedPoint | null>(null);
  const [classifier, setClassifier] = useState<ClassifierOutcome | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<string | null>(null);

  const mapQuery = useQuery({
    queryKey: queryKeys.wildlife.catalog,
    queryFn: async () => {
      const [catalog, basemap] = await Promise.all([
        loadWildlifeCatalog(repository),
        repository.basemap(),
      ]);
      return {
        catalog: unwrapOrThrow(catalog),
        basemap: unwrapOrThrow(basemap),
      };
    },
  });

  const catalog = mapQuery.data?.catalog ?? { species: [], zones: [], individuals: [] };
  const zoneOverlays = useMemo(
    () => catalog.zones.map((zone) => zoneToOverlay(zone)),
    [catalog.zones],
  );

  const zoneForPoint = useMemo(() => {
    if (!picked) return null;
    return (
      catalog.zones.find((zone) =>
        circleContainsPoint(zone.geo, { lat: picked.lat, lng: picked.lng }),
      ) ?? null
    );
  }, [picked, catalog.zones]);

  const individualOptions = useMemo(
    () => individualsForSpecies(catalog.individuals, draft.speciesId),
    [catalog.individuals, draft.speciesId],
  );

  const validation = validateSightingDraft(draft, new Date(), {
    knownSpeciesIds: catalog.species.map((s) => s.id),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const clientPhotoId = createClientPhotoId();
      const media = unwrapOrThrow(await uploadSightingMedia(repository, { file, clientPhotoId }));
      return { media, clientPhotoId };
    },
    onMutate: () => {
      setUploadError(null);
      setClassifier(null);
    },
    onSuccess: async ({ media }) => {
      setDraft((current) => ({ ...current, mediaIds: [...current.mediaIds, media.mediaId] }));
      setPhotoName(media.thumbUrl);
      // 分类是**可选增强**：失败/无能力都不阻塞上报（规格 §5.2）
      const outcome = await suggestSpeciesForMedia(repository, media.mediaId, catalog);
      if (outcome.ok) setClassifier(outcome.value);
    },
    onError: (error) => setUploadError(errorMessage(error)),
  });

  const submitMutation = useMutation({
    mutationFn: async () =>
      unwrapOrThrow(
        await submitSighting(
          repository,
          draft,
          catalog,
          new Date(),
        ),
      ),
    onSuccess: (outcome) => {
      if (outcome.receipt) {
        setProblems([]);
        setReceipt(outcome.receipt.message);
      } else {
        setProblems(outcome.problems);
      }
    },
    onError: (error) => setProblems([errorMessage(error)]),
  });

  if (mapQuery.isPending) {
    return (
      <div aria-busy aria-live="polite" className="flex flex-col gap-3" data-testid="wildlife-report-loading">
        <KdySkeleton className="h-72 w-full" />
        <KdySkeleton lines={4} />
      </div>
    );
  }

  if (mapQuery.isError) {
    return (
      <KdyAlert
        tone="danger"
        title="上报页所需的物种表/底图加载失败"
        role="alert"
        action={
          <KdyButton size="sm" variant="secondary" onClick={() => void mapQuery.refetch()}>
            <RefreshCw className={cn('size-3.5', mapQuery.isFetching && 'animate-spin')} aria-hidden />
            重试
          </KdyButton>
        }
      >
        <p>{errorMessage(mapQuery.error)}</p>
      </KdyAlert>
    );
  }

  if (receipt) {
    return (
      <KdyCard className="flex flex-col gap-3">
        <KdyAlert tone="success" title="上报已提交" role="status">
          <p>{receipt}</p>
          <p className="mt-1 text-xs">
            公开时间会被粗化、公开坐标会被模糊化；敏感区内的记录
            <strong className="font-medium">不公开任何坐标</strong>。
          </p>
        </KdyAlert>
        <div className="flex flex-wrap gap-2">
          <KdyButton href="/wildlife">回到地图</KdyButton>
          <KdyButton
            variant="secondary"
            onClick={() => {
              setReceipt(null);
              setDraft(createEmptySightingDraft());
              setPicked(null);
              setClassifier(null);
              setPhotoName(null);
            }}
          >
            再报一条
          </KdyButton>
        </div>
      </KdyCard>
    );
  }

  const basemap = mapQuery.data ? toBasemapVM(mapQuery.data.basemap) : null;

  return (
    <div className="flex flex-col gap-4" data-testid="wildlife-report-form">
      <KdyAlert tone="info" title="上报流程">
        <p>{reportProgressHint({
          photoCount: draft.mediaIds.length,
          hasGeo: draft.geo !== null,
          speciesId: draft.speciesId,
          ethicsAcknowledged: draft.ethicsAcknowledged,
        })}</p>
        <p className="mt-1 text-xs">
          分类是增强而不是前置条件：没有照片、没有自动识别，上报依然完整有效。
        </p>
      </KdyAlert>

      {/* ---- ① 照片 ---- */}
      <KdyCard className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-body">
          ① 照片（最多 {SIGHTING_LIMITS.mediaMax} 张，单张 ≤5 MB）
        </h3>
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-xs text-muted">
            支持 JPEG / PNG / WebP。上传后服务端会强制剥离 EXIF（含 GPS）并重新编码。
          </span>
          <input
            type="file"
            accept={SIGHTING_LIMITS.mediaMimeTypes.join(',')}
            disabled={uploadMutation.isPending || draft.mediaIds.length >= SIGHTING_LIMITS.mediaMax}
            data-testid="wildlife-photo-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              const fileProblems = validateMediaFile(file);
              if (fileProblems.length > 0) {
                setUploadError(fileProblems[0] ?? '文件不合法');
                return;
              }
              uploadMutation.mutate(file);
            }}
            className="rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-body"
          />
        </label>

        {uploadMutation.isPending ? (
          <p className="text-xs text-muted" aria-live="polite">
            <Upload className="mr-1 inline size-3.5" aria-hidden />
            上传中…（EXIF 剥离在服务端执行）
          </p>
        ) : null}
        {uploadError ? (
          <p className="text-xs text-danger" role="alert">
            {uploadError}
          </p>
        ) : null}
        {draft.mediaIds.length > 0 ? (
          <p className="text-xs text-muted" data-testid="wildlife-media-count">
            已上传 {draft.mediaIds.length} 张：{draft.mediaIds.join('、')}
            {photoName ? `（缩略图 ${photoName}）` : ''}
          </p>
        ) : (
          <p className="text-xs text-muted">还没有照片。没有照片也可以提交，但更容易被审核拒绝。</p>
        )}
      </KdyCard>

      {/* ---- ② 地点 ---- */}
      <KdyCard className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-body">② 发现地点（地图点选）</h3>
        {basemap ? (
          <WildlifeBasemapMap
            basemap={basemap}
            zones={zoneOverlays}
            spots={[]}
            tracks={[]}
            markers={[]}
            picking
            picked={picked}
            onPick={(point) => {
              setPicked(point);
              setDraft((current) => ({ ...current, geo: { lat: point.lat, lng: point.lng } }));
            }}
          />
        ) : null}
        <p className="text-xs text-muted">
          点击底图上的位置即可选点。键盘用户可先用「跳过地图」按钮清空选择，再联系管理员代为录入
          （地图点选目前只有指针交互，这是已知限制）。
        </p>
        {picked ? (
          <p className="text-xs text-body" data-testid="wildlife-picked-readout">
            已选点：WGS84 {picked.lat.toFixed(6)}, {picked.lng.toFixed(6)}（像素 {picked.px.toFixed(0)},{' '}
            {picked.py.toFixed(0)}）· {isInCampus({ lat: picked.lat, lng: picked.lng }) ? '在校园范围内' : '不在校园范围内'}
          </p>
        ) : null}
        {!picked || !isInCampus({ lat: picked.lat, lng: picked.lng }) ? (
          <p className="text-xs text-warning">请点选校园范围内的地点，否则服务端会以 COORDINATE_OUT_OF_CAMPUS 拒绝。</p>
        ) : null}
        {zoneForPoint ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-alt px-3 py-2">
            <span className="text-xs text-body">落在区域：{zoneForPoint.name}</span>
            <FeedingPolicyBadge policy={zoneForPoint.feedingPolicy} />
            {zoneForPoint.feedingPolicy === 'forbidden' ? (
              <span className="text-xs text-danger">
                {forbiddenZoneWarning(
                  zoneForPoint.name,
                  catalog.species.find((s) => s.id === draft.speciesId)?.commonNameZh,
                )}
              </span>
            ) : null}
            {zoneForPoint.isSensitive ? (
              <span className="text-xs text-warning">敏感区：该记录不会公开任何坐标</span>
            ) : null}
          </div>
        ) : null}
      </KdyCard>

      {/* ---- ③ 时间 / 物种 / 个体名 ---- */}
      <KdyCard className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-body">③ 发现时间与物种</h3>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-body">发现时间（不是你上传的时间）</span>
          <input
            type="datetime-local"
            value={draft.observedAt}
            onChange={(event) => setDraft((current) => ({ ...current, observedAt: event.target.value }))}
            className="rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-body"
            data-testid="wildlife-observed-at"
          />
          <span className="text-xs text-muted">
            必须在过去 {SIGHTING_LIMITS.observedPastDays} 天内，且不晚于当前时间（容忍 5 分钟时钟误差）。
          </span>
        </label>

        {classifier ? (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-alt p-3">
            <p className="text-xs text-body">{classifier.notice}</p>
            {classifier.suggestions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {classifier.suggestions.map((suggestion) => (
                  <button
                    key={suggestion.speciesId}
                    type="button"
                    onClick={() => setDraft((current) => applySuggestion(current, suggestion))}
                    className={cn(
                      'rounded-pill border px-3 py-1 text-xs',
                      suggestion.preselected
                        ? 'border-brand-soft bg-brand-soft text-brand-strong'
                        : 'border-border bg-surface text-muted',
                    )}
                  >
                    {suggestion.label}（{Math.round(suggestion.confidence * 100)}%）
                  </button>
                ))}
              </div>
            ) : null}
            <p className="text-xs text-muted">
              置信度低于 60% 的建议<strong className="font-medium">不会</strong>被预选（避免把“可能是”当成“就是”）。
            </p>
          </div>
        ) : null}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-body">物种（必填）</span>
          <select
            value={draft.speciesId}
            onChange={(event) =>
              setDraft((current) =>
                // 换物种时清掉已选个体（个体属于特定物种，跨物种关联是脏数据）
                correctSpecies({ ...current, individualId: null }, event.target.value),
              )
            }
            className="rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-body"
            data-testid="wildlife-species-select"
          >
            <option value="">请选择物种</option>
            {catalog.species.map((species) => (
              <option key={species.id} value={species.id}>
                {species.commonNameZh}
                {species.isProtected ? '（保护动物：需两名审核员复核）' : ''}
              </option>
            ))}
          </select>
          {isCorrection(draft) ? (
            <span className="text-xs text-muted">
              你修改了自动识别结果，这会被记录为一条纠正样本（帮助后续提高识别质量）。
            </span>
          ) : null}
        </label>

        {draft.speciesId && individualOptions.length > 0 ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-body">或选择已命名的个体</span>
            <select
              value={draft.individualId ?? ''}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  individualId: event.target.value === '' ? null : event.target.value,
                }))
              }
              className="rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-body"
              data-testid="wildlife-individual-select"
            >
              <option value="">不指定个体</option>
              {individualOptions.map((individual) => (
                <option key={individual.id} value={individual.id}>
                  {individual.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-body">这是某只熟悉的动物吗？（可选）</span>
          <input
            type="text"
            value={draft.individualName}
            maxLength={24}
            placeholder="例如：大橘（留空表示不命名）"
            onChange={(event) => setDraft((current) => ({ ...current, individualName: event.target.value }))}
            className="rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-body"
            data-testid="wildlife-individual-name"
          />
          <span className="text-xs text-muted">
            新建个体需要审核后才公开（防止恶搞命名）。同物种内名字唯一。
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-body">备注（≤{SIGHTING_LIMITS.noteMax} 字）</span>
          <textarea
            rows={3}
            value={draft.note}
            maxLength={SIGHTING_LIMITS.noteMax}
            onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
            className="rounded-md border border-border bg-surface-alt px-3 py-2 text-sm text-body"
            placeholder="例如：两只成年个体，在湖面北侧"
          />
        </label>

        <div className="flex flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.healthConcern}
              onChange={(event) => setDraft((current) => ({ ...current, healthConcern: event.target.checked }))}
            />
            疑似受伤 / 异常
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.isAnonymous}
              onChange={(event) => setDraft((current) => ({ ...current, isAnonymous: event.target.checked }))}
            />
            匿名上报
          </label>
          {draft.healthConcern ? (
            <span className="text-xs text-danger">
              疑似受伤请勿自行处理、请勿投喂；提交后会立即通知校园动物社团。
            </span>
          ) : null}
        </div>
      </KdyCard>

      {/* ---- ④ 伦理（硬要求） ---- */}
      <EthicsNotice
        acknowledged={draft.ethicsAcknowledged}
        onAcknowledgeChange={(next) =>
          setDraft((current) => ({ ...current, ethicsAcknowledged: next }))
        }
      />

      {validation.hints.length > 0 ? (
        <KdyAlert tone="warning" title="提交前提醒">
          <ul className="list-disc pl-4">
            {validation.hints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </KdyAlert>
      ) : null}

      {problems.length > 0 ? (
        <KdyAlert tone="danger" title="无法提交" role="alert">
          <ul className="list-disc pl-4">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </KdyAlert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {validation.ok ? '信息齐全，可以提交。' : `还有 ${validation.problems.length} 项未完成。`}
        </p>
        <KdyButton
          disabled={submitMutation.isPending || !validation.ok}
          onClick={() => submitMutation.mutate()}
          data-testid="wildlife-submit"
        >
          {submitMutation.isPending ? '提交中…' : '提交上报'}
        </KdyButton>
      </div>

      {catalog.species.length === 0 ? (
        <KdyAlert tone="warning" title="物种表为空">
          <p>
            物种清单由服务端下发（真实清单需校园动物社团确认，未决问题 U2）。当前没有可选物种，
            请稍后再试或联系管理员。
          </p>
        </KdyAlert>
      ) : null}
    </div>
  );
}
