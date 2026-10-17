import { describe, expect, it, vi } from 'vitest';
import { CampusBindingRequiredError, UpstreamUnavailableError } from '../../common/errors/app-error';
import { AgentToolsService } from './agent-tools.service';
import type { CampusCardService } from '../campus-card/campus-card.service';
import type { ScheduleCourseService } from '../schedule/schedule.service';
import type { CampusIdentityService } from '../auth/campus-identity.service';
import type { ProfileSettingService } from '../profile/profile.service';
import type { CampusDataPort } from '../auth/domain/campus-data.domain';

/**
 * 工具层测试 —— agent 的**权限与降级**边界都在这里。
 *
 * 最重要的一条：未登录时**绝不**用别人的数据兜底，而是明确说"需要登录"。
 */

function build(options: {
  scheduleNext?: unknown;
  cardAccount?: unknown;
  cardError?: Error;
  identityOverview?: unknown;
  identityError?: Error;
  dataMode?: 'mock' | 'live';
} = {}) {
  const schedule = {
    nextClass: vi.fn().mockResolvedValue(
      options.scheduleNext ?? {
        next: { courseName: '线性代数', timeLabel: '10:25–11:15', location: '教学中心 201', startSlot: 3, endSlot: 4 },
        minutesUntilNext: 65,
        nextStartsAt: null,
        ongoing: [],
        todayLabel: '周一 · 2026-2027 学年 第一学期',
      },
    ),
    today: vi.fn(),
  } as unknown as ScheduleCourseService;

  const campusCard = {
    account: vi.fn().mockImplementation(async () => {
      if (options.cardError) throw options.cardError;
      return (
        options.cardAccount ?? {
          activated: true,
          balanceFen: 1500,
          updatedAt: '2026-10-17T01:30:00.000Z',
        }
      );
    }),
  } as unknown as CampusCardService;

  const identity = {
    overview: vi.fn().mockImplementation(async () => {
      if (options.identityError) throw options.identityError;
      return (
        options.identityOverview ?? {
          dataMode: 'mock',
          platforms: [
            { platform: 'EGATE', available: true, boundAt: null, expiresAt: null, expired: false, simulated: true },
            { platform: 'CARD', available: false, boundAt: null, expiresAt: null, expired: false, simulated: false },
          ],
        }
      );
    }),
    // 默认与真实行为一致：未绑定 EGATE 时 view 抛 CAMPUS_BINDING_REQUIRED
    view: vi.fn().mockRejectedValue(new CampusBindingRequiredError('未绑定', { platform: 'EGATE' })),
  } as unknown as CampusIdentityService;

  const profile = {
    listConsents: vi.fn().mockResolvedValue([
      { module: 'wellbeing', nameZh: '心理健康', summary: '', sensitivity: 'critical', gated: true, active: false, version: null, grantedAt: null, revokedAt: null },
    ]),
    me: vi.fn().mockResolvedValue({ allowAiPortrait: false, allowWellbeing: false, allowDormHarmony: false, showRealName: false }),
  } as unknown as ProfileSettingService;

  const audit = { record: vi.fn(), recordQuietly: vi.fn().mockResolvedValue(undefined), list: vi.fn() };
  const campusData: CampusDataPort = {
    mode: options.dataMode ?? 'mock',
    fetchIdentity: vi.fn(),
    fetchSchedule: vi.fn(),
    fetchCard: vi.fn(),
  };

  const service = new AgentToolsService(
    schedule,
    campusCard,
    identity,
    profile,
    audit as never,
    campusData,
  );
  return { service, schedule, campusCard, identity, audit };
}

function tool(service: AgentToolsService, name: string) {
  const found = service.tools().find((item) => item.name === name);
  if (!found) throw new Error(`工具不存在: ${name}`);
  return found;
}

