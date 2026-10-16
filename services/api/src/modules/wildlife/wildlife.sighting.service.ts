/**
 * wildlife · 写用例（规格 §10.1 的 11–17 号端点）
 *
 * 本文件是**隐私流水线的唯一入口**：任何创建/修改观测的路径都必须经过
 * `domain/fuzzing.ts` 的 `fuzzSighting()`，且精确坐标**只**写进受限表。
 *
 * 三条硬规则：
 *   1. **精确坐标绝不进公开表**（`geoLat`/`geoLng` 存的是模糊后的值）；
 *   2. **降级时 `geo` 为 `null`** —— 不构造、不近似、不"顺手补一个"；
 *   3. **EXIF 剥离在服务端断言**，客户端承诺不算数。
 *
 * 关于 id：观测 id 由**应用层先用 ULID 生成**（而不是让 Prisma 生成），
 * 因为 §9.3 ③ 的确定性噪声要按 `sightingId` 派生 ——
 * "同一条观测永远映射到同一个模糊点"这一保证，要求噪声键与持久化主键**是同一个值**。
 */
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { distanceMeters, gridCellKey } from '@kedaya/shared';
import { AuditService } from '../../common/compliance/audit.service';
import { ulid } from '../../common/ids/ulid';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../common/errors/app-error';
import { MEDIA_MAX_PER_SIGHTING, acceptUpload, type MediaMime } from './domain/media';
import { assertEthicsAcknowledged, assertNoteAcceptable, parseKeywordList } from './domain/content';
import {
  assertFuzzSecret,
  fuzzSighting,
  kAnonymityWindowStart,
  type FuzzResult,
  type FuzzSpeciesInput,
  type FuzzZoneInput,
} from './domain/fuzzing';
import { assertInCampus } from './domain/geo';
import {
  CLASSIFIED_BY_VALUES,
  assertObservedAtInRange,
  normalizeClassifiedBy,
  shapeClassification,
  toSensitivePolygons,
  type ClassificationResponse,
} from './domain/taxonomy';
import { SPECIES_CLASSIFIER, type SpeciesClassifierPort } from './domain/ports/species-classifier.port';
import { readWildlifeConfig } from '../../config/wildlife.config';
import {
  HEALTH_ALERT_PORT,
  MEDIA_STORAGE,
  THUMBNAILER,
  WILDLIFE_CATALOG_REPOSITORY,
  WILDLIFE_INDIVIDUAL_REPOSITORY,
  WILDLIFE_MEDIA_REPOSITORY,
  WILDLIFE_MODULE_ID,
  WILDLIFE_SIGHTING_REPOSITORY,
  type HealthAlertPort,
  type IndividualModel,
  type MediaModel,
  type MediaStoragePort,
  type SightingModel,
  type SpeciesModel,
  type ThumbnailerPort,
  type UpdateSightingInput,
  type WildlifeCatalogRepository,
  type WildlifeIndividualRepository,
  type WildlifeMediaRepository,
  type WildlifeSightingRepository,
  type ZoneModel,
} from './domain/wildlife.domain';
import { WildlifeQueryService, type SightingDetailView } from './wildlife.query.service';
import {
  toIndividualView,
  toMediaView,
  toSightingView,
  type IndividualView,
  type MediaView,
} from './wildlife.views';

/* ------------------------------------------------------------------ *
 * 请求体（与 controller 的 Zod schema 对齐）
 * ------------------------------------------------------------------ */

export interface CreateSightingBody {
  species?: string;
  /** OpenAPI 别名（与 `species` 同义） */
  speciesId?: string;
  observedAt: Date;
  geo?: { lat: number; lng: number };
  /** OpenAPI 的写法：`latitude` / `longitude` */
  latitude?: number;
  longitude?: number;
  geoAccuracyM?: number;
  zoneId?: string | null;
  mediaIds?: string[];
  healthConcern?: boolean;
  individualId?: string | null;
  note?: string | null;
  isAnonymous?: boolean;
  autoSpeciesId?: string | null;
  autoConfidence?: number | null;
  classifiedBy?: string;
  ethicsAcknowledged?: boolean;
}

/** RFC 7396 Merge Patch：`null` = 删除该字段，缺省 = 不改 */
export interface PatchSightingBody {
  species?: string | null;
  observedAt?: Date | null;
  note?: string | null;
}

