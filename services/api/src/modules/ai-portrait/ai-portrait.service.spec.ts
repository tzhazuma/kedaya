import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/compliance/audit.service';
import type { ConsentService } from '../../common/compliance/consent.service';
import { ConsentRequiredError, ForbiddenError } from '../../common/errors/app-error';
import { AiPortraitService } from './ai-portrait.service';
import {
  assertAllowedSources,
  type AiPortraitProfileModel,
  type AiPortraitProfileRepository,
} from './domain/ai-portrait.domain';

/**
 * 契约 §9「数据最小化」的回归测试：
 * `ai-portrait` **不得**读取 `wellbeing` / `dorm-harmony` 的数据。
 */

const USER = 'user-1';

const PROFILE: AiPortraitProfileModel = {
  id: 'portrait-1',
  userId: USER,
  traits: { likes: ['奶茶'] },
  explain: { likes: '来自拼单历史' },
  enabled: true,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

function makeConsentService(active: boolean) {
  return {
    isGated: vi.fn().mockReturnValue(true),
    hasActiveConsent: vi.fn().mockResolvedValue(active),
    requireConsent: vi.fn(async (_userId: string, moduleId: string) => {
      if (!active) throw new ConsentRequiredError(moduleId);
    }),
    grant: vi.fn(),
    revoke: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
  };
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
    let repo: {
      findByUserId: ReturnType<typeof vi.fn>;
      upsertForUser: ReturnType<typeof vi.fn>;
    };
    let audit: { record: ReturnType<typeof vi.fn>; recordQuietly: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> };

    function build(active: boolean) {
      repo = {
        findByUserId: vi.fn().mockResolvedValue(PROFILE),
        upsertForUser: vi.fn().mockResolvedValue(PROFILE),
      };
      audit = { record: vi.fn().mockResolvedValue({ id: 'a1' }), recordQuietly: vi.fn(), list: vi.fn() };
      return new AiPortraitService(
        repo as unknown as AiPortraitProfileRepository,
        makeConsentService(active) as unknown as ConsentService,
        audit as unknown as AuditService,
      );
    }

    beforeEach(() => {
      build(true);
    });

    it('含禁读来源时**在写库之前**就拒绝', async () => {
      const service = build(true);

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

    it('未二次同意时抛 CONSENT_REQUIRED（同意门在来源校验之前）', async () => {
      const service = build(false);

      await expect(
        service.upsert(USER, { sources: ['groupbuy'], traits: {}, explain: {} }),
      ).rejects.toThrow(ConsentRequiredError);

      expect(repo.upsertForUser).not.toHaveBeenCalled();
    });

    it('合法来源时把 sources 写进 explain（可解释性）并写审计', async () => {
      const service = build(true);

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
      const service = new AiPortraitService(
        {} as unknown as AiPortraitProfileRepository,
        makeConsentService(true) as unknown as ConsentService,
        { record: vi.fn() } as unknown as AuditService,
      );

      const info = service.sources();

      expect(info.forbidden).toEqual(['wellbeing', 'dorm-harmony']);
      expect(info.allowed).toContain('groupbuy');
      expect(info.allowed).not.toContain('wellbeing');
    });
  });
});
