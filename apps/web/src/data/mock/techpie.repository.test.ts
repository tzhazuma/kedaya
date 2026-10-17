/**
 * TechPie mock 适配器测试（**服务端替身**的契约形状）。
 *
 * 覆盖 Phase 0 的验收点里可以在客户端侧验证的部分：
 * - P0-7 的镜像：非白名单域名 → `FORBIDDEN` / `TARGET_URL_NOT_ALLOWED`；
 * - 一次性票据：30 秒、用后即焚、只能兑换一次；
 * - 校园卡（OPENID 通道）：未绑定 → `CAMPUS_BINDING_REQUIRED`（**不是 401**）；
 * - 付款码：60 秒 TTL、每次新码；
 * - **不产生任何 CASTGC / 校园会话数据**（§11.18-D）；
 * - 明文密码凭证被拒绝（§11.18-D）；
 * - Phase 1+ 的能力一律 `PHASE_BLOCKED`（不假装只是"待接线"）。
 */
import { describe, expect, it } from 'vitest';

import { findForbiddenCredentialKeys } from '@/domain/models/techpie';

import {
  WEBVIEW_SESSION_RATE_LIMIT,
  WEBVIEW_TICKET_TTL_SEC,
  createMockTechpieRepository,
  type MockTechpieRepository,
} from './techpie.repository';

const NOW = new Date('2026-10-17T10:00:00.000Z');
const ALLOWED = 'https://ecourse.shanghaitech.edu.cn/';

function makeRepo(overrides: Parameters<typeof createMockTechpieRepository>[0] = {}) {
  return createMockTechpieRepository({ now: () => NOW, latencyMs: 0, ...overrides });
}

/** 绑定校园卡（走 OPENID 通道，然后模拟学校侧完成授权） */
async function bindEcard(repo: MockTechpieRepository): Promise<void> {
  const created = await repo.createLink({
    platform: 'ecard',
    credential: { kind: 'openid', channel: 'wechat' },
  });
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  repo.completeOpenIdBinding(created.value.id);
}