export interface ModerateBody {
  decision: 'PUBLISHED' | 'REJECTED';
  reason?: string | null;
}

export interface CreateIndividualBody {
  name: string;
  speciesId: string;
  description?: string | null;
  coverPhotoUrl?: string | null;
}

export interface UploadMediaInput {
  data: Buffer;
  declaredMime?: string;
  clientPhotoId: string;
  sortOrder?: number;
}

/** 个体名长度上限（规格 §2.8：≤24 字。OpenAPI 写 60，以规格为准） */
export const INDIVIDUAL_NAME_MAX_LENGTH = 24;

@Injectable()
export class WildlifeSightingService {
  constructor(
    @Inject(WILDLIFE_SIGHTING_REPOSITORY) private readonly sightings: WildlifeSightingRepository,
    @Inject(WILDLIFE_MEDIA_REPOSITORY) private readonly media: WildlifeMediaRepository,
    @Inject(WILDLIFE_CATALOG_REPOSITORY) private readonly catalog: WildlifeCatalogRepository,
    @Inject(WILDLIFE_INDIVIDUAL_REPOSITORY) private readonly individuals: WildlifeIndividualRepository,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStoragePort,
    @Inject(THUMBNAILER) private readonly thumbnailer: ThumbnailerPort,
    @Inject(SPECIES_CLASSIFIER) private readonly classifier: SpeciesClassifierPort,
    @Inject(HEALTH_ALERT_PORT) private readonly healthAlert: HealthAlertPort,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(WildlifeQueryService) private readonly query: WildlifeQueryService,
  ) {}

  /* ================================================================ *
   * 11. POST /media
   * ================================================================ */

  /**
   * 上传照片。
   *
   * 链路（规格 §4.1）：校验 mime/大小/魔数 → **强制剥离 EXIF** → 断言 →
   * 生成缩略图（可降级）→ 存对象存储 → 落 `WildlifeMedia`（`sightingId = null`）。
   *
   * 幂等（规格 §4.5 / T37）：同 `(uploadedBy, clientPhotoId)` 重试返回**同一个** `mediaId`，
   * 不重复存储。
   */
  async uploadMedia(actorId: string | undefined, input: UploadMediaInput): Promise<MediaView> {
    const userId = this.requireActor(actorId);
    const clientPhotoId = input.clientPhotoId?.trim();
    if (!clientPhotoId) {
      throw new ValidationError('缺少 clientPhotoId（客户端生成的幂等键，规格 §4.5）', {
        reason: 'CLIENT_PHOTO_ID_REQUIRED',
      });
    }

    const existing = await this.media.findByUploaderAndClientPhotoId(userId, clientPhotoId);
    if (existing) return this.mediaView(existing);

    // 校验 + 剥离 + 断言（全部在服务端，客户端承诺不算数）
    const accepted = acceptUpload(input.data, input.declaredMime);
    const sha256 = createHash('sha256').update(accepted.data).digest('hex');
    const key = this.storageKey(sha256, accepted.mime);

    await this.storage.put(key, accepted.data, accepted.mime);

    // 缩略图是**非隐私路径**：sharp 不可用就降级为"缩略图 = 原图"
    const thumbnail = await this.thumbnailer.render(accepted.data);
    let thumbKey = key;
    if (thumbnail) {
      thumbKey = `${key}.thumb.webp`;
      await this.storage.put(thumbKey, thumbnail, 'image/webp');
    }

    const created = await this.media.create({
      sightingId: null,
      storageKey: key,
      thumbKey,
      widthPx: accepted.width,
      heightPx: accepted.height,
      byteSize: accepted.byteSize,
      mimeType: accepted.mime,
      sha256,
      clientPhotoId,
      sortOrder: input.sortOrder ?? 0,
      uploadedBy: userId,
    });

    return this.mediaView(created);
  }

  /* ================================================================ *
   * 12. POST /items
   * ================================================================ */