describe('AgentToolsService · 关键词路由', () => {
  it('"下一节课在哪上"命中 schedule.next 而不是别的工具', () => {
    const { service } = build();
    expect(service.matchTools('下一节课在哪上')[0]?.name).toBe('schedule.next');
  });

  it('"我卡里还有多少钱"命中 card.overview', () => {
    const { service } = build();
    expect(service.matchTools('我卡里还有多少钱')[0]?.name).toBe('card.overview');
  });

  it('完全不相关的问题不命中任何工具（交给检索）', () => {
    const { service } = build();
    expect(service.matchTools('讲个笑话')).toEqual([]);
  });
});

describe('AgentToolsService · 权限边界', () => {
  it('未登录时拒答并引导登录，**不**调用下游取数', async () => {
    const { service, campusCard, schedule } = build();

    const card = await tool(service, 'card.overview').run({ userId: null });
    expect(card.facts[0]?.label).toBe('需要先登录');
    expect(campusCard.account).not.toHaveBeenCalled();

    const next = await tool(service, 'schedule.next').run({ userId: null });
    expect(next.facts[0]?.label).toBe('需要先登录');
    expect(schedule.nextClass).not.toHaveBeenCalled();
  });

  it('公共工具（账号指引）匿名也可用', async () => {
    const { service } = build();
    const result = await tool(service, 'account.guide').run({ userId: null });
    expect(result.actions?.length).toBeGreaterThan(0);
  });
});

describe('AgentToolsService · 降级', () => {
  it('未开通校园卡 → 人话 + "去开通"动作，而不是抛异常', async () => {
    const { service } = build({ cardError: new CampusBindingRequiredError('请先开通校园卡（ecard）', { provider: 'ecard' }) });
    const result = await tool(service, 'card.overview').run({ userId: 'u1' });

    expect(result.facts[0]?.value).toContain('还没有开通');
    expect(result.actions?.[0]?.path).toBe('/presentation/pages/identity/index');
  });

  it('上游不可用且无缓存 → 明确说"不会瞎猜余额"', async () => {
    const { service } = build({ cardError: new UpstreamUnavailableError('校园卡系统暂时不可用') });
    const result = await tool(service, 'card.overview').run({ userId: 'u1' });
    expect(result.facts[0]?.value).toContain('不会瞎猜');
  });

  it('没有账单记录时只说"看不到余额"，不把"读不到"说成 ¥0.00', async () => {
    const { service } = build({ cardAccount: { activated: true, balanceFen: 0 } });
    const result = await tool(service, 'card.overview').run({ userId: 'u1' });
    expect(result.facts[0]?.value).toContain('还没有你的账单记录');
    expect(result.facts[0]?.value).not.toContain('¥0.00');
  });

  it('读取高敏感数据（校园卡）会写审计', async () => {
    const { service, audit } = build();
    await tool(service, 'card.overview').run({ userId: 'u1' });
    expect(audit.recordQuietly).toHaveBeenCalledOnce();
  });

  it('模拟数据会被标注 simulated（前端据此提示"演示数据"）', async () => {
    const { service } = build();
    const result = await tool(service, 'schedule.next').run({ userId: 'u1' });
    expect(result.facts.some((fact) => fact.simulated === true)).toBe(true);
  });
});

describe('AgentToolsService · 身份工具', () => {
  it('用脱敏视图，绝不把明文实名放进回答（回答可能被截图）', async () => {
    const { service, identity } = build();
    identity.view = vi.fn().mockResolvedValue({
      platform: 'EGATE',
      masked: true,
      identity: { studentId: '2024*****', realName: '黄**', department: '信息科学与技术学院', email: null, campus: '张江' },
      simulated: true,
      dataMode: 'mock',
      fetchedAt: new Date().toISOString(),
      audited: false,
    });

    await tool(service, 'identity.view').run({ userId: 'u1' });
    expect(identity.view).toHaveBeenCalledWith('u1', false);
  });

  it('未绑定 EGATE 时不报错，而是告诉用户去绑定', async () => {
    const { service } = build({ identityError: new CampusBindingRequiredError('未绑定', { platform: 'EGATE' }) });
    const result = await tool(service, 'identity.view').run({ userId: 'u1' });
    expect(result.facts.some((fact) => fact.value.includes('绑定'))).toBe(true);
    expect(result.actions?.[0]?.path).toBe('/presentation/pages/identity/index');
  });
});
