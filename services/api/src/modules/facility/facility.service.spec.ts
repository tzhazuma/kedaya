import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, ForbiddenError, ValidationError } from '../../common/errors/app-error';
import { FacilityBookingService } from './facility.service';
import type {
  FacilityBookingModel,
  FacilityBookingRepository,
} from './domain/facility.domain';

/**
 * facility（场馆预约，契约 §11.10-C 的第 20 个模块）用例测试。
 *
 * 覆盖 Lead 点名的两条：
 *   · 预约时段冲突 → `CONFLICT`；
 *   · 金额一律**整数分**（非整数/负数 → `VALIDATION_FAILED`，不静默截断）。
 */

const OWNER = 'user-A';
const STRANGER = 'user-B';

function makeBooking(overrides: Partial<FacilityBookingModel> = {}): FacilityBookingModel {
  return {
    id: 'booking-1',
    ownerId: OWNER,
    kind: 'badminton',
    facilityName: '体育馆 3 号场',
    startsAt: new Date('2026-10-20T10:00:00.000Z'),
    endsAt: new Date('2026-10-20T11:00:00.000Z'),
    status: 'booked',
    feeFen: 1500,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

type MockFn = ReturnType<typeof vi.fn>;

interface Fakes {
  list: MockFn;
  create: MockFn;
  findById: MockFn;
  update: MockFn;
  remove: MockFn;
  findOverlapping: MockFn;
}

function makeFakes(): Fakes {
  return {
    list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    create: vi.fn().mockImplementation(async (input: Record<string, unknown>) => makeBooking(input)),
    findById: vi.fn().mockResolvedValue(makeBooking()),
    update: vi.fn().mockImplementation(async (id: string, data: Record<string, unknown>) =>
      makeBooking({ id, ...data }),
    ),
    remove: vi.fn().mockResolvedValue(undefined),
    findOverlapping: vi.fn().mockResolvedValue(null),
  };
}

function makeService(fakes: Fakes): FacilityBookingService {
  return new FacilityBookingService(fakes as unknown as FacilityBookingRepository);
}

const DRAFT = {
  kind: 'badminton',
  facilityName: '体育馆 3 号场',
  startsAt: new Date('2026-10-20T10:00:00.000Z'),
  endsAt: new Date('2026-10-20T11:00:00.000Z'),
  feeFen: 1500,
};

describe('FacilityBookingService · 时段冲突（CONFLICT）', () => {
  let fakes: Fakes;
  let service: FacilityBookingService;

  beforeEach(() => {
    fakes = makeFakes();
    service = makeService(fakes);
  });

  it('同一场馆同一时段已被预约 → CONFLICT，且不写库', async () => {
    fakes.findOverlapping.mockResolvedValue(makeBooking());

    await expect(service.create(DRAFT, OWNER)).rejects.toThrow(ConflictError);
    expect(fakes.create).not.toHaveBeenCalled();
  });

  it('无冲突时正常创建，并把 ownerId 由请求主体补全', async () => {
    await service.create(DRAFT, OWNER);

    expect(fakes.findOverlapping).toHaveBeenCalledWith({
      kind: 'badminton',
      facilityName: '体育馆 3 号场',
      startsAt: DRAFT.startsAt,
      endsAt: DRAFT.endsAt,
    });
    expect(fakes.create).toHaveBeenCalledWith(expect.objectContaining({ ownerId: OWNER }));
  });

  it('endsAt 不晚于 startsAt → VALIDATION_FAILED（不查冲突）', async () => {
    await expect(
      service.create({ ...DRAFT, endsAt: new Date('2026-10-20T10:00:00.000Z') }, OWNER),
    ).rejects.toThrow(ValidationError);
    expect(fakes.findOverlapping).not.toHaveBeenCalled();
  });

  it('未登录且未显式给 ownerId → VALIDATION_FAILED', async () => {
    await expect(service.create(DRAFT)).rejects.toThrow(ValidationError);
  });
});

describe('FacilityBookingService · 金额一律整数分（契约 §6.1）', () => {
  let fakes: Fakes;
  let service: FacilityBookingService;

  beforeEach(() => {
    fakes = makeFakes();
    service = makeService(fakes);
  });

  it('整数分正常通过，且原样落库（不做浮点换算）', async () => {
    const created = await service.create({ ...DRAFT, feeFen: 1500 }, OWNER);

    expect(fakes.create).toHaveBeenCalledWith(expect.objectContaining({ feeFen: 1500 }));
    expect(created.feeFen).toBe(1500);
    expect(Number.isInteger(created.feeFen)).toBe(true);
  });

  it('小数金额 → VALIDATION_FAILED（不静默截断）', async () => {
    await expect(service.create({ ...DRAFT, feeFen: 15.5 }, OWNER)).rejects.toThrow(ValidationError);
    expect(fakes.create).not.toHaveBeenCalled();
  });

  it('负数金额 → VALIDATION_FAILED', async () => {
    await expect(service.create({ ...DRAFT, feeFen: -1 }, OWNER)).rejects.toThrow(ValidationError);
  });

  it('0 元是合法的（免费场馆）', async () => {
    await service.create({ ...DRAFT, feeFen: 0 }, OWNER);
    expect(fakes.create).toHaveBeenCalledWith(expect.objectContaining({ feeFen: 0 }));
  });
});

describe('FacilityBookingService · cancel（契约 §11.10-C 的领域动作）', () => {
  let fakes: Fakes;
  let service: FacilityBookingService;

  beforeEach(() => {
    fakes = makeFakes();
    service = makeService(fakes);
  });

  it('发起人取消 → 状态改为 cancelled', async () => {
    await service.cancel('booking-1', OWNER);

    expect(fakes.update).toHaveBeenCalledWith('booking-1', { status: 'cancelled' });
  });

  it('非发起人取消 → FORBIDDEN', async () => {
    await expect(service.cancel('booking-1', STRANGER)).rejects.toThrow(ForbiddenError);
    expect(fakes.update).not.toHaveBeenCalled();
  });

  it('未登录 → FORBIDDEN（不泄漏该预约是否存在）', async () => {
    await expect(service.cancel('booking-1')).rejects.toThrow(ForbiddenError);
  });

  it('已取消的预约不能重复取消 → CONFLICT', async () => {
    fakes.findById.mockResolvedValue(makeBooking({ status: 'cancelled' }));

    await expect(service.cancel('booking-1', OWNER)).rejects.toThrow(ConflictError);
    expect(fakes.update).not.toHaveBeenCalled();
  });
});
