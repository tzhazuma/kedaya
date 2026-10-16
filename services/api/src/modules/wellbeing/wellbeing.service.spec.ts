import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AuditService } from '../../common/compliance/audit.service';
import type { ConsentService } from '../../common/compliance/consent.service';
import { ConsentRequiredError, NotFoundError } from '../../common/errors/app-error';
import { WellbeingService } from './wellbeing.service';
import type {
  WellbeingAppointmentModel,
  WellbeingAppointmentRepository,
} from './domain/wellbeing.domain';

/**
 * 契约 §9 的核心测试：**敏感模块二次同意门**。
 *
 * 断言的不只是"抛了 CONSENT_REQUIRED"，还包括
 * **未同意时根本没有触碰数据、也没有写审计** —— 同意门必须在最前面。
 */

const USER = 'user-1';
const OTHER_USER = 'user-2';

const APPOINTMENT: WellbeingAppointmentModel = {
  id: 'appt-1',
  userId: USER,
  counselor: '李老师',
  slotAt: new Date('2026-11-05T02:00:00.000Z'),
  mode: 'onsite',
  status: 'requested',
  note: null,
  crisisFlag: false,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

interface FakeRepo {
  listByUser: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function makeRepo(): FakeRepo {
  return {
    listByUser: vi.fn().mockResolvedValue({ items: [APPOINTMENT], nextCursor: null }),
    create: vi.fn().mockImplementation((data: object) => ({ ...APPOINTMENT, ...data })),
    findById: vi.fn().mockResolvedValue(APPOINTMENT),
    update: vi.fn().mockImplementation((_id: string, data: object) => ({ ...APPOINTMENT, ...data })),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

/** 模拟真实 ConsentService 的语义：未同意 → 抛 CONSENT_REQUIRED */
function makeConsentService(active: boolean) {
  return {
    isGated: vi.fn().mockReturnValue(true),
    hasActiveConsent: vi.fn().mockResolvedValue(active),
    requireConsent: vi.fn(async (_userId: string, moduleId: string) => {
      if (!active) throw new ConsentRequiredError(moduleId);
    }),
    grant: vi.fn().mockResolvedValue({ id: 'consent-1' }),
    revoke: vi.fn().mockResolvedValue({ id: 'consent-1', revokedAt: new Date() }),
    list: vi.fn().mockResolvedValue([]),
  };
}

function makeAuditService() {
  return { record: vi.fn().mockResolvedValue({ id: 'audit-1' }), recordQuietly: vi.fn(), list: vi.fn() };
}

function makeConfig(): ConfigService {
  const values: Record<string, string> = {
    WELLBEING_CRISIS_HOTLINE: '021-12320-5',
    WELLBEING_CRISIS_HOTLINE_ALT: '400-161-9995',
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function build(consented: boolean) {
  const repo = makeRepo();
  const consent = makeConsentService(consented);
  const audit = makeAuditService();
  const service = new WellbeingService(
    repo as unknown as WellbeingAppointmentRepository,
    consent as unknown as ConsentService,
    audit as unknown as AuditService,
    makeConfig(),
  );
  return { service, repo, consent, audit };
}

describe('WellbeingService（契约 §9：二次同意 + 审计 + 危机干预）', () => {
  let ctx: ReturnType<typeof build>;

  describe('未二次同意时', () => {
    beforeEach(() => {
      ctx = build(false);
    });

    it('list 抛 CONSENT_REQUIRED，且**不读取任何数据**', async () => {
      await expect(ctx.service.list(USER, { limit: 20 })).rejects.toThrow(ConsentRequiredError);
      expect(ctx.repo.listByUser).not.toHaveBeenCalled();
    });

    it('create 抛 CONSENT_REQUIRED，且不写库、不写审计', async () => {
      await expect(
        ctx.service.create(USER, { counselor: '李老师', slotAt: new Date() }),
      ).rejects.toThrow(ConsentRequiredError);

      expect(ctx.repo.create).not.toHaveBeenCalled();
      expect(ctx.audit.record).not.toHaveBeenCalled();
    });

    it('detail 抛 CONSENT_REQUIRED，且不按 id 查询', async () => {
      await expect(ctx.service.detail(USER, 'appt-1')).rejects.toThrow(ConsentRequiredError);
      expect(ctx.repo.findById).not.toHaveBeenCalled();
    });

    it('错误码确实是 CONSENT_REQUIRED 且带 module（供客户端弹同意框）', async () => {
      await expect(ctx.service.list(USER, { limit: 20 })).rejects.toMatchObject({
        code: 'CONSENT_REQUIRED',
        details: { module: 'wellbeing' },
      });
    });
  });

  describe('已二次同意时', () => {
    beforeEach(() => {
      ctx = build(true);
    });

    it('list 正常返回并写审计（fail-closed）', async () => {
      const page = await ctx.service.list(USER, { limit: 20 });

      expect(page.items).toHaveLength(1);
      expect(ctx.repo.listByUser).toHaveBeenCalledWith(USER, { limit: 20 });
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: USER,
          action: 'wellbeing.appointment.list',
          module: 'wellbeing',
        }),
      );
    });

    it('create 把 userId 注入到数据里（不接受客户端指定他人）', async () => {
      await ctx.service.create(USER, { counselor: '李老师', slotAt: new Date() });

      expect(ctx.repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER, counselor: '李老师' }),
      );
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'wellbeing.appointment.create', actorId: USER }),
      );
    });

    it('审计失败会让请求失败（敏感数据不能"被读过却没痕迹"）', async () => {
      ctx.audit.record.mockRejectedValue(new Error('审计库不可用'));
      await expect(ctx.service.list(USER, { limit: 20 })).rejects.toThrow('审计库不可用');
    });

    it('访问他人预约返回 NOT_FOUND（不泄漏"记录存在"）', async () => {
      await expect(ctx.service.detail(OTHER_USER, 'appt-1')).rejects.toThrow(NotFoundError);
    });

    it('escalateCrisis 标记后一并返回热线', async () => {
      const result = await ctx.service.escalateCrisis(USER, 'appt-1');

      expect(result.appointment.crisisFlag).toBe(true);
      expect(result.crisisLine.hotlines.length).toBeGreaterThan(0);
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'wellbeing.crisis.escalate' }),
      );
    });
  });

  describe('危机干预出口（契约 §9：不可被埋进二级菜单）', () => {
    it('无需登录、无需同意即可拿到热线', () => {
      const { service } = build(false);
      const line = service.crisisLine();

      expect(line.requiresLogin).toBe(false);
      expect(line.requiresConsent).toBe(false);
      // 前端据此强制首屏渲染，不能折叠
      expect(line.prominence).toBe('primary');
      expect(line.hotlines).toContainEqual({ name: '全国24小时心理援助热线', number: '021-12320-5' });
    });
  });
});
