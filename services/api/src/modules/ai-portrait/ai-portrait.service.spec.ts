import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/compliance/audit.service';
import type { ConsentService } from '../../common/compliance/consent.service';
import type { ConsentRecord } from '../../common/compliance/compliance.types';
import {
  ConsentRequiredError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
} from '../../common/errors/app-error';
import { AiPortraitService } from './ai-portrait.service';
import {
  AI_PORTRAIT_GENERATION,
  PORTRAIT_SOURCE_CATALOG,
  assertAllowedSources,
  type AiPortraitProfileModel,
  type AiPortraitProfileRepository,
} from './domain/ai-portrait.domain';

/**
 * AI 画像用例测试。
 *
 * 这个模块的风险不在 CRUD 能不能跑，而在**四条"能跑但会出事"的规则**：
 *
 *   1. 契约 §9「数据最小化」：心理支持（wellbeing）与宿舍矛盾（dorm-harmony）
 *      的数据**不得**进入画像 —— 而且必须在写库**之前**拒绝；
 *   2. **归属只来自 JWT**：请求体里塞 `userId` 不能生效，否则任何人都能读别人的画像；
 *   3. 同意门在最前面：没有有效同意时读 / 写一律 `CONSENT_REQUIRED`，
 *      不可能"先看到画像再补同意"；
 *   4. **现状要如实**：后端还没有生成逻辑，`me()` 返回 `null` 时客户端必须
 *      按"尚无画像数据"处理，而不是把它当故障或编造标签。
 *
 * 因此这里用假仓储 / 假同意服务断言"服务层到底写了什么、拒了什么"。
 */

const USER = 'user-1';
const OTHER = 'user-other';

const PROFILE: AiPortraitProfileModel = {
  id: 'portrait-1',
  userId: USER,
  traits: { likes: ['奶茶'] },
  explain: { likes: '来自拼单历史' },
  enabled: true,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

interface FakeConsentService {
  isGated: ReturnType<typeof vi.fn>;
  hasActiveConsent: ReturnType<typeof vi.fn>;
  requireConsent: ReturnType<typeof vi.fn>;
  grant: ReturnType<typeof vi.fn>;
  revoke: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
}

function consentRecord(overrides: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    id: 'consent-1',
    userId: USER,
    module: 'ai-portrait',
    version: 'v1',
    grantedAt: new Date('2026-10-01T00:00:00.000Z'),
    revokedAt: null,
    ...overrides,
  };
}

/**
 * 假的同意服务：`active` 决定 `requireConsent` 是否放行。
 * `grant` / `revoke` / `list` 都真的回声参数，便于断言"服务层传了谁、传了哪个模块"。
 */
function makeConsentService(active: boolean): FakeConsentService {
  return {
    isGated: vi.fn().mockReturnValue(true),
    hasActiveConsent: vi.fn().mockResolvedValue(active),
    requireConsent: vi.fn(async (_userId: string, moduleId: string) => {
      if (!active) throw new ConsentRequiredError(moduleId);
    }),
    grant: vi.fn(async (userId: string, moduleId: string) =>
      consentRecord({ userId, module: moduleId }),
    ),
    revoke: vi.fn(async (userId: string, moduleId: string) =>
      consentRecord({ userId, module: moduleId, revokedAt: new Date('2026-10-02T00:00:00.000Z') }),
    ),
    list: vi.fn().mockResolvedValue([consentRecord()]),
  };
}

interface FakeRepo {
  findByUserId: ReturnType<typeof vi.fn>;
  upsertForUser: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
}

function makeRepo(profile: AiPortraitProfileModel | null = PROFILE): FakeRepo {
  return {
    findByUserId: vi.fn().mockResolvedValue(profile),
    upsertForUser: vi.fn().mockImplementation(async (userId: string, input: Record<string, unknown>) => ({
      ...(profile ?? PROFILE),
      userId,
      ...input,
    })),
    create: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
  };
}

