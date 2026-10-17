/**
 * TechPie application 层测试（用例编排 + 视图模型，全部纯逻辑，node 环境）。
 *
 * 重点覆盖交付要求里点名的事项：
 * - `CAMPUS_BINDING_REQUIRED` **显示为引导**（`needsBinding` + 去绑定链接 + 非错误语气）；
 * - Phase 0 凭证闸门（明文密码 / 非 Phase 0 平台在发请求前被拒绝）；
 * - F3：续期不支持时**不谎称成功**；
 * - 付款码持有者不泄漏码值（`toJSON` 只给状态）。
 */
import type { ApiError, Page } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';
import { describe, expect, it } from 'vitest';

import {
  PaymentCodeHolder,
  campusCardBindingGuidance,
  campusCardState,
  toCampusCardVM,
  toPaymentCodeVM,
  toTransactionListVM,
  toTransactionVM,
} from '@/application/techpie/campusCard';
import {
  bindablePlatforms,
  bindCampusPlatform,
  formatLocalDateTime,
  loadTechpieLinks,
  renewFailureMessage,
  techpieLinkListState,
  toTechpieLinkListVM,
  toTechpieLinkVM,
} from '@/application/techpie/listTechpieLinks';
import {
  capabilityListState,
  deriveCapabilityGroups,
  loadCapabilities,
  toCapabilityListVM,
  toCapabilityVM,
  webviewTargetFor,
} from '@/application/techpie/capabilities';
import type {
  CampusBindingSummary,
  CampusCard,
  CardTransaction,
  PaymentCode,
  TechpieCapability,
} from '@/domain/models/techpie';
import type { CampusCardRepository, TechpieRepository } from '@/domain/ports/techpie';

const NOW = new Date('2026-10-17T10:00:00.000Z');

function makeLink(overrides: Partial<CampusBindingSummary> = {}): CampusBindingSummary {
  return {
    id: 'lk-1',
    platform: 'ecard',
    status: 'LINKED',
    externalUserId: '2023XXXXXX',
    expiresAt: null,
    lastSyncAt: '2026-10-17T02:00:00.000Z',
    ...overrides,
  };
}

function makeCapability(overrides: Partial<TechpieCapability> = {}): TechpieCapability {
  return {
    id: 'ecard.balance',
    moduleId: 'campus-card',
    nameZh: '校园卡余额',
    summary: '一卡通余额。',
    phase: 'phase0',
    access: 'openid',
    platform: 'ecard',
    targetUrl: null,
    status: 'CAMPUS_BINDING_REQUIRED',
    guidance: null,
    ...overrides,
  };
}

/** 只实现测试用得到的方法的假仓储（调用即抛，防止意外调用） */
function fakeTechpieRepository(overrides: Partial<TechpieRepository> = {}): TechpieRepository {
  const notImplemented = (): never => {
    throw new Error('该端口方法不应在本次测试中被调用');
  };
  return {
    listLinks: async () => notImplemented(),
    getLink: async () => notImplemented(),
    createLink: async () => notImplemented(),
    deleteLink: async () => notImplemented(),
    renewLink: async () => notImplemented(),
    listCapabilities: async () => notImplemented(),
    createWebviewSession: async () => notImplemented(),
    redeemWebviewTicket: async () => notImplemented(),
    ...overrides,
  };
}