describe('绑定列表（规格 §8.3）', () => {
  it('默认只有一条 EXPIRED 的 cpdaily 绑定，且响应不含凭证键名', async () => {
    const repo = makeRepo();
    const result = await repo.listLinks({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.items).toHaveLength(1);
    expect(result.value.items[0]?.platform).toBe('cpdaily');
    expect(result.value.items[0]?.status).toBe('EXPIRED');
    expect(findForbiddenCredentialKeys(result.value)).toEqual([]);
  });

  it('游标分页：limit 生效并给出 nextCursor（游标对客户端不透明）', async () => {
    const repo = makeRepo({
      seedLinks: [
        { id: 'a', platform: 'ecard', status: 'LINKED', externalUserId: null, expiresAt: null, lastSyncAt: null },
        { id: 'b', platform: 'cpdaily', status: 'EXPIRED', externalUserId: null, expiresAt: null, lastSyncAt: null },
        { id: 'c', platform: 'egate', status: 'LINKED', externalUserId: null, expiresAt: null, lastSyncAt: null },
      ],
    });
    const first = await repo.listLinks({ limit: 2 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.items).toHaveLength(2);
    expect(first.value.nextCursor).not.toBeNull();

    const second = await repo.listLinks({ limit: 2, cursor: first.value.nextCursor ?? undefined });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.items).toHaveLength(1);
    expect(second.value.nextCursor).toBeNull();
  });
});

describe('发起绑定：Phase 0 凭证闸门（契约 §11.18-D）', () => {
  it('校园卡 OPENID 绑定 → LINKING（授权发生在学校/微信侧）', async () => {
    const repo = makeRepo();
    const result = await repo.createLink({
      platform: 'ecard',
      credential: { kind: 'openid', channel: 'wechat' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('LINKING');
    expect(result.value.platform).toBe('ecard');
  });

  it('**明文密码凭证被拒绝，且不产生任何绑定**', async () => {
    const repo = makeRepo();
    const before = repo.linksSnapshot();
    const result = await repo.createLink({
      platform: 'cpdaily',
      credential: { kind: 'password', studentId: '2023XXXXXX', password: 'hunter2' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORBIDDEN');
    expect((result.error.details as { reason?: string }).reason).toBe('PHASE_1_NOT_IMPLEMENTED');
    expect(repo.linksSnapshot()).toEqual(before);
  });

  it('非 Phase 0 平台（即便用 openid 凭证）也被拒绝', async () => {
    const repo = makeRepo();
    const result = await repo.createLink({
      platform: 'egate',
      credential: { kind: 'openid', channel: 'wechat' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORBIDDEN');
  });

  it('幂等：同一 Idempotency-Key 重复提交返回同一资源，不产生第二行', async () => {
    const repo = makeRepo();
    const input = {
      platform: 'ecard' as const,
      credential: { kind: 'openid' as const, channel: 'wechat' as const },
      idempotencyKey: 'idem-1',
    };
    const first = await repo.createLink(input);
    const second = await repo.createLink(input);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.id).toBe(first.value.id);
    expect(repo.linksSnapshot().filter((link) => link.platform === 'ecard')).toHaveLength(1);
  });

  it('已绑定同一平台 → CONFLICT / ALREADY_LINKED', async () => {
    const repo = makeRepo();
    await bindEcard(repo);
    const again = await repo.createLink({
      platform: 'ecard',
      credential: { kind: 'openid', channel: 'wechat' },
    });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe('CONFLICT');
    expect((again.error.details as { reason?: string }).reason).toBe('ALREADY_LINKED');
  });
});

describe('解绑与续期（规格 §8.6 / F3）', () => {
  it('解绑后不再出现在列表里，详情返回 NOT_FOUND', async () => {
    const repo = makeRepo();
    const list = await repo.listLinks({});
    if (!list.ok) return;
    const id = list.value.items[0]?.id ?? '';

    const deleted = await repo.deleteLink(id);
    expect(deleted.ok).toBe(true);

    const after = await repo.listLinks({});
    if (!after.ok) return;
    expect(after.value.items).toHaveLength(0);

    const detail = await repo.getLink(id);
    expect(detail.ok).toBe(false);
    if (detail.ok) return;
    expect(detail.error.code).toBe('NOT_FOUND');
  });

  it('上游无续期能力时返回 CONFLICT / RENEW_NOT_SUPPORTED（**不谎称已续期**）', async () => {
    const repo = makeRepo();
    const list = await repo.listLinks({});
    if (!list.ok) return;
    const cpdaily = list.value.items[0];
    expect(cpdaily?.platform).toBe('cpdaily');

    const renewed = await repo.renewLink(cpdaily?.id ?? '');
    expect(renewed.ok).toBe(false);
    if (renewed.ok) return;
    expect(renewed.error.code).toBe('CONFLICT');
    expect((renewed.error.details as { reason?: string }).reason).toBe('RENEW_NOT_SUPPORTED');
    // 状态**保持原样**（EXPIRED 不能变成 LINKED）
    const after = await repo.getLink(cpdaily?.id ?? '');
    if (!after.ok) return;
    expect(after.value.status).toBe('EXPIRED');
  });

  it('校园卡（OPENID 通道）可以手动续期', async () => {
    const repo = makeRepo();
    await bindEcard(repo);
    const list = await repo.listLinks({});
    if (!list.ok) return;
    const ecard = list.value.items.find((link) => link.platform === 'ecard');

    const renewed = await repo.renewLink(ecard?.id ?? '');
    expect(renewed.ok).toBe(true);
    if (!renewed.ok) return;
    expect(renewed.value.status).toBe('LINKED');
    expect(renewed.value.lastSyncAt).not.toBeNull();
  });
});

describe('能力清单（规格 §8.1 端点 6 / §11.18-C）', () => {
  it('未绑定的校园卡能力 → CAMPUS_BINDING_REQUIRED（**引导**而不是报错）', async () => {
    const repo = makeRepo();
    const result = await repo.listCapabilities();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const balance = result.value.items.find((item) => item.id === 'ecard.balance');
    expect(balance?.status).toBe('CAMPUS_BINDING_REQUIRED');
    expect(result.value.allowlistPlaceholder).toBe(true);
    expect(findForbiddenCredentialKeys(result.value)).toEqual([]);
  });

  it('绑定校园卡之后，校园卡能力变为 AVAILABLE', async () => {
    const repo = makeRepo();
    await bindEcard(repo);
    const result = await repo.listCapabilities();
    if (!result.ok) return;
    const balance = result.value.items.find((item) => item.id === 'ecard.balance');
    expect(balance?.status).toBe('AVAILABLE');
  });

  it('WebView 直连能力可用（W4 不需要绑定），且地址来自白名单', async () => {
    const repo = makeRepo();
    const result = await repo.listCapabilities();
    if (!result.ok) return;
    const webviews = result.value.items.filter((item) => item.access === 'webview');
    expect(webviews.length).toBeGreaterThanOrEqual(4);
    for (const item of webviews) {
      expect(item.status).toBe('AVAILABLE');
      expect(item.platform).toBeNull();
      expect(item.targetUrl).not.toBeNull();
    }
  });

  it('Phase 1–2 的能力一律 PHASE_BLOCKED（不假装只是"待接线"）', async () => {
    const repo = makeRepo();
    const result = await repo.listCapabilities();
    if (!result.ok) return;
    for (const id of ['schedule.timetable', 'schedule.exams', 'facility.gym']) {
      const item = result.value.items.find((capability) => capability.id === id);
      expect(item?.status).toBe('PHASE_BLOCKED');
    }
  });

  it('**不编造校园网能力**（契约 §11.18-C：未发现就不出现）', async () => {
    const repo = makeRepo();
    const result = await repo.listCapabilities();
    if (!result.ok) return;
    const ids = result.value.items.map((item) => item.id).join(',');
    expect(ids).not.toContain('campus-network');
    expect(ids).not.toContain('network');
  });
});

describe('WebView 一次性票据（规格 §8.4）', () => {
  it('白名单内的 https 地址 → 30 秒票据', async () => {
    const repo = makeRepo();
    const result = await repo.createWebviewSession({ platform: null, targetUrl: ALLOWED });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ticket.startsWith('wvt_')).toBe(true);
    expect(result.value.expiresInSec).toBe(WEBVIEW_TICKET_TTL_SEC);
    expect(result.value.targetUrl).toBe(ALLOWED);
  });

  it('P0-7 镜像：非白名单域名 → FORBIDDEN / TARGET_URL_NOT_ALLOWED', async () => {
    const repo = makeRepo();
    const result = await repo.createWebviewSession({
      platform: null,
      targetUrl: 'https://evil.example.com/',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORBIDDEN');
    expect((result.error.details as { reason?: string }).reason).toBe('TARGET_URL_NOT_ALLOWED');
    expect(repo.pendingTicketCount()).toBe(0);
  });

  it('http（非 https）→ VALIDATION_FAILED', async () => {
    const repo = makeRepo();
    const result = await repo.createWebviewSession({
      platform: null,
      targetUrl: 'http://ecourse.shanghaitech.edu.cn/',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('已声明平台但未绑定 → CAMPUS_BINDING_REQUIRED（不是 UNAUTHENTICATED）', async () => {
    const repo = makeRepo();
    const result = await repo.createWebviewSession({ platform: 'egate', targetUrl: ALLOWED });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CAMPUS_BINDING_REQUIRED');
  });

  it('票据**只能兑换一次**（用后即焚）', async () => {
    const repo = makeRepo();
    const created = await repo.createWebviewSession({ platform: null, targetUrl: ALLOWED });
    if (!created.ok) return;
    expect(repo.pendingTicketCount()).toBe(1);

    const first = await repo.redeemWebviewTicket(created.value.ticket);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.mode).toBe('direct');
    expect(first.value.url).toBe(ALLOWED);
    expect(repo.pendingTicketCount()).toBe(0);

    const second = await repo.redeemWebviewTicket(created.value.ticket);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe('NOT_FOUND');
  });

  it('过期的票据无法兑换', async () => {
    let clock = NOW.getTime();
    const repo = createMockTechpieRepository({ now: () => new Date(clock), latencyMs: 0 });
    const created = await repo.createWebviewSession({ platform: null, targetUrl: ALLOWED });
    if (!created.ok) return;

    clock += (WEBVIEW_TICKET_TTL_SEC + 1) * 1000;
    const redeemed = await repo.redeemWebviewTicket(created.value.ticket);
    expect(redeemed.ok).toBe(false);
  });

  it('限流：超过 10 次/分钟 → RATE_LIMITED', async () => {
    const repo = makeRepo();
    for (let i = 0; i < WEBVIEW_SESSION_RATE_LIMIT; i += 1) {
      const result = await repo.createWebviewSession({ platform: null, targetUrl: ALLOWED });
      expect(result.ok).toBe(true);
    }
    const overflow = await repo.createWebviewSession({ platform: null, targetUrl: ALLOWED });
    expect(overflow.ok).toBe(false);
    if (overflow.ok) return;
    expect(overflow.error.code).toBe('RATE_LIMITED');
  });
});

describe('校园卡（OPENID 通道）', () => {
  it('未绑定时余额/流水/付款码都返回 CAMPUS_BINDING_REQUIRED（合法状态，不是 401）', async () => {
    const repo = makeRepo();
    const card = await repo.getCard();
    const txs = await repo.listTransactions({});
    const code = await repo.issuePaymentCode();

    for (const result of [card, txs, code]) {
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('CAMPUS_BINDING_REQUIRED');
    }
  });

  it('绑定后可读余额（整数分）与掩码卡号', async () => {
    const repo = makeRepo();
    await bindEcard(repo);
    const card = await repo.getCard();
    expect(card.ok).toBe(true);
    if (!card.ok) return;
    expect(card.value.balanceFen).toBe(5830);
    expect(card.value.cardNoMasked).toBe('****1024');
    expect(card.value.status).toBe('ACTIVE');
  });

  it('流水游标分页且金额是整数分', async () => {
    const repo = makeRepo();
    await bindEcard(repo);
    const first = await repo.listTransactions({ limit: 2 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.items).toHaveLength(2);
    expect(first.value.nextCursor).not.toBeNull();
    expect(Number.isSafeInteger(first.value.items[0]?.amountFen)).toBe(true);

    const second = await repo.listTransactions({
      limit: 2,
      cursor: first.value.nextCursor ?? undefined,
    });
    if (!second.ok) return;
    expect(second.value.items).toHaveLength(2);
    expect(second.value.items[0]?.id).not.toBe(first.value.items[0]?.id);
  });

  it('付款码：60 秒 TTL，且每次申请都是**新码**（旧码立即失效）', async () => {
    const repo = makeRepo();
    await bindEcard(repo);
    const first = await repo.issuePaymentCode();
    const second = await repo.issuePaymentCode();
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.value.ttlSec).toBe(60);
    expect(first.value.payload).not.toBe(second.value.payload);
    expect(Date.parse(second.value.expiresAt) - Date.parse(second.value.issuedAt)).toBe(60_000);
  });

  it('作废付款码返回 revoked（审计只记动作，不记码值）', async () => {
    const repo = makeRepo();
    await bindEcard(repo);
    const revoked = await repo.revokePaymentCode();
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.value.revoked).toBe(true);
  });

  it('mock 全程不产生 CASTGC / 校园会话数据（§11.18-D）', async () => {
    const repo = makeRepo();
    await bindEcard(repo);
    const payloads = [
      await repo.listLinks({}),
      await repo.listCapabilities(),
      await repo.getCard(),
      await repo.listTransactions({}),
    ];
    for (const payload of payloads) {
      expect(findForbiddenCredentialKeys(payload)).toEqual([]);
      expect(JSON.stringify(payload)).not.toMatch(/castgc/i);
      expect(JSON.stringify(payload)).not.toMatch(/tgc/i);
    }
    // 只有默认种子（cpdaily）与刚绑定的校园卡；**没有**任何 eGate / CAS / CpDaily 会话行
    expect(repo.linksSnapshot().map((link) => link.platform).sort()).toEqual(['cpdaily', 'ecard']);
  });
});

describe('故障演练与重置', () => {
  it('failureMode=error 时全部端点返回 UPSTREAM_UNAVAILABLE', async () => {
    const repo = makeRepo({ failureMode: 'error' });
    const results = [
      await repo.listLinks({}),
      await repo.listCapabilities(),
      await repo.getCard(),
      await repo.createWebviewSession({ platform: null, targetUrl: ALLOWED }),
    ];
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('UPSTREAM_UNAVAILABLE');
    }
  });

  it('reset() 恢复初始数据集（含票据与限流计数）', async () => {
    const repo = makeRepo();
    await bindEcard(repo);
    await repo.createWebviewSession({ platform: null, targetUrl: ALLOWED });
    expect(repo.pendingTicketCount()).toBe(1);

    repo.reset();
    expect(repo.pendingTicketCount()).toBe(0);
    expect(repo.linksSnapshot()).toHaveLength(1);
    expect(repo.linksSnapshot()[0]?.platform).toBe('cpdaily');
    expect(repo.getFailureMode()).toBe('none');
  });
});
