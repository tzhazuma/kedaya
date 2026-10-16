/**
 * wildlife 用例层测试（application）—— 视图模型与编排。
 *
 * 这一层是"UI 不做计算"的落点：所有文案/隐私状态/免责声明都在这里算好，
 * 于是"页面是否真的会显示推断声明 / 位置扣留说明 / 投喂警告"可以被**纯逻辑测试**覆盖，
 * 不需要 jsdom，也不需要人工点页面。
 */
import { describe, expect, it } from 'vitest';

import {
  applySuggestion,
  correctSpecies,
  isCorrection,
  reportProgressHint,
  submitSighting,
  suggestSpeciesForMedia,
} from '@/application/wildlife/reportSighting';
import { loadWildlifeCatalog } from '@/application/wildlife/loadWildlifeCatalog';
import { loadSightingList, toSightingListItemVM } from '@/application/wildlife/listSightings';
import { loadTrackList } from '@/application/wildlife/listTracks';
import { loadZoneList } from '@/application/wildlife/listZones';
import {
  DEMO_MODERATOR,
  DEMO_SECOND_MODERATOR,
  loadModerationQueue,
  moderateSighting,
} from '@/application/wildlife/moderateSightings';
import {
  ALL_SPECIES,
  defaultMapFilters,
  loadWildlifeMap,
} from '@/application/wildlife/wildlifeMap';
import { deriveViewState } from '@/application/viewState';
import { createMockWildlifeRepository } from '@/data/mock/wildlife.repository';
import { INFERRED_TRACK_LABEL } from '@/domain/models/wildlife/tracks';
import { createEmptySightingDraft, type SightingDraft } from '@/domain/models/wildlife/sightings';

const NOW = new Date('2026-10-17T04:00:00.000Z');

function createRepo() {
  return createMockWildlifeRepository({ now: () => NOW, latencyMs: 0 });
}

