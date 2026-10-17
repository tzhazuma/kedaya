import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service';
import { LocalAuthService } from './local-auth.service';
import { createInMemoryAuth } from './testing/in-memory-auth';
import type { MailMessage, MailPort } from './domain/local-account.domain';
import {
  CAMPUS_EMAIL_DOMAINS,
  isCampusEmail,
  normalizeEmail,
} from './domain/verification-code';

/**
 * 验证码免密登录 + 校园邮箱域名限制。
 *
 * 这两件事是同一套身份前提的两面：
 *   · **域名限制**保证「上科大师生」这个身份前提成立；
 *   · **验证码免密登录**让没有密码（或忘了密码）的人也能进来，
 *     且不需要把密码这种高价值凭据交给第三方平台保管。
 */

const SECRET = 'x'.repeat(48);

function makeConfig(values: Record<string, string> = {}): ConfigService {
  const table: Record<string, string> = {
    JWT_SECRET: SECRET,
    JWT_ACCESS_TTL: '900',
    JWT_REFRESH_TTL: '2592000',
    AUTH_DEV_EXPOSE_CODES: 'true',
    ...values,
  };
  return { get: (key: string) => table[key] } as unknown as ConfigService;
}

interface Harness {
  service: LocalAuthService;
  auth: ReturnType<typeof createInMemoryAuth>;
  sent: MailMessage[];
}

function build(now?: () => Date): Harness {
  const auth = createInMemoryAuth(now === undefined ? {} : { now });
  const sent: MailMessage[] = [];
  const mail: MailPort = {
    send: vi.fn(async (message: MailMessage) => {
      sent.push(message);
    }),
  };

  const config = makeConfig();
  const authService = new AuthService(
    { authenticateTicket: vi.fn() },
    {
      bind: vi.fn(),
      listBindings: vi.fn().mockResolvedValue([]),
      acquireSession: vi.fn().mockResolvedValue(null),
      unbind: vi.fn(),
    },
    auth.users,
    auth.accounts,
    config,
    auth.sessions,
  );

  const clock = now ?? ((): Date => new Date());
  const service = new LocalAuthService(
    auth.accounts,
    auth.codes,
    auth.sessions,
    mail,
    auth.users,
    config,
    authService,
    clock,
  );

  return { service, auth, sent };
}

function codeFromMail(message: MailMessage): string {
  const matched = /(\d{6})/.exec(message.text);
  if (!matched) throw new Error(`邮件里没有验证码：${message.text}`);
  return matched[1]!;
}

const STUDENT = 'kedaya@stu.shanghaitech.edu.cn';
const STAFF = 'someone@shanghaitech.edu.cn';

/* ================================================================== *
 * 校园邮箱域名限制
 * ================================================================== */

