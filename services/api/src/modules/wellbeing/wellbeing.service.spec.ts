import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AuditService } from '../../common/compliance/audit.service';
import type { ConsentService } from '../../common/compliance/consent.service';
import {
  ConflictError,
  ConsentRequiredError,
  NotFoundError,
  ValidationError,
} from '../../common/errors/app-error';
import { WellbeingService } from './wellbeing.service';
import {
  WELLBEING_CANCELLABLE_STATUSES,
  WELLBEING_DEFAULT_STATUS,
  WELLBEING_STATUSES,
  type WellbeingAppointmentModel,
  type WellbeingAppointmentRepository,
} from './domain/wellbeing.domain';

/**
 * 心理支持用例测试。
 *
 * 分四块，对应这个模块真正的风险（而不是 CRUD 能不能跑）：
 *   1. **同意门**：未同意时不仅抛 `CONSENT_REQUIRED`，而且**根本没触碰数据、没写审计**；
 *   2. **归属**：`userId` 只来自入参（= JWT 主体），请求体里塞什么都不生效；
 *      非本人一律 `NOT_FOUND`；列表强制按主体收窄；
 *   3. **状态**：新建恒 `requested`；`cancel` 只能从 `requested / confirmed` 出发；
 *      `status` 不在 PATCH 输入类型里；
 *   4. **危机出口**：公开、形状稳定（可拨号码 + 打不了电话时的下一步），
 *      且号码可由环境变量覆盖（换学校不用发版）。
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

/** 相对现在构造：预约时间校验会拒绝"已经过去的时间"，写死日期会随时间推移失效 */
function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

interface FakeRepo {
  listByUser: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  applyStatus: ReturnType<typeof vi.fn>;
  markCrisis: ReturnType<typeof vi.fn>;
}

