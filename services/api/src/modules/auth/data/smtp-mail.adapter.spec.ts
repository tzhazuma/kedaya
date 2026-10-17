import type { ConfigService } from '@nestjs/config';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Server, Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { SmtpMailAdapter, resolveMailTransport } from './smtp-mail.adapter';

/**
 * `SmtpMailAdapter` 的规格。
 *
 * 这是**生产环境的注册/找回密码路径**，所以这里用一台内存里的假 SMTP 服务器
 * 逐条断言命令序列，而不是断言「调用了 send」。
 *
 * 最要紧的三条：
 *   1. 不该泄露的动作**一个都不能发生**：连不上 TLS 时，用户名、密码、验证码
 *      都不允许出现在明文连接上；
 *   2. 投递失败必须变成异常（上层接口因此返回失败），
 *      否则用户会看到「验证码已发送」而永远收不到；
 *   3. 生产环境没配 SMTP 时**拒绝启动** —— 这是「假功能不许上线」的最后一道闸门。
 */

interface FakeServerOptions {
  /** EHLO 里宣告的能力行；空数组表示什么都不宣告 */
  capabilities?: string[];
  /** 对 RCPT TO 的回复 */
  rcptReply?: string;
  /** 密码是否正确（用于制造 535） */
  password?: string;
  /** STARTTLS 之后立刻断开（模拟「对端根本不会 TLS」） */
  killOnStartTls?: boolean;
}

class FakeSmtpServer {
  readonly commands: string[] = [];
  readonly payloads: string[] = [];
  readonly dataLines: string[] = [];
  port = 0;
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();

  constructor(private readonly options: FakeServerOptions = {}) {}

  async start(): Promise<void> {
    this.server = createServer((socket) => {
      this.serve(socket);
    });
    await new Promise<void>((resolve) => {
      this.server?.listen(0, '127.0.0.1', () => resolve());
    });
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => {
      if (this.server === null) return resolve();
      this.server.close(() => resolve());
    });
    this.server = null;
  }

  /**
   * 还原收到的报文。
   *
   * 注意：**头部是明文、正文才是 base64**（见 `buildMessage`）。
   * 所以这里在第一个空行处切开，只对正文做 base64 解码 ——
   * 把整封邮件（含头部）一起解码会得到一堆乱码，从而误判成「编码坏了」。
   */
  decodedMessage(): { headers: string; body: string } {
    const blank = this.dataLines.indexOf('');
    const headers = this.dataLines.slice(0, blank).join('\n');
    const body = Buffer.from(this.dataLines.slice(blank + 1).join(''), 'base64').toString('utf8');
    return { headers, body };
  }

  private serve(socket: Socket): void {
    this.sockets.add(socket);
    socket.setEncoding('utf8');
    socket.on('error', () => undefined);
    let buffer = '';
    let inData = false;
    let authStage: 'none' | 'user' | 'pass' = 'none';
    const write = (line: string): void => {
      socket.write(`${line}\r\n`);
    };
    write('220 fake ESMTP ready');

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf('\r\n');
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            write('250 2.0.0 Ok: queued as FAKE');
          } else {
            this.dataLines.push(line);
          }
        } else {
          this.commands.push(line);
          this.respond(socket, line, write, {
            setData: () => {
              inData = true;
            },
            setAuthStage: (stage) => {
              authStage = stage;
            },
            authStage: () => authStage,
          });
        }
        index = buffer.indexOf('\r\n');
      }
    });
  }

  private respond(
    socket: Socket,
    line: string,
    write: (line: string) => void,
    state: {
      setData: () => void;
      setAuthStage: (stage: 'none' | 'user' | 'pass') => void;
      authStage: () => 'none' | 'user' | 'pass';
    },
  ): void {
    const upper = line.toUpperCase();

    if (upper.startsWith('EHLO')) {
      const capabilities = this.options.capabilities ?? ['AUTH PLAIN LOGIN'];
      if (capabilities.length === 0) {
        write('250 fake greets you');
        return;
      }
      write('250-fake greets you');
      capabilities.forEach((capability, position) => {
        const last = position === capabilities.length - 1;
        write(`${last ? '250 ' : '250-'}${capability}`);
      });
      return;
    }

    if (upper.startsWith('STARTTLS')) {
      write('220 2.0.0 Ready to start TLS');
      if (this.options.killOnStartTls === true) socket.destroy();
      return;
    }

    if (upper.startsWith('AUTH PLAIN')) {
      const payload = line.slice('AUTH PLAIN '.length);
      this.payloads.push(payload);
      const parts = Buffer.from(payload, 'base64').toString('utf8').split('\u0000');
      const pass = parts[2] ?? '';
      const expected = this.options.password ?? 's3cret-pass';
      write(pass === expected ? '235 2.7.0 Authentication successful' : '535 5.7.8 Bad credentials');
      return;
    }

    if (upper.startsWith('AUTH LOGIN')) {
      state.setAuthStage('user');
      write('334 VXNlcm5hbWU6');
      return;
    }

    if (state.authStage() === 'user') {
      this.payloads.push(line);
      state.setAuthStage('pass');
      write('334 UGFzc3dvcmQ6');
      return;
    }

    if (state.authStage() === 'pass') {
      this.payloads.push(line);
      state.setAuthStage('none');
      const pass = Buffer.from(line, 'base64').toString('utf8');
      const expected = this.options.password ?? 's3cret-pass';
      write(pass === expected ? '235 2.7.0 Authentication successful' : '535 5.7.8 Bad credentials');
      return;
    }

    if (upper.startsWith('MAIL FROM')) {
      write('250 2.1.0 Ok');
      return;
    }

    if (upper.startsWith('RCPT TO')) {
      write(this.options.rcptReply ?? '250 2.1.5 Ok');
      return;
    }

    if (upper.startsWith('DATA')) {
      write('354 End data with <CR><LF>.<CR><LF>');
      state.setData();
      return;
    }

    if (upper.startsWith('QUIT')) {
      write('221 2.0.0 Bye');
      socket.end();
      return;
    }

    write('502 5.5.2 Command not implemented');
  }
}

