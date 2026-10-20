import { describe, expect, it } from 'vitest';

import { UnauthenticatedError, InternalError } from '../../../common/errors/app-error';
import { parseServiceResponse } from './http-campus-auth.provider';

/**
 * CAS `p3/serviceValidate?format=JSON` 的响应解析。
 *
 * 这些 JSON 形状是**对着真实 IDS 抓的**（2026-10-20）：
 * 失败响应确实长这样：
 * ```json
 * { "serviceResponse": { "authenticationFailure": {
 *     "code": "INVALID_TICKET",
 *     "description": "未能够识别出目标 'ST-…'票根" } } }
 * ```
 *
 * 所以测试不是凭空编的 —— 是照着上游真实返回写的。
 */
describe('parseServiceResponse —— 真实 CAS 响应形状', () => {
  it('学号有效时解析出身份', () => {
    const identity = parseServiceResponse({
      serviceResponse: {
        authenticationSuccess: {
          user: '20230001',
          attributes: {
            // CAS 的属性值**总是数组**（多值字段）
            name: ['张三'],
            email: ['zhangsan@shanghaitech.edu.cn'],
            department: ['信息科学与技术学院'],
          },
        },
      },
    });

    expect(identity.provider).toBe('SHTU_CAS');
    expect(identity.externalId).toBe('20230001');
    expect(identity.realName).toBe('张三');
    expect(identity.email).toBe('zhangsan@shanghaitech.edu.cn');
    expect(identity.department).toBe('信息科学与技术学院');
  });

  it('属性给单个字符串也认（个别部署不是数组）', () => {
    const identity = parseServiceResponse({
      serviceResponse: {
        authenticationSuccess: {
          user: '20230001',
          attributes: { name: '李四', mail: 'lisi@shanghaitech.edu.cn' },
        },
      },
    });
    expect(identity.realName).toBe('李四');
    expect(identity.email).toBe('lisi@shanghaitech.edu.cn');
  });

  it('属性缺失时字段为 undefined，**不编造**', () => {
    const identity = parseServiceResponse({
      serviceResponse: { authenticationSuccess: { user: '20230001' } },
    });
    expect(identity.externalId).toBe('20230001');
    expect(identity.realName).toBeUndefined();
    expect(identity.email).toBeUndefined();
    expect(identity.department).toBeUndefined();
  });

  it('空数组 / 空字符串不算值', () => {
    const identity = parseServiceResponse({
      serviceResponse: {
        authenticationSuccess: {
          user: '20230001',
          attributes: { name: ['  '], email: [] },
        },
      },
    });
    expect(identity.realName).toBeUndefined();
    expect(identity.email).toBeUndefined();
  });

  it('⚠️ 票根无效 → UnauthenticatedError（不是 500）', () => {
    expect(() =>
      parseServiceResponse({
        serviceResponse: {
          authenticationFailure: {
            code: 'INVALID_TICKET',
            description: "未能够识别出目标 'ST-invalid'票根",
          },
        },
      }),
    ).toThrow(UnauthenticatedError);
  });

  it('⚠️ 上游的错误描述**不**透传给用户（可能含 ticket）', () => {
    try {
      parseServiceResponse({
        serviceResponse: {
          authenticationFailure: {
            code: 'INVALID_TICKET',
            description: "未能够识别出目标 'ST-secret-ticket-value'票根",
          },
        },
      });
      expect.unreachable('应该抛错');
    } catch (error) {
      expect((error as Error).message).not.toContain('ST-secret-ticket-value');
    }
  });

  it('⚠️ 没有学号 → InternalError（上游违约，不是用户的问题）', () => {
    expect(() =>
      parseServiceResponse({ serviceResponse: { authenticationSuccess: { user: '' } } }),
    ).toThrow(InternalError);
    expect(() =>
      parseServiceResponse({ serviceResponse: { authenticationSuccess: {} } }),
    ).toThrow(InternalError);
  });

  it('结构完全不对 → InternalError，不崩', () => {
    for (const bad of [null, undefined, {}, { serviceResponse: null }, { foo: 1 }, 'string']) {
      expect(() => parseServiceResponse(bad), JSON.stringify(bad)).toThrow(InternalError);
    }
  });

  it('学号会 trim（上游偶尔带空白）', () => {
    const identity = parseServiceResponse({
      serviceResponse: { authenticationSuccess: { user: '  20230001  ' } },
    });
    expect(identity.externalId).toBe('20230001');
  });
});
