import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { connect as connectTcp, type Socket } from 'node:net';
import { connect as connectTls, type TLSSocket } from 'node:tls';

import type { MailMessage, MailPort } from '../domain/local-account.domain';

/**
 * 生产用邮件实现：**零依赖**的 SMTP 客户端。
 *
 * ## 为什么这件事是「能不能上线」级别的问题
 *
 * 在此之前，本仓库只有一个 `ConsoleMailAdapter`：它把验证码写进服务端日志。
 * 开发时这没问题（`AUTH_DEV_EXPOSE_CODES=true` 还能把验证码直接回给客户端），
 * 但生产镜像固定 `NODE_ENV=production`、该开关必须为 false ——
 * 于是**用户点「获取验证码」永远收不到邮件**，而接口返回 200「已发送」。
 * 邮箱注册、找回密码、绑定邮箱三条路全部静默失效，
 * 而这恰恰是校园 CAS 还没拿到授权时**唯一能自己走通的登录路径**。
 *
 * 所以这里不只是「补一个适配器」，还包括一条硬约束：见 `resolveMailTransport` ——
 * 生产环境没配 SMTP 时**直接拒绝启动**，而不是带着一个假功能上线。
 *
 * ## 为什么手写 SMTP 而不是装 nodemailer
 *
 * SMTP 的发送侧只有几条命令（EHLO / STARTTLS / AUTH / MAIL / RCPT / DATA / QUIT），
 * 我们要用到的能力是它的一个很小的子集。手写 ≈300 行、可读、可测（见本文件的 spec：
 * 用内存里的假 SMTP 服务器逐条断言命令序列），换来的是**依赖树里不多一个包**、
 * 以及出错信息可以写成人话。真实对接点只需要一套凭据，不需要改代码。
 *
 * ## 安全底线
 *
 * - 默认走 TLS：`SMTP_SECURE=true` → 隐式 TLS（465）；否则明文 + `STARTTLS`（587）。
 * - 服务器**没提供** STARTTLS 且没开 `SMTP_ALLOW_INSECURE` 时**拒绝发送** ——
 *   否则用户名、密码、验证码都会在公网明文里跑，而且没人会发现。
 * - 日志里**永远不出现**密码与正文；错误信息只带 SMTP 回复码与对端提示。
 * - 正文整体 base64 编码：既绕开中文编码问题，也顺带消除
 *   「正文里有一行以 `.` 开头」导致 `DATA` 被提前结束的经典陷阱。
 */

/** 单条命令（含连接与 TLS 握手）的等待上限，可用 `SMTP_TIMEOUT_MS` 覆盖 */
const DEFAULT_TIMEOUT_MS = 10_000;
const CRLF = '\r\n';

interface SmtpReply {
  code: number;
  lines: string[];
}

class SmtpError extends Error {
  constructor(message: string, readonly replyCode?: number) {
    super(message);
    this.name = 'SmtpError';
  }
}

interface SmtpSettings {
  host: string;
  port: number;
  /** 隐式 TLS（465）。false 时要求 STARTTLS 升级 */
  secure: boolean;
  /** 非空则必须认证 */
  user: string;
  pass: string;
  /** 原始 `SMTP_FROM`，可能是 `名字 <a@b.c>` */
  from: string;
  fromAddress: string;
  servername: string;
  allowInsecure: boolean;
  timeoutMs: number;
}

/* ------------------------------------------------------------------ *
 * SMTP 连接：行协议 + 多行回复 + STARTTLS 升级
 * ------------------------------------------------------------------ */

class SmtpConnection {
  private socket: Socket | TLSSocket;
  private buffer = '';
  private partial: string[] = [];
  /** 已经收到、但还没有人在等的回复（理论上不该有，留作兜底） */
  private readonly ready: SmtpReply[] = [];
  private waiter: { resolve: (reply: SmtpReply) => void; reject: (error: Error) => void } | null =
    null;

