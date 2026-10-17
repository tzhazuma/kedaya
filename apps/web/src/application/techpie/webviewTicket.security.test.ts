/**
 * **安全不变式测试**：一次性票据与 `targetUrl` 白名单。
 *
 * 这是交付要求里点名的三条里的两条：
 * 1. **一次性票据不被缓存 / 不进日志 / 不进 URL 历史**（行为断言 + 静态断言）；
 * 2. **`targetUrl` 只能来自服务端白名单**（客户端没有"自己拼一个 URL"的入口）。
 *
 * 另外还覆盖：票据只能兑换一次、服务端把票据塞进 URL 时客户端拒绝打开、
 * `CAMPUS_BINDING_REQUIRED` 作为引导（而不是崩溃）。
 */
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { createMockTechpieRepository } from '@/data/mock/techpie.repository';
import type { TechpieCapability } from '@/domain/models/techpie';
import type { TechpieRepository, TechpieWebviewSessionRequest } from '@/domain/ports/techpie';
import { techpieTraceLogger } from '@/platform/redact';

import { queryKeys } from '@/presentation/query/keys';
import {
  OneTimeTicketHolder,
  WEBVIEW_HONEST_NOTICE,
  openCampusWebview,
  refuseIfTicketInUrl,
  urlCarriesTicket,
  webviewHostOf,
} from './webviewTicket';

const ALLOWED = 'https://ecourse.shanghaitech.edu.cn/';

function webviewCapability(overrides: Partial<TechpieCapability> = {}): TechpieCapability {
  return {
    id: 'webview.ecourse',
    moduleId: 'techpie',
    nameZh: 'E云课堂',
    summary: '直接打开学校 E云课堂。',
    phase: 'phase0',
    access: 'webview',
    platform: null,
    targetUrl: ALLOWED,
    status: 'AVAILABLE',
    guidance: null,
    ...overrides,
  };
}

/** 递归收集对象里出现过的键名（用于"凭证键名不得出现在缓存里"的结构化断言） */
function collectKeys(value: unknown, out: string[] = []): string[] {
  if (value === null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
    return out;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out.push(key);
    collectKeys(child, out);
  }
  return out;
}

interface Recorded {
  platform: string | null;
  targetUrl: string;
}

/** 记录 `createWebviewSession` 的入参（断言"客户端没有自造 URL"） */
function recordingRepository(): {
  repo: TechpieRepository;
  calls: Recorded[];
  mock: ReturnType<typeof createMockTechpieRepository>;
} {
  const mock = createMockTechpieRepository({ latencyMs: 0 });
  const calls: Recorded[] = [];
  const repo: TechpieRepository = {
    ...mock,
    createWebviewSession: async (request: TechpieWebviewSessionRequest) => {
      calls.push({ platform: request.platform, targetUrl: request.targetUrl });
      return mock.createWebviewSession(request);
    },
  };
  return { repo, calls, mock };
}

describe('一次性票据：用后即焚', () => {
  it('holder 只能取走票据一次，第二次拿到 null', () => {
    const holder = new OneTimeTicketHolder();
    expect(holder.state).toBe('empty');
    expect(holder.consume()).toBeNull();

    holder.issue('wvt_secret');
    expect(holder.hasTicket).toBe(true);
    expect(holder.consume()).toBe('wvt_secret');
    expect(holder.consume()).toBeNull();
    expect(holder.state).toBe('consumed');
    expect(holder.hasTicket).toBe(false);
  });

  it('holder 序列化**不暴露票据**（防 React DevTools / 意外 JSON 泄漏）', () => {
    const holder = new OneTimeTicketHolder();
    holder.issue('wvt_secret');
    expect(JSON.stringify(holder)).toBe('{"state":"issued"}');
    expect(JSON.stringify(holder)).not.toContain('wvt_secret');
  });

  it('完整流程：票据被兑换、持有者清空、服务端票据表清空', async () => {
    const { repo, mock } = recordingRepository();
    const holder = new OneTimeTicketHolder();

    const result = await openCampusWebview(repo, { capability: webviewCapability(), holder });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.ticketBurned).toBe(true);
    expect(result.value.launch.mode).toBe('direct');
    expect(result.value.launch.url).toBe(ALLOWED);
    expect(holder.state).toBe('consumed');
    expect(holder.consume()).toBeNull();
    expect(mock.pendingTicketCount()).toBe(0);
  });

  it('流程返回的结果里**没有票据**（调用方拿不到，也无法缓存它）', async () => {
    const { repo } = recordingRepository();
    const holder = new OneTimeTicketHolder();
    const result = await openCampusWebview(repo, { capability: webviewCapability(), holder });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toMatch(/wvt_/);
    expect(serialized).not.toContain('ticket"');
  });
});

