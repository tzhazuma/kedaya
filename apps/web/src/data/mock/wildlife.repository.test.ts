/**
 * wildlife mock 适配器测试。
 *
 * 重点不是"mock 能返回数据"，而是 **mock 也真的执行隐私与审核规则**：
 * - 敏感区上报 → 公开坐标 `null`，只给 `zoneId`（规格 §9.3 ①）；
 * - 普通区上报 → 网格吸附（§9.3 ②）；
 * - 不满足 k-匿名（<3 位不同上报人）的热点**不进公开列表**（§9.3 ④）；
 * - 公开列表只含 `PUBLISHED`；保护物种 `moderate(PUBLISHED)` 必须两名审核员（§2.10）；
 * - 无分类能力时 `classify()` 返回**空数组**而不是 5xx（验收 T43）；
 * - 上传幂等：同一 `clientPhotoId` 重试返回**相同** `mediaId`（验收 T37）。
 */
import { describe, expect, it } from 'vitest';

import { createMockWildlifeRepository } from '@/data/mock/wildlife.repository';
import type { CreateSightingInput } from '@/domain/models/wildlife/sightings';

const NOW = new Date('2026-10-17T04:00:00.000Z');
const IN_CAMPUS = { lat: 31.1795, lng: 121.591 };

function createRepo(): ReturnType<typeof createMockWildlifeRepository> {
  return createMockWildlifeRepository({ now: () => NOW, latencyMs: 0 });
}

function validInput(overrides: Partial<CreateSightingInput> = {}): CreateSightingInput {
  return {
    species: 'sp-cat',
    observedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    geo: IN_CAMPUS,
    zoneId: 'wz-lib-lawn',
    mediaIds: [],
    healthConcern: false,
    individualId: null,
    individualName: null,
    note: null,
    isAnonymous: false,
    autoSpeciesId: null,
    autoConfidence: null,
    classifiedBy: 'manual',
    ethicsAcknowledged: true,
    ...overrides,
  };
}