  /**
   * 上报观测（核心端点，规格 §10.3）。
   *
   * 顺序刻意如此：先做**全部校验**（伦理勾选、物种、时间、坐标、照片、备注），
   * 再跑模糊化流水线，最后才写库 —— 任何校验失败都不产生副作用。
   */
  async createSighting(
    actorId: string | undefined,
    body: CreateSightingBody,
  ): Promise<SightingDetailView> {
    const userId = this.requireActor(actorId);
    const cfg = readWildlifeConfig(this.config);
    const secret = assertFuzzSecret(cfg.WILDLIFE_FUZZ_SECRET);
    const now = new Date();

    // —— 伦理确认（**表单校验**，不是同意门；缺它只影响该次提交） ——
    assertEthicsAcknowledged(body.ethicsAcknowledged);

    // —— 物种 ——
    const speciesId = (body.species ?? body.speciesId ?? '').trim();
    if (!speciesId) {
      throw new ValidationError('必须选择一个物种（或先上传照片后手动选择）', {
        reason: 'UNKNOWN_SPECIES',
      });
    }
    const species = await this.requireSpecies(speciesId);
    if (!species.isActive) {
      throw new ValidationError('物种不存在或已下架', { reason: 'UNKNOWN_SPECIES' });
    }
    if (body.autoSpeciesId) {
      const auto = await this.catalog.findSpeciesById(body.autoSpeciesId);
      if (!auto) {
        throw new ValidationError('自动分类结果引用了不存在的物种', { reason: 'UNKNOWN_SPECIES' });
      }
    }

    // —— 发现时间（与上报时间分离，契约 §11.10-A） ——
    const observedAt = body.observedAt;
    assertObservedAtInRange(observedAt, now);

    // —— 坐标（WGS84 单一真相；所有写入路径都必须过校园边界断言） ——
    const point = this.resolvePoint(body);
    assertInCampus(point);
    if (body.geoAccuracyM !== undefined && (body.geoAccuracyM < 1 || body.geoAccuracyM > 10000)) {
      throw new ValidationError('GPS 精度必须在 1–10000 米之间', { reason: 'INVALID_ACCURACY' });
    }

    // —— 备注 ——
    assertNoteAcceptable(body.note, parseKeywordList(cfg.WILDLIFE_BANNED_KEYWORDS));

    // —— 分类来源 ——
    if (
      body.classifiedBy !== undefined &&
      !(CLASSIFIED_BY_VALUES as readonly string[]).includes(body.classifiedBy)
    ) {
      throw new ValidationError('分类来源不合法', { reason: 'INVALID_CLASSIFIER_SOURCE' });
    }
    const classifiedBy = normalizeClassifiedBy(body.classifiedBy);

    // —— 命名个体 ——
    if (body.individualId) {
      const individual = await this.individuals.findById(body.individualId);
      if (!individual || individual.deletedAt) {
        throw new ValidationError('指定的个体不存在', { reason: 'UNKNOWN_INDIVIDUAL' });
      }
    }

    // —— 区域（未指定时按坐标自动落区，这样敏感区判定不依赖客户端传参） ——
    const zones = await this.catalog.listZones();
    const zone = this.resolveZone(body.zoneId, point, zones);

    // —— 照片：数量、归属、同图去重 ——
    const mediaRows = await this.resolveMedia(userId, body.mediaIds ?? []);

    // —— 模糊化流水线（§9 四层）。id 必须先于入库生成，见文件头说明 ——
    const sightingId = ulid();
    const fuzz = await this.fuzz({
      sightingId,
      point,
      observedAt,
      species,
      zone,
      allZones: zones,
      secret,
      defaultRadiusM: cfg.WILDLIFE_FUZZ_DEFAULT_RADIUS_M,
    });

    // —— 落库：公开行（只有模糊后的坐标） ——
    const sighting = await this.sightings.create({
      id: sightingId,
      // 用 fuzz.zoneId（含契约 §11.13 的"降级后必须有区域"回退），而不是 zone?.id
      zoneId: fuzz.zoneId,
      species: species.id,
      status: 'PENDING',
      geoLat: fuzz.geo?.lat ?? null,
      geoLng: fuzz.geo?.lng ?? null,
      geoFuzzLevel: fuzz.level,
      fuzzRadiusM: fuzz.fuzzRadiusM,
      gridCellKey: fuzz.gridCellKey,
      photoUrls: mediaRows.map((m) => this.storage.urlFor(m.thumbKey)),
      healthConcern: body.healthConcern === true,
      reporterId: userId,
      observedAt,
      observedAtFuzzed: new Date(fuzz.observedAtFuzzed),
      publishDelayDays: fuzz.publishDelayDays,
      individualId: body.individualId ?? null,
      autoSpeciesId: body.autoSpeciesId ?? null,
      autoConfidence: body.autoConfidence ?? null,
      classifiedBy,
      correctedFromSpeciesId: null,
      note: body.note ?? null,
      isAnonymous: body.isAnonymous === true,
    });

    // —— 受限表：精确坐标（唯一的落点，读取需审计） ——
    await this.sightings.saveExact({
      sightingId: sighting.id,
      exactLat: point.lat,
      exactLng: point.lng,
      exactAccuracyM: body.geoAccuracyM ?? null,
      exactObservedAt: observedAt,
    });

    // —— 关联照片 ——
    if (mediaRows.length > 0) {
      await this.media.attachToSighting(
        mediaRows.map((m) => m.id),
        sighting.id,
      );
    }

    // —— 健康异常：**不等待审核**立即通知社团（规格 §8.4） ——
    if (sighting.healthConcern) {
      await this.audit.recordQuietly({
        action: 'wildlife.sighting.health_concern',
        resource: 'WildlifeSighting',
        resourceId: sighting.id,
        module: WILDLIFE_MODULE_ID,
        metadata: { priority: 'queue-head' },
      });
      await this.healthAlert.notifyHealthConcern({
        sightingId: sighting.id,
        reporterId: userId,
        zoneId: sighting.zoneId,
        observedAt,
      });
    }

    return this.detailView(sighting, species.commonNameZh, userId);
  }