  constructor(socket: Socket | TLSSocket, private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.socket = socket;
    this.attach(socket);
  }

  private attach(socket: Socket | TLSSocket): void {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setTimeout(this.timeoutMs);
    socket.on('timeout', () => {
      this.fail(new SmtpError(`等待 SMTP 服务器响应超时（${this.timeoutMs}ms）`));
    });
    socket.on('data', (chunk: string) => {
      this.consume(chunk);
    });
    socket.on('error', (error: Error) => {
      this.fail(error);
    });
    socket.on('close', () => {
      // 主动 QUIT 之后的关闭是正常的：此时没有人在等回复，fail 是空操作。
      this.fail(new SmtpError('SMTP 连接被对端关闭'));
    });
  }

  /** 摘掉监听：TLS 握手期间的字节不能被当成 SMTP 回复 */
  private detach(): void {
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('error');
    this.socket.removeAllListeners('close');
    this.socket.removeAllListeners('timeout');
    this.socket.setTimeout(0);
  }

  private fail(error: Error): void {
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.reject(error);
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf(CRLF);
    while (index >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + CRLF.length);
      this.partial.push(line);
      // `250-...` 表示后面还有行，`250 ...` 才是这条回复的结尾（RFC 5321 §4.2.1）
      if (/^\d{3} /.test(line)) {
        const reply: SmtpReply = { code: Number(line.slice(0, 3)), lines: [...this.partial] };
        this.partial = [];
        const waiter = this.waiter;
        this.waiter = null;
        if (waiter) waiter.resolve(reply);
        else this.ready.push(reply);
      }
      index = this.buffer.indexOf(CRLF);
    }
  }

  readReply(): Promise<SmtpReply> {
    const buffered = this.ready.shift();
    if (buffered !== undefined) return Promise.resolve(buffered);
    if (this.waiter !== null) {
      return Promise.reject(new SmtpError('SMTP 客户端状态错乱：上一次回复还没读完就发了下一条命令'));
    }
    return new Promise<SmtpReply>((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }

  /** 发一条命令并读回复（**不判断**是否成功，由调用方决定接受哪些码） */
  async command(text: string): Promise<SmtpReply> {
    this.socket.write(`${text}${CRLF}`);
    return this.readReply();
  }

  expect(reply: SmtpReply, accepted: readonly number[], what: string): void {
    if (accepted.includes(reply.code)) return;
    const detail = reply.lines.join(' ').slice(0, 200);
    throw new SmtpError(`${what} 被拒绝（SMTP ${reply.code}）：${detail}`, reply.code);
  }

  async upgradeToTls(servername: string): Promise<void> {
    const plain = this.socket;
    this.detach();
    this.buffer = '';
    this.partial = [];
    const secured = await new Promise<TLSSocket>((resolve, reject) => {
      const tlsSocket: TLSSocket = connectTls({ socket: plain, servername });
      /**
       * TLS 握手必须有自己的表：`socket.setTimeout` 只会触发 `timeout` 事件，
       * 而 `timeout` 的处理器走的是「有人在等 SMTP 回复」那条路。握手期间没有人等回复，
       * 所以不加这个表，一个不回 ServerHello 的对端会让这里一直挂着。
       */
      const timer = setTimeout(() => {
        tlsSocket.destroy();
        reject(new SmtpError(`TLS 握手超时（${this.timeoutMs}ms）`));
      }, this.timeoutMs);
      tlsSocket.once('error', (error: Error) => {
        clearTimeout(timer);
        tlsSocket.destroy();
        reject(error);
      });
      tlsSocket.once('secureConnect', () => {
        clearTimeout(timer);
        resolve(tlsSocket);
      });
    });
    this.attach(secured);
  }

  close(): void {
    this.detach();
    this.socket.destroy();
  }
}

/* ------------------------------------------------------------------ *
 * 报文构造
 * ------------------------------------------------------------------ */

/** 非 ASCII 的头部值必须用 RFC 2047 编码字（中文主题、中文发件人名） */
function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  // 编码字单行上限 75 字符；可达鸭的邮件主题都很短，超出时由调用方控制。
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** 抽出裸地址（`MAIL FROM:<...>` 只能用地址，不能带显示名） */
function extractAddress(raw: string): string {
  const matched = /<([^>]+)>/.exec(raw);
  return (matched?.[1] ?? raw).trim();
}

function formatFrom(raw: string): string {
  const matched = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw);
  const address = extractAddress(raw);
  if (matched === null) return `<${address}>`;
  const name = (matched[1] ?? '').replace(/^"|"$/g, '');
  if (name === '') return `<${address}>`;
  return `${encodeHeaderValue(name)} <${address}>`;
}

