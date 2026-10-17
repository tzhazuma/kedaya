import { describe, expect, it, vi } from 'vitest';
import {
  CampusBindingRequiredError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from '../../../../common/errors/app-error';
import type { CampusBindingState, CampusSessionPort } from '../../domain/ports/campus-session.port';
import { WebviewTicketStore } from './ticket.store';
import {
  DisabledCookieDelivery,
  WebviewSessionService,
  WEBVIEW_SESSION_RATE_LIMIT,
  type CookieDeliveryPort,
} from './webview-session.service';

/**
 * 契约 §11.4 I3 + 规格 §8.4 + 裁决 §11.18-B / §11.21-A / §11.20-E / §11.22-C / §11.10-F
 *
 * 这组测试要证明的核心命题是**否定性**的：
 *   Phase 0 下没有任何客户端能通过 HTTP 拿到校园 cookie。
 *
 * 以及本轮收敛的三条**形状**要求：
 *   · 入参只收 `{linkId, targetUrl}`（§11.20-E：删掉 `platform` / `provider` 兼容）；
 *   · 出参只保留 `{ticket, targetUrl, expiresAt, singleUse}`（删掉 `expiresInSec` / `targetHost`）；
 *   · 兑换端形状 `{url, targetUrl, mode:'direct', cookieInjected:false, reason:'W4_PHASE_0'}`（§11.22-C）。
 */

const TARGET = 'https://ecourse.shanghaitech.edu.cn/';
const LINK_ID = 'link-1';

function binding(provider: 'ecard' | 'cpdaily' = 'cpdaily'): CampusBindingState {
  return {
    id: LINK_ID,
    provider,
    status: 'ACTIVE',
    externalUserId: null,
    expiresAt: null,
    lastSyncAt: null,
    phase: provider === 'ecard' ? 'phase0' : 'phase1',
  };
}

function makeCampusSession(bindings: CampusBindingState[] = []): CampusSessionPort {
  return {
    listBindings: vi.fn().mockResolvedValue(bindings),
    getBinding: vi
      .fn()
      .mockImplementation(async (_userId: string, provider: string) =>
        bindings.find((item) => item.provider === provider) ?? null,
      ),
    bind: vi.fn(),
    unbind: vi.fn(),
    renew: vi.fn(),
    cookieHeaderFor: vi.fn().mockResolvedValue('CASTGC=should-never-be-read-in-phase-0'),
  } as unknown as CampusSessionPort;
}

function build(options: { bindings?: CampusBindingState[]; delivery?: CookieDeliveryPort } = {}) {
  const campusSession = makeCampusSession(options.bindings ?? []);
  const tickets = new WebviewTicketStore();
  const delivery = options.delivery ?? new DisabledCookieDelivery();
  const service = new WebviewSessionService(campusSession, tickets, delivery);
  return { service, campusSession, tickets, delivery };
}

describe('webview-session · 一次性票据（规格 §8.4 / §11.20-E）', () => {
  it('白名单内的地址签发一次性票据：30 秒、singleUse，且**只有四个键**', async () => {
    const { service, tickets } = build({ bindings: [binding()] });

    const result = await service.issue('user-1', { linkId: LINK_ID, targetUrl: TARGET });

    expect(result.ticket.startsWith('wvt_')).toBe(true);
    expect(result.singleUse).toBe(true);
    expect(result.targetUrl).toBe(TARGET);
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
    // §11.20-E：**只保留**这四个键 —— `expiresInSec` / `targetHost` 已删除
    expect(Object.keys(result).sort()).toEqual(['expiresAt', 'singleUse', 'targetUrl', 'ticket']);
    expect(tickets.size()).toBe(1);
  });

  it('票据**不含 cookie** —— 它是引用，不是凭证（客户端从未拿到 cookie）', async () => {
    const { service } = build({ bindings: [binding()] });
    const result = await service.issue('user-1', { linkId: LINK_ID, targetUrl: TARGET });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/CASTGC|JSESSIONID|EGATE=/i);
    expect(serialized).not.toMatch(/cookie/i);
  });

  /* ---------------- 白名单：fail-closed（§11.18-B + §11.21-A） ---------------- */

  it('非白名单 origin → 403 FORBIDDEN（P0-7）', async () => {
    const { service } = build();
    await expect(
      service.issue('user-1', { targetUrl: 'https://evil.com/' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('403 的 details 里带机器可读的 reason / check（规格 §8.4）', async () => {
    const { service } = build();
    await expect(service.issue('user-1', { targetUrl: 'https://evil.com/' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
      details: { reason: 'TARGET_URL_NOT_ALLOWED', check: 'NOT_ALLOWLISTED' },
    });
  });

  it('http 明文 → 422 VALIDATION_FAILED（规格 §8.4 的校验表）', async () => {
    const { service } = build();
    await expect(
      service.issue('user-1', { targetUrl: 'http://ecourse.shanghaitech.edu.cn/' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
  });

  it.each([
    ['userinfo 绕过', 'https://shanghaitech.edu.cn@evil.com/'],
    ['未登记的端口（origin 不同）', 'https://ecourse.shanghaitech.edu.cn:8443/'],
    ['IP 字面量', 'https://127.0.0.1/'],
    ['后缀通配绕过', 'https://ecourse.shanghaitech.edu.cn.evil.com/'],
  ])('服务端独立再校验一次（不信任客户端）：%s', async (_label, url) => {
    const { service } = build();
    await expect(service.issue('user-1', { targetUrl: url })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('§11.21-A：白名单里登记的 `:8080` origin **通过**（旧规则会误杀它）', async () => {
    const { service } = build();
    const result = await service.issue('user-1', {
      targetUrl: 'https://ecourse.shanghaitech.edu.cn:8080/',
    });
    expect(result.ticket).toBeTruthy();
  });

  it('校验在**服务端**做：客户端传什么都会被重新判一遍', async () => {
    const { service } = build();
    const good = await service.issue('user-1', { targetUrl: TARGET });
    expect(good.ticket).toBeTruthy();
    await expect(service.issue('user-1', { targetUrl: 'https://evil.com/' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  /* ---------------- 绑定门（I4：409 而不是 401） ---------------- */

  it('指定了 `linkId` 但该绑定不存在 → 404（不泄漏"这个 id 存在"）', async () => {
    const { service } = build({ bindings: [] });
    await expect(
      service.issue('user-1', { linkId: LINK_ID, targetUrl: TARGET }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('绑定存在但不是 ACTIVE（EXPIRED）→ 409 CAMPUS_BINDING_REQUIRED（**不是** 401）', async () => {
    const { service } = build({ bindings: [{ ...binding(), status: 'EXPIRED' }] });
    await expect(
      service.issue('user-1', { linkId: LINK_ID, targetUrl: TARGET }),
    ).rejects.toMatchObject({ code: 'CAMPUS_BINDING_REQUIRED', status: 409 });
    await expect(
      service.issue('user-1', { linkId: LINK_ID, targetUrl: TARGET }),
    ).rejects.toBeInstanceOf(CampusBindingRequiredError);
  });

  it('已绑定（ACTIVE）→ 放行', async () => {
    const { service } = build({ bindings: [binding()] });
    await expect(
      service.issue('user-1', { linkId: LINK_ID, targetUrl: TARGET }),
    ).resolves.toBeDefined();
  });

  it('不给 `linkId`（W4 直连）→ **不要求绑定**（§11.21-D：不给出入加权限门）', async () => {
    const { service } = build({ bindings: [] });
    const result = await service.issue('user-1', { targetUrl: 'https://elrc.shanghaitech.edu.cn/' });
    expect(result.ticket).toBeTruthy();
  });

  it('`linkId` 非空字符串之外的取值 → 422（不是 500，也不是静默放行）', async () => {
    const { service } = build();
    await expect(
      service.issue('user-1', { linkId: '   ', targetUrl: TARGET }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('§11.20-E：`platform` / `provider` 已**不是**入参（类型上就没有这两个键）', async () => {
    const { service } = build({ bindings: [binding()] });
    // 传了也不会被读 —— 因此它既不生效、也不会误判成"已绑定"
    const result = await service.issue('user-1', {
      targetUrl: TARGET,
      ...({ platform: 'cpdaily' } as Record<string, unknown>),
    } as never);
    expect(result.ticket).toBeTruthy();
  });

  /* ---------------- 限流 ---------------- */

  it(`超过 ${WEBVIEW_SESSION_RATE_LIMIT.max} 次/分钟 → 429 RATE_LIMITED`, async () => {
    const { service } = build();
    for (let i = 0; i < WEBVIEW_SESSION_RATE_LIMIT.max; i += 1) {
      await service.issue('user-1', { targetUrl: TARGET });
    }
    await expect(service.issue('user-1', { targetUrl: TARGET })).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('限流按**主体**隔离：A 被限流不影响 B', async () => {
    const { service } = build();
    for (let i = 0; i < WEBVIEW_SESSION_RATE_LIMIT.max; i += 1) {
      await service.issue('user-a', { targetUrl: TARGET });
    }
    await expect(service.issue('user-b', { targetUrl: TARGET })).resolves.toBeDefined();
  });
});

describe('webview-session · 票据兑换（§11.22-C 的正式形状）', () => {
  it('Phase 0 返回 `mode: "direct"` + `cookieInjected: false`（W4：我们不接触 cookie）', async () => {
    const { service } = build({ bindings: [binding()] });
    const { ticket } = await service.issue('user-1', { linkId: LINK_ID, targetUrl: TARGET });

    const launch = await service.redeem('user-1', ticket);

    // §11.22-D：`expiresAt` 在 direct 模式下没有值 → **整个键不出现**（不下发 null）
    expect(launch).toEqual({
      url: TARGET,
      targetUrl: TARGET,
      mode: 'direct',
      cookieInjected: false,
      reason: 'W4_PHASE_0',
    });
    expect('expiresAt' in launch).toBe(false);
  });

  it('**用后即焚**：同一票据第二次兑换 → 404', async () => {
    const { service } = build();
    const { ticket } = await service.issue('user-1', { targetUrl: TARGET });

    await expect(service.redeem('user-1', ticket)).resolves.toBeDefined();
    await expect(service.redeem('user-1', ticket)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('票据不属于调用者 → 404，且**不会**被消费掉（不区分"不存在/不是你的"）', async () => {
    const { service } = build();
    const { ticket } = await service.issue('user-1', { targetUrl: TARGET });

    await expect(service.redeem('user-2', ticket)).rejects.toBeInstanceOf(NotFoundError);
    // 本人仍然能用（因为别人的失败尝试没有把它烧掉）
    await expect(service.redeem('user-1', ticket)).resolves.toBeDefined();
  });

  it('未知票据 → 404', async () => {
    const { service } = build();
    await expect(service.redeem('user-1', 'wvt_nonexistent')).rejects.toBeInstanceOf(NotFoundError);
  });

  /* ---------------- I3 的核心断言 ---------------- */

  it('⚠️ Phase 0 下 `cookieHeaderFor` **根本不会被执行**（闸门在读取凭证之前）', async () => {
    const { service, campusSession } = build({ bindings: [binding()] });
    const { ticket } = await service.issue('user-1', { linkId: LINK_ID, targetUrl: TARGET });

    const launch = await service.redeem('user-1', ticket);

    expect(launch.cookieInjected).toBe(false);
    expect(campusSession.cookieHeaderFor).not.toHaveBeenCalled();
  });

  it('投递被禁用时若有人试图走 cookie 路径，会得到**诚实且机器可见**的拒绝理由', async () => {
    const delivery = new DisabledCookieDelivery();
    await expect(delivery.deliver()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      details: {
        reason: 'COOKIE_INJECTION_NOT_ENABLED_PHASE_0',
        blockedBy: ['U4', 'W3'],
        recommended: 'W4',
      },
    });
  });

  it('一旦投递被启用（Phase 2），`cookieHeaderFor` 就在**这一个地方**被调用', async () => {
    // 这个测试钉死 I3 的"出口是存在的、且只有一个"：
    // 启用投递后，凭证确实经由 webview-session/ 流出，而不是别处。
    const deliver = vi.fn().mockImplementation(async (_header: string) => ({
      url: TARGET,
      targetUrl: TARGET,
      mode: 'injected' as const,
      cookieInjected: true,
      reason: 'COOKIE_INJECTED' as const,
    }));
    const delivery: CookieDeliveryPort = { enabled: true, deliver };

    const { service, campusSession } = build({ bindings: [binding()], delivery });
    const { ticket } = await service.issue('user-1', { linkId: LINK_ID, targetUrl: TARGET });

    const launch = await service.redeem('user-1', ticket);

    expect(campusSession.cookieHeaderFor).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(launch.mode).toBe('injected');
  });

  it('投递被启用但没有可绑定的平台 → 409 CONFLICT（不静默返回空 cookie）', async () => {
    const delivery: CookieDeliveryPort = { enabled: true, deliver: vi.fn() };
    const { service } = build({ delivery });
    const { ticket } = await service.issue('user-1', { targetUrl: TARGET });

    await expect(service.redeem('user-1', ticket)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