  /* ================================================================ *
   * 13. PATCH /items/:id —— RFC 7396 Merge Patch
   * ================================================================ */

  /**
   * 修正自己的上报（物种纠正 / 时间纠正 / 备注增删）。
   *
   * **RFC 7396 语义**（契约 §11.1 / T29）：
   *   · `null` = 删除该字段（`{"note": null}` 清空备注）；
   *   · 缺省 = 保持原值；
   *   · body 本身就是 patch，**不**包一层 `{patch: ...}`。
   *
   * 物种被纠正时保留自动分类结果（`correctedFromSpeciesId = autoSpeciesId`），
   * 让"自动分类不准"从产品缺陷变成**数据资产**（规格 §5.5）。
   */
  async patchSighting(
    id: string,
    actorId: string | undefined,
    patch: PatchSightingBody,
  ): Promise<SightingDetailView> {
    const userId = this.requireActor(actorId);
    const sighting = await this.query.requireSighting(id);
    if (sighting.reporterId !== userId) {
      // 不是本人的上报：统一 403（**不区分**"不存在"与"不是你的"，防枚举）
      throw new ForbiddenError('只能修改自己的上报');
    }
    if (sighting.status === 'REJECTED') {
      throw new ConflictError('已下架的观测不能修改');
    }

    const cfg = readWildlifeConfig(this.config);
    const secret = assertFuzzSecret(cfg.WILDLIFE_FUZZ_SECRET);
    const now = new Date();
    const next: UpdateSightingInput = {};

    // —— 备注（null = 清空） ——
    if ('note' in patch) {
      const note = patch.note ?? null;
      assertNoteAcceptable(note, parseKeywordList(cfg.WILDLIFE_BANNED_KEYWORDS));
      next.note = note;
    }

    // —— 发现时间（null 非法：发现时间是必填语义） ——
    let observedAt = sighting.observedAt;
    if ('observedAt' in patch) {
      if (patch.observedAt === null || patch.observedAt === undefined) {
        throw new ValidationError('发现时间不能被删除（它是必填语义）', {
          reason: 'OBSERVED_AT_OUT_OF_RANGE',
        });
      }
      assertObservedAtInRange(patch.observedAt, now);
      observedAt = patch.observedAt;
      next.observedAt = observedAt;
    }

    // —— 物种纠正 ——
    let species = await this.requireSpecies(sighting.species);
    let speciesChanged = false;
    if ('species' in patch) {
      if (patch.species === null || patch.species === undefined) {
        throw new ValidationError('物种不能被删除（PENDING → PUBLISHED 的前置条件）', {
          reason: 'UNKNOWN_SPECIES',
        });
      }
      const corrected = await this.requireSpecies(patch.species);
      if (!corrected.isActive) {
        throw new ValidationError('物种不存在或已下架', { reason: 'UNKNOWN_SPECIES' });
      }
      species = corrected;
      speciesChanged = corrected.id !== sighting.species;
      next.species = corrected.id;
      if (speciesChanged && sighting.autoSpeciesId && !sighting.correctedFromSpeciesId) {
        next.correctedFromSpeciesId = sighting.autoSpeciesId;
        // `classifiedBy` **保留原值**（规格 §5.5 第 1 条）
      }
    }

    // 物种或时间变了 → 模糊半径（繁殖期加倍）与公开时间都要重算。
    // 用**同一条观测的 id** 派生噪声，因此同一 sighting 的模糊点保持确定性。
    if (speciesChanged || 'observedAt' in patch) {
      const zones = await this.catalog.listZones();
      const zone = sighting.zoneId ? (zones.find((z) => z.id === sighting.zoneId) ?? null) : null;
      const exact = await this.sightings.findExact(id);
      if (exact) {
        const fuzz = await this.fuzz({
          sightingId: id,
          point: { lat: exact.exactLat, lng: exact.exactLng },
          observedAt,
          species,
          zone,
          allZones: zones,
          secret,
          defaultRadiusM: cfg.WILDLIFE_FUZZ_DEFAULT_RADIUS_M,
        });
        next.zoneId = fuzz.zoneId;
        next.geoLat = fuzz.geo?.lat ?? null;
        next.geoLng = fuzz.geo?.lng ?? null;
        next.geoFuzzLevel = fuzz.level;
        next.fuzzRadiusM = fuzz.fuzzRadiusM;
        next.gridCellKey = fuzz.gridCellKey;
        next.observedAtFuzzed = new Date(fuzz.observedAtFuzzed);
        next.publishDelayDays = fuzz.publishDelayDays;
      }
    }

    const updated = await this.sightings.update(id, next);
    return this.detailView(updated, species.commonNameZh, userId);
  }

