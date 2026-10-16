import { randomBytes } from 'node:crypto';

/**
 * ULID 生成器（纯逻辑，零依赖）。
 *
 * 为什么后端需要自己生成 id（而不是全靠 Prisma 的 `@default(cuid())`）：
 *
 *   论坛的**匿名发帖**要保证「同帖同人一致、跨帖不可关联」。
 *   做法是把匿名 handle 绑到 `thread:<postId>` 上（见 forum.domain.ts），
 *   因此**必须在写库之前就知道 postId** —— 只能由应用层先生成。
 *
 * 为什么是 ULID 而不是 cuid：契约 02-domain-model §0.1 明确写了
 * 「`id`：ULID。有序、无碰撞、不可枚举。**不用自增整数**」。
 * 本模块新写入的行统一用 ULID；既有表仍由 Prisma 的 cuid() 兜底
 * （两种都是不可枚举的字符串，对分页游标等价）。
 *
 * 编码：Crockford Base32，26 字符 = 48 bit 时间戳 + 80 bit 随机数。
 * 同一毫秒内**单调递增**（随机段 +1），这样 `orderBy id asc` 的分页
 * 在同一毫秒的并发写入下依然稳定。
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;
const RANDOM_BYTES = 10; // 80 bit
const MAX_TIME = 2 ** 48 - 1;

export interface UlidFactoryOptions {
  /** 随机源（默认 node:crypto 的 randomBytes）；测试可注入确定性实现 */
  random?: (size: number) => Uint8Array;
  /** 时钟（默认 Date.now）；测试可注入 */
  now?: () => number;
}

function encodeTime(time: number): string {
  let out = '';
  let rest = time;
  for (let i = 0; i < TIME_CHARS; i += 1) {
    out = CROCKFORD[rest % 32] + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

function encodeRandom(bytes: Uint8Array): string {
  let bits = 0n;
  for (let i = 0; i < RANDOM_BYTES; i += 1) {
    bits = (bits << 8n) | BigInt(bytes[i] ?? 0);
  }
  let out = '';
  for (let i = 0; i < RANDOM_CHARS; i += 1) {
    out = CROCKFORD[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return out;
}

/** 大端 +1；溢出（全 0xFF）返回 false */
function incrementRandom(bytes: Uint8Array): boolean {
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    const next = (bytes[i] ?? 0) + 1;
    if (next <= 0xff) {
      bytes[i] = next;
      return true;
    }
    bytes[i] = 0;
  }
  return false;
}

export class UlidFactory {
  private readonly random: (size: number) => Uint8Array;
  private readonly now: () => number;
  private lastTime = -1;
  private lastRandom: Uint8Array = new Uint8Array(RANDOM_BYTES);

  constructor(options: UlidFactoryOptions = {}) {
    this.random = options.random ?? ((size) => randomBytes(size));
    this.now = options.now ?? (() => Date.now());
  }

  /** 随机源可能返回 `Uint8Array<ArrayBufferLike>`，这里统一拷成自有缓冲 */
  private drawRandom(): Uint8Array {
    return new Uint8Array(this.random(RANDOM_BYTES));
  }

  next(): string {
    let time = Math.floor(this.now());
    if (time < 0) time = 0;
    if (time > MAX_TIME) throw new RangeError('ULID 时间戳超出 48 bit 范围');

    if (time > this.lastTime) {
      this.lastTime = time;
      this.lastRandom = this.drawRandom();
    } else {
      // 同一毫秒（或时钟回拨）：在上一枚的随机段上 +1，保持单调
      time = this.lastTime;
      if (!incrementRandom(this.lastRandom)) {
        this.lastTime += 1;
        time = this.lastTime;
        this.lastRandom = new Uint8Array(RANDOM_BYTES);
      }
    }

    return encodeTime(time) + encodeRandom(this.lastRandom);
  }
}

const defaultFactory = new UlidFactory();

/** 生成一枚 ULID（进程内单调） */
export function ulid(): string {
  return defaultFactory.next();
}

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** 是否是合法 ULID（供入参校验用；大小写不敏感） */
export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value.toUpperCase());
}
