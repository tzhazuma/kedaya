import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/compliance/audit.service';
import type { ConsentService } from '../../common/compliance/consent.service';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../common/errors/app-error';
import { sha256Hex } from '../auth/domain/verification-code';
import { DormHarmonyService } from './dorm-harmony.service';
import type {
  CreateDormHarmonyCaseData,
  DormHarmonyCaseModel,
  DormHarmonyCaseRepository,
  DormHarmonyMessageModel,
} from './domain/dorm-harmony.domain';

/**
 * dorm-harmony 的核心用例测试：**追踪码即能力 + 匿名不可关联 + 防枚举**。
 *
 * 这里刻意不碰数据库：用假 repository 捕获服务层真正落库的数据，
 * 断言「库里只有 sha256(trackCode)」「返回实体没有 trackCodeHash」。
 */

const GOOD_CODE = 'ABCD-EFGH-JKLM';

const CASE_BASE: DormHarmonyCaseModel = {
  id: 'case-1',
  anonHandle: '鸭友0A1B2C',
  trackCodeHash: sha256Hex(GOOD_CODE),
  building: '1 号楼',
  topic: '作息不一致',
  detail: '有人凌晨打游戏外放',
  status: 'submitted',
  mediatorId: null,
  expectation: 'talk',
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

const MESSAGE_BASE: DormHarmonyMessageModel = {
  id: 'msg-1',
  caseId: 'case-1',
  fromRole: 'student',
  anonHandle: CASE_BASE.anonHandle,
  body: '补充一下',
  createdAt: new Date('2026-10-01T01:00:00.000Z'),
};

interface FakeRepo {
  create: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  listMessages: ReturnType<typeof vi.fn>;
  appendMessage: ReturnType<typeof vi.fn>;
  updateStatus: ReturnType<typeof vi.fn>;
  setMediator: ReturnType<typeof vi.fn>;
}

interface FakeConsent {
  list: ReturnType<typeof vi.fn>;
  grant: ReturnType<typeof vi.fn>;
  revoke: ReturnType<typeof vi.fn>;
}

interface FakeAudit {
  record: ReturnType<typeof vi.fn>;
  recordQuietly: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
}

function makeRepo(): FakeRepo {
  return {
    create: vi.fn().mockImplementation(async (data: CreateDormHarmonyCaseData) => ({
      ...CASE_BASE,
      id: data.id,
      anonHandle: data.anonHandle,
      trackCodeHash: data.trackCodeHash,
      building: data.building,
      topic: data.topic,
      detail: data.detail,
      expectation: data.expectation,
      status: 'submitted',
    })),
    findById: vi.fn().mockResolvedValue(CASE_BASE),
    listMessages: vi.fn().mockResolvedValue([MESSAGE_BASE]),
    appendMessage: vi.fn().mockImplementation(async (data: object) => ({ ...MESSAGE_BASE, ...data })),
    updateStatus: vi.fn().mockImplementation(async (_id: string, status: string) => ({
      ...CASE_BASE,
      status,
    })),
    setMediator: vi.fn().mockImplementation(async (_id: string, mediatorId: string) => ({
      ...CASE_BASE,
      mediatorId,
      status: 'in-progress',
    })),
  };
}

function makeConsent(): FakeConsent {
  return {
    list: vi.fn().mockResolvedValue([]),
    grant: vi.fn().mockResolvedValue({ id: 'consent-1', userId: 'u1', module: 'dorm-harmony', version: 'v1', grantedAt: new Date(), revokedAt: null }),
    revoke: vi.fn().mockResolvedValue(null),
  };
}

function makeAudit(): FakeAudit {
  return { record: vi.fn().mockResolvedValue({ id: 'audit-1' }), recordQuietly: vi.fn(), list: vi.fn() };
}

function makeService(repo: FakeRepo, consent = makeConsent(), audit = makeAudit()): DormHarmonyService {
  return new DormHarmonyService(
    repo as unknown as DormHarmonyCaseRepository,
    consent as unknown as ConsentService,
    audit as unknown as AuditService,
  );
}

describe('DormHarmonyService（匿名调解用例）', () => {
  let repo: FakeRepo;
  let audit: FakeAudit;
  let service: DormHarmonyService;

  beforeEach(() => {
    repo = makeRepo();
    audit = makeAudit();
    service = makeService(repo, makeConsent(), audit);
  });

  describe('submit（提交，公开无需登录）', () => {
    const draft = { building: '1 号楼', topic: '作息不一致', detail: '凌晨打游戏', expectation: 'talk' as const };

    it('返回 { case, trackCode }，且 case 不含 trackCodeHash', async () => {
      const result = await service.submit(draft);

      expect(result.trackCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(result.case).not.toHaveProperty('trackCodeHash');
      expect(result.case.status).toBe('submitted');
    });

    it('库里只存 sha256(trackCode)，绝不落明文', async () => {
      const result = await service.submit(draft);
      const stored = repo.create.mock.calls[0]![0] as CreateDormHarmonyCaseData;

      expect(stored.trackCodeHash).toBe(sha256Hex(result.trackCode));
      expect(stored.trackCodeHash).not.toContain(result.trackCode);
      expect(JSON.stringify(stored)).not.toContain(result.trackCode);
    });

    it('anonHandle 由「案子 id + 随机数」派生，不含实名信息', async () => {
      const result = await service.submit(draft);
      const stored = repo.create.mock.calls[0]![0] as CreateDormHarmonyCaseData;

      expect(stored.anonHandle).toMatch(/^鸭友[0-9A-F]{6}$/);
      expect(stored.anonHandle).toBe(result.case.anonHandle);
      // 两次提交即使同一环境也应拿到不同 handle（种子含随机数）
      const second = await service.submit(draft);
      expect(second.case.anonHandle).not.toBe(result.case.anonHandle);
    });

    it('写审计（匿名 actor，不落实名）', async () => {
      await service.submit(draft);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: null,
          actorType: 'anonymous',
          action: 'dorm-harmony.case.create',
        }),
      );
    });

    it('宿舍楼为空 → VALIDATION_FAILED，不落库', async () => {
      await expect(service.submit({ ...draft, building: '  ' })).rejects.toThrow(ValidationError);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('问题描述超过 40 字 → VALIDATION_FAILED', async () => {
      await expect(service.submit({ ...draft, topic: 'x'.repeat(41) })).rejects.toThrow(ValidationError);
    });

    it('补充说明超过 2000 字 → VALIDATION_FAILED', async () => {
      await expect(service.submit({ ...draft, detail: 'x'.repeat(2001) })).rejects.toThrow(
        ValidationError,
      );
    });

    it('期望的解决方式不在白名单 → VALIDATION_FAILED', async () => {
      await expect(service.submit({ ...draft, expectation: 'sue' as never })).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe('detail（出示追踪码）', () => {
    it('追踪码正确 → 返回详情 + 留言，且不含 trackCodeHash', async () => {
      const result = await service.detail('case-1', GOOD_CODE);

      expect(result.id).toBe('case-1');
      expect(result.messages).toHaveLength(1);
      expect(result).not.toHaveProperty('trackCodeHash');
    });

    it('追踪码错误 → FORBIDDEN', async () => {
      await expect(service.detail('case-1', 'WRONG-CODE-0000')).rejects.toThrow(ForbiddenError);
    });

    it('缺少追踪码 → FORBIDDEN', async () => {
      await expect(service.detail('case-1')).rejects.toThrow(ForbiddenError);
    });

    it('案子不存在与追踪码错误返回**完全一致**的文案（防枚举）', async () => {
      repo.findById.mockResolvedValue(null);

      const missing = await service.detail('case-x', GOOD_CODE).catch((e: Error) => e);
      const wrongCode = await service.detail('case-1', 'WRONG-CODE-0000').catch((e: Error) => e);

      expect(missing).toBeInstanceOf(ForbiddenError);
      expect((missing as Error).message).toBe((wrongCode as Error).message);
    });
  });

  describe('postMessage（学生留言）', () => {
    it('submitted 状态留言后自动推进为 in-progress', async () => {
      const result = await service.postMessage('case-1', GOOD_CODE, '你好');

      expect(repo.appendMessage).toHaveBeenCalledWith({
        caseId: 'case-1',
        fromRole: 'student',
        anonHandle: CASE_BASE.anonHandle,
        body: '你好',
      });
      expect(repo.updateStatus).toHaveBeenCalledWith('case-1', 'in-progress');
      expect(result.caseStatus).toBe('in-progress');
    });

    it('已在 in-progress 状态不再重复推进', async () => {
      repo.findById.mockResolvedValue({ ...CASE_BASE, status: 'in-progress' });

      const result = await service.postMessage('case-1', GOOD_CODE, '继续');

      expect(repo.updateStatus).not.toHaveBeenCalled();
      expect(result.caseStatus).toBe('in-progress');
    });

    it('已结案 → CONFLICT', async () => {
      repo.findById.mockResolvedValue({ ...CASE_BASE, status: 'closed' });

      await expect(service.postMessage('case-1', GOOD_CODE, '在吗')).rejects.toThrow(ConflictError);
      expect(repo.appendMessage).not.toHaveBeenCalled();
    });

    it('追踪码错误 → FORBIDDEN，不留言', async () => {
      await expect(service.postMessage('case-1', 'WRONG-CODE-0000', '在吗')).rejects.toThrow(
        ForbiddenError,
      );
      expect(repo.appendMessage).not.toHaveBeenCalled();
    });

    it('留言为空 → VALIDATION_FAILED', async () => {
      await expect(service.postMessage('case-1', GOOD_CODE, '  ')).rejects.toThrow(ValidationError);
    });

    it('留言超长 → VALIDATION_FAILED', async () => {
      await expect(service.postMessage('case-1', GOOD_CODE, 'x'.repeat(2001))).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe('closeCase（学生结案）', () => {
    it('追踪码正确 → closed', async () => {
      const result = await service.closeCase('case-1', GOOD_CODE);
      expect(result.status).toBe('closed');
      expect(repo.updateStatus).toHaveBeenCalledWith('case-1', 'closed');
    });

    it('重复结案 → CONFLICT', async () => {
      repo.findById.mockResolvedValue({ ...CASE_BASE, status: 'closed' });
      await expect(service.closeCase('case-1', GOOD_CODE)).rejects.toThrow(ConflictError);
    });

    it('追踪码错误 → FORBIDDEN', async () => {
      await expect(service.closeCase('case-1', 'WRONG-CODE-0000')).rejects.toThrow(ForbiddenError);
    });
  });

  describe('mediatorReply（调解员入口，需要登录）', () => {
    it('设 mediatorId 并追加 mediator 留言（不带 handle）', async () => {
      const result = await service.mediatorReply('case-1', '我们已联系宿管', 'staff-1');

      expect(repo.setMediator).toHaveBeenCalledWith('case-1', 'staff-1');
      expect(repo.appendMessage).toHaveBeenCalledWith({
        caseId: 'case-1',
        fromRole: 'mediator',
        anonHandle: null,
        body: '我们已联系宿管',
      });
      expect(result.caseStatus).toBe('in-progress');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'staff-1', action: 'dorm-harmony.case.mediator-reply' }),
      );
    });

    it('案子不存在 → NOT_FOUND', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.mediatorReply('missing', '在吗', 'staff-1')).rejects.toThrow(NotFoundError);
    });

    it('已结案 → CONFLICT', async () => {
      repo.findById.mockResolvedValue({ ...CASE_BASE, status: 'closed' });
      await expect(service.mediatorReply('case-1', '在吗', 'staff-1')).rejects.toThrow(ConflictError);
    });

    it('留言为空 → VALIDATION_FAILED', async () => {
      await expect(service.mediatorReply('case-1', '  ', 'staff-1')).rejects.toThrow(ValidationError);
    });
  });

  describe('consents（实名合规入口，与匿名案子分离）', () => {
    it('grant 记录同意并写审计', async () => {
      await service.grantConsent('user-1');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'user-1', action: 'dorm-harmony.consent.grant' }),
      );
    });
  });
});
