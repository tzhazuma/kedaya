import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { MockCampusAuthProvider } from './mock-campus-auth.provider';

/**
 * `MockCampusAuthProvider` 的规格。
 *
 * 核心只有一件事：**除非显式开启，否则不许采信 `mock-<学号>` 票据**。
 *
 * 因为 `authenticateTicket` 会把 `mock-20230001` 直接当成学号用，
 * 而 `POST /api/v1/auth/login` 按设计是公开接口（登录当然不需要先登录）。
 * 两条放在一起就是：任何人 curl 一个学号，就能拿到那个学生的令牌。
 * 这是一条**完整的身份伪造路径**，不是理论风险。
 *
 * 审计 P0-3 的根因是旧闸门只拒绝 `NODE_ENV === 'production'`：
 * `NODE_ENV` 未设 / 拼错时被当成「非生产」直接放行。现在改成 fail-closed：
 *   1. `production` → 无条件拒绝（`CAMPUS_CAS_MOCK_ALLOWED` 也不放行）；
 *   2. `NODE_ENV` 未设置 / 拼错 → 拒绝；
 *   3. 只有 `development` / `test` **且** `CAMPUS_CAS_MOCK_ALLOWED=true` → 放行。
 */

function makeConfig(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function provider(values: Record<string, string>): MockCampusAuthProvider {
  return new MockCampusAuthProvider(makeConfig(values));
}

/** 显式开启 mock 的唯一合法组合（development + 显式开关） */
const DEV_MOCK_ENABLED = {
  NODE_ENV: 'development',
  CAMPUS_CAS_MOCK_ALLOWED: 'true',
} as const;

async function captureError(run: () => Promise<unknown>): Promise<Error | null> {
  return run().then(
    () => null,
    (reason: unknown) => reason as Error,
  );
}

describe('MockCampusAuthProvider · 显式开启（development + CAMPUS_CAS_MOCK_ALLOWED=true）', () => {
  it('采信 mock-<学号> 形式的票据（本地把整条链路跑通用）', async () => {
    const identity = await provider(DEV_MOCK_ENABLED).authenticateTicket('mock-20230001');
    expect(identity.externalId).toBe('20230001');
    expect(identity.provider).toBe('SHTU_CAS');
    // 只返回身份字段，绝不带回凭据
    expect(Object.keys(identity).sort()).toEqual(
      ['department', 'email', 'externalId', 'provider', 'realName'].sort(),
    );
  });

  it('非 mock 形式的票据由哈希派生外部 ID（同一个票据永远映射到同一个账户）', async () => {
    const first = await provider(DEV_MOCK_ENABLED).authenticateTicket('ST-1234567890-ticket');
    const second = await provider(DEV_MOCK_ENABLED).authenticateTicket('ST-1234567890-ticket');
    expect(first.externalId).toBe(second.externalId);
    expect(first.externalId).not.toContain('1234567890');
  });

  it('test 环境同样需要显式开关（CI 里跑全链路时不必伪造 production）', async () => {
    const identity = await provider({
      NODE_ENV: 'test',
      CAMPUS_CAS_MOCK_ALLOWED: 'true',
    }).authenticateTicket('mock-20230001');
    expect(identity.externalId).toBe('20230001');
  });

  it('空票据 → 401（先过闸门，再校验票据）', async () => {
    await expect(provider(DEV_MOCK_ENABLED).authenticateTicket('   ')).rejects.toThrow(/ticket/);
  });
});

describe('MockCampusAuthProvider · P0-3 fail-closed 闸门', () => {
  it('NODE_ENV 未设置 + CAMPUS_CAS_MOCK_ALLOWED 未设置 → 拒绝（P0-3 核心回归）', async () => {
    // 旧实现在这里 `return`（把未设置当成非生产）—— 正是身份伪造路径的入口。
    const error = await captureError(() => provider({}).authenticateTicket('mock-20230001'));

    expect(error).not.toBeNull();
    expect(error?.message).toContain('NODE_ENV');
    expect(error?.message).toContain('CAMPUS_CAS_MOCK_ALLOWED');
    // 连学号都不该出现在错误里（避免变成「探测某个学号存不存在」的接口）
    expect(error?.message).not.toContain('20230001');
  });

  it('NODE_ENV 未设置 + CAMPUS_CAS_MOCK_ALLOWED=true → 仍然拒绝（未声明环境不视为开发）', async () => {
    await expect(
      provider({ CAMPUS_CAS_MOCK_ALLOWED: 'true' }).authenticateTicket('mock-20230001'),
    ).rejects.toThrow(/NODE_ENV/);
  });

  it('NODE_ENV 拼错 + CAMPUS_CAS_MOCK_ALLOWED=true → 仍然拒绝（拼错不等于开发环境）', async () => {
    for (const typo of ['prod', 'Production ', 'dev', 'staging']) {
      await expect(
        provider({ NODE_ENV: typo, CAMPUS_CAS_MOCK_ALLOWED: 'true' }).authenticateTicket(
          'mock-20230001',
        ),
      ).rejects.toThrow(/NODE_ENV/);
    }
  });

  it('NODE_ENV=development + 未设置开关 → 拒绝（默认关闭）', async () => {
    await expect(
      provider({ NODE_ENV: 'development' }).authenticateTicket('mock-20230001'),
    ).rejects.toThrow(/CAMPUS_CAS_MOCK_ALLOWED/);
  });

  it('NODE_ENV=production + 未设置开关 → 拒绝，且文案指向邮箱 / 微信', async () => {
    const error = await captureError(() =>
      provider({ NODE_ENV: 'production' }).authenticateTicket('mock-20230001'),
    );

    expect(error).not.toBeNull();
    expect(error?.message).toContain('邮箱');
    expect(error?.message).toContain('微信');
    expect(error?.message).not.toContain('20230001');
  });

  it('NODE_ENV=production + CAMPUS_CAS_MOCK_ALLOWED=true → **仍然拒绝**（生产不允许 mock）', async () => {
    const error = await captureError(() =>
      provider({
        NODE_ENV: 'production',
        CAMPUS_CAS_MOCK_ALLOWED: 'true',
      }).authenticateTicket('mock-20230001'),
    );

    expect(error).not.toBeNull();
    // 文案必须说清：设开关也没用，别让运维以为「再加一个变量就能打开」。
    expect(error?.message).toContain('CAMPUS_CAS_MOCK_ALLOWED');
    expect(error?.message).toContain('无条件禁用');
  });

  it('NODE_ENV=production 时空票据同样先撞闸门 —— 不泄露「哪种票据才是对的」', async () => {
    await expect(provider({ NODE_ENV: 'production' }).authenticateTicket('')).rejects.toThrow(
      /暂不可用/,
    );
  });

  it('类似 true 的写法都认（1 / true / TRUE / yes / on），写错的值不认', async () => {
    for (const value of ['1', 'true', 'TRUE', ' yes ', 'on']) {
      await expect(
        provider({ NODE_ENV: 'development', CAMPUS_CAS_MOCK_ALLOWED: value }).authenticateTicket(
          'mock-20230001',
        ),
      ).resolves.toBeDefined();
    }
    for (const value of ['false', '0', 'no', 'off', '']) {
      await expect(
        provider({ NODE_ENV: 'development', CAMPUS_CAS_MOCK_ALLOWED: value }).authenticateTicket(
          'mock-20230001',
        ),
      ).rejects.toThrow(/CAMPUS_CAS_MOCK_ALLOWED/);
    }
  });
});

describe('MockCampusAuthProvider · simulated 标记', () => {
  it('自报 simulated=true —— AuthService 会把它带进 CAS 登录响应', () => {
    expect(provider(DEV_MOCK_ENABLED).simulated).toBe(true);
  });
});