  /* ================================================================ *
   * 14. DELETE /items/:id（软删）
   * ================================================================ */

  async deleteSighting(
    id: string,
    actorId: string | undefined,
  ): Promise<{ id: string; deleted: true }> {
    const userId = this.requireActor(actorId);
    const sighting = await this.query.requireSighting(id);
    if (sighting.reporterId !== userId) throw new ForbiddenError('只能撤回自己的上报');
    await this.sightings.softDelete(id, new Date());
    await this.audit.recordQuietly({
      action: 'wildlife.sighting.withdraw',
      resource: 'WildlifeSighting',
      resourceId: id,
      module: WILDLIFE_MODULE_ID,
    });
    return { id, deleted: true };
  }

  /* ================================================================ *
   * 15. POST /items/:id/moderate（契约 §11.2 冻结的 action 名）
   * ================================================================ */

  /**
   * 审核观测（`PENDING → PUBLISHED / REJECTED`）。
   *
   * 三条业务规则（规格 §2.10）：
   *   · `PENDING → PUBLISHED` 前置：物种必须已确认；
   *   · **保护物种必须双人复核**：第一位审核员通过返回 `FORBIDDEN`（T33），
   *     第二位审核员才真正发布；
   *   · `PUBLISHED → REJECTED`（事后下架）**必须**填 `rejectReason`。
   */
  async moderate(
    id: string,
    actorId: string | undefined,
    body: ModerateBody,
  ): Promise<SightingDetailView> {
    const userId = this.requireActor(actorId);
    await this.query.assertModerator(userId);

    const sighting = await this.query.requireSighting(id);
    const decision = body.decision;
    if (decision !== 'PUBLISHED' && decision !== 'REJECTED') {
      throw new ValidationError('decision 只能是 PUBLISHED 或 REJECTED', { decision });
    }

    const species = await this.requireSpecies(sighting.species);

    if (decision === 'REJECTED') {
      // 事后下架必须填理由（规格 §2.10）
      if (sighting.status === 'PUBLISHED' && !body.reason?.trim()) {
        throw new ValidationError('下架已发布的观测必须填写 rejectReason', {
          reason: 'REJECT_REASON_REQUIRED',
        });
      }
      const updated = await this.sightings.update(id, {
        status: 'REJECTED',
        moderatedBy: userId,
        moderatedAt: new Date(),
        rejectReason: body.reason?.trim() ?? null,
      });
      await this.audit.record({
        action: 'wildlife.sighting.moderate',
        resource: 'WildlifeSighting',
        resourceId: id,
        module: WILDLIFE_MODULE_ID,
        metadata: { decision, from: sighting.status },
      });
      return this.detailView(updated, species.commonNameZh, userId, true);
    }

    // —— decision === 'PUBLISHED' ——
    if (sighting.status === 'PUBLISHED') {
      return this.detailView(sighting, species.commonNameZh, userId, true);
    }
    if (sighting.status !== 'PENDING') {
      throw new ConflictError(`不能从 ${sighting.status} 流转到 PUBLISHED`, {
        from: sighting.status,
        to: 'PUBLISHED',
      });
    }

    // 保护物种：必须两名**不同**审核员复核。
    //   moderatedBy == null      → 记录第一位审核员，返回 FORBIDDEN
    //   moderatedBy === userId   → 同一个人不能给自己凑第二票，仍然 FORBIDDEN
    //   moderatedBy 是另一位审核员 → 放行发布
    // （`moderatedBy !== userId` 那种写法会让同一个审核员点两次就发布，
    //   双人复核形同虚设 —— 由 `wildlife-http.spec.ts` 的 T33 断言抓出。）
    if (species.isProtected && (sighting.moderatedBy === null || sighting.moderatedBy === userId)) {
      // 第一位审核员**记录在案但不发布**
      await this.sightings.update(id, { moderatedBy: userId });
      await this.audit.record({        action: 'wildlife.sighting.moderate.first_approval',
        resource: 'WildlifeSighting',
        resourceId: id,
        module: WILDLIFE_MODULE_ID,
        metadata: { decision, species: species.id, isProtected: true },
      });
      throw new ForbiddenError('保护物种必须两名审核员复核；这是第一位审核员的通过记录', {
        reason: 'NEEDS_SECOND_MODERATOR',
      });
    }

    const updated = await this.sightings.update(id, {
      status: 'PUBLISHED',
      moderatedBy: userId,
      moderatedAt: new Date(),
    });
    await this.audit.record({
      action: 'wildlife.sighting.moderate',
      resource: 'WildlifeSighting',
      resourceId: id,
      module: WILDLIFE_MODULE_ID,
      metadata: { decision, isProtected: species.isProtected },
    });
    return this.detailView(updated, species.commonNameZh, userId, true);
  }