describe('绑定列表视图模型', () => {
  it('LINKED 状态无 notice，展示平台名与通道', () => {
    const vm = toTechpieLinkVM(makeLink(), { now: NOW });
    expect(vm.statusLabel).toBe('已绑定');
    expect(vm.statusTone).toBe('success');
    expect(vm.notice).toBeNull();
    expect(vm.platformLabel).toBe('校园一卡通');
    expect(vm.openIdChannel).toBe(true);
    expect(vm.canUnbind).toBe(true);
    expect(vm.canRenew).toBe(true);
  });

  it('EXPIRED 状态给出"登录不受影响"的说明（状态不静默消失）', () => {
    const vm = toTechpieLinkVM(makeLink({ platform: 'cpdaily', status: 'EXPIRED' }), { now: NOW });
    expect(vm.statusLabel).toBe('已过期');
    expect(vm.statusTone).toBe('warning');
    expect(vm.notice).toContain('登录状态不受影响');
    expect(vm.openIdChannel).toBe(false);
  });

  it('LINKING 状态明确告知"授权在学校侧完成"', () => {
    const vm = toTechpieLinkVM(makeLink({ status: 'LINKING' }), { now: NOW });
    expect(vm.notice).toContain('等待校园系统侧的授权确认');
  });

  it('时间展示是确定性的本地格式', () => {
    expect(formatLocalDateTime('2026-10-24T06:00:00.000Z')).toBe('10月24日 14:00');
    expect(formatLocalDateTime('not-a-date')).toBe('时间未知');
  });

  it('列表 VM 汇总已绑定平台（供能力清单判断"要不要引导去绑定"）', () => {
    const page: Page<CampusBindingSummary> = {
      items: [makeLink(), makeLink({ id: 'lk-2', platform: 'cpdaily', status: 'EXPIRED' })],
      nextCursor: null,
      total: 2,
    };
    const vm = toTechpieLinkListVM(page, { now: NOW });
    expect(vm.linkedPlatforms).toEqual(['ecard']);
    expect(vm.isEmpty).toBe(false);
    expect(vm.state).toBe('ready');
  });

  it('四态判定：loading > error > empty > ready', () => {
    expect(techpieLinkListState({ isPending: true, isError: true, itemCount: 3 })).toBe('loading');
    expect(techpieLinkListState({ isPending: false, isError: true, itemCount: 3 })).toBe('error');
    expect(techpieLinkListState({ isPending: false, isError: false, itemCount: 0 })).toBe('empty');
    expect(techpieLinkListState({ isPending: false, isError: false, itemCount: 1 })).toBe('ready');
  });

  it('loadTechpieLinks 透传仓储错误', async () => {
    const repo = fakeTechpieRepository({
      listLinks: async () => err({ code: 'UNAUTHENTICATED', message: '请先登录' }),
    });
    const result = await loadTechpieLinks(repo, {}, { now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('Phase 0 凭证闸门（契约 §11.18-D / E）', () => {
  it('明文密码：拒绝且**不调用仓储**', async () => {
    let called = false;
    const repo = fakeTechpieRepository({
      createLink: async () => {
        called = true;
        return ok(makeLink());
      },
    });
    const result = await bindCampusPlatform(repo, {
      platform: 'cpdaily',
      credential: { kind: 'password', studentId: '2023XXXXXX', password: 'hunter2' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORBIDDEN');
    expect(result.error.message).toContain('明文密码');
    expect(called).toBe(false);
  });

  it('非 Phase 0 平台（openid 凭证）也被拒绝', async () => {
    let called = false;
    const repo = fakeTechpieRepository({
      createLink: async () => {
        called = true;
        return ok(makeLink());
      },
    });
    const result = await bindCampusPlatform(repo, {
      platform: 'egate',
      credential: { kind: 'openid', channel: 'wechat' },
    });
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('校园卡 OPENID：放行，并给出"下一步在学校/微信侧完成授权"的引导', async () => {
    const repo = fakeTechpieRepository({
      createLink: async () => ok(makeLink({ status: 'LINKING' })),
    });
    const result = await bindCampusPlatform(repo, {
      platform: 'ecard',
      credential: { kind: 'openid', channel: 'wechat' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextStep).toContain('OPENID');
    expect(result.value.nextStep).toContain('不接触你的登录凭证');
  });

  it('bindablePlatforms：Phase 0 只有校园卡可发起，其余给出阻塞原因', () => {
    const platforms = bindablePlatforms([makeLink({ platform: 'cpdaily', status: 'EXPIRED' })]);
    const ecard = platforms.find((item) => item.platform === 'ecard');
    const cpdaily = platforms.find((item) => item.platform === 'cpdaily');
    const egate = platforms.find((item) => item.platform === 'egate');

    expect(ecard?.available).toBe(true);
    expect(ecard?.blockedReason).toBeNull();
    expect(cpdaily?.available).toBe(false);
    expect(cpdaily?.blockedReason).toContain('信息办');
    expect(egate?.available).toBe(false);
  });

  it('已绑定的平台不再可发起（要先解绑）', () => {
    const platforms = bindablePlatforms([makeLink({ platform: 'ecard', status: 'LINKED' })]);
    const ecard = platforms.find((item) => item.platform === 'ecard');
    expect(ecard?.available).toBe(false);
    expect(ecard?.blockedReason).toContain('已绑定');
  });
});

describe('续期失败必须诚实（F3）', () => {
  it('RENEW_NOT_SUPPORTED → 明确说明"不会假装续期成功"', () => {
    const error: ApiError = {
      code: 'CONFLICT',
      message: '续期失败',
      details: { reason: 'RENEW_NOT_SUPPORTED' },
    };
    const message = renewFailureMessage(error);
    expect(message).toContain('不会假装续期成功');
    expect(message).toContain('保持原样');
  });

  it('其它错误原样透传 message', () => {
    expect(renewFailureMessage({ code: 'NOT_FOUND', message: '绑定不存在' })).toBe('绑定不存在');
  });
});

describe('能力清单：CAMPUS_BINDING_REQUIRED 是引导而不是错误', () => {
  const capability: TechpieCapability = makeCapability();

  it('分组时进入 needsBinding，而不是 blocked', () => {
    const vm = toCapabilityVM(capability);
    const groups = deriveCapabilityGroups([vm]);
    expect(groups.needsBinding.map((item) => item.id)).toEqual(['ecard.balance']);
    expect(groups.blocked).toEqual([]);
    expect(groups.available).toEqual([]);
  });

  it('视图模型给出"去绑定"链接与引导文案，且语气不是错误', () => {
    const vm = toCapabilityVM(capability);
    expect(vm.needsBinding).toBe(true);
    expect(vm.bindHref).toBe('/techpie');
    expect(vm.guidance.length).toBeGreaterThan(0);
    expect(vm.guidance).not.toContain('失败');
    // 徽章用 info（引导）而不是 danger（错误）
    expect(vm.statusTone).toBe('info');
    expect(vm.usable).toBe(false);
  });

  it('EXPIRED 同样进入 needsBinding（重新绑定引导）', () => {
    const vm = toCapabilityVM(makeCapability({ status: 'EXPIRED' }));
    const groups = deriveCapabilityGroups([vm]);
    expect(groups.needsBinding.map((item) => item.id)).toEqual(['ecard.balance']);
    expect(vm.statusTone).toBe('warning');
  });

  it('PHASE_BLOCKED 进入 blocked，且给出信息办原因、没有绑定入口', () => {
    const vm = toCapabilityVM(
      makeCapability({ phase: 'phase1', status: 'PHASE_BLOCKED', platform: 'cpdaily' }),
    );
    const groups = deriveCapabilityGroups([vm]);
    expect(groups.blocked.map((item) => item.id)).toEqual(['ecard.balance']);
    expect(vm.bindHref).toBeNull();
    expect(vm.guidance).toContain('信息办');
    expect(vm.statusTone).toBe('neutral');
  });

  it('AVAILABLE 的校园卡能力给站内入口，WebView 能力给 WebView 入口', () => {
    const card = toCapabilityVM(makeCapability({ status: 'AVAILABLE' }));
    const webview = toCapabilityVM(
      makeCapability({
        id: 'webview.ecourse',
        moduleId: 'techpie',
        access: 'webview',
        platform: null,
        targetUrl: 'https://ecourse.shanghaitech.edu.cn/',
        status: 'AVAILABLE',
      }),
    );
    expect(card.entryHref).toBe('/campus-card');
    expect(webview.entryHref).toBe('/techpie/webview');
    expect(webview.usable).toBe(true);
  });

  it('模块中文名来自冻结模块注册表', () => {
    expect(toCapabilityVM(makeCapability()).moduleLabel).toBe('校园卡');
  });

  it('loadCapabilities 组装 VM 并保留白名单占位标记', async () => {
    const repo = fakeTechpieRepository({
      listCapabilities: async () =>
        ok({ items: [capability], allowlistPlaceholder: true }),
    });
    const result = await loadCapabilities(repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.allowlistPlaceholder).toBe(true);
    expect(result.value.items).toHaveLength(1);
  });

  it('toCapabilityListVM 的空态判定', () => {
    const vm = toCapabilityListVM({ items: [], allowlistPlaceholder: false });
    expect(vm.isEmpty).toBe(true);
    expect(vm.state).toBe('empty');
  });

  it('capabilityListState 四态', () => {
    expect(capabilityListState({ isPending: true, isError: false, itemCount: 0 })).toBe('loading');
    expect(capabilityListState({ isPending: false, isError: true, itemCount: 0 })).toBe('error');
    expect(capabilityListState({ isPending: false, isError: false, itemCount: 0 })).toBe('empty');
    expect(capabilityListState({ isPending: false, isError: false, itemCount: 2 })).toBe('ready');
  });
});

describe('WebView 目标只能来自服务端清单（§11.18-B）', () => {
  const capabilities: TechpieCapability[] = [
    makeCapability({
      id: 'webview.ecourse',
      access: 'webview',
      platform: null,
      targetUrl: 'https://ecourse.shanghaitech.edu.cn/',
      status: 'AVAILABLE',
    }),
    makeCapability({ id: 'ecard.balance', access: 'openid' }),
    makeCapability({
      id: 'webview.null',
      access: 'webview',
      platform: null,
      targetUrl: null,
      status: 'AVAILABLE',
    }),
  ];

  it('按 id 取出服务端下发的目标', () => {
    expect(webviewTargetFor(capabilities, 'webview.ecourse')?.targetUrl).toBe(
      'https://ecourse.shanghaitech.edu.cn/',
    );
  });

  it('未知 id / 非 webview / 无地址一律返回 null（没有"自己拼一个"的入口）', () => {
    expect(webviewTargetFor(capabilities, 'nope')).toBeNull();
    expect(webviewTargetFor(capabilities, 'ecard.balance')).toBeNull();
    expect(webviewTargetFor(capabilities, 'webview.null')).toBeNull();
  });
});

describe('校园卡视图模型与状态', () => {
  const card: CampusCard = {
    cardNoMasked: '****1024',
    balanceFen: 5830,
    status: 'ACTIVE',
    syncedAt: '2026-10-17T09:59:00.000Z',
  };

  it('余额以元展示（分只在展示层转元）', () => {
    expect(toCampusCardVM(card, { now: NOW }).balanceLabel).toBe('¥58.30');
  });

  it('卡状态异常时给出显式说明', () => {
    expect(toCampusCardVM({ ...card, status: 'FROZEN' }, { now: NOW }).notice).toContain('冻结');
    expect(toCampusCardVM({ ...card, status: 'LOST' }, { now: NOW }).notice).toContain('挂失');
  });

  it('CAMPUS_BINDING_REQUIRED 映射为 binding_required（不是 error）', () => {
    expect(
      campusCardState({
        isPending: false,
        isError: true,
        errorCode: 'CAMPUS_BINDING_REQUIRED',
      }),
    ).toBe('binding_required');
    expect(campusCardState({ isPending: false, isError: true, errorCode: 'INTERNAL' })).toBe('error');
    expect(campusCardState({ isPending: true, isError: false })).toBe('loading');
  });

  it('绑定引导文案说明"绑定是可选的一步"', () => {
    expect(campusCardBindingGuidance()).toContain('可选');
  });

  it('流水金额带符号，支出用负号', () => {
    const tx: CardTransaction = {
      id: 'tx-1',
      occurredAt: '2026-10-17T08:00:00.000Z',
      amountFen: -1250,
      merchant: '一食堂二楼',
      kind: 'meal',
    };
    const vm = toTransactionVM(tx, { now: NOW });
    expect(vm.amountLabel).toBe('-12.50');
    expect(vm.isExpense).toBe(true);
    expect(vm.kindLabel).toBe('餐饮');

    const list = toTransactionListVM(
      { items: [{ ...tx, id: 'tx-2', amountFen: 20000, kind: 'recharge' }], nextCursor: null },
      { now: NOW },
    );
    expect(list.items[0]?.amountLabel).toBe('+200.00');
    expect(list.state).toBe('ready');
  });
});

describe('付款码持有者（凭证不泄漏）', () => {
  const code: PaymentCode = {
    payload: 'KEDAYA-ECARD-000001-1760000000000',
    issuedAt: '2026-10-17T10:00:00.000Z',
    expiresAt: '2026-10-17T10:01:00.000Z',
    ttlSec: 60,
  };

  it('issue → peek 拿到码值，consume 只能取一次', () => {
    const holder = new PaymentCodeHolder();
    expect(holder.state).toBe('empty');
    expect(holder.peek()).toBeNull();

    holder.issue(code);
    expect(holder.state).toBe('issued');
    expect(holder.peek()).toBe(code.payload);
    expect(holder.consume()).toBe(code.payload);
    expect(holder.consume()).toBeNull();
    expect(holder.state).toBe('consumed');
  });

  it('toJSON 只暴露状态与到期时刻，**不含码值**', () => {
    const holder = new PaymentCodeHolder();
    holder.issue(code);
    const serialized = JSON.stringify(holder);
    expect(serialized).not.toContain(code.payload);
    expect(JSON.parse(serialized)).toEqual({ state: 'issued', expiresAt: code.expiresAt });
  });

  it('clear 之后码值不可再读', () => {
    const holder = new PaymentCodeHolder();
    holder.issue(code);
    holder.clear();
    expect(holder.peek()).toBeNull();
    expect(holder.consume()).toBeNull();
    expect(holder.state).toBe('empty');
  });

  it('付款码 VM：剩余秒数与过期判定', () => {
    const vm = toPaymentCodeVM(code, { now: NOW });
    expect(vm.remainingSec).toBe(60);
    expect(vm.expired).toBe(false);
    expect(vm.expiresLabel).toBe('60 秒后失效');

    const later = toPaymentCodeVM(code, { now: new Date(NOW.getTime() + 61_000) });
    expect(later.expired).toBe(true);
    expect(later.remainingSec).toBe(0);
  });
});

describe('校园卡端口类型可用性（编译期 + 运行时烟测）', () => {
  it('CampusCardRepository 的形状可被实现（防止端口漂移）', () => {
    const repo: CampusCardRepository = {
      getCard: async () => err({ code: 'NOT_FOUND', message: 'x' }),
      listTransactions: async () =>
        ok({ items: [], nextCursor: null }) as Result<Page<CardTransaction>, ApiError>,
      issuePaymentCode: async () => err({ code: 'NOT_FOUND', message: 'x' }),
      revokePaymentCode: async () => ok({ revoked: true }),
    };
    expect(typeof repo.getCard).toBe('function');
  });
});