function makeRepo(base: WellbeingAppointmentModel = APPOINTMENT): FakeRepo {
  return {
    listByUser: vi.fn().mockResolvedValue({ items: [base], nextCursor: null }),
    create: vi.fn().mockImplementation((data: object) => ({ ...base, ...data })),
    findById: vi.fn().mockResolvedValue(base),
    update: vi.fn().mockImplementation((_id: string, data: object) => ({ ...base, ...data })),
    remove: vi.fn().mockResolvedValue(undefined),
    applyStatus: vi.fn().mockImplementation((_id: string, status: string) => ({ ...base, status })),
    markCrisis: vi.fn().mockImplementation(() => ({ ...base, crisisFlag: true })),
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

/** 环境变量表：测试用它验证"号码可运营覆盖"，也是缺省值兜底的对照 */
const CONFIG_VALUES: Record<string, string> = {
  WELLBEING_CRISIS_HOTLINE: '021-12320-5',
  WELLBEING_CRISIS_HOTLINE_ALT: '400-161-9995',
};

function makeConfig(values: Record<string, string> = CONFIG_VALUES): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function build(consented: boolean, base: WellbeingAppointmentModel = APPOINTMENT) {
  const repo = makeRepo(base);
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
        ctx.service.create(USER, { counselor: '李老师', slotAt: hoursFromNow(24) }),
      ).rejects.toThrow(ConsentRequiredError);

      expect(ctx.repo.create).not.toHaveBeenCalled();
      expect(ctx.audit.record).not.toHaveBeenCalled();
    });

    it('detail 抛 CONSENT_REQUIRED，且不按 id 查询', async () => {
      await expect(ctx.service.detail(USER, 'appt-1')).rejects.toThrow(ConsentRequiredError);
      expect(ctx.repo.findById).not.toHaveBeenCalled();
    });

    it('cancel / escalateCrisis 同样被同意门挡住，不触碰仓储', async () => {
      await expect(ctx.service.cancel(USER, 'appt-1')).rejects.toThrow(ConsentRequiredError);
      await expect(ctx.service.escalateCrisis(USER, 'appt-1')).rejects.toThrow(
        ConsentRequiredError,
      );
      expect(ctx.repo.applyStatus).not.toHaveBeenCalled();
      expect(ctx.repo.markCrisis).not.toHaveBeenCalled();
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
      await ctx.service.create(USER, { counselor: '李老师', slotAt: hoursFromNow(24) });

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

  describe('归属只来自 JWT', () => {
    let repo: FakeRepo;
    let service: WellbeingService;

    beforeEach(() => {
      const built = build(true);
      repo = built.repo;
      service = built.service;
    });

    it('请求体里硬塞 userId / status / crisisFlag 都不生效（服务层覆盖）', async () => {
      // 类型上这些字段根本不存在；用 `as never` 模拟"有人绕过类型直接发请求"
      await service.create(OTHER_USER, {
        counselor: '李老师',
        slotAt: hoursFromNow(24),
        userId: USER,
        status: 'completed',
        crisisFlag: true,
      } as never);

      const written = repo.create.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(written.userId).toBe(OTHER_USER);
      expect(written.status).toBe(WELLBEING_DEFAULT_STATUS);
      expect(written.crisisFlag).toBe(false);
    });

    it('列表无论怎么调都强制只看自己，status 作为白名单筛选叠加', async () => {
      await service.list(USER, { limit: 10, cursor: 'cur-1', status: 'confirmed' });

      expect(repo.listByUser).toHaveBeenCalledWith(USER, {
        limit: 10,
        cursor: 'cur-1',
        filters: { status: 'confirmed' },
      });

      // 不传 status 时连 filters 都不带（避免"空 where"被误解成"筛全部状态"）
      await service.list(USER, { limit: 10 });
      expect(repo.listByUser).toHaveBeenLastCalledWith(USER, { limit: 10 });
    });

    it('非本人：详情 / 修改 / 删除 / 取消 / 危机干预一律 NOT_FOUND，且不改动任何数据', async () => {
      repo.findById.mockResolvedValue(APPOINTMENT); // 记录属于 USER

      await expect(service.detail(OTHER_USER, 'appt-1')).rejects.toThrow(NotFoundError);
      await expect(service.update(OTHER_USER, 'appt-1', { note: '改一下' })).rejects.toThrow(
        NotFoundError,
      );
      await expect(service.remove(OTHER_USER, 'appt-1')).rejects.toThrow(NotFoundError);
      await expect(service.cancel(OTHER_USER, 'appt-1')).rejects.toThrow(NotFoundError);
      await expect(service.escalateCrisis(OTHER_USER, 'appt-1')).rejects.toThrow(NotFoundError);

      expect(repo.update).not.toHaveBeenCalled();
      expect(repo.remove).not.toHaveBeenCalled();
      expect(repo.applyStatus).not.toHaveBeenCalled();
      expect(repo.markCrisis).not.toHaveBeenCalled();
    });

    it('不存在的记录对本人也是 NOT_FOUND', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.detail(USER, 'ghost')).rejects.toThrow(NotFoundError);
    });
  });

  describe('状态：白名单 + 领域动作', () => {
    let repo: FakeRepo;
    let service: WellbeingService;

    beforeEach(() => {
      const built = build(true);
      repo = built.repo;
      service = built.service;
    });

    it('白名单就是 requested | confirmed | completed | cancelled，新建恒为 requested', () => {
      expect([...WELLBEING_STATUSES]).toEqual([
        'requested',
        'confirmed',
        'completed',
        'cancelled',
      ]);
      expect(WELLBEING_DEFAULT_STATUS).toBe('requested');
      expect([...WELLBEING_CANCELLABLE_STATUSES]).toEqual(['requested', 'confirmed']);
    });

    it('列表的 status 只认白名单：遗留自由字符串直接 VALIDATION_FAILED，且不查库', async () => {
      for (const bad of ['crisis-escalated', 'done', '']) {
        await expect(service.list(USER, { status: bad })).rejects.toThrow(ValidationError);
      }
      expect(repo.listByUser).not.toHaveBeenCalled();
    });

    it('cancel 从 requested / confirmed 走到 cancelled（走 applyStatus，不走 update）', async () => {
      await service.cancel(USER, 'appt-1');
      expect(repo.applyStatus).toHaveBeenCalledWith('appt-1', 'cancelled');

      repo.findById.mockResolvedValue({ ...APPOINTMENT, status: 'confirmed' });
      await service.cancel(USER, 'appt-1');
      expect(repo.applyStatus).toHaveBeenLastCalledWith('appt-1', 'cancelled');
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('cancel 已取消 / 已完成 / 未知状态 → CONFLICT（幂等冲突可见，不静默改写）', async () => {
      for (const status of ['cancelled', 'completed', 'crisis-escalated']) {
        repo.findById.mockResolvedValue({ ...APPOINTMENT, status });
        await expect(service.cancel(USER, 'appt-1')).rejects.toThrow(ConflictError);
      }
      expect(repo.applyStatus).not.toHaveBeenCalled();
    });

    it('update 只能改时间 / 方式 / 摘要：patch 里没有 status / userId / crisisFlag', async () => {
      // 同样绕过类型塞越权字段，确认服务层只挑白名单内字段
      await service.update(USER, 'appt-1', {
        note: '  想聊聊最近的压力  ',
        status: 'completed',
        userId: OTHER_USER,
        crisisFlag: true,
      } as never);

      const patch = repo.update.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(patch).toEqual({ note: '想聊聊最近的压力' });
      expect('status' in patch).toBe(false);
      expect('userId' in patch).toBe(false);
      expect('crisisFlag' in patch).toBe(false);
    });

    it('escalateCrisis 只打标记，不改状态（用户是否继续这次预约由用户决定）', async () => {
      await service.escalateCrisis(USER, 'appt-1');
      expect(repo.markCrisis).toHaveBeenCalledWith('appt-1');
      expect(repo.applyStatus).not.toHaveBeenCalled();
    });
  });

  describe('字段校验（客户端只做即时提示，服务端才是裁决）', () => {
    let repo: FakeRepo;
    let service: WellbeingService;

    beforeEach(() => {
      const built = build(true);
      repo = built.repo;
      service = built.service;
    });

    it('老师 / 咨询师必填且限长，摘要限长，方式走白名单，日期必须合法', async () => {
      const cases = [
        { counselor: '   ', slotAt: hoursFromNow(24) },
        { counselor: 'x'.repeat(121), slotAt: hoursFromNow(24) },
        { counselor: '李老师', slotAt: new Date('not-a-date') },
        { counselor: '李老师', slotAt: hoursFromNow(24), mode: 'video' },
        { counselor: '李老师', slotAt: hoursFromNow(24), note: 'x'.repeat(1001) },
      ];

      for (const input of cases) {
        await expect(service.create(USER, input as never)).rejects.toThrow(ValidationError);
      }
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('预约时间不能是已经过去的时间（留 5 分钟时钟偏差）', async () => {
      await expect(
        service.create(USER, {
          counselor: '李老师',
          slotAt: new Date(Date.now() - 4 * 60 * 1000),
        }),
      ).resolves.toBeTruthy();

      await expect(
        service.create(USER, {
          counselor: '李老师',
          slotAt: new Date(Date.now() - 30 * 60 * 1000),
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('老师与摘要都会 trim，空摘要归一成 null（最小化采集：不存"填了空"）', async () => {
      await service.create(USER, {
        counselor: '  李老师  ',
        slotAt: hoursFromNow(24),
        note: '   ',
      });

      const written = repo.create.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(written.counselor).toBe('李老师');
      expect(written.note).toBeNull();
      // 默认方式：线下
      expect(written.mode).toBe('onsite');
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
      expect(line.module).toBe('wellbeing');
    });

    it('返回形状：可拨号码 + 打不了电话时的下一步（不是一句"请寻求专业帮助"）', () => {
      const { service } = build(false);
      const line = service.crisisLine();

      // 110 / 120 必须是独立条目：带「/」的字符串没法被 makePhoneCall 直接拨打
      expect(line.hotlines).toContainEqual({
        name: '紧急报警（有自伤 / 伤人风险）',
        number: '110',
      });
      expect(line.hotlines).toContainEqual({ name: '急救', number: '120' });
      expect(line.hotlines).toContainEqual({
        name: '全国 24 小时心理援助热线',
        number: '021-12320-5',
      });

      // 每条热线都是纯号码（客户端会直接拨），渠道是文字指引
      for (const hotline of line.hotlines) {
        expect(hotline.number).toMatch(/^[\d-]+$/);
      }
      expect(line.channels.map((channel) => channel.name)).toEqual(['辅导员', '学校保卫处']);
      expect(line.channels.every((channel) => channel.instruction.length > 10)).toBe(true);
      expect(line.message).toContain('110');
      expect(line.message).toContain('120');
    });

    it('号码可由环境变量覆盖（学校换合作机构不必发版）', () => {
      const repo = makeRepo();
      const service = new WellbeingService(
        repo as unknown as WellbeingAppointmentRepository,
        makeConsentService(true) as unknown as ConsentService,
        makeAuditService() as unknown as AuditService,
        makeConfig({ WELLBEING_CRISIS_HOTLINE: '12356' }),
      );

      const line = service.crisisLine();
      expect(line.hotlines).toContainEqual({ name: '全国 24 小时心理援助热线', number: '12356' });
      // 没配的仍回落到域名里的默认值，不会变成 undefined / 空串
      expect(line.hotlines).toContainEqual({ name: '急救', number: '120' });
    });

    it('配置成空串时回落到默认号码（不允许危机出口出现空号码）', () => {
      const repo = makeRepo();
      const service = new WellbeingService(
        repo as unknown as WellbeingAppointmentRepository,
        makeConsentService(true) as unknown as ConsentService,
        makeAuditService() as unknown as AuditService,
        makeConfig({ WELLBEING_CRISIS_HOTLINE: '   ' }),
      );

      expect(service.crisisLine().hotlines).toContainEqual({
        name: '全国 24 小时心理援助热线',
        number: '021-12320-5',
      });
    });
  });

  describe('consents 三个端点', () => {
    it('grant 透传 module 并写审计；revoke 同理；list 直接透传', async () => {
      const built = build(true);

      await built.service.grantConsent(USER);
      expect(built.consent.grant).toHaveBeenCalledWith(USER, 'wellbeing');
      expect(built.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'wellbeing.consent.grant', actorId: USER }),
      );

      await built.service.revokeConsent(USER);
      expect(built.consent.revoke).toHaveBeenCalledWith(USER, 'wellbeing');
      expect(built.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'wellbeing.consent.revoke', actorId: USER }),
      );

      await built.service.listConsents(USER);
      expect(built.consent.list).toHaveBeenCalledWith(USER);
    });
  });
});