  /* ================================================================ *
   * 16. POST /individuals
   * ================================================================ */

  /**
   * 创建命名个体（"手动给个名字"，规格 §2.8）。
   *
   * 低风险但**需审核** → 走 `PENDING` 队列，与 sighting 审核复用同一套队列与守卫。
   * 同物种内名字唯一，防止重复建个体。
   */
  async createIndividual(
    actorId: string | undefined,
    body: CreateIndividualBody,
  ): Promise<IndividualView> {
    const userId = this.requireActor(actorId);
    const cfg = readWildlifeConfig(this.config);

    const name = body.name?.trim() ?? '';
    if (!name) throw new ValidationError('个体名不能为空', { reason: 'NAME_REQUIRED' });
    if (name.length > INDIVIDUAL_NAME_MAX_LENGTH) {
      throw new ValidationError(`个体名不能超过 ${INDIVIDUAL_NAME_MAX_LENGTH} 字`, {
        reason: 'NAME_TOO_LONG',
        maxLength: INDIVIDUAL_NAME_MAX_LENGTH,
      });
    }
    // 防止给动物起侮辱性名字，或借此指向真人
    assertNoteAcceptable(name, parseKeywordList(cfg.WILDLIFE_BANNED_KEYWORDS));

    const species = await this.requireSpecies(body.speciesId);
    const existing: IndividualModel | null = await this.individuals.findByName(species.id, name);
    if (existing) {
      throw new ConflictError('该物种下已有个体使用这个名字', { reason: 'INDIVIDUAL_NAME_TAKEN' });
    }

    const created = await this.individuals.create({
      name,
      speciesId: species.id,
      description: body.description ?? null,
      coverPhotoUrl: body.coverPhotoUrl ?? null,
      status: 'PENDING',
      createdBy: userId,
    });
    return toIndividualView(created);
  }

  /* ================================================================ *
   * 17. POST /classify
   * ================================================================ */