function makeConfig(values: Record<string, string>): ConfigService {
  const table: Record<string, string> = { NODE_ENV: 'production', ...values };
  return { get: (key: string) => table[key] } as unknown as ConfigService;
}

const running: FakeSmtpServer[] = [];

afterEach(async () => {
  while (running.length > 0) {
    const server = running.pop();
    if (server !== undefined) await server.stop();
  }
});

async function startServer(options: FakeServerOptions = {}): Promise<FakeSmtpServer> {
  const server = new FakeSmtpServer(options);
  await server.start();
  running.push(server);
  return server;
}

function adapterFor(server: FakeSmtpServer, overrides: Record<string, string> = {}) {
  const config = makeConfig({
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(server.port),
    SMTP_USER: 'kdy@example.com',
    SMTP_PASS: 's3cret-pass',
    SMTP_FROM: '"可达鸭" <no-reply@example.com>',
    // 假服务器跑在明文 TCP 上，且会宣告 STARTTLS 时客户端会尝试真 TLS 握手 ——
    // 本文件里需要走通投递的用例都显式打开这个开关（生产默认关闭）。
    SMTP_ALLOW_INSECURE: 'true',
    ...overrides,
  });
  return new SmtpMailAdapter(config);
}

describe('SmtpMailAdapter · 投递', () => {
  it('完整走完 AUTH PLAIN → MAIL/RCPT/DATA/QUIT，并把验证码装进正文', async () => {
    const server = await startServer();
    await adapterFor(server).send({
      to: 'student@example.com',
      subject: '【可达鸭】注册验证码',
      text: '你的验证码是 123456，10 分钟内有效。',
    });

    const sent = server.commands.join('\n');
    expect(sent).toContain('EHLO example.com');
    expect(sent).toContain('MAIL FROM:<no-reply@example.com>');
    expect(sent).toContain('RCPT TO:<student@example.com>');
    expect(sent).toContain('DATA');
    expect(sent.trimEnd().endsWith('QUIT')).toBe(true);

    // 用户名/密码用 AUTH PLAIN 一次性发出，载荷必须是 \0user\0pass
    const decodedAuth = Buffer.from(server.payloads[0] ?? '', 'base64').toString('utf8');
    expect(decodedAuth).toBe('\u0000kdy@example.com\u0000s3cret-pass');

    // 正文整体 base64：还原后要能读出验证码
    const decoded = server.decodedMessage();
    expect(decoded.body).toContain('你的验证码是 123456');
    expect(decoded.headers).toContain('Content-Transfer-Encoding: base64');
    // 中文主题必须是 RFC 2047 编码字（否则邮件客户端显示乱码）
    expect(decoded.headers).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    // 中文发件人名同样要编码，地址部分保持裸地址
    expect(decoded.headers).toContain('<no-reply@example.com>');
  });

  it('服务器只宣告 AUTH LOGIN 时退回 LOGIN：三条命令依次是 user/pass 的 base64', async () => {
    const server = await startServer({ capabilities: ['AUTH LOGIN'] });
    await adapterFor(server).send({ to: 'student@example.com', subject: '验证码', text: '你的验证码是 654321' });

    expect(server.commands).toContain('AUTH LOGIN');
    const [user, pass] = server.payloads;
    expect(Buffer.from(user ?? '', 'base64').toString('utf8')).toBe('kdy@example.com');
    expect(Buffer.from(pass ?? '', 'base64').toString('utf8')).toBe('s3cret-pass');
  });

  it('收件人被拒（550）→ 抛错，且**不**进入 DATA（否则等于把验证码发进黑洞）', async () => {
    const server = await startServer({ rcptReply: '550 5.1.1 No such user' });
    await expect(
      adapterFor(server).send({ to: 'nobody@example.com', subject: '验证码', text: '你的验证码是 1' }),
    ).rejects.toThrow(/RCPT TO.*550/);
    expect(server.commands.join('\n')).not.toContain('DATA');
  });

  it('认证失败（535）→ 抛错，错误信息里**没有**密码', async () => {
    const server = await startServer({ password: 'another-pass' });
    const error = await adapterFor(server)
      .send({ to: 'student@example.com', subject: '验证码', text: '你的验证码是 1' })
      .then(
        () => null,
        (reason: unknown) => reason as Error,
      );
    expect(error).not.toBeNull();
    expect(error?.message).toContain('535');
    expect(error?.message).not.toContain('s3cret-pass');
  });
});