describe('wildlife mock · 列表与分页', () => {
  it('观测列表默认只返回 PUBLISHED，且游标翻页不重不漏', async () => {
    const repo = createRepo();
    const first = await repo.sightings({ limit: 3 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.value.items.every((s) => s.status === 'PUBLISHED')).toBe(true);
    expect(first.value.items).toHaveLength(3);
    expect(first.value.nextCursor).not.toBeNull();

    const second = await repo.sightings({ limit: 100, cursor: first.value.nextCursor ?? undefined });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const ids = [...first.value.items, ...second.value.items].map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(second.value.nextCursor).toBeNull();
  });

  it('显式传 status=PENDING 时返回待审核队列（管理端审核用）', async () => {
    const repo = createRepo();
    const pending = await repo.sightings({ status: 'PENDING' });
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    expect(pending.value.items.length).toBeGreaterThan(0);
    expect(pending.value.items.every((s) => s.status === 'PENDING')).toBe(true);
  });

  it('物种筛选生效，且区域按 sortOrder 排序', async () => {
    const repo = createRepo();
    const swans = await repo.sightings({ species: 'sp-swan' });
    expect(swans.ok).toBe(true);
    if (swans.ok) expect(swans.value.items.every((s) => s.species === 'sp-swan')).toBe(true);

    const zones = await repo.zones({});
    expect(zones.ok).toBe(true);
    if (zones.ok) {
      const orders = zones.value.items.map((z) => z.sortOrder);
      expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    }
  });

  it('未知 id 返回 NOT_FOUND（观测 / 区域 / 轨迹）', async () => {
    const repo = createRepo();
    for (const result of [
      await repo.sightingDetail('nope'),
      await repo.zoneDetail('nope'),
      await repo.trackDetail('nope'),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('wildlife mock · 隐私（规格 §9.3）', () => {
  it('不满足 k-匿名的热点不出现在公开列表里', async () => {
    const repo = createRepo();
    const spots = await repo.spots({ minConfidence: 0 });
    expect(spots.ok).toBe(true);
    if (!spots.ok) return;
    expect(spots.value.items.length).toBeGreaterThan(0);
    expect(spots.value.items.every((spot) => spot.distinctReporters >= 3)).toBe(true);
    // 种子数据里的 wsp-04 只有 2 位上报人 → 必须被过滤掉
    expect(spots.value.items.some((spot) => spot.id === 'wsp-04')).toBe(false);
  });

  it('敏感区（宿舍区）的既有记录不公开坐标，只给 zoneId', async () => {
    const repo = createRepo();
    const dorm = await repo.sightings({ zoneId: 'wz-dorm-west' });
    expect(dorm.ok).toBe(true);
    if (!dorm.ok) return;
    expect(dorm.value.items.length).toBeGreaterThan(0);
    for (const item of dorm.value.items) {
      expect(item.geo).toBeNull();
      expect(item.geoWithheld).toBe('sensitive-zone');
      expect(item.zoneId).toBe('wz-dorm-west');
    }
  });

  it('敏感区上报 → 公开坐标为 null；普通区上报 → 坐标被网格吸附', async () => {
    const repo = createRepo();
    const sensitive = await repo.createSighting(
      validInput({ zoneId: 'wz-dorm-west', geo: { lat: 31.1768, lng: 121.587 } }),
    );
    expect(sensitive.ok).toBe(true);
    if (sensitive.ok) {
      expect(sensitive.value.geo).toBeNull();
      expect(sensitive.value.geoWithheld).toBe('sensitive-zone');
      // 敏感区的时间粗化到**天**
      expect(sensitive.value.observedAtFuzzed).toMatch(/T00:00:00\.000Z$/);
    }

    const normal = await repo.createSighting(
      validInput({ zoneId: 'wz-lib-lawn', geo: { lat: 31.1801, lng: 121.5893 } }),
    );
    expect(normal.ok).toBe(true);
    if (normal.ok) {
      expect(normal.value.geo).not.toBeNull();
      expect(normal.value.geo?.lat).not.toBe(31.1801);
      // 普通区的时间粗化到**小时**
      expect(normal.value.observedAtFuzzed).toMatch(/:\d{2}:00\.000Z$/);
    }
  });

  it('公开响应里没有精确坐标与 reporterId 字段（结构上不存在）', async () => {
    const repo = createRepo();
    const detail = await repo.sightingDetail('ws-1001');
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    const keys = Object.keys(detail.value);
    expect(keys).not.toContain('reporterId');
    expect(keys).not.toContain('exactLat');
    expect(keys).not.toContain('exactLng');
    expect(keys).not.toContain('exactObservedAt');
  });
});

describe('wildlife mock · 上报校验（规格 §10.3）', () => {
  it('未确认伦理守则 → VALIDATION_FAILED / ETHICS_NOT_ACKNOWLEDGED', async () => {
    const repo = createRepo();
    const result = await repo.createSighting(validInput({ ethicsAcknowledged: false as true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect((result.error.details as { reason: string }).reason).toBe('ETHICS_NOT_ACKNOWLEDGED');
    }
  });

  it('坐标出校园（含 lat/lng 颠倒）→ COORDINATE_OUT_OF_CAMPUS', async () => {
    const repo = createRepo();
    const result = await repo.createSighting(validInput({ geo: { lat: 121.591, lng: 31.1795 } }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error.details as { reason: string }).reason).toBe('COORDINATE_OUT_OF_CAMPUS');
    }
  });

  it('未知物种 → UNKNOWN_SPECIES；发现时间越界 → OBSERVED_AT_OUT_OF_RANGE', async () => {
    const repo = createRepo();
    const unknown = await repo.createSighting(validInput({ species: 'sp-nonexistent' }));
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect((unknown.error.details as { reason: string }).reason).toBe('UNKNOWN_SPECIES');

    const old = await repo.createSighting(
      validInput({ observedAt: new Date(NOW.getTime() - 40 * 24 * 3600 * 1000).toISOString() }),
    );
    expect(old.ok).toBe(false);
    if (!old.ok) {
      expect((old.error.details as { reason: string }).reason).toBe('OBSERVED_AT_OUT_OF_RANGE');
    }
  });

  it('成功上报 → 状态为 PENDING（公开列表看不到）', async () => {
    const repo = createRepo();
    const result = await repo.createSighting(validInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('PENDING');
    expect(result.value.speciesNameZh).toBe('猫（家猫/流浪猫）');

    const published = await repo.sightings({ limit: 100 });
    expect(published.ok).toBe(true);
    if (published.ok) {
      expect(published.value.items.some((s) => s.id === result.value.id)).toBe(false);
    }
  });

  it('新建命名个体：同物种重名返回 CONFLICT，否则个体进入 PENDING', async () => {
    const repo = createRepo();
    const created = await repo.createSighting(validInput({ individualName: '新猫' }));
    expect(created.ok).toBe(true);
    if (created.ok) expect(created.value.individualId).not.toBeNull();

    const duplicate = await repo.createSighting(validInput({ individualName: '新猫' }));
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error.code).toBe('CONFLICT');
  });
});

describe('wildlife mock · 媒体上传（规格 §4.5 / 验收 T37）', () => {
  it('同一 clientPhotoId 重试返回相同 mediaId（幂等）', async () => {
    const repo = createRepo();
    const file = new File([new Uint8Array([1, 2, 3])], 'cat.jpg', { type: 'image/jpeg' });
    const first = await repo.uploadMedia({ file, clientPhotoId: 'photo-1' });
    const second = await repo.uploadMedia({ file, clientPhotoId: 'photo-1' });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.mediaId).toBe(first.value.mediaId);
      expect(second.value.sha256).toBe(first.value.sha256);
    }
  });

  it('非图片 MIME → MEDIA_UNSUPPORTED_TYPE；超 5 MB → MEDIA_TOO_LARGE', async () => {
    const repo = createRepo();
    const text = new File([new Uint8Array([1])], 'fake.jpg', { type: 'text/plain' });
    const unsupported = await repo.uploadMedia({ file: text, clientPhotoId: 'p-text' });
    expect(unsupported.ok).toBe(false);
    if (!unsupported.ok) {
      expect((unsupported.error.details as { reason: string }).reason).toBe('MEDIA_UNSUPPORTED_TYPE');
    }

    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' });
    const tooLarge = await repo.uploadMedia({ file: big, clientPhotoId: 'p-big' });
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) {
      expect((tooLarge.error.details as { reason: string }).reason).toBe('MEDIA_TOO_LARGE');
    }
  });

  it('同一张照片不能关联到两条上报 → MEDIA_ALREADY_LINKED', async () => {
    const repo = createRepo();
    const file = new File([new Uint8Array([9, 9])], 'cat2.jpg', { type: 'image/jpeg' });
    const media = await repo.uploadMedia({ file, clientPhotoId: 'p-2' });
    expect(media.ok).toBe(true);
    if (!media.ok) return;

    const first = await repo.createSighting(validInput({ mediaIds: [media.value.mediaId] }));
    expect(first.ok).toBe(true);
    const second = await repo.createSighting(validInput({ mediaIds: [media.value.mediaId] }));
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect((second.error.details as { reason: string }).reason).toBe('MEDIA_ALREADY_LINKED');
    }
  });
});

describe('wildlife mock · 审核（规格 §2.10 / 契约 §11.2）', () => {
  it('拒绝必须填理由 → VALIDATION_FAILED / REJECT_REASON_REQUIRED', async () => {
    const repo = createRepo();
    const result = await repo.moderate('ws-1012', { decision: 'REJECTED', moderatorId: 'u_admin_01' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect((result.error.details as { reason: string }).reason).toBe('REJECT_REASON_REQUIRED');
    }
  });

  it('普通物种单人通过即发布', async () => {
    const repo = createRepo();
    const result = await repo.moderate('ws-1012', { decision: 'PUBLISHED', moderatorId: 'u_admin_01' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('PUBLISHED');
      expect(result.value.moderatedBy).toBe('u_admin_01');
    }
  });

  it('保护物种单人通过 → FORBIDDEN；换第二名审核员才通过', async () => {
    const repo = createRepo();
    const first = await repo.moderate('ws-1011', { decision: 'PUBLISHED', moderatorId: 'u_admin_01' });
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.error.code).toBe('FORBIDDEN');
      expect((first.error.details as { reason: string }).reason).toBe('SECOND_MODERATOR_REQUIRED');
    }

    // 同一人再确认也不行
    const sameAgain = await repo.moderate('ws-1011', {
      decision: 'PUBLISHED',
      moderatorId: 'u_admin_01',
    });
    expect(sameAgain.ok).toBe(false);

    const second = await repo.moderate('ws-1011', {
      decision: 'PUBLISHED',
      moderatorId: 'u_admin_02',
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.status).toBe('PUBLISHED');
  });

  it('已拒绝的记录不能再审核', async () => {
    const repo = createRepo();
    const result = await repo.moderate('ws-1014', { decision: 'PUBLISHED', moderatorId: 'u_admin_01' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CONFLICT');
  });
});

describe('wildlife mock · 降级与故障演练', () => {
  it('无分类能力时 classify 返回空数组（验收 T43，不是 5xx）', async () => {
    const repo = createRepo();
    const result = await repo.classify('wm-1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
    expect(repo.getClassifierMode()).toBe('manual');
  });

  it('切到 server 模式后返回 top-K 建议（可插拔分类）', async () => {
    const repo = createRepo();
    repo.setClassifierMode('server');
    const result = await repo.classify('wm-1', 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]?.confidence).toBeGreaterThan(result.value[1]?.confidence ?? 0);
    }
  });

  it('故障演练让所有请求返回 UPSTREAM_UNAVAILABLE；reset 后恢复', async () => {
    const repo = createRepo();
    repo.setFailureMode('error');
    const failed = await repo.sightings({});
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe('UPSTREAM_UNAVAILABLE');

    repo.reset();
    expect(repo.getFailureMode()).toBe('none');
    const recovered = await repo.sightings({});
    expect(recovered.ok).toBe(true);
    expect(repo.pendingCount()).toBeGreaterThan(0);
  });

  it('底图配置经 mock 返回时仍是占位底图（不谎称已授权）', async () => {
    const repo = createRepo();
    const basemap = await repo.basemap();
    expect(basemap.ok).toBe(true);
    if (basemap.ok) {
      expect(basemap.value.license).toBe('original');
      expect(basemap.value.isPlaceholder).toBe(true);
      expect(basemap.value.placeholderNotice).toContain('占位');
      expect(basemap.value.calibrationRmsePx).toBeLessThan(5);
    }
  });
});
