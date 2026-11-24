import { describe, expect, it, vi } from 'vitest';

import { UnauthenticatedError } from '../../../common/errors/app-error';
import type { ConfigService } from '@nestjs/config';
import { HttpCampusAuthProvider } from './http-campus-auth.provider';

function configWith(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

const successXml = `<?xml version="1.0" encoding="UTF-8"?>
<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
  <cas:authenticationSuccess>
    <cas:user>20265555</cas:user>
    <cas:attributes>
      <cas:cn>张三</cas:cn>
      <cas:mail>zhangsan@shanghaitech.edu.cn</cas:mail>
      <cas:ou>信息科学与技术学院</cas:ou>
    </cas:attributes>
  </cas:authenticationSuccess>
</cas:serviceResponse>`;

describe('HttpCampusAuthProvider', () => {
  it('成功票据 → 解析学号/姓名/邮箱/院系', async () => {
    const provider = new HttpCampusAuthProvider(
      configWith({
        CAMPUS_CAS_URL: 'https://ids.example.edu/authserver',
        CAMPUS_CAS_SERVICE: 'https://api.example.cn/auth/cas/callback',
      }),
      vi.fn(async () => new Response(successXml, { status: 200 })),
    );

    const identity = await provider.authenticateTicket('ST-123');
    expect(identity.provider).toBe('SHTU_CAS');
    expect(identity.externalId).toBe('20265555');
    expect(identity.realName).toBe('张三');
    expect(identity.email).toBe('zhangsan@shanghaitech.edu.cn');
    expect(identity.department).toBe('信息科学与技术学院');
    expect(provider.simulated).toBe(false);
  });

  it('校验 URL 带 service 与 ticket，且请求体不落日志（错误里没有 ticket）', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/authserver/serviceValidate');
      expect(url.searchParams.get('service')).toBe(
        'https://api.example.cn/auth/cas/callback',
      );
      expect(url.searchParams.get('ticket')).toBe('ST-SECRET');
      return new Response('<cas:serviceResponse></cas:serviceResponse>', {
        status: 200,
      });
    });
    const provider = new HttpCampusAuthProvider(
      configWith({
        CAMPUS_CAS_URL: 'https://ids.example.edu/authserver/',
        CAMPUS_CAS_SERVICE: 'https://api.example.cn/auth/cas/callback',
      }),
      fetchMock,
    );

    await expect(provider.authenticateTicket('ST-SECRET')).rejects.toThrow(
      UnauthenticatedError,
    );
    await expect(provider.authenticateTicket('ST-SECRET')).rejects.not.toThrow(
      /ST-SECRET/,
    );
  });

  it('authenticationFailure → UnauthenticatedError', async () => {
    const provider = new HttpCampusAuthProvider(
      configWith({
        CAMPUS_CAS_SERVICE: 'https://api.example.cn/auth/cas/callback',
      }),
      vi.fn(
        async () =>
          new Response(
            '<cas:serviceResponse><cas:authenticationFailure code="INVALID_TICKET"/></cas:serviceResponse>',
            { status: 200 },
          ),
      ),
    );
    await expect(provider.authenticateTicket('bad')).rejects.toThrow(
      UnauthenticatedError,
    );
  });

  it('没配 CAMPUS_CAS_SERVICE 时拒绝，且不发请求', async () => {
    const fetchMock = vi.fn();
    const provider = new HttpCampusAuthProvider(configWith({}), fetchMock);
    await expect(provider.authenticateTicket('ST-1')).rejects.toThrow(
      /CAMPUS_CAS_SERVICE/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('空票据直接拒绝', async () => {
    const fetchMock = vi.fn();
    const provider = new HttpCampusAuthProvider(
      configWith({ CAMPUS_CAS_SERVICE: 'https://x/cb' }),
      fetchMock,
    );
    await expect(provider.authenticateTicket('  ')).rejects.toThrow(
      UnauthenticatedError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
