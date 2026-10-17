import { describe, expect, it, vi } from 'vitest';
import type { Page } from '@kedaya/contracts';
import {
  CampusBindingRequiredError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../common/errors/app-error';
import {
  CampusSessionError,
  translateCampusSessionError,
  type CampusBindingSummary,
  type CampusSessionPort,
} from './domain/ports/campus-session.port';
import type { WebviewAllowlistPort } from './domain/ports/webview-allowlist.port';
import type {
  TechpieLinkModel,
  TechpieLinkRepository,
  TechpieSyncJobRepository,
} from './domain/techpie.domain';
import { TechpieService } from './techpie.service';

/**
 * 用例层测试：**错误码映射**与**不泄漏**是重点。
 * 规格 §8.5 / §8.6 的错误表是契约，不是建议。
 */

function link(overrides: Partial<TechpieLinkModel> = {}): TechpieLinkModel {
  return {
    id: 'link-1',
    userId: 'user-1',
    provider: 'ecard',
    status: 'LINKED',
    externalUserId: 'openid-1',
    tokenCipher: null,
    expiresAt: null,
    lastSyncAt: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeLinks(rows: TechpieLinkModel[] = []): TechpieLinkRepository {
  const page: Page<TechpieLinkModel> = { items: rows, nextCursor: null };
  return {
    listByUser: vi.fn().mockResolvedValue(page),
    findById: vi.fn().mockImplementation(async (id: string) => rows.find((row) => row.id === id) ?? null),
    findByUserAndProvider: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn().mockResolvedValue(undefined),
  } as unknown as TechpieLinkRepository;
}

function makeJobs(): TechpieSyncJobRepository {
  return {
    listByUser: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    create: vi.fn(),
  } as unknown as TechpieSyncJobRepository;
}

function makeCampusSession(overrides: Partial<CampusSessionPort> = {}): CampusSessionPort {
  return {
    listBindings: vi.fn().mockResolvedValue([]),
    getBinding: vi.fn().mockResolvedValue(null),
    bind: vi.fn(),
    unbind: vi.fn().mockResolvedValue(undefined),
    renew: vi.fn(),
    cookieHeaderFor: vi.fn(),
    ...overrides,
  } as unknown as CampusSessionPort;
}

const ALLOWLIST: WebviewAllowlistPort = {
  allowlistPlaceholder: true,
  allowlistNote: '占位',
  allowlistSize: 7,
};

function build(options: { links?: TechpieLinkModel[]; campus?: CampusSessionPort } = {}) {
  const links = makeLinks(options.links ?? []);
  const jobs = makeJobs();
  const campus = options.campus ?? makeCampusSession();
  const service = new TechpieService(links, jobs, campus, ALLOWLIST);
  return { service, links, jobs, campus };
}

describe('techpie 用例层（规格 §8.1 / §8.5 / §8.6）', () => {
  /* ---------------- 列表与详情 ---------------- */

  it('listLinks 返回 CampusBindingSummary[]，**不含凭证**', async () => {
    const { service } = build({ links: [link()] });
    const page = await service.listLinks('user-1', { limit: 20 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: 'link-1', platform: 'ecard', status: 'LINKED', phase: 'phase0' });
    expect(JSON.stringify(page)).not.toMatch(/tokenCipher|sessionCipher|cookie|castgc/i);
  });

  it('getLink：非本人 → 404（不泄漏"这个 id 存在"）', async () => {
    const { service } = build({ links: [link({ userId: 'someone-else' })] });
    await expect(service.getLink('user-1', 'link-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('getLink：已软删 → 404', async () => {
    const { service } = build({ links: [link({ deletedAt: new Date() })] });
    await expect(service.getLink('user-1', 'link-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  /* ---------------- 绑定 ---------------- */

  it('未知平台 → 422 VALIDATION_FAILED（UNKNOWN_PLATFORM）', async () => {
    const { service } = build();
    await expect(
      service.createLink('user-1', { platform: 'gradescope', credential: { kind: 'openid', openId: 'x' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'UNKNOWN_PLATFORM' } });
  });

  it('Phase 0 之外的平台 → 403 FORBIDDEN（**没有**绑定路径，不是"暂不可用"）', async () => {
    const campus = makeCampusSession({
      bind: vi
        .fn()
        .mockRejectedValue(new CampusSessionError('PHASE_BLOCKED', '阻塞于信息办书面回复', { blockedBy: ['U7'] })),
    });
    const { service } = build({ campus });

    await expect(
      service.createLink('user-1', { platform: 'cpdaily', credential: { kind: 'openid', openId: 'x' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403, details: { reason: 'PHASE_BLOCKED' } });
  });

  it('明文密码 → 403 FORBIDDEN，且**不把密码搬到下游**（只传 kind）', async () => {
    const bind = vi.fn().mockRejectedValue(new CampusSessionError('PLAIN_PASSWORD_REFUSED', '不接受明文密码'));
    const { service } = build({ campus: makeCampusSession({ bind }) });

    await expect(
      service.createLink('user-1', {
        platform: 'ecard',
        credential: { kind: 'password', studentId: '20260001', password: 'hunter2' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // 关键：端口收到的 credential 里**没有**明文密码
    const passed = bind.mock.calls[0]![2] as Record<string, unknown>;
    expect(passed).toEqual({ kind: 'password', studentId: '', password: '' });
    expect(JSON.stringify(bind.mock.calls)).not.toContain('hunter2');
  });

  it('重复绑定 → 409 CONFLICT（ALREADY_LINKED）', async () => {
    const campus = makeCampusSession({
      bind: vi.fn().mockRejectedValue(new CampusSessionError('ALREADY_LINKED', '已经绑定')),
    });
    const { service } = build({ campus });

    await expect(
      service.createLink('user-1', { platform: 'ecard', credential: { kind: 'openid', channel: 'wechat', openId: 'a' } }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409, details: { reason: 'ALREADY_LINKED' } });
  });

  it('凭证错误 → 409 CONFLICT（INVALID_CREDENTIAL）', async () => {
    const campus = makeCampusSession({
      bind: vi.fn().mockRejectedValue(new CampusSessionError('INVALID_CREDENTIAL', '凭证不合法')),
    });
    const { service } = build({ campus });

    await expect(
      service.createLink('user-1', { platform: 'ecard', credential: { kind: 'openid', channel: 'wechat', openId: '' } }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('credential 不是对象 / kind 不认识 → 422（不静默当 openid 处理）', async () => {
    const { service } = build();
    await expect(service.createLink('user-1', { platform: 'ecard', credential: null })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      service.createLink('user-1', { platform: 'ecard', credential: { kind: 'sms' } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('OPENID 的 channel 必须是 wechat（Phase 0 只有这一条通道）', async () => {
    const { service } = build();
    await expect(
      service.createLink('user-1', { platform: 'ecard', credential: { kind: 'openid', channel: 'alipay', openId: 'a' } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  /* ---------------- 解绑 ---------------- */

  it('deleteLink：先**硬删凭证副本**（unbind），再软删 link', async () => {
    const campus = makeCampusSession();
    const { service, links } = build({ links: [link()], campus });

    const result = await service.deleteLink('user-1', 'link-1');

    expect(result).toEqual({ id: 'link-1', deleted: true });
    expect(campus.unbind).toHaveBeenCalledWith('user-1', 'ecard');
    expect(links.softDelete).toHaveBeenCalledWith('link-1');
  });

  /* ---------------- 续期 ---------------- */

  it('renewLink：上游无续期能力 → 409 CONFLICT（RENEW_NOT_SUPPORTED），**绝不谎称已续期**', async () => {
    const campus = makeCampusSession({
      renew: vi.fn().mockRejectedValue(new CampusSessionError('RENEW_NOT_SUPPORTED', '上游没有续期能力')),
    });
    const { service } = build({ links: [link()], campus });

    await expect(service.renewLink('user-1', 'link-1')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      details: { reason: 'RENEW_NOT_SUPPORTED' },
    });
  });

  it('renewLink：非本人 → 404（不泄漏存在性）', async () => {
    const { service } = build({ links: [link({ userId: 'other' })] });
    await expect(service.renewLink('user-1', 'link-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  /* ---------------- 能力清单 ---------------- */

  it('capabilities：两套客户端字段都在，且带白名单占位标记（§11.18-B 第 2 条）', async () => {
    const { service } = build();
    const result = await service.capabilities('user-1');

    expect(result.allowlistPlaceholder).toBe(true);
    expect(result.items).toBe(result.capabilities); // 同一份数组（并集别名）
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.unboundCount).toBeGreaterThan(0);
    expect(result.items.every((item) => item.key === item.id)).toBe(true);
  });

  it('capabilities：未绑定项是**引导**而不是错误（CAMPUS_BINDING_REQUIRED 在 items 里，不是抛异常）', async () => {
    const { service } = build();
    const result = await service.capabilities('user-1');

    const required = result.items.filter((item) => item.status === 'CAMPUS_BINDING_REQUIRED');
    expect(required.length).toBeGreaterThan(0);
    for (const item of required) expect(item.guidance).toBeTruthy();
  });

  /* ---------------- 同步任务 ---------------- */

  it('listSyncJobs 走游标分页', async () => {
    const { service, jobs } = build();
    await service.listSyncJobs('user-1', { cursor: undefined, limit: 10 });
    expect(jobs.listByUser).toHaveBeenCalledWith('user-1', { cursor: undefined, limit: 10 });
  });

  /* ---------------- 错误翻译 ---------------- */

  it('translateCampusSessionError 对非端口错误原样返回（不吞异常）', () => {
    const original = new Error('boom');
    expect(translateCampusSessionError(original)).toBe(original);
    expect(translateCampusSessionError('not-an-error')).toBeInstanceOf(Error);
  });

  it('bindingRequired() 是 409（I4：**不是** 401）', () => {
    const error = new CampusBindingRequiredError('需要绑定', { platform: 'cpdaily' });
    expect(error.status).toBe(409);
    expect(error.code).toBe('CAMPUS_BINDING_REQUIRED');
  });
});