  /**
   * 请求自动分类建议（可选端点）。
   *
   * **无能力时必须优雅降级**（规格 §5.2 / T43）：返回空建议 + `degraded: true`，
   * **不得返回 5xx 阻塞上报流程**。分类器本身也被约定为"不抛异常"。
   */
  async classify(
    actorId: string | undefined,
    body: { mediaId: string },
  ): Promise<ClassificationResponse> {
    this.requireActor(actorId);
    const cfg = readWildlifeConfig(this.config);

    const media = await this.media.findById(body.mediaId);
    if (!media) throw new NotFoundError('照片不存在');

    if (cfg.effectiveClassifierMode !== 'server') {
      // manual / off → 直接降级，连图片都不读
      return shapeClassification([], {
        topK: cfg.WILDLIFE_CLASSIFIER_TOP_K,
        minConfidence: cfg.WILDLIFE_CLASSIFIER_MIN_CONFIDENCE,
        degraded: true,
      });
    }

    let predictions: Awaited<ReturnType<SpeciesClassifierPort['classify']>> = [];
    try {
      const bytes = await this.storage.get(media.storageKey);
      predictions = await this.classifier.classify(bytes, cfg.WILDLIFE_CLASSIFIER_TOP_K);
    } catch {
      // 上游不可用 / 模型加载失败 → 静默降级到手动选择（绝不 5xx）
      predictions = [];
    }

    return shapeClassification(predictions, {
      topK: cfg.WILDLIFE_CLASSIFIER_TOP_K,
      minConfidence: cfg.WILDLIFE_CLASSIFIER_MIN_CONFIDENCE,
      provider: this.classifier.provider,
      degraded: predictions.length === 0,
    });
  }

  /* ================================================================ *
   * 内部
   * ================================================================ */

  private requireActor(actorId: string | undefined): string {
    if (!actorId) throw new UnauthenticatedError();
    return actorId;
  }

  private async requireSpecies(id: string): Promise<SpeciesModel> {
    const species = await this.catalog.findSpeciesById(id);
    if (!species || species.deletedAt) {
      throw new ValidationError('物种不存在或已下架', { reason: 'UNKNOWN_SPECIES' });
    }
    return species;
  }

  /** `geo` / `latitude+longitude` 两种写法都要支持（规格与 OpenAPI 各用一种） */
  private resolvePoint(body: CreateSightingBody): { lat: number; lng: number } {
    if (body.geo) return { lat: body.geo.lat, lng: body.geo.lng };
    if (typeof body.latitude === 'number' && typeof body.longitude === 'number') {
      return { lat: body.latitude, lng: body.longitude };
    }
    throw new ValidationError('缺少坐标（geo 或 latitude/longitude）', {
      reason: 'COORDINATE_OUT_OF_CAMPUS',
    });
  }

  /**
   * 解析区域：显式 `zoneId` 优先；否则按坐标**自动落区**。
   *
   * 自动落区不是为了省事，而是为了让 §9.3 ① 的敏感区判定
   * **不依赖客户端是否传了 `zoneId`** —— 客户端不传就漏掉敏感区保护，
   * 那才是真正的问题。
   */
  private resolveZone(
    zoneId: string | null | undefined,
    point: { lat: number; lng: number },
    zones: readonly ZoneModel[],
  ): ZoneModel | null {
    if (zoneId) {
      const zone = zones.find((z) => z.id === zoneId);
      if (!zone) throw new ValidationError('区域不存在', { reason: 'UNKNOWN_ZONE' });
      return zone;
    }
    const containing = zones.filter(
      (zone) => distanceMeters(point, { lat: zone.centerLat, lng: zone.centerLng }) <= zone.radiusM,
    );
    // 命中多个时优先敏感区（更严格的隐私处理）
    return containing.find((zone) => zone.isSensitive) ?? containing[0] ?? null;
  }