interface FakeAudit {
  record: ReturnType<typeof vi.fn>;
  recordQuietly: ReturnType<typeof vi.fn>;
}

function makeAudit(): FakeAudit {
  return { record: vi.fn().mockResolvedValue({ id: 'a1' }), recordQuietly: vi.fn() };
}

function makeService(options: { active?: boolean; repo?: FakeRepo; audit?: FakeAudit } = {}) {
  const repo = options.repo ?? makeRepo();
  const consent = makeConsentService(options.active ?? true);
  const audit = options.audit ?? makeAudit();
  const service = new AiPortraitService(
    repo as unknown as AiPortraitProfileRepository,
    consent as unknown as ConsentService,
    audit as unknown as AuditService,
  );
  return { service, repo, consent, audit };
}

describe('契约 §9 · ai-portrait 数据最小化护栏', () => {
  describe('assertAllowedSources', () => {
    it('白名单内的来源通过', () => {
      expect(() => assertAllowedSources(['groupbuy', 'canteen', 'schedule'])).not.toThrow();
    });

    it('wellbeing 被拒绝', () => {
      expect(() => assertAllowedSources(['groupbuy', 'wellbeing'])).toThrow(ForbiddenError);
    });

    it('dorm-harmony 被拒绝', () => {
      expect(() => assertAllowedSources(['dorm-harmony'])).toThrow(ForbiddenError);
    });

    it('两个禁读域同时出现时 details 里都列出', () => {
      try {
        assertAllowedSources(['wellbeing', 'dorm-harmony', 'canteen']);
        throw new Error('应当抛错但没有');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenError);
        expect((error as ForbiddenError).details).toMatchObject({
          forbidden: ['wellbeing', 'dorm-harmony'],
          rule: 'data-minimization',
        });
      }
    });

    it('白名单外的未知模块也被拒绝（默认拒绝而不是默认允许）', () => {
      expect(() => assertAllowedSources(['some-unknown-module'])).toThrow(ForbiddenError);
    });

    it('空来源列表不报错（调用方自行决定语义）', () => {
      expect(() => assertAllowedSources([])).not.toThrow();
    });
  });

  describe('AiPortraitService.upsert', () => {
    it('含禁读来源时**在写库之前**就拒绝（也不写审计）', async () => {
      const { service, repo, audit } = makeService();

      await expect(
        service.upsert(USER, {
          sources: ['groupbuy', 'wellbeing'],
          traits: {},
          explain: {},
        }),
      ).rejects.toThrow(ForbiddenError);

      expect(repo.upsertForUser).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('白名单外的来源同样被拒（不静默丢弃）', async () => {
      const { service, repo } = makeService();

      await expect(
        service.upsert(USER, { sources: ['wellbeing-v2'], traits: {}, explain: {} }),
      ).rejects.toThrow(ForbiddenError);
      expect(repo.upsertForUser).not.toHaveBeenCalled();
    });

    it('未二次同意时抛 CONSENT_REQUIRED（同意门在来源校验之前）', async () => {
      const { service, repo } = makeService({ active: false });

      await expect(
        service.upsert(USER, { sources: ['groupbuy'], traits: {}, explain: {} }),
      ).rejects.toThrow(ConsentRequiredError);

      expect(repo.upsertForUser).not.toHaveBeenCalled();
    });

    it('合法来源时把 sources 写进 explain（可解释性）并写审计', async () => {
      const { service, repo, audit } = makeService();

      await service.upsert(USER, {
        sources: ['groupbuy', 'canteen'],
        traits: { likes: ['奶茶'] },
        explain: { likes: '来自拼单历史' },
      });

      expect(repo.upsertForUser).toHaveBeenCalledWith(
        USER,
        expect.objectContaining({
          explain: expect.objectContaining({ sources: ['groupbuy', 'canteen'] }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai-portrait.profile.upsert', module: 'ai-portrait' }),
      );
    });
  });

  describe('公开的来源边界说明', () => {
    it('sources() 把禁读域明确告知用户', () => {
      const { service } = makeService();

      const info = service.sources();

      expect(info.forbidden).toEqual(['wellbeing', 'dorm-harmony']);
      expect(info.allowed).toContain('groupbuy');
      expect(info.allowed).not.toContain('wellbeing');
    });

    it('sources() 如实说明"尚未接入任何数据来源、也还没有生成逻辑"', () => {
      const { service } = makeService();

      const info = service.sources();

      expect(info.generation.implemented).toBe(false);
      expect(info.generation.connectedSources).toBe(0);
      expect(info.generation.note).toContain('不会在客户端编造标签');
    });

    it('来源清单每类数据都写明"用在哪"，禁读域都写明"为什么排除"', () => {
      const { service } = makeService();
      const { catalog } = service.sources();

      expect(catalog).toHaveLength(10 + 2);
      for (const source of catalog) {
        expect(source.usage.length).toBeGreaterThan(0);
        // 现在没有任何一类数据被真的读取 —— 清单不许"假装已接入"
        expect(source.connected).toBe(false);
        if (!source.allowed) {
          expect(source.exclusionReason).toBeTruthy();
        }
      }

      const forbidden = catalog.filter((source) => !source.allowed).map((source) => source.id);
      expect(forbidden).toEqual(['wellbeing', 'dorm-harmony']);
      // 清单与运行时常量必须同源，否则页面会展示一份"更好看"的假白名单
      expect(catalog.map((source) => source.id)).toEqual([
        ...service.sources().allowed,
        ...service.sources().forbidden,
      ]);
      expect(AI_PORTRAIT_GENERATION.connectedSources).toBe(0);
      expect(PORTRAIT_SOURCE_CATALOG.every((source) => source.connected === false)).toBe(true);
    });
  });
});

describe('归属只来自 JWT（与 takeout-guard 同一套写法）', () => {
  const methodsWithBody: Array<[string, (service: AiPortraitService) => Promise<unknown>]> = [
    ['me', (service) => service.me(undefined)],
    ['setEnabled', (service) => service.setEnabled(undefined, false)],
    ['listConsents', async (service) => service.listConsents(undefined)],
    ['grantConsent', (service) => service.grantConsent(undefined)],
    ['revokeConsent', (service) => service.revokeConsent(undefined)],
    [
      'upsert',
      (service) => service.upsert(undefined, { sources: ['groupbuy'], traits: {}, explain: {} }),
    ],
  ];

  it('未登录（主体为空）一律 UNAUTHENTICATED，且不触碰仓储与同意服务', async () => {
    for (const [name, call] of methodsWithBody) {
      const { service, repo, consent, audit } = makeService();
      await expect(call(service), name).rejects.toThrow(UnauthenticatedError);
      expect(repo.findByUserId, name).not.toHaveBeenCalled();
      expect(repo.upsertForUser, name).not.toHaveBeenCalled();
      expect(consent.grant, name).not.toHaveBeenCalled();
      expect(consent.revoke, name).not.toHaveBeenCalled();
      expect(consent.list, name).not.toHaveBeenCalled();
      expect(audit.record, name).not.toHaveBeenCalled();
    }
  });

  it('me() 只按登录主体查（仓储收到的就是 JWT 主体）', async () => {
    const { service, repo } = makeService();
    await service.me(USER);
    expect(repo.findByUserId).toHaveBeenCalledWith(USER);
    expect(repo.findByUserId).not.toHaveBeenCalledWith(OTHER);
  });

  it('upsert 的归属恒为登录主体：请求体里硬塞 userId 不生效', async () => {
    const { service, repo } = makeService();

    // 类型上根本没有 userId；用 `as never` 模拟"有人绕过类型直接发请求"
    await service.upsert(
      USER,
      { sources: ['groupbuy'], traits: {}, explain: {}, userId: OTHER, id: 'portrait-other' } as never,
    );

    const [writtenUserId, writtenInput] = repo.upsertForUser.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(writtenUserId).toBe(USER);
    expect(writtenInput).not.toHaveProperty('userId');
    expect(writtenInput).not.toHaveProperty('id');
  });

  it('setEnabled 也先按主体查：没有画像行 → NOT_FOUND（而不是凭空建一行）', async () => {
    const { service, repo, audit } = makeService({ repo: makeRepo(null) });

    await expect(service.setEnabled(USER, false)).rejects.toThrow(NotFoundError);
    expect(repo.findByUserId).toHaveBeenCalledWith(USER);
    expect(repo.upsertForUser).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('关闭/开启只改 enabled，并保留原 traits（重开不丢数据）', async () => {
    const { service, repo, audit } = makeService();

    await service.setEnabled(USER, false);

    expect(repo.upsertForUser).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ enabled: false, traits: PROFILE.traits }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ai-portrait.profile.disable' }),
    );

    await service.setEnabled(USER, true);
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'ai-portrait.profile.enable' }),
    );
  });
});

describe('consents 的开关语义', () => {
  it('grant 固定写 ai-portrait 这一个模块，并落审计（用户能看见自己同意过）', async () => {
    const { service, consent, audit } = makeService();

    const record = await service.grantConsent(USER);

    expect(consent.grant).toHaveBeenCalledWith(USER, 'ai-portrait');
    expect(record.module).toBe('ai-portrait');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ai-portrait.consent.grant',
        module: 'ai-portrait',
        resourceId: record.id,
      }),
    );
  });

  it('revoke 是幂等的：仓储没有记录时也返回 null，并落审计', async () => {
    const { service, consent, audit } = makeService();
    consent.revoke.mockResolvedValue(null);

    await expect(service.revokeConsent(USER)).resolves.toBeNull();

    expect(consent.revoke).toHaveBeenCalledWith(USER, 'ai-portrait');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ai-portrait.consent.revoke',
        resourceId: null,
        module: 'ai-portrait',
      }),
    );
  });

  it('撤回后立即拒绝对画像的读写（CONSENT_REQUIRED，且不触碰仓储）', async () => {
    const { service, repo, audit } = makeService({ active: false });

    await expect(service.me(USER)).rejects.toThrow(ConsentRequiredError);
    await expect(service.setEnabled(USER, false)).rejects.toThrow(ConsentRequiredError);
    expect(repo.findByUserId).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('listConsents 只查当前主体的记录（含已撤回的历史条目由服务端返回）', async () => {
    const { service, consent } = makeService();
    consent.list.mockResolvedValue([
      consentRecord(),
      consentRecord({ id: 'consent-0', revokedAt: new Date('2026-09-01T00:00:00.000Z') }),
    ]);

    const records = await service.listConsents(OTHER);

    expect(consent.list).toHaveBeenCalledWith(OTHER);
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.revokedAt === null)).toEqual([true, false]);
  });
});

describe('尚无画像数据时的读语义（不编造标签）', () => {
  it('me() 在仓储没有画像行时返回 null，并把"不存在"写进审计', async () => {
    const { service, audit } = makeService({ repo: makeRepo(null) });

    await expect(service.me(USER)).resolves.toBeNull();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ai-portrait.profile.read',
        resourceId: null,
        metadata: { exists: false, enabled: null },
      }),
    );
  });

  it('有画像行时返回原样模型（enabled=false 也如实返回，展示与否由客户端决定）', async () => {
    const { service } = makeService({
      repo: makeRepo({ ...PROFILE, enabled: false }),
    });

    const profile = await service.me(USER);

    expect(profile?.enabled).toBe(false);
    expect(profile?.traits).toEqual(PROFILE.traits);
  });
});