describe('校园邮箱域名', () => {
  it('只放行两个校园域', () => {
    expect(CAMPUS_EMAIL_DOMAINS).toEqual([
      'shanghaitech.edu.cn',
      'stu.shanghaitech.edu.cn',
    ]);
  });

  it('接受学生邮箱与教职工邮箱', () => {
    expect(isCampusEmail(STUDENT)).toBe(true);
    expect(isCampusEmail(STAFF)).toBe(true);
    // 大小写与空白都应被规范化
    expect(isCampusEmail('  Kedaya@STU.ShanghaiTech.edu.cn ')).toBe(true);
  });

  it('接受校园域的子域（如院系邮箱）', () => {
    // `*.shanghaitech.edu.cn` 是学校自己的子域空间（院系/实验室邮箱），应当放行。
    // 注意这与「后缀伪装」的区别：`shanghaitech.edu.cn.evil.com` 的**注册域**是
    // evil.com，`endsWith('.shanghaitech.edu.cn')` 为 false，因此被正确拒绝。
    expect(isCampusEmail('a@cs.shanghaitech.edu.cn')).toBe(true);
    expect(isCampusEmail('a@xstu.shanghaitech.edu.cn')).toBe(true);
  });

  it('拒绝外部邮箱', () => {
    for (const email of [
      'a@gmail.com',
      'a@qq.com',
      'a@outlook.com',
      'a@163.com',
    ]) {
      expect(isCampusEmail(email), email).toBe(false);
    }
  });

  it('⚠️ 拒绝后缀伪装（这是最容易写错的地方）', () => {
    // 以下三个都**不是**上科大邮箱：
    //   · `notshanghaitech.edu.cn` 是另一个域（前面粘了 not）
    //   · `shanghaitech.edu.cn.evil.com` 的注册域是 evil.com
    //   · `evil-shanghaitech.edu.cn` 的域是 evil-shanghaitech.edu.cn
    for (const email of [
      'a@notshanghaitech.edu.cn',
      'a@shanghaitech.edu.cn.evil.com',
      'a@evil-shanghaitech.edu.cn',
    ]) {
      expect(isCampusEmail(email), email).toBe(false);
    }
  });

  it('畸形输入一律拒绝，不抛异常', () => {
    for (const bad of ['', '@', 'a@', '@b.com', 'a b@shanghaitech.edu.cn', 'no-at-sign']) {
      expect(isCampusEmail(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('normalizeTarget 强制校园邮箱（服务层）', () => {
  it('外部邮箱在**发码阶段**就被拒（不是等到建号）', async () => {
    const h = build();
    await expect(h.service.sendLoginCode('a@gmail.com')).rejects.toThrow(
      /上海科技大学邮箱|shanghaitech/,
    );
    // 关键：一封邮件都不应发出
    expect(h.sent).toHaveLength(0);
  });

  it('注册也用同一套限制', async () => {
    const h = build();
    await expect(h.service.sendRegisterCode('a@gmail.com')).rejects.toThrow();
    expect(h.sent).toHaveLength(0);
  });

  it('校园邮箱正常通过', async () => {
    const h = build();
    const receipt = await h.service.sendLoginCode(STUDENT);
    expect(receipt.sent).toBe(true);
    expect(normalizeEmail(STUDENT)).toBe(STUDENT);
  });
});

/* ================================================================== *
 * 验证码免密登录
 * ================================================================== */

describe('验证码免密登录', () => {
  it('首次登录自动建号，且账号是**免密**的', async () => {
    const h = build();
    const receipt = await h.service.sendLoginCode(STUDENT);
    const code = receipt.devCode ?? codeFromMail(h.sent.at(-1)!);

    const outcome = await h.service.loginWithCode({ email: STUDENT, code });

    expect(outcome.isNewUser).toBe(true);
    expect(outcome.user.displayName.length).toBeGreaterThan(0);
    expect(outcome.accessToken.length).toBeGreaterThan(0);

    // 免密账号：`hasPassword` 必须是 false
    await expect(h.service.hasPassword(outcome.user.id)).resolves.toBe(false);
  });

  it('再次登录不会重复建号（isNewUser=false）', async () => {
    const h = build();
    const first = await h.service.sendLoginCode(STUDENT);
    const code1 = first.devCode ?? codeFromMail(h.sent.at(-1)!);
    const created = await h.service.loginWithCode({ email: STUDENT, code: code1 });

    const second = await h.service.sendLoginCode(STUDENT);
    const code2 = second.devCode ?? codeFromMail(h.sent.at(-1)!);
    const again = await h.service.loginWithCode({ email: STUDENT, code: code2 });

    expect(again.isNewUser).toBe(false);
    expect(again.user.id).toBe(created.user.id);
  });

  it('验证码一次性：第二次用同一个码失败', async () => {
    const h = build();
    const receipt = await h.service.sendLoginCode(STUDENT);
    const code = receipt.devCode ?? codeFromMail(h.sent.at(-1)!);

    await h.service.loginWithCode({ email: STUDENT, code });
    await expect(h.service.loginWithCode({ email: STUDENT, code })).rejects.toThrow();
  });

  it('错误的验证码被拒', async () => {
    const h = build();
    await h.service.sendLoginCode(STUDENT);
    await expect(
      h.service.loginWithCode({ email: STUDENT, code: '000000' }),
    ).rejects.toThrow();
  });

  it('⚠️ 不区分邮箱是否已注册（防枚举）', async () => {
    const h = build();
    // 两个**都未注册**的校园邮箱：响应形状必须一致
    const a = await h.service.sendLoginCode('nobody-1@stu.shanghaitech.edu.cn');
    const b = await h.service.sendLoginCode('nobody-2@stu.shanghaitech.edu.cn');

    expect(a.sent).toBe(true);
    expect(b.sent).toBe(true);
    // 已注册与未注册的响应都不含「是否已注册」这一位
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });

  it('免密账号仍然可以用密码登录吗？—— **不能**（这是预期）', async () => {
    const h = build();
    const receipt = await h.service.sendLoginCode(STUDENT);
    const code = receipt.devCode ?? codeFromMail(h.sent.at(-1)!);
    await h.service.loginWithCode({ email: STUDENT, code });

    // 免密账号的 passwordHash 是哨兵值，任何密码都验不过
    await expect(
      h.service.login({ email: STUDENT, password: 'anything' }),
    ).rejects.toThrow();
  });

  it('60 秒内重复发码被频控拦下', async () => {
    let now = new Date('2026-10-17T12:00:00Z');
    const h = build(() => now);
    await h.service.sendLoginCode(STUDENT);

    now = new Date(now.getTime() + 10_000); // 只过 10 秒
    await expect(h.service.sendLoginCode(STUDENT)).rejects.toThrow(/秒后再试/);
  });
});