  /** 照片：数量、归属、同图（sha256）去重 */
  private async resolveMedia(userId: string, mediaIds: readonly string[]): Promise<MediaModel[]> {
    if (mediaIds.length === 0) return [];
    const wanted = new Set(mediaIds);
    if (wanted.size > MEDIA_MAX_PER_SIGHTING) {
      throw new ValidationError(`单次上报最多 ${MEDIA_MAX_PER_SIGHTING} 张照片`, {
        reason: 'MEDIA_TOO_MANY',
        max: MEDIA_MAX_PER_SIGHTING,
      });
    }

    const rows = await this.media.findByIds([...wanted]);
    if (rows.length !== wanted.size) {
      throw new ValidationError('有照片不存在', { reason: 'UNKNOWN_MEDIA' });
    }
    for (const row of rows) {
      if (row.sightingId !== null) {
        throw new ValidationError('该照片已关联到其它上报', {
          reason: 'MEDIA_ALREADY_LINKED',
          mediaId: row.id,
        });
      }
      if (row.uploadedBy && row.uploadedBy !== userId) {
        throw new ForbiddenError('不能关联他人上传的照片');
      }
    }

    // 同 sha256 去重（T38）：同一张图在同一 sighting 内只留一份
    const seen = new Set<string>();
    const unique: MediaModel[] = [];
    for (const row of [...rows].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
    )) {
      if (seen.has(row.sha256)) continue;
      seen.add(row.sha256);
      unique.push(row);
    }
    return unique;
  }

  /** 跑一遍 §9 的四层流水线（k-匿名计数从 data 层取） */
  private async fuzz(input: {
    sightingId: string;
    point: { lat: number; lng: number };
    observedAt: Date;
    species: SpeciesModel;
    zone: ZoneModel | null;
    /** 全部区域：用于"降级后必须给出一个区域"的回退（契约 §11.13） */
    allZones: readonly ZoneModel[];
    secret: string;
    defaultRadiusM: number;
  }): Promise<FuzzResult> {
    const speciesInput: FuzzSpeciesInput = {
      isProtected: input.species.isProtected,
      isNestingSensitive: input.species.isNestingSensitive,
      nestingMonths: input.species.nestingMonths,
    };
    const zoneInput: FuzzZoneInput | null = input.zone
      ? {
          id: input.zone.id,
          fuzzRadiusM: input.zone.fuzzRadiusM,
          isSensitive: input.zone.isSensitive,
        }
      : null;

    const sensitiveZones = await this.catalog.listSensitiveZones();
    const sensitiveAreas = toSensitivePolygons(sensitiveZones);

    // k-匿名：同格 + 同 7 天窗口内的去重人数。
    // 计数用的格键必须与 `fuzzSighting` 内部**同一套** `gridCellKey`（floor 划分），
    // 否则"计数用的格"与"发布用的格"不一致，k-匿名保证失效。
    const radiusM = input.zone?.fuzzRadiusM ?? input.defaultRadiusM;
    const cellKey = gridCellKey(input.point, radiusM);

    // 当前这条还没入库，因此要 +1。
    const others = await this.sightings.countDistinctReportersInCell(
      cellKey,
      kAnonymityWindowStart(input.observedAt),
      input.observedAt,
      undefined,
    );
    const distinctReportersInCell = others + 1;

    const result = fuzzSighting({
      sightingId: input.sightingId,
      point: input.point,
      observedAt: input.observedAt,
      species: speciesInput,
      zone: zoneInput,
      sensitiveAreas,
      secret: input.secret,
      distinctReportersInCell,
      defaultRadiusM: input.defaultRadiusM,
    });

    // 契约 §11.13（v1.3.1 冻结）：`geo` 为空时 **`zoneId` 必须非空** ——
    // 否则客户端拿不到任何位置信息，只能显示"位置未知"，
    // 而这与"模糊到片区级"的产品目标不符。
    // 回退到**最近的区域**（只影响对外暴露的 zoneId，**不影响模糊半径**）：
    // 最近区域距离可能远大于网格，因此这个提示比网格更粗，方向上只会更安全。
    if (result.geo === null && result.zoneId === null) {
      const nearest = this.nearestZone(input.point, input.allZones);
      return { ...result, zoneId: nearest?.id ?? null };
    }
    return result;
  }

  /** 最近的区域（按圆心距离）。用于 §11.13 的"降级后必须给出区域"回退 */
  private nearestZone(
    point: { lat: number; lng: number },
    zones: readonly ZoneModel[],
  ): ZoneModel | null {
    let best: ZoneModel | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const zone of zones) {
      const distance = distanceMeters(point, { lat: zone.centerLat, lng: zone.centerLng });
      if (distance < bestDistance) {
        bestDistance = distance;
        best = zone;
      }
    }
    return best;
  }

  private detailView(
    sighting: SightingModel,
    speciesNameZh: string | null,
    viewerId?: string,
    moderatorView = false,
  ): SightingDetailView {
    return toSightingView(sighting, { speciesNameZh, viewerId, moderatorView });
  }

  private mediaView(media: MediaModel): MediaView {
    return toMediaView(media, (key) => this.storage.urlFor(key));
  }

  private storageKey(sha256: string, mime: MediaMime): string {
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `wildlife/${yyyy}/${mm}/${sha256}.${ext}`;
  }
}
