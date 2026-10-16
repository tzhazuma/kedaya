/**
 * wildlife · 读用例（规格 §10.1 的 1–10 号端点）
 *
 * **读接口大部分无需登录**（契约 `02-domain-model.md:883`：`ListZones` 无需登录）。
 * 因此本服务不做任何身份前置校验，只在需要区分"我的/审核员视角"时读可选身份。
 *
 * 出参**一律**经过 `wildlife.views.ts` 的视图函数 —— 那是唯一的出参出口，
 * 精确坐标与 `reporterId` 在结构上不可能从这里泄漏出去。
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Page } from '@kedaya/contracts';
import { AuditService } from '../../common/compliance/audit.service';
import { ROLE_PORT, type RolePort } from '../../common/auth/role.port';
import { ForbiddenError, NotFoundError, ValidationError } from '../../common/errors/app-error';
import { AGGREGATION_DELAY_HOURS } from './domain/cluster';
import { assertBasemap, type CampusBasemap } from './domain/geo';
import { WILDLIFE_PLACEHOLDER_BASEMAP } from './wildlife.basemap';
import {
  WILDLIFE_CATALOG_REPOSITORY,
  WILDLIFE_DERIVED_REPOSITORY,
  WILDLIFE_INDIVIDUAL_REPOSITORY,
  WILDLIFE_MODERATOR_ROLE,
  WILDLIFE_MODULE_ID,
  WILDLIFE_SIGHTING_REPOSITORY,
  type IndividualModel,
  type SightingModel,
  type SpeciesModel,
  type WildlifeCatalogRepository,
  type WildlifeDerivedRepository,
  type WildlifeIndividualRepository,
  type WildlifeSightingRepository,
} from './domain/wildlife.domain';
import { readWildlifeConfig } from '../../config/wildlife.config';
import {
  toBasemapView,
  toIndividualView,
  toSightingPage,
  toSightingView,
  toSpeciesTree,
  toSpeciesView,
  toSpotView,
  toTrackView,
  toZoneView,
  type IndividualView,
  type SightingView,
  type SpeciesTreeNode,
  type SpeciesView,
  type SpotView,
  type TrackView,
  type ZoneView,
} from './wildlife.views';

/** `GET /items/:id` 的管理员视角额外字段 */
export interface SightingDetailView extends SightingView {
  /** **仅审核员可见**：受限表里的精确坐标。每次读取写审计（规格 §2.7） */
  exactGeo?: { lat: number; lng: number; accuracyM: number | null; observedAt: string };
}

