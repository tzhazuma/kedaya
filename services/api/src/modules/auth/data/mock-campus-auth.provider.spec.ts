import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { MockCampusAuthProvider } from './mock-campus-auth.provider';

/**
 * `MockCampusAuthProvider` 的规格。
 *
 * 核心只有一件事：**生产环境默认不许采信 `mock-<学号>` 票据**。
 *
 * 因为 `authenticateTicket` 会把 `mock-20230001` 直接当成学号用，
 * 而 `POST /api/v1/auth/login` 按设计是公开接口（登录当然不需要先登录）。
 * 两条放在一起就是：任何人 curl 一个学号，就能拿到那个学生的令牌。
 * 这是一条**完整的身份伪造路径**，不是理论风险。
 *
 * 所以这里断言的不是「功能对不对」，而是「这个后门在生产环境关着」。
 */

function makeConfig(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function provider(values: Record<string, string>): MockCampusAuthProvider {
  return new MockCampusAuthProvider(makeConfig(values));
}

describe('MockCampusAuthProvider · 开发环境', () => {
  it('采信 mock-<学号> 形式的票据（本地把整条链路跑通用）', async () => {
    const identity = await provider({ NODE_ENV: 'development' }).authenticateTicket('mock-20230001');
    expect(identity.externalId).toBe('20230001');
    expect(identity.provider).toBe('SHTU_CAS');
    // 只返回身份字段，绝不带回凭据
    expect(Object.keys(identity).sort()).toEqual(
      ['department', 'email', 'externalId', 'provider', 'realName'].sort(),
    );
  });

  it('非 mock 形式的票据由哈希派生外部 ID（同一个票据永远映射到同一个账户）', async () => {
    const first = await provider({}).authenticateTicket('ST-1234567890-ticket');
    const second = await provider({}).authenticateTicket('ST-1234567890-ticket');
    expect(first.externalId).toBe(second.externalId);
    expect(first.externalId).not.toContain('1234567890');
  });

  it('空票据 → 401（不区分大小写地拒绝）', async () => {
    await expect(provider({}).authenticateTicket('   ')).rejects.toThrow(/ticket/);
  });
});

describe('MockCampusAuthProvider · 生产环境（默认关闭）', () => {
  it('默认拒绝认证，且错误信息直接告诉用户去用哪条路', async () => {
    const error = await provider({ NODE_ENV: 'production' })
      .authenticateTicket('mock-20230001')
      .then(
        () => null,
        (reason: unknown) => reason as Error,
      );

    expect(error).not.toBeNull();
    expect(error?.message).toContain('邮箱');
    expect(error?.message).toContain('微信');
    // 连学号都不该出现在错误里（避免变成「探测某个学号存不存在」的接口）
    expect(error?.message).not.toContain('20230001');
  });

  it('空票据在生产环境同样先撞闸门 —— 不泄露「哪种票据才是对的」', async () => {
    await expect(provider({ NODE_ENV: 'production' }).authenticateTicket('')).rejects.toThrow(
      /暂不可用/,
    );
  });

  it('显式 CAMPUS_CAS_MOCK_ALLOWED=true 才打开（演示部署的出路）', async () => {
    const identity = await provider({
      NODE_ENV: 'production',
      CAMPUS_CAS_MOCK_ALLOWED: 'true',
    }).authenticateTicket('mock-20230001');
    expect(identity.externalId).toBe('20230001');
  });

  it('类似 true 的写法都认（1 / yes / on），写错的值不认', async () => {
    for (const value of ['1', 'true', 'TRUE', ' yes ', 'on']) {
      await expect(
        provider({ NODE_ENV: 'production', CAMPUS_CAS_MOCK_ALLOWED: value }).authenticateTicket(
          'mock-20230001',
        ),
      ).resolves.toBeDefined();
    }
    await expect(
      provider({ NODE_ENV: 'production', CAMPUS_CAS_MOCK_ALLOWED: 'false' }).authenticateTicket(
        'mock-20230001',
      ),
    ).rejects.toThrow(/暂不可用/);
  });
});