function buildMessage(settings: SmtpSettings, message: MailMessage): string {
  const body = Buffer.from(message.text, 'utf8')
    .toString('base64')
    .replace(/(.{76})/g, `$1${CRLF}`);
  const domain = settings.fromAddress.split('@')[1] ?? 'localhost';
  const headers = [
    `From: ${formatFrom(settings.from)}`,
    `To: <${message.to}>`,
    `Subject: ${encodeHeaderValue(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    // 自动生成的通知类邮件，避免被对方的休假自动回复纠缠
    'Auto-Submitted: auto-generated',
  ];
  return `${headers.join(CRLF)}${CRLF}${CRLF}${body}${CRLF}`;
}

/* ------------------------------------------------------------------ *
 * 适配器
 * ------------------------------------------------------------------ */

@Injectable()
export class SmtpMailAdapter implements MailPort {
  private readonly logger = new Logger('KedaYaMail');

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async send(message: MailMessage): Promise<void> {
    const settings = this.readSettings();
    const socket = await dial(settings);
    const connection = new SmtpConnection(socket, settings.timeoutMs);
    try {
      await negotiate(connection, settings);
      await deliver(connection, settings, message);
      this.logger.log(`[mail] 已投递给 SMTP（to=${maskEmail(message.to)}）`);
    } finally {
      connection.close();
    }
  }

  private readSettings(): SmtpSettings {
    const host = (this.config.get<string>('SMTP_HOST') ?? '').trim();
    if (host === '') throw new SmtpError('SMTP_HOST 未配置');
    const secure = isTruthy(this.config.get<string>('SMTP_SECURE'));
    const rawPort = (this.config.get<string>('SMTP_PORT') ?? '').trim();
    const port = rawPort === '' ? (secure ? 465 : 587) : Number(rawPort);
    if (!Number.isInteger(port) || port <= 0) {
      throw new SmtpError(`SMTP_PORT 不合法：${rawPort}`);
    }
    const from = (this.config.get<string>('SMTP_FROM') ?? '').trim();
    if (from === '') {
      throw new SmtpError(
        'SMTP_FROM 未配置。它同时是邮件的 From 头与 MAIL FROM 地址，必须是服务商允许的发信地址。',
      );
    }
    const rawTimeout = (this.config.get<string>('SMTP_TIMEOUT_MS') ?? '').trim();
    const timeoutMs = rawTimeout === '' ? DEFAULT_TIMEOUT_MS : Number(rawTimeout);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new SmtpError(`SMTP_TIMEOUT_MS 不合法：${rawTimeout}`);
    }
    return {
      host,
      port,
      secure,
      user: (this.config.get<string>('SMTP_USER') ?? '').trim(),
      pass: this.config.get<string>('SMTP_PASS') ?? '',
      from,
      fromAddress: extractAddress(from),
      servername: (this.config.get<string>('SMTP_SERVERNAME') ?? host).trim(),
      allowInsecure: isTruthy(this.config.get<string>('SMTP_ALLOW_INSECURE')),
      timeoutMs,
    };
  }
}

function dial(settings: SmtpSettings): Promise<Socket | TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket: Socket | TLSSocket = settings.secure
      ? connectTls(
          { host: settings.host, port: settings.port, servername: settings.servername },
          () => {
            clearTimeout(timer);
            resolve(socket);
          },
        )
      : connectTcp({ host: settings.host, port: settings.port }, () => {
          clearTimeout(timer);
          resolve(socket);
        });
    // 连接阶段也要有尽头：一个被防火墙丢包的地址会让 OS 默认超时拖到两分钟，
    // 而用户那边只会看到「验证码一直转圈」。
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new SmtpError(`连接 SMTP 服务器超时（${settings.host}:${settings.port}）`));
    }, settings.timeoutMs);
    socket.once('error', (error: Error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(new SmtpError(`连接 SMTP 服务器失败（${settings.host}:${settings.port}）：${error.message}`));
    });
  });
}

/** 读出 `EHLO` 回复里的能力表（`STARTTLS`、`AUTH PLAIN LOGIN`…） */
function capabilities(reply: SmtpReply): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of reply.lines) {
    const body = line.slice(4);
    const [keyword, rest] = splitOnce(body);
    map.set(keyword.toUpperCase(), rest.toUpperCase());
  }
  return map;
}

function splitOnce(value: string): [string, string] {
  const index = value.indexOf(' ');
  return index < 0 ? [value, ''] : [value.slice(0, index), value.slice(index + 1)];
}

async function negotiate(connection: SmtpConnection, settings: SmtpSettings): Promise<void> {
  connection.expect(await connection.readReply(), [220], '连接问候');

  const fromDomain = settings.fromAddress.split('@')[1] ?? 'localhost';
  let ehlo = await connection.command(`EHLO ${fromDomain}`);
  connection.expect(ehlo, [250], 'EHLO');

  if (!settings.secure) {
    const advertised = capabilities(ehlo);
    if (!advertised.has('STARTTLS')) {
      if (!settings.allowInsecure) {
        throw new SmtpError(
          '服务器没有提供 STARTTLS。拒绝在明文连接上发送用户名/密码与验证码：' +
            '请改用 465（SMTP_SECURE=true，隐式 TLS），或确认服务商支持 587 + STARTTLS；' +
            '只有在明确知情时才设置 SMTP_ALLOW_INSECURE=true。',
        );
      }
    } else {
      connection.expect(await connection.command('STARTTLS'), [220], 'STARTTLS');
      await connection.upgradeToTls(settings.servername);
      ehlo = await connection.command(`EHLO ${fromDomain}`);
      connection.expect(ehlo, [250], 'EHLO（TLS 升级之后）');
    }
  }

  if (settings.user === '') return;
  await authenticate(connection, settings, capabilities(ehlo));
}

async function authenticate(
  connection: SmtpConnection,
  settings: SmtpSettings,
  advertised: Map<string, string>,
): Promise<void> {
  const mechanisms = (advertised.get('AUTH') ?? '').split(' ').filter((item) => item !== '');

  if (mechanisms.includes('PLAIN')) {
    // AUTH PLAIN 的载荷是 \0user\0pass，一次性发完，比 LOGIN 少一个来回
    const payload = Buffer.from(
      `\u0000${settings.user}\u0000${settings.pass}`,
      'utf8',
    ).toString('base64');
    connection.expect(
      await connection.command(`AUTH PLAIN ${payload}`),
      [235],
      'AUTH PLAIN（用户名或密码错误时，服务商通常返回 535）',
    );
    return;
  }

  if (mechanisms.includes('LOGIN') || mechanisms.length === 0) {
    // LOGIN 是最通用的兜底（QQ 企业邮 / 163 / 阿里云 / Resend 都支持）
    connection.expect(await connection.command('AUTH LOGIN'), [334], 'AUTH LOGIN');
    connection.expect(
      await connection.command(Buffer.from(settings.user, 'utf8').toString('base64')),
      [334],
      'AUTH LOGIN（用户名）',
    );
    connection.expect(
      await connection.command(Buffer.from(settings.pass, 'utf8').toString('base64')),
      [235],
      'AUTH LOGIN（密码）',
    );
    return;
  }

  throw new SmtpError(
    `服务器只支持这些认证方式：${mechanisms.join(', ')}；本实现支持 PLAIN 与 LOGIN。`,
  );
}

async function deliver(
  connection: SmtpConnection,
  settings: SmtpSettings,
  message: MailMessage,
): Promise<void> {
  connection.expect(
    await connection.command(`MAIL FROM:<${settings.fromAddress}>`),
    [250],
    'MAIL FROM',
  );
  connection.expect(
    await connection.command(`RCPT TO:<${message.to}>`),
    [250, 251],
    'RCPT TO（收件人被拒通常意味着发信域/地址不被服务商允许）',
  );
  connection.expect(await connection.command('DATA'), [354], 'DATA');
  connection.expect(
    await connection.command(`${buildMessage(settings, message)}.`),
    [250],
    '投递正文',
  );
  // QUIT 之后对端常直接断开，因此这条回复不重要
  await connection.command('QUIT').catch(() => undefined);
}

/* ------------------------------------------------------------------ *
 * 装配策略：生产环境不允许「静默地只打日志」
 * ------------------------------------------------------------------ */

export type MailTransport = 'console' | 'smtp';

/**
 * 选邮件实现。**故意会在生产环境抛错**。
 *
 * 原来的写法是「没有 SMTP 就用 ConsoleMailAdapter」——它让一个**假功能**
 * 顺利上线：接口返回「验证码已发送」，用户永远收不到邮件，
 * 而日志里那行 `[dev-mail] ...` 只有运维能看到。这比编译错误危险得多。
 *
 * 所以：
 *   - `MAIL_TRANSPORT=smtp` 或配了 `SMTP_HOST` → 真发信
 *   - 生产环境 + 两者都没配 → **拒绝启动**（错误信息里给出两条出路：配 SMTP，或显式承认是演示部署）
 *   - 非生产 → 日志实现（本机与 CI 没有 SMTP，且开发时 `AUTH_DEV_EXPOSE_CODES` 可回显验证码）
 */
export function resolveMailTransport(config: ConfigService): MailTransport {
  const explicit = (config.get<string>('MAIL_TRANSPORT') ?? '').trim().toLowerCase();
  const host = (config.get<string>('SMTP_HOST') ?? '').trim();
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  if (explicit !== '' && explicit !== 'console' && explicit !== 'smtp') {
    throw new Error(`MAIL_TRANSPORT 只能是 console 或 smtp，收到：${explicit}`);
  }

  if (explicit === 'console') {
    if (isProduction) {
      throw new Error(
        '生产环境不允许 MAIL_TRANSPORT=console：验证码只会写进服务端日志，用户永远收不到，' +
          '邮箱注册 / 找回密码 / 绑定邮箱会全部静默失效。如果这只是一次演示部署，' +
          '请把这点**显式**写在部署记录里并接受该限制。',
      );
    }
    return 'console';
  }

  if (explicit === 'smtp' || host !== '') {
    if (host === '') throw new Error('MAIL_TRANSPORT=smtp 但没有配置 SMTP_HOST');
    return 'smtp';
  }

  if (isProduction) {
    throw new Error(
      '生产环境必须配置邮件发信（SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM），' +
        '否则邮箱注册与找回密码会静默失效。见 docs/deploy.md §5.7。',
    );
  }
  return 'console';
}

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

/** 日志里只留域名，不留完整地址（日志会被长期保留） */
function maskEmail(email: string): string {
  const [local = '', domain] = email.split('@');
  if (domain === undefined) return '***';
  const head = local.slice(0, 1);
  return `${head}***@${domain}`;
}
