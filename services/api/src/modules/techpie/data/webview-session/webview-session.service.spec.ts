import { describe, expect, it, vi } from 'vitest';
import {
  CampusBindingRequiredError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from '../../../../common/errors/app-error';
import type {
  CampusBindingSummary,
  CampusSessionPort,
} from '../../domain/ports/campus-session.port';
import { WebviewTicketStore } from './ticket.store';
import {
  DisabledCookieDelivery,
  WebviewSessionService,
  WEBVIEW_SESSION_RATE_LIMIT,
  type CookieDeliveryPort,
} from './webview-session.service';

/**
 * 契约 §11.4 I3 + 规格 §8.4 + 裁决 §11.18-B / §11.10-F
 *
 * 这组测试要证明的核心命题是**否定性**的：
 *   Phase 0 下没有任何客户端能通过 HTTP 拿到校园 cookie。
 */

const TARGET = 'https://ecourse.shanghaitech.edu.cn/';

function binding(platform: 'ecard' | 'cpdaily' = 'cpdaily'): CampusBindingSummary {
  return {
    id: 'link-1',
    platform,
    status: 'LINKED',
    externalUserId: null,
    expiresAt: null,
    lastSyncAt: null,
    phase: platform === 'ecard' ? 'phase0' : 'phase1',
  };
}

function makeCampusSession(bindings: CampusBindingSummary[] = []): CampusSessionPort {
  return {
    listBindings: vi.fn().mockResolvedValue(bindings),
    getBinding: vi
      .fn()
      .mockImplementation(async (_userId: string, platform: string) =>
        bindings.find((item) => item.platform === platform) ?? null,
      ),
    bind: vi.fn(),
    unbind: vi.fn(),
    renew: vi.fn(),
    cookieHeaderFor: vi.fn().mockResolvedValue('CASTGC=should-never-be-read-in-phase-0'),
  } as unknown as CampusSessionPort;
}

function build(options: { bindings?: CampusBindingSummary[]; delivery?: CookieDeliveryPort } = {}) {
  const campusSession = makeCampusSession(options.bindings ?? []);
  const tickets = new WebviewTicketStore();
  const delivery = options.delivery ?? new DisabledCookieDelivery();
  const service = new WebviewSessionService(campusSession, tickets, delivery);
  return { service, campusSession, tickets, delivery };
}

describe('webview-session · 一次性票据（规格 §8.4）', () => {
  it('白名单内的地址签发一次性票据：30 秒、singleUse、绑定 host', async () => {
    const { service, tickets } = build({ bindings: [binding()] });

    const result = await service.issue('user-1', { platform: 'cpdaily', targetUrl: TARGET });

    expect(result.ticket.startsWith('wvt_')).toBe(true);
    expect(result.expiresInSec).toBe(30);
    expect(result.singleUse).toBe(true);
    expect(result.targetUrl).toBe(TARGET);
    expect(result.targetHost).toBe('ecourse.shanghaitech.edu.cn');
    // OpenAPI 形状的别名也给了
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
    expect(tickets.size()).toBe(1);
  });

  it('票据**不含 cookie** —— 它是引用，不是凭证（客户端从未拿到 cookie）', async () => {
    const { service } = build({ bindings: [binding()] });
    const result = await service.issue('user-1', { platform: 'cpdaily', targetUrl: TARGET });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/CASTGC|JSESSIONID|EGATE=/i);
    expect(serialized).not.toMatch(/cookie/i);
  });

  /* ---------------- 白名单：fail-closed ---------------- */

  it('非白名单域名 → 403 FORBIDDEN（P0-7）', async () => {
    const { service } = build();
    await expect(
      service.issue('user-1', { platform: 'cpdaily', targetUrl: 'https://evil.com/' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('403 的 details 里带机器可读的 reason / check（规格 §8.4）', async () => {
    const { service } = build();
    await expect(
      service.issue('user-1', { platform: 'cpdaily', targetUrl: 'https://evil.com/' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
      details: { reason: 'TARGET_URL_NOT_ALLOWED', check: 'NOT_ALLOWLISTED' },
    });
  });

  it('http 明文 → 422 VALIDATION_FAILED（规格 §8.4 的校验表）', async () => {
    const { service } = build();
    await expect(
      service.issue('user-1', { platform: 'cpdaily', targetUrl: 'http://ecourse.shanghaitech.edu.cn/' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
  });

  it.each([
    ['userinfo 绕过', 'https://shanghaitech.edu.cn@evil.com/'],
    ['非 443 端口', 'https://ecourse.shanghaitech.edu.cn:8443/'],
    ['IP 字面量', 'https://127.0.0.1/'],
    ['后缀通配绕过', 'https://ecourse.shanghaitech.edu.cn.evil.com/'],
  ])('服务端独立再校验一次（不信任客户端）：%s', async (_label, url) => {
    const { service } = build();
    await expect(service.issue('user-1', { platform: 'cpdaily', targetUrl: url })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('校验在**服务端**做：客户端传什么都会被重新判一遍（同一 URL 两次结果一致）', async () => {
    const { service } = build();
    const good = await service.issue('user-1', { targetUrl: TARGET });
    expect(good.targetHost).toBe('ecourse.shanghaitech.edu.cn');
    await expect(service.issue('user-1', { targetUrl: 'https://evil.com/' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  /* ---------------- 绑定门（I4：409 而不是 401） ---------------- */

  it('指定了平台但未绑定 → 409 CAMPUS_BINDING_REQUIRED（**不是** 401）', async () => {
    const { service } = build({ bindings: [] });
    await expect(
      service.issue('user-1', { platform: 'cpdaily', targetUrl: TARGET }),
    ).rejects.toMatchObject({ code: 'CAMPUS_BINDING_REQUIRED', status: 409 });
  });

  it('绑定存在但已过期 → 同样是 409（引导重绑，不是登出）', async () => {
    const { service } = build({ bindings: [{ ...binding(), status: 'EXPIRED' }] });
    await expect(
      service.issue('user-1', { platform: 'cpdaily', targetUrl: TARGET }),
    ).rejects.toBeInstanceOf(CampusBindingRequiredError);
  });

  it('已绑定 → 放行', async () => {
    const { service } = build({ bindings: [binding()] });
    await expect(service.issue('user-1', { platform: 'cpdaily', targetUrl: TARGET })).resolves.toBeDefined();
  });

  it('不指定平台（W4 公开入口，如课程录播）→ 不要求绑定', async () => {
    const { service } = build({ bindings: [] });
    const result = await service.issue('user-1', { targetUrl: 'https://elrc.shanghaitech.edu.cn/' });
    expect(result.ticket).toBeTruthy();
  });

  /* ---------------- 三端形状的并集 ---------------- */

  it('接受冻结 OpenAPI 的 `linkId` 写法（反查该绑定的平台，且必须是自己）', async () => {
    const { service } = build({ bindings: [binding()] });
    const result = await service.issue('user-1', { linkId: 'link-1', targetUrl: TARGET });
    expect(result.ticket).toBeTruthy();
  });

  it('linkId 不是本人的 → 404（不泄漏"这个 id 存在"）', async () => {
    const { service } = build({ bindings: [binding()] });
    await expect(service.issue('user-1', { linkId: 'someone-else', targetUrl: TARGET })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('未知平台 → 422（不是 500，也不是静默放行）', async () => {
    const { service } = build();
    await expect(
      service.issue('user-1', { platform: 'gradescope', targetUrl: TARGET }),
    ).rejects.toBeInstanceOf(ValidationError);
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

describe('webview-session · 票据兑换（规格 §8.4 的「换取方式」行）', () => {
  it('Phase 0 返回 `mode: "direct"`（W4：用户自登录，我们不接触 cookie）', async () => {
    const { service } = build({ bindings: [binding()] });
    const { ticket } = await service.issue('user-1', { platform: 'cpdaily', targetUrl: TARGET });

    const launch = await service.redeem('user-1', ticket);

    expect(launch).toEqual({
      url: TARGET,
      targetUrl: TARGET,
      mode: 'direct',
      expiresAt: null,
      cookieInjected: false,
      reason: 'W4_PHASE_0',
    });
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
    const { ticket } = await service.issue('user-1', { platform: 'cpdaily', targetUrl: TARGET });

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
      expiresAt: null,
      cookieInjected: true,
      reason: 'COOKIE_INJECTED' as const,
    }));
    const delivery: CookieDeliveryPort = { enabled: true, deliver };

    const { service, campusSession } = build({ bindings: [binding()], delivery });
    const { ticket } = await service.issue('user-1', { platform: 'cpdaily', targetUrl: TARGET });

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