describe('SmtpMailAdapter · 不允许静默降级到明文', () => {
  it('服务器没宣告 STARTTLS 且没开 SMTP_ALLOW_INSECURE → 拒绝发送，凭据一次都没发出', async () => {
    const server = await startServer({ capabilities: [] });
    const error = await adapterFor(server, { SMTP_ALLOW_INSECURE: 'false' })
      .send({ to: 'student@example.com', subject: '验证码', text: '你的验证码是 1' })
      .then(
        () => null,
        (reason: unknown) => reason as Error,
      );

    expect(error?.message).toContain('STARTTLS');
    const sent = server.commands.join('\n');
    expect(sent).not.toContain('AUTH');
    expect(sent).not.toContain('s3cret-pass');
  });

  it('宣告了 STARTTLS 但握手失败 → 抛错，且明文连接上没有出现 AUTH / MAIL / 正文', async () => {
    // 假服务器收到 STARTTLS 就断开：模拟「能力宣告了，但 TLS 其实建不起来」
    const server = await startServer({ capabilities: ['STARTTLS', 'AUTH PLAIN LOGIN'], killOnStartTls: true });
    await expect(
      adapterFor(server, { SMTP_ALLOW_INSECURE: 'false', SMTP_TIMEOUT_MS: '1500' })
        .send({ to: 'student@example.com', subject: '验证码', text: '你的验证码是 1' })
        .then(
          () => null,
          (reason: unknown) => reason as Error,
        ),
    ).resolves.toBeInstanceOf(Error);

    const sent = server.commands.join('\n');
    expect(sent).toContain('STARTTLS');
    expect(sent).not.toContain('AUTH');
    expect(sent).not.toContain('MAIL FROM');
    expect(server.payloads).toHaveLength(0);
  });
});

describe('resolveMailTransport · 装配策略', () => {
  it('开发/测试环境没有 SMTP → 走日志实现（本机与 CI 都不可能有 SMTP）', () => {
    expect(resolveMailTransport(makeConfig({ NODE_ENV: 'development' }))).toBe('console');
  });

  it('配了 SMTP_HOST → 真发信（不管什么环境）', () => {
    expect(resolveMailTransport(makeConfig({ SMTP_HOST: 'smtp.example.com' }))).toBe('smtp');
  });

  it('生产环境没配 SMTP → **拒绝启动**（而不是带着假功能上线）', () => {
    expect(() => resolveMailTransport(makeConfig({ NODE_ENV: 'production' }))).toThrow(/SMTP|邮件/);
  });

  it('生产环境显式 MAIL_TRANSPORT=console → 也拒绝（要承认限制就得说清楚）', () => {
    expect(() =>
      resolveMailTransport(makeConfig({ NODE_ENV: 'production', MAIL_TRANSPORT: 'console' })),
    ).toThrow(/console/);
  });

  it('MAIL_TRANSPORT=smtp 但没给 SMTP_HOST → 明确报错', () => {
    expect(() => resolveMailTransport(makeConfig({ MAIL_TRANSPORT: 'smtp' }))).toThrow(/SMTP_HOST/);
  });

  it('MAIL_TRANSPORT 写错 → 明确报错（不静默忽略）', () => {
    expect(() => resolveMailTransport(makeConfig({ MAIL_TRANSPORT: 'sendmail' }))).toThrow(
      /MAIL_TRANSPORT/,
    );
  });
});
