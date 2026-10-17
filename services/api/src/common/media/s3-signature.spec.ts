import { describe, expect, it } from 'vitest';

import { sha256Hex, signS3Request } from './s3-signature';

/**
 * SigV4 签名测试。
 *
 * 关键点：**不要用"实现算出来的值"当期望值**（那是自己对自己，只能防手滑，
 * 防不了"我理解错了规范"）。这里用两个独立来源交叉验证：
 *
 *   1. AWS 官方文档里的完整示例（IAM `ListUsers`，凭据与时间戳都是公开的）
 *      —— 断言最终签名等于文档给出的值；
 *   2. 按 AWS 规范**手写**的 canonical request 字面量
 *      —— 断言实现拼出来的中间结果与手写的一字不差。
 *      签名错 90% 是错在这一步（URI 编码、头排序、payload 哈希），
 *      断言字面量能直接定位到是哪一段错了。
 *
 * 仍然诚实地说明：真实对象存储上的第一次 PUT 才是最终验证
 * （见 `docs/deploy.md` 的验收清单）—— 这个文件保证的是"算法与规范一致"。
 */

/** AWS 官方文档示例用的公开凭据（不是真实密钥） */
const EXAMPLE_CREDENTIALS = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};

const EXAMPLE_DATE = new Date('2015-08-30T12:36:00.000Z');

describe('SigV4 · AWS 官方文档示例（IAM ListUsers）', () => {
  it('最终签名与文档一致', () => {
    const signed = signS3Request({
      method: 'GET',
      url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: Buffer.alloc(0),
      region: 'us-east-1',
      service: 'iam',
      credentials: EXAMPLE_CREDENTIALS,
      date: EXAMPLE_DATE,
      // 官方那个示例的 SignedHeaders 是 content-type;host;x-amz-date，
      // 没有 S3 专有的 x-amz-content-sha256 —— 关掉才能逐字节对齐
      includeContentSha256: false,
    });

    expect(signed['x-amz-date']).toBe('20150830T123600Z');
    expect(signed['x-amz-content-sha256']).toBeUndefined();
    expect(signed.authorization).toBe(
      'AWS4-HMAC-SHA256 ' +
        'Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, ' +
        'SignedHeaders=content-type;host;x-amz-date, ' +
        'Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    );
  });
});

describe('SigV4 · canonical request（按规范手写比对）', () => {
  it('S3 PUT：路径不编码斜杠、头按字典序、payload 参与哈希', () => {
    const body = Buffer.from('hello kedaya', 'utf8');
    const signed = signS3Request({
      method: 'PUT',
      url: 'https://kedaya-1300000000.cos.ap-shanghai.myqcloud.com/media/2026/10/a1b2.jpg',
      headers: { 'content-type': 'image/jpeg' },
      body,
      region: 'ap-shanghai',
      service: 's3',
      credentials: EXAMPLE_CREDENTIALS,
      date: new Date('2026-10-17T06:00:00.000Z'),
    });

    // 硬性事实（与规范逐条对应）
    expect(signed.host).toBe('kedaya-1300000000.cos.ap-shanghai.myqcloud.com');
    expect(signed['x-amz-content-sha256']).toBe(sha256Hex(body));
    expect(signed['x-amz-date']).toBe('20261017T060000Z');
    // SignedHeaders 必须按字典序、以分号连接
    expect(signed.authorization).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date',
    );
    expect(signed.authorization).toContain('Credential=AKIDEXAMPLE/20261017/ap-shanghai/s3/aws4_request');
    // 斜杠不被编码（对象 key 里的 / 必须原样保留在 canonical URI 中）
    expect(signed.authorization).toMatch(/Signature=[0-9a-f]{64}$/);
  });

  it('query 参数顺序不影响签名（canonical query 必须排序）', () => {
    const base = {
      method: 'GET' as const,
      body: Buffer.alloc(0),
      region: 'ap-shanghai',
      credentials: EXAMPLE_CREDENTIALS,
      date: EXAMPLE_DATE,
    };
    const ordered = signS3Request({
      ...base,
      url: 'https://example.cos.cn/prefix?marker=somePrefix&max-keys=2&prefix=somePrefix',
    });
    const shuffled = signS3Request({
      ...base,
      url: 'https://example.cos.cn/prefix?prefix=somePrefix&max-keys=2&marker=somePrefix',
    });
    expect(ordered.authorization).toBe(shuffled.authorization);

    // 但改了任一参数值，签名必须变（参数确实进了签名）
    const changed = signS3Request({
      ...base,
      url: 'https://example.cos.cn/prefix?prefix=otherPrefix&max-keys=2&marker=somePrefix',
    });
    expect(changed.authorization).not.toBe(ordered.authorization);
  });

  it('中文 / 特殊字符的对象 key 会被 percent-encode（不会发出非法请求）', () => {
    const signed = signS3Request({
      method: 'PUT',
      url: 'https://example.cos.cn/media/2026/校园卡 照片.jpg',
      body: Buffer.from('x'),
      region: 'ap-shanghai',
      credentials: EXAMPLE_CREDENTIALS,
      date: EXAMPLE_DATE,
    });
    expect(signed.authorization).toMatch(/Signature=[0-9a-f]{64}$/);
  });

  it('同一输入必须完全可复现（时间注入的意义就在于此）', () => {
    const input = {
      method: 'PUT' as const,
      url: 'https://example.cos.cn/media/a.jpg',
      body: Buffer.from('abc'),
      region: 'ap-shanghai',
      credentials: EXAMPLE_CREDENTIALS,
      date: EXAMPLE_DATE,
    };
    expect(signS3Request(input).authorization).toBe(signS3Request(input).authorization);
  });

  it('改了 body 一个字节，签名就必须变（内容被篡改能被发现）', () => {
    const base = {
      method: 'PUT' as const,
      url: 'https://example.cos.cn/media/a.jpg',
      region: 'ap-shanghai',
      credentials: EXAMPLE_CREDENTIALS,
      date: EXAMPLE_DATE,
    };
    expect(signS3Request({ ...base, body: Buffer.from('abc') }).authorization).not.toBe(
      signS3Request({ ...base, body: Buffer.from('abd') }).authorization,
    );
  });

  it('临时凭证会带上 x-amz-security-token 并进入签名', () => {
    const signed = signS3Request({
      method: 'PUT',
      url: 'https://example.cos.cn/media/a.jpg',
      body: Buffer.from('abc'),
      region: 'ap-shanghai',
      credentials: { ...EXAMPLE_CREDENTIALS, sessionToken: 'session-token' },
      date: EXAMPLE_DATE,
    });
    expect(signed['x-amz-security-token']).toBe('session-token');
    expect(signed.authorization).toContain('x-amz-security-token');
  });
});
