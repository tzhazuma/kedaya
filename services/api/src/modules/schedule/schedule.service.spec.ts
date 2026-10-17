import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CampusBindingRequiredError, ValidationError } from '../../common/errors/app-error';
import { ScheduleCourseService } from './schedule.service';
import type { ScheduleCourseModel, ScheduleCourseRepository } from './domain/schedule.domain';
import type { CampusSessionPort } from '../auth/domain/auth.domain';
import type { CampusDataPort } from '../auth/domain/campus-data.domain';

/**
 * 课表用例测试。重点验证**高可用**那一条：
 *   上游失败 / 未绑定时，本地课表**绝不能**被清空。
 */

const USER = 'user-1';
/** 2026-10-12 周一 09:20 */
const NOW = new Date(2026, 9, 12, 9, 20, 0);

function row(partial: Partial<ScheduleCourseModel> & { startSlot: number; endSlot: number }): ScheduleCourseModel {
  return {
    id: `c-${partial.startSlot}`,
    userId: USER,
    term: '2026-2027-1',
    courseName: partial.courseName ?? '线性代数',
    teacher: partial.teacher ?? '许岚',
    location: partial.location ?? '教学中心 201',
    weekday: partial.weekday ?? 1,
    startSlot: partial.startSlot,
    endSlot: partial.endSlot,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeRepo(rows: ScheduleCourseModel[]) {
  return {
    list: vi.fn(),
    create: vi.fn().mockImplementation(async (input: object) => ({ ...row({ startSlot: 1, endSlot: 2 }), ...input })),
    findById: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    listByWeekday: vi.fn().mockResolvedValue(rows),
    listByUserTerm: vi.fn().mockResolvedValue(rows),
    listTerms: vi.fn().mockResolvedValue(['2026-2027-1']),
    replaceTerm: vi.fn().mockImplementation(async (_u: string, _t: string, items: unknown[]) => items.length),
  };
}

function build(options: {
  rows?: ScheduleCourseModel[];
  session?: { platform: 'JWC'; sessionRef: string; expiresAt: Date } | null;
  courses?: Awaited<ReturnType<CampusDataPort['fetchSchedule']>>;
  fetchError?: Error;
  mode?: 'mock' | 'live';
} = {}) {
  const repo = makeRepo(options.rows ?? []);
  const campusSession = {
    bind: vi.fn(),
    listBindings: vi.fn(),
    unbind: vi.fn(),
    acquireSession: vi.fn().mockResolvedValue(
      options.session === undefined
        ? { platform: 'JWC', sessionRef: 'demo:JWC:user-1', expiresAt: new Date(2027, 0, 1) }
        : options.session,
    ),
  } as unknown as CampusSessionPort;

  const campusData: CampusDataPort = {
    mode: options.mode ?? 'mock',
    fetchIdentity: vi.fn(),
    fetchCard: vi.fn(),
    fetchSchedule: vi.fn().mockImplementation(async () => {
      if (options.fetchError) throw options.fetchError;
      return options.courses ?? [];
    }),
  };

  const service = new ScheduleCourseService(
    repo as unknown as ScheduleCourseRepository,
    campusSession,
    campusData,
    () => NOW,
  );

  return { service, repo, campusSession, campusData };
}

describe('ScheduleCourseService', () => {
  let ctx: ReturnType<typeof build>;

  beforeEach(() => {
    ctx = build({ rows: [row({ startSlot: 1, endSlot: 2 }), row({ startSlot: 3, endSlot: 4 })] });
  });

  it('today：按服务端时钟给出今天、下一节课与剩余分钟数', async () => {
    const view = await ctx.service.today(USER);

    expect(view.term).toBe('2026-2027-1');
    expect(view.weekday).toBe(1);
    expect(view.courses).toHaveLength(2);
    expect(view.courses[0]?.timeLabel).toBe('08:15–10:05'); // 第 1-2 节：从第 1 节开始到第 2 节结束
    expect(view.next?.courseName).toBe('线性代数');
    expect(view.minutesUntilNext).toBe(65);
    expect(view.empty).toBe(false);
    expect(view.simulated).toBe(true); // 模拟上游必须如实标注
  });

  it('today：没有课时 empty=true（UI 用来引导"去同步"，而不是显示空白）', async () => {
    const empty = build({ rows: [] });
    const view = await empty.service.today(USER);
    expect(view.empty).toBe(true);
    expect(view.courses).toHaveLength(0);
  });

  it('week：7 天全部返回（含空白天），并给出冲突与可切换学期', async () => {
    const view = await ctx.service.week(USER);
    expect(view.days).toHaveLength(7);
    expect(view.days[0]?.isToday).toBe(true);
    expect(view.totalCount).toBe(2);
    expect(view.terms).toContain('2026-2027-1');
  });

  it('create：节次非法（start > end）直接拒绝，不写库', async () => {
    await expect(
      ctx.service.create({ userId: USER, term: '2026-2027-1', courseName: 'x', weekday: 1, startSlot: 5, endSlot: 3 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(ctx.repo.create).not.toHaveBeenCalled();
  });

  it('sync：未绑定 JWC → CAMPUS_BINDING_REQUIRED（客户端据此展示"去绑定"）', async () => {
    const unbound = build({ session: null });
    await expect(unbound.service.syncFromCampus(USER)).rejects.toBeInstanceOf(CampusBindingRequiredError);
    expect(unbound.repo.replaceTerm).not.toHaveBeenCalled();
  });

  it('sync：整体替换本地课表，并丢掉节次非法的脏数据', async () => {
    const withDirty = build({
      courses: [
        { courseName: '数据结构', teacher: '陆明', location: '信息楼 305', weekday: 1, startSlot: 1, endSlot: 2, weeks: '1-16 周' },
        { courseName: '脏数据', teacher: null, location: null, weekday: 1, startSlot: 99, endSlot: 100, weeks: null },
      ],
    });

    const result = await withDirty.service.syncFromCampus(USER);

    expect(result.imported).toBe(1);
    expect(result.simulated).toBe(true);
    const replaced = withDirty.repo.replaceTerm.mock.calls[0]?.[2] as { courseName: string }[];
    expect(replaced.map((item) => item.courseName)).toEqual(['数据结构']);
  });

  it('sync：上游失败时**不清空**本地课表（用户至少还能看到上次的课表）', async () => {
    const failing = build({ fetchError: new Error('上游 502') });
    await expect(failing.service.syncFromCampus(USER)).rejects.toThrow('上游 502');
    expect(failing.repo.replaceTerm).not.toHaveBeenCalled();
  });

  it('nextClass：给 agent / 小组件用的精简视图', async () => {
    const result = await ctx.service.nextClass(USER);
    expect(result.next?.courseName).toBe('线性代数');
    expect(result.minutesUntilNext).toBe(65);
    expect(result.todayLabel).toContain('第一学期');
  });
});