@Injectable()
export class WildlifeQueryService {
  constructor(
    @Inject(WILDLIFE_CATALOG_REPOSITORY) private readonly catalog: WildlifeCatalogRepository,
    @Inject(WILDLIFE_SIGHTING_REPOSITORY) private readonly sightings: WildlifeSightingRepository,
    @Inject(WILDLIFE_DERIVED_REPOSITORY) private readonly derived: WildlifeDerivedRepository,
    @Inject(WILDLIFE_INDIVIDUAL_REPOSITORY) private readonly individuals: WildlifeIndividualRepository,
    @Inject(ROLE_PORT) private readonly roles: RolePort,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /* ---------------- 1. 底图 ---------------- */

  /**
   * 当前底图配置。
   *
   * 每次读取都跑一遍 `assertBasemap`（很便宜）：这样"残差 ≥5px 或控制点 <6 个"
   * 的底图**不可能**被下发到客户端 —— 把 CI 规则同时变成运行期保证。
   */
  async basemap(): Promise<CampusBasemap> {
    const basemap = WILDLIFE_PLACEHOLDER_BASEMAP;
    assertBasemap(basemap);
    return toBasemapView(basemap);
  }

  /* ---------------- 2. 物种 ---------------- */

  async species(): Promise<Page<SpeciesView> & { tree: SpeciesTreeNode[] }> {
    const all = await this.catalog.listSpecies();
    const active = all.filter((item) => item.isActive);
    return { items: active.map(toSpeciesView), nextCursor: null, tree: toSpeciesTree(active) };
  }

  /* ---------------- 3–4. 区域 ---------------- */

  async zones(): Promise<Page<ZoneView>> {
    const all = await this.catalog.listZones();
    return { items: all.map(toZoneView), nextCursor: null };
  }

  async zoneDetail(id: string): Promise<ZoneView> {
    const zone = await this.catalog.findZoneById(id);
    if (!zone || zone.deletedAt) throw new NotFoundError('区域不存在或已被删除');
    return toZoneView(zone);
  }

  /* ---------------- 5. 热点 ---------------- */

  /**
   * 聚合热点（**派生只读，延迟 ≥24h**）。
   *
   * `computedBefore = now - 24h` 是**隐私设计的一部分**（规格 §8.1 E10）：
   * 近实时的热点会削弱位置模糊化的效果，也会让平台变成"围观召集工具"。
   */
  async spots(query: {
    speciesId?: string;
    zoneId?: string;
    minConfidence?: number;
    cursor?: string;
    limit: number;
  }): Promise<Page<SpotView> & { isAggregated: true; aggregationDelayHours: number }> {
    const minConfidence = query.minConfidence ?? 0.3;
    if (!(minConfidence >= 0 && minConfidence <= 1)) {
      throw new ValidationError('minConfidence 必须在 0..1 之间', { minConfidence });
    }
    const computedBefore = new Date(Date.now() - AGGREGATION_DELAY_HOURS * 60 * 60 * 1000);
    const page = await this.derived.listSpots({
      cursor: query.cursor,
      limit: query.limit,
      speciesId: query.speciesId,
      zoneId: query.zoneId,
      minConfidence,
      computedBefore,
    });
    const names = await this.speciesNameMap();
    return {
      items: page.items.map((spot) => toSpotView(spot, names.get(spot.speciesId) ?? null)),
      nextCursor: page.nextCursor,
      isAggregated: true,
      aggregationDelayHours: AGGREGATION_DELAY_HOURS,
    };
  }

  /* ---------------- 6–7. 轨迹 ---------------- */

  async tracks(query: {
    speciesId?: string;
    individualId?: string;
    cursor?: string;
    limit: number;
  }): Promise<Page<TrackView>> {
    const page = await this.derived.listTracks({
      cursor: query.cursor,
      limit: query.limit,
      speciesId: query.speciesId,
      individualId: query.individualId,
      computedBefore: new Date(),
    });
    const names = await this.speciesNameMap();
    return {
      items: page.items.map((track) => toTrackView(track, names.get(track.speciesId) ?? null)),
      nextCursor: page.nextCursor,
    };
  }

  async trackDetail(id: string): Promise<TrackView> {
    const track = await this.derived.findTrackById(id);
    if (!track) throw new NotFoundError('轨迹不存在');
    const names = await this.speciesNameMap();
    return toTrackView(track, names.get(track.speciesId) ?? null);
  }

  /* ---------------- 8. 命名个体 ---------------- */

  async listIndividuals(query: {
    speciesId?: string;
    cursor?: string;
    limit: number;
  }): Promise<Page<IndividualView>> {
    const page = await this.individuals.list({
      cursor: query.cursor,
      limit: query.limit,
      speciesId: query.speciesId,
      publishedOnly: true,
    });
    return { items: page.items.map(toIndividualView), nextCursor: page.nextCursor };
  }

  /* ---------------- 9. 观测列表 ---------------- */

  /** 公开列表：**仅 PUBLISHED**（规格 §10.1） */
  async listSightings(
    query: { speciesId?: string; zoneId?: string; cursor?: string; limit: number },
    viewerId?: string,
  ): Promise<Page<SightingView>> {
    const page = await this.sightings.list({
      cursor: query.cursor,
      limit: query.limit,
      species: query.speciesId,
      zoneId: query.zoneId,
      publishedOnly: true,
      now: new Date(),
    });
    // 物种中文名由客户端用 `GET /species` 的缓存拼装：列表里逐条查名字要 N 次查询，
    // 而 `/species` 本身就是一张小表。
    return toSightingPage(page, { viewerId });
  }

  /* ---------------- 10. 观测详情 ---------------- */

  /**
   * 观测详情。
   *
   * 可见性规则（防枚举，规格 §9.1 A3：**`NOT_FOUND` 不区分**）：
   *   · `PUBLISHED` → 任何人可看；
   *   · 非 `PUBLISHED` → 只有**上报人本人**与**审核员**可看，其余一律 `NOT_FOUND`；
   *   · 审核员视角额外带受限表的精确坐标，且**每次读取写审计**（fail-closed）。
   */
  async sightingDetail(id: string, viewerId?: string): Promise<SightingDetailView> {
    const sighting = await this.sightings.findById(id);
    if (!sighting || sighting.deletedAt) throw new NotFoundError('观测记录不存在');

    const isOwner = viewerId !== undefined && viewerId === sighting.reporterId;
    const isModerator = viewerId !== undefined && (await this.isModerator(viewerId));
    const visible = sighting.status === 'PUBLISHED' || isOwner || isModerator;
    if (!visible) throw new NotFoundError('观测记录不存在');

    const names = await this.speciesNameMap();
    const view: SightingDetailView = toSightingView(sighting, {
      viewerId,
      moderatorView: isModerator,
      speciesNameZh: names.get(sighting.species) ?? null,
    });

    if (isModerator) {
      const exact = await this.sightings.findExact(id);
      if (exact) {
        // 规格 §2.7：**每次读取都写审计**。用 record()（fail-closed）而不是
        // recordQuietly()：审计写不进去就不放行精确坐标。
        await this.audit.record({
          action: 'wildlife.sighting.read_exact',
          resource: 'WildlifeSightingExact',
          resourceId: id,
          module: WILDLIFE_MODULE_ID,
          metadata: { reason: 'moderator-view' },
        });
        view.exactGeo = {
          lat: exact.exactLat,
          lng: exact.exactLng,
          accuracyM: exact.exactAccuracyM,
          observedAt: exact.exactObservedAt.toISOString(),
        };
      }
    }
    return view;
  }

  /** 审核员判定（治理动作与管理员视角共用） */
  async isModerator(userId: string | undefined): Promise<boolean> {
    if (!userId) return false;
    return this.roles.hasRole(userId, WILDLIFE_MODERATOR_ROLE);
  }

  /** 审核员守卫（`moderate` 与精确坐标读取都走它） */
  async assertModerator(userId: string | undefined): Promise<void> {
    if (!(await this.isModerator(userId))) {
      throw new ForbiddenError('只有审核员可以执行该操作');
    }
  }

  /** 物种 id → 中文名（小表，直接全量拉一次） */
  async speciesNameMap(): Promise<Map<string, string>> {
    const all = await this.catalog.listSpecies();
    return new Map(all.map((item) => [item.id, item.commonNameZh]));
  }

  async findSpecies(id: string): Promise<SpeciesModel | null> {
    return this.catalog.findSpeciesById(id);
  }

  /** 配置（读接口里也要用，比如默认模糊半径） */
  get configView() {
    return readWildlifeConfig(this.config);
  }

  /** 给写用例复用的单条观测读取 */
  async requireSighting(id: string): Promise<SightingModel> {
    const sighting = await this.sightings.findById(id);
    if (!sighting || sighting.deletedAt) throw new NotFoundError('观测记录不存在');
    return sighting;
  }

  /** 给写用例复用的个体读取 */
  async requireIndividual(id: string): Promise<IndividualModel> {
    const individual = await this.individuals.findById(id);
    if (!individual || individual.deletedAt) throw new NotFoundError('个体不存在');
    return individual;
  }
}