describe('loadWildlifeMap（地图主用例）', () => {
  it('组装底图、叠加层、物种筛选与全部合规提示', async () => {
    const repo = createRepo();
    const result = await loadWildlifeMap(repo, defaultMapFilters(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const vm = result.value;

    // 底图：占位声明必须非空（学校授权状态未知）
    expect(vm.basemap.isPlaceholder).toBe(true);
    expect(vm.basemap.placeholderNotice).toContain('占位底图');
    expect(vm.basemap.calibrationOk).toBe(true);
    expect(vm.basemap.calibrationLabel).toContain('控制点');

    // 叠加层：区域 + 热点 + 轨迹都有，且热点已按 k-匿名过滤
    expect(vm.counts.zones).toBeGreaterThanOrEqual(5);
    expect(vm.counts.spots).toBeGreaterThanOrEqual(3);
    expect(vm.counts.tracks).toBeGreaterThanOrEqual(3);
    expect(vm.counts.spots).toBeLessThan(4);

    // 坐标被扣留的记录**不落点**，但必须在 UI 里被说明
    expect(vm.counts.markersHiddenByPrivacy).toBe(2);

    // 三个硬要求提示都在
    expect(vm.notices.basemap).toContain('占位');
    expect(vm.notices.spotRealtime).toContain('历史聚合');
    expect(vm.notices.privacy).toContain('片区');
    expect(vm.notices.noAccuracyClaim).toContain('没有实测数据');
    expect(vm.isEmpty).toBe(false);

    expect(vm.speciesOptions.map((option) => option.id)).toContain('sp-swan');
  });

  it('物种筛选会同时影响区域/热点/轨迹/观测，且繁殖期给出加强模糊提示', async () => {
    const repo = createRepo();
    const may = new Date('2026-05-10T04:00:00.000Z');
    const result = await loadWildlifeMap(
      repo,
      { ...defaultMapFilters(), speciesId: 'sp-swan' },
      may,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const vm = result.value;
    expect(vm.overlays.spots.every((spot) => spot.speciesId === 'sp-swan')).toBe(true);
    expect(vm.trackVMs.every((track) => track.speciesId === 'sp-swan')).toBe(true);
    expect(vm.overlays.tracks.length).toBeGreaterThan(0);
    expect(vm.notices.nesting).toContain('繁殖期');
  });

  it('图层开关真的会清空对应叠加层', async () => {
    const repo = createRepo();
    const result = await loadWildlifeMap(
      repo,
      { ...defaultMapFilters(), showZones: false, showSpots: false, showTracks: false },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.overlays.zones).toEqual([]);
    expect(result.value.overlays.spots).toEqual([]);
    expect(result.value.overlays.tracks).toEqual([]);
    // 列表数据仍然在（图层开关只影响地图，不影响列表）
    expect(result.value.zoneVMs.length).toBeGreaterThan(0);
  });

  it('故障时返回 UPSTREAM_UNAVAILABLE（三态里的 error 态）', async () => {
    const repo = createRepo();
    repo.setFailureMode('error');
    const result = await loadWildlifeMap(repo, defaultMapFilters(), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('空筛选结果 → isEmpty + 引导文案（三态里的 empty 态）', async () => {
    const repo = createRepo();
    const result = await loadWildlifeMap(
      repo,
      { ...defaultMapFilters(), speciesId: 'sp-nonexistent' },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.isEmpty).toBe(true);
    expect(result.value.emptyHint).toContain('上报');
  });

  it('四态选择器与用例结果一致（loading 由查询库给出，这里覆盖 error/empty/ready）', async () => {
    const repo = createRepo();
    const ready = await loadWildlifeMap(repo, defaultMapFilters(), NOW);
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(
      deriveViewState({
        isPending: false,
        isError: false,
        isEmpty: ready.value.isEmpty,
      }),
    ).toBe('ready');
    expect(deriveViewState({ isPending: true, isError: false, isEmpty: false })).toBe('loading');
    expect(deriveViewState({ isPending: false, isError: true, isEmpty: false })).toBe('error');
  });
});

describe('观测列表与详情 VM', () => {
  it('禁投喂区域 + 保护物种 → 红色警告条；匿名 → 「匿名同学」', async () => {
    const repo = createRepo();
    const catalog = await loadWildlifeCatalog(repo);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;

    const list = await loadSightingList(repo, { limit: 50 }, catalog.value, NOW);
    expect(list.ok).toBe(true);
    if (!list.ok) return;

    const swan = list.value.items.find((item) => item.speciesId === 'sp-swan');
    expect(swan).toBeDefined();
    expect(swan?.feedingPolicy).toBe('forbidden');
    expect(swan?.forbiddenWarning).toContain('人工湖');
    expect(swan?.geoWithheld).toBe(false);

    const anonymous = list.value.items.find((item) => item.isAnonymous);
    expect(anonymous?.reporterLabel).toBe('匿名同学');
  });

  it('坐标被扣留的记录带明确说明（敏感区 / k-匿名）', async () => {
    const repo = createRepo();
    const catalog = await loadWildlifeCatalog(repo);
    if (!catalog.ok) throw new Error('catalog 加载失败');

    const list = await loadSightingList(repo, { limit: 50 }, catalog.value, NOW);
    if (!list.ok) throw new Error('list 加载失败');

    const withheld = list.value.items.filter((item) => item.geoWithheld);
    expect(withheld.length).toBeGreaterThan(0);
    for (const item of withheld) {
      expect(item.geoNotice).toMatch(/敏感区|3 人/);
    }
  });

  it('自动分类来源非 manual 时必须带免责声明（规格 §5.7）', async () => {
    const repo = createRepo();
    const catalog = await loadWildlifeCatalog(repo);
    if (!catalog.ok) throw new Error('catalog 加载失败');
    const detail = await repo.sightingDetail('ws-1006');
    if (!detail.ok) throw new Error('detail 加载失败');

    const vm = toSightingListItemVM(detail.value, catalog.value, NOW);
    expect(vm.classifiedBy).toBe('vision_api');
    expect(vm.classifierDisclaimer).toContain('仅供参考');
    expect(vm.autoSpeciesLabel).toBe('黑天鹅');
    expect(vm.autoConfidenceLabel).toBe('78%');
  });

  it('列表按发现时间倒序，并给出空态引导文案', async () => {
    const repo = createRepo();
    const catalog = await loadWildlifeCatalog(repo);
    if (!catalog.ok) throw new Error('catalog 加载失败');

    const list = await loadSightingList(repo, { limit: 50 }, catalog.value, NOW);
    if (!list.ok) throw new Error('list 加载失败');
    const times = list.value.items.map((item) => new Date(item.observedAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const empty = await loadSightingList(repo, { species: 'sp-nonexistent' }, catalog.value, NOW);
    if (!empty.ok) throw new Error('empty 加载失败');
    expect(empty.value.isEmpty).toBe(true);
    expect(empty.value.emptyHint).toContain('上报');
  });

  it('健康异常记录被标记（供列表高亮与审核队首）', async () => {
    const repo = createRepo();
    const catalog = await loadWildlifeCatalog(repo);
    if (!catalog.ok) throw new Error('catalog 加载失败');
    const list = await loadSightingList(repo, { status: 'PENDING', limit: 50 }, catalog.value, NOW);
    if (!list.ok) throw new Error('list 加载失败');
    expect(list.value.healthConcernCount).toBe(1);
  });
});

describe('区域与轨迹 VM', () => {
  it('区域列表统计禁投喂/敏感区数量，并标注告示文案是草案', async () => {
    const repo = createRepo();
    const catalog = await loadWildlifeCatalog(repo);
    if (!catalog.ok) throw new Error('catalog 加载失败');

    const zones = await loadZoneList(repo, { limit: 50 }, catalog.value);
    expect(zones.ok).toBe(true);
    if (!zones.ok) return;
    expect(zones.value.forbiddenCount).toBe(2);
    expect(zones.value.sensitiveCount).toBe(1);
    expect(zones.value.basemapNotice).toContain('占位');

    const sensitive = zones.value.items.find((zone) => zone.isSensitive);
    expect(sensitive?.sensitiveNotice).toContain('不公开任何坐标');
    // 有告示文案的区域都要带"草案、未经校方审核"标记（未决问题 U7）
    expect(sensitive?.noticeDraftFlag).toContain('草案');

    const lake = zones.value.items.find((zone) => zone.id === 'wz-lake');
    expect(lake?.noticeDraftFlag).toContain('草案');
    expect(lake?.forbiddenWarning).toContain('禁止投喂');
  });

  it('**每条轨迹都必须带"推断"标签与非空免责声明**（验收 T18 的客户端镜像）', async () => {
    const repo = createRepo();
    const catalog = await loadWildlifeCatalog(repo);
    if (!catalog.ok) throw new Error('catalog 加载失败');

    const tracks = await loadTrackList(repo, {}, catalog.value, NOW);
    expect(tracks.ok).toBe(true);
    if (!tracks.ok) return;
    expect(tracks.value.items.length).toBeGreaterThan(0);
    for (const track of tracks.value.items) {
      expect(track.inferredLabel).toBe(INFERRED_TRACK_LABEL);
      expect(track.disclaimer.length).toBeGreaterThan(0);
      expect(track.summaryLabel).toContain('推断');
      expect(track.summaryLabel).not.toContain('路线');
      expect(track.hasPath).toBe(true);
    }
    expect(tracks.value.renderedPointCount).toBeGreaterThan(0);
    expect(tracks.value.inferredNotice).toContain('不是 GPS 项圈');
  });

  it('空轨迹列表给出"至少 5 个观测"的引导', async () => {
    const repo = createRepo();
    const catalog = await loadWildlifeCatalog(repo);
    if (!catalog.ok) throw new Error('catalog 加载失败');
    const tracks = await loadTrackList(repo, { species: 'sp-nonexistent' }, catalog.value, NOW);
    if (!tracks.ok) throw new Error('tracks 加载失败');
    expect(tracks.value.isEmpty).toBe(true);
    expect(tracks.value.emptyHint).toContain('5 个已发布观测');
  });
});

describe('上报用例（规格 §4 / §5 / §8.2）', () => {
  function draft(overrides: Partial<SightingDraft> = {}): SightingDraft {
    return {
      ...createEmptySightingDraft(NOW),
      speciesId: 'sp-cat',
      observedAt: new Date(NOW.getTime() - 3600 * 1000).toISOString(),
      geo: { lat: 31.1795, lng: 121.591 },
      zoneId: 'wz-lib-lawn',
      ethicsAcknowledged: true,
      ...overrides,
    };
  }

  it('未勾选伦理守则 → 返回问题清单而不是异常（表单校验，不是错误）', async () => {
    const repo = createRepo();
    const catalog = await loadWildlifeCatalog(repo);
    if (!catalog.ok) throw new Error('catalog 加载失败');

    const outcome = await submitSighting(repo, draft({ ethicsAcknowledged: false }), catalog.value, NOW);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.receipt).toBeNull();
    expect(outcome.value.problems.join('|')).toContain('伦理守则');
  });

  it('完整上报 → 回执说明进入审核队列，且状态为 PENDING', async () => {
    const repo = createRepo();
    const catalog = await loadWildlifeCatalog(repo);
    if (!catalog.ok) throw new Error('catalog 加载失败');

    const outcome = await submitSighting(repo, draft({ note: '在草坪边' }), catalog.value, NOW);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !outcome.value.receipt) throw new Error('未产生回执');
    expect(outcome.value.receipt.status).toBe('PENDING');
    expect(outcome.value.receipt.message).toContain('审核');
    expect(outcome.value.receipt.item.zoneName).toBe('图书馆后草坪');
  });

  it('敏感区上报 → 回执里的记录标记为"不公开坐标"', async () => {
    const repo = createRepo();
    const catalog = await loadWildlifeCatalog(repo);
    if (!catalog.ok) throw new Error('catalog 加载失败');

    const outcome = await submitSighting(
      repo,
      draft({ zoneId: 'wz-dorm-west', geo: { lat: 31.1768, lng: 121.587 } }),
      catalog.value,
      NOW,
    );
    if (!outcome.ok || !outcome.value.receipt) throw new Error('未产生回执');
    expect(outcome.value.receipt.item.geoWithheld).toBe(true);
    expect(outcome.value.receipt.item.geoNotice).toContain('敏感区');
  });

  it('疑似受伤 → 回执强调"已通知社团、请勿自行处理"', async () => {
    const repo = createRepo();
    const catalog = await loadWildlifeCatalog(repo);
    if (!catalog.ok) throw new Error('catalog 加载失败');

    const outcome = await submitSighting(repo, draft({ healthConcern: true }), catalog.value, NOW);
    if (!outcome.ok || !outcome.value.receipt) throw new Error('未产生回执');
    expect(outcome.value.receipt.message).toContain('社团');
    expect(outcome.value.receipt.message).toContain('请勿自行处理');
  });

  it('个体名非法（超长）→ 直接返回问题清单，不发请求', async () => {
    const repo = createRepo();
    const catalog = await loadWildlifeCatalog(repo);
    if (!catalog.ok) throw new Error('catalog 加载失败');

    const outcome = await submitSighting(
      repo,
      draft({ individualName: 'x'.repeat(30) }),
      catalog.value,
      NOW,
    );
    if (!outcome.ok) throw new Error('不应失败');
    expect(outcome.value.problems.join('|')).toContain('个体名');
  });
});

describe('自动分类建议（规格 §5.2 / §5.5）', () => {
  it('无能力时静默降级为手动（available=false, classifiedBy=fallback）', async () => {
    const repo = createRepo();
    const catalog = await loadWildlifeCatalog(repo);
    if (!catalog.ok) throw new Error('catalog 加载失败');

    const outcome = await suggestSpeciesForMedia(repo, 'wm-1', catalog.value);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.available).toBe(false);
    expect(outcome.value.suggestions).toEqual([]);
    expect(outcome.value.classifiedBy).toBe('fallback');
    expect(outcome.value.notice).toContain('请手动选择物种');
  });

  it('有分类能力时返回建议；置信度 <0.60 的建议**不预选**（验收 T44）', async () => {
    const repo = createRepo();
    repo.setClassifierMode('server');
    const catalog = await loadWildlifeCatalog(repo);
    if (!catalog.ok) throw new Error('catalog 加载失败');

    const outcome = await suggestSpeciesForMedia(repo, 'wm-1', catalog.value, 3);
    if (!outcome.ok) throw new Error('分类建议加载失败');
    expect(outcome.value.available).toBe(true);
    expect(outcome.value.classifiedBy).toBe('vision_api');

    const swan = outcome.value.suggestions.find((s) => s.speciesId === 'sp-swan');
    const duck = outcome.value.suggestions.find((s) => s.speciesId === 'sp-duck');
    expect(swan?.preselected).toBe(true);
    expect(duck?.preselected).toBe(false);
  });

  it('采纳建议 / 手动纠正的语义', async () => {
    const base = createEmptySightingDraft(NOW);
    const adopted = applySuggestion(base, {
      speciesId: 'sp-swan',
      confidence: 0.9,
      preselected: true,
      band: 'high',
      label: '识别为 黑天鹅（很确定）',
    });
    expect(adopted.speciesId).toBe('sp-swan');
    expect(adopted.autoSpeciesId).toBe('sp-swan');
    expect(adopted.classifiedBy).toBe('vision_api');

    const corrected = correctSpecies(adopted, 'sp-duck');
    expect(corrected.speciesId).toBe('sp-duck');
    // 保留自动识别结果，服务端据此派生 correctedFromSpeciesId
    expect(corrected.autoSpeciesId).toBe('sp-swan');
    expect(corrected.classifiedBy).toBe('vision_api');
    expect(isCorrection(corrected)).toBe(true);
    expect(isCorrection(adopted)).toBe(false);
  });

  it('上报进度提示按步骤推进', () => {
    expect(reportProgressHint({ photoCount: 0, hasGeo: false, speciesId: '', ethicsAcknowledged: false })).toContain('第 1 步');
    expect(reportProgressHint({ photoCount: 1, hasGeo: false, speciesId: '', ethicsAcknowledged: false })).toContain('第 2 步');
    expect(reportProgressHint({ photoCount: 1, hasGeo: true, speciesId: '', ethicsAcknowledged: false })).toContain('第 3 步');
    expect(reportProgressHint({ photoCount: 1, hasGeo: true, speciesId: 'sp-cat', ethicsAcknowledged: false })).toContain('第 4 步');
    expect(reportProgressHint({ photoCount: 1, hasGeo: true, speciesId: 'sp-cat', ethicsAcknowledged: true })).toContain('可以提交');
  });
});

describe('审核用例（规格 §2.10）', () => {
  it('队列把疑似受伤排在队首，并统计保护物种数量', async () => {
    const repo = createRepo();
    const catalog = await loadWildlifeCatalog(repo);
    if (!catalog.ok) throw new Error('catalog 加载失败');

    const queue = await loadModerationQueue(repo, catalog.value, DEMO_MODERATOR, NOW);
    expect(queue.ok).toBe(true);
    if (!queue.ok) return;
    expect(queue.value.items.length).toBeGreaterThan(0);
    expect(queue.value.items[0]?.healthConcern).toBe(true);
    expect(queue.value.healthConcernCount).toBe(1);
    expect(queue.value.protectedCount).toBeGreaterThan(0);
    expect(queue.value.moderatorNotice).toContain('审计');
    // 审核端能看到"精确坐标存在"这一事实的说明（但字段本身不在公开响应里）
    expect(queue.value.items[0]?.moderatorHint).toContain('精确坐标');
  });

  it('保护物种单人通过 → FORBIDDEN；第二名审核员通过 → PUBLISHED', async () => {
    const repo = createRepo();
    const first = await moderateSighting(repo, 'ws-1011', 'PUBLISHED', DEMO_MODERATOR, { now: NOW });
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error.code).toBe('FORBIDDEN');

    const second = await moderateSighting(repo, 'ws-1011', 'PUBLISHED', DEMO_SECOND_MODERATOR, {
      now: NOW,
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.statusLabel).toBe('已发布');
      expect(second.value.message).toContain('双人复核');
    }
  });

  it('拒绝未填理由 → VALIDATION_FAILED；填了理由 → 状态为未通过', async () => {
    const repo = createRepo();
    const rejected = await moderateSighting(repo, 'ws-1012', 'REJECTED', DEMO_MODERATOR, { now: NOW });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe('VALIDATION_FAILED');

    const okResult = await moderateSighting(repo, 'ws-1012', 'REJECTED', DEMO_MODERATOR, {
      reason: '照片未拍到动物',
      now: NOW,
    });
    expect(okResult.ok).toBe(true);
    if (okResult.ok) expect(okResult.value.statusLabel).toBe('未通过');
  });

  it('故障演练时审核也走统一错误通道', async () => {
    const repo = createRepo();
    repo.setFailureMode('error');
    const result = await moderateSighting(repo, 'ws-1012', 'PUBLISHED', DEMO_MODERATOR, { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UPSTREAM_UNAVAILABLE');
  });
});

describe('物种筛选哨兵值', () => {
  it('ALL_SPECIES 不参与请求参数（避免把 "all" 当成物种 id 传给后端）', async () => {
    const repo = createRepo();
    const result = await loadWildlifeMap(repo, { ...defaultMapFilters(), speciesId: ALL_SPECIES }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.selectedSpeciesId).toBe(ALL_SPECIES);
    expect(result.value.selectedSpecies).toBeNull();
  });
});