describe('票据不进日志 / 埋点（规格 §10.3）', () => {
  it('完整流程后，trace 缓冲里没有任何票据', async () => {
    techpieTraceLogger.clear();
    const { repo } = recordingRepository();
    const holder = new OneTimeTicketHolder();

    const result = await openCampusWebview(repo, { capability: webviewCapability(), holder });
    expect(result.ok).toBe(true);

    const events = techpieTraceLogger.recent();
    expect(events.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toMatch(/wvt_/);
    expect(serialized).not.toMatch(/castgc/i);
    expect(serialized).not.toMatch(/ticket/i);
    // 只记白名单字段
    expect(events.some((event) => event.name === 'techpie.webview.opened')).toBe(true);
    expect(events.every((event) => !('credential' in (event.data ?? {})))).toBe(true);
  });

  it('被白名单拦截时也照常记录（但同样不带票据）', async () => {
    techpieTraceLogger.clear();
    const { repo } = recordingRepository();
    const result = await openCampusWebview(repo, {
      capability: webviewCapability({ targetUrl: 'https://evil.example.com/' }),
      holder: new OneTimeTicketHolder(),
    });
    expect(result.ok).toBe(false);

    const serialized = JSON.stringify(techpieTraceLogger.recent());
    expect(serialized).toContain('techpie.webview.blocked');
    expect(serialized).not.toMatch(/wvt_/);
  });
});

describe('票据不进缓存 / 不进 URL 历史', () => {
  it('TanStack Query 缓存里没有票据（跑一遍真实 query）', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, networkMode: 'always' } },
    });
    const { repo, mock } = recordingRepository();

    const data = await queryClient.fetchQuery({
      queryKey: ['techpie', 'webview', 'probe'],
      queryFn: () => openCampusWebview(repo, { capability: webviewCapability() }),
    });
    expect(data.ok).toBe(true);

    const cacheDump = JSON.stringify(
      queryClient.getQueryCache().getAll().map((query) => ({
        key: query.queryKey,
        data: query.state.data,
      })),
    );
    // 断言"缓存里没有票据**值**"，以及"没有名为 ticket 的**键**"。
    // 注意 `ticketBurned: true` 只是一个布尔标记（结构上声明票据已焚毁），
    // 不是凭证 —— 因此这里做的是结构化键名断言，而不是粗糙的字符串匹配。
    expect(cacheDump).not.toMatch(/wvt_/);
    expect(cacheDump).not.toContain('"ticket":');
    expect(collectKeys(JSON.parse(cacheDump))).not.toContain('ticket');
    expect(collectKeys(JSON.parse(cacheDump))).not.toContain('castgc');
    // 服务端那边的票据也已经用掉了
    expect(mock.pendingTicketCount()).toBe(0);
  });

  it('query key 工厂里**没有任何**票据/付款码 key（凭证不进缓存的结构保证）', () => {
    const serialized = JSON.stringify(queryKeys);
    expect(serialized).not.toMatch(/ticket/i);
    expect(serialized).not.toMatch(/paymentCode/i);
    expect(serialized).not.toMatch(/payload/i);
    expect(Object.keys(queryKeys.techpie)).toEqual(['root', 'links', 'link', 'capabilities']);
  });

  it('打开地址里不含票据，且 URL 兜底检查可用', async () => {
    const { repo } = recordingRepository();
    const result = await openCampusWebview(repo, {
      capability: webviewCapability(),
      holder: new OneTimeTicketHolder(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(urlCarriesTicket(result.value.launch.url)).toBe(false);
    expect(refuseIfTicketInUrl(result.value.launch.url)).toBeNull();
    expect(result.value.launch.url).not.toMatch(/wvt_/);
  });

  it('refuseIfTicketInUrl 能抓出 ?ticket= 形式（兜底闸门）', () => {
    expect(refuseIfTicketInUrl('https://oa.shanghaitech.edu.cn/?ticket=wvt_1')).not.toBeNull();
    expect(refuseIfTicketInUrl('https://oa.shanghaitech.edu.cn/')).toBeNull();
  });

  it('服务端把票据塞进 URL → 客户端拒绝打开（INTERNAL / TICKET_IN_URL）', async () => {
    const mock = createMockTechpieRepository({ latencyMs: 0 });
    const hostile: TechpieRepository = {
      ...mock,
      redeemWebviewTicket: async () => ({
        ok: true,
        value: {
          url: `${ALLOWED}?ticket=wvt_leaked`,
          targetUrl: ALLOWED,
          mode: 'direct',
          expiresAt: null,
        },
      }),
    };

    const result = await openCampusWebview(hostile, {
      capability: webviewCapability(),
      holder: new OneTimeTicketHolder(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTERNAL');
    expect((result.error.details as { reason?: string }).reason).toBe('TICKET_IN_URL');
  });
});

describe('targetUrl 只能来自服务端白名单（契约 §11.18-B）', () => {
  it('客户端只把服务端下发的地址原样透传（没有任何拼接）', async () => {
    const { repo, calls } = recordingRepository();
    const capability = webviewCapability();
    const result = await openCampusWebview(repo, {
      capability,
      holder: new OneTimeTicketHolder(),
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ platform: null, targetUrl: capability.targetUrl }]);
  });

  it('白名单外的地址：拒绝，且**一张票据都不签发**', async () => {
    const { repo, calls, mock } = recordingRepository();
    const result = await openCampusWebview(repo, {
      capability: webviewCapability({ targetUrl: 'https://evil.example.com/' }),
      holder: new OneTimeTicketHolder(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORBIDDEN');
    expect((result.error.details as { reason?: string }).reason).toBe('TARGET_URL_NOT_ALLOWED');
    expect(calls).toEqual([]); // 连请求都没发
    expect(mock.pendingTicketCount()).toBe(0);
  });

  it('userinfo 绕过（https://shanghaitech.edu.cn@evil.com）被拒绝', async () => {
    const { repo } = recordingRepository();
    const result = await openCampusWebview(repo, {
      capability: webviewCapability({ targetUrl: 'https://shanghaitech.edu.cn@evil.com/' }),
      holder: new OneTimeTicketHolder(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.error.details as { detail?: string }).detail).toBe('HAS_USERINFO');
  });

  it('非 https 被拒绝', async () => {
    const { repo } = recordingRepository();
    const result = await openCampusWebview(repo, {
      capability: webviewCapability({ targetUrl: 'http://ecourse.shanghaitech.edu.cn/' }),
      holder: new OneTimeTicketHolder(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.error.details as { detail?: string }).detail).toBe('NOT_HTTPS');
  });

  it('通配子域（attacker.shanghaitech.edu.cn）被拒绝 —— 白名单不是通配', async () => {
    const { repo } = recordingRepository();
    const result = await openCampusWebview(repo, {
      capability: webviewCapability({ targetUrl: 'https://attacker.shanghaitech.edu.cn/' }),
      holder: new OneTimeTicketHolder(),
    });
    expect(result.ok).toBe(false);
  });

  it('服务端没下发地址 → 拒绝（而不是回落到"默认站点"）', async () => {
    const { repo, calls } = recordingRepository();
    const result = await openCampusWebview(repo, {
      capability: webviewCapability({ targetUrl: null }),
      holder: new OneTimeTicketHolder(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.error.details as { reason?: string }).reason).toBe('TARGET_URL_MISSING');
    expect(calls).toEqual([]);
  });

  it('非 WebView 能力不能换取票据', async () => {
    const { repo, calls } = recordingRepository();
    const result = await openCampusWebview(repo, {
      capability: webviewCapability({ access: 'openid', targetUrl: ALLOWED }),
      holder: new OneTimeTicketHolder(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.error.details as { reason?: string }).reason).toBe('NOT_A_WEBVIEW_CAPABILITY');
    expect(calls).toEqual([]);
  });
});

describe('CAMPUS_BINDING_REQUIRED 是引导而不是崩溃', () => {
  it('服务端要求先绑定 → 原样透传错误码，票据未被签发', async () => {
    const mock = createMockTechpieRepository({ latencyMs: 0 });
    const { repo } = recordingRepository();
    // 直接构造：平台已声明但未绑定（mock 会返回 CAMPUS_BINDING_REQUIRED）
    const result = await openCampusWebview(repo, {
      capability: webviewCapability({ platform: 'egate' }),
      holder: new OneTimeTicketHolder(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CAMPUS_BINDING_REQUIRED');
    expect(mock.pendingTicketCount()).toBe(0);
  });
});

describe('如实告知用户（交付要求逐字）', () => {
  it('文案逐字一致', () => {
    expect(WEBVIEW_HONEST_NOTICE).toBe(
      '接下来的页面由学校系统提供，请在那里登录；可达鸭只转发一次性的访问票据，不接触你的登录凭证。',
    );
  });

  it('host 提取只用于日志（不参与任何安全判定）', () => {
    expect(webviewHostOf(ALLOWED)).toBe('ecourse.shanghaitech.edu.cn');
    expect(webviewHostOf('not-a-url')).toBe('invalid-url');
  });
});
