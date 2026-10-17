import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature V4 签名（零依赖实现）。
 *
 * 为什么手写而不是引 `@aws-sdk/client-s3`：
 *   · 我们只需要**一个 PUT**（外加可选 DELETE），为此拉进 AWS SDK 会让镜像里
 *     多出几十 MB 依赖 —— 微信云托管的构建时限是 10 分钟，这个账不划算；
 *   · S3 兼容协议（COS / OSS / MinIO / R2）都接受 V4 签名，
 *     所以这一份实现就能打通"到时候配置即可"的诉求。
 *
 * 正确性由 `s3-signature.spec.ts` 用 **AWS 官方测试向量** 校验（不是自己对自己）。
 * 改动本文件前请先看那组向量 —— 签名写错的表现是"服务端 403 SignatureDoesNotMatch"，
 * 在真实云存储上排查成本很高。
 *
 * 只实现 PUT / DELETE / GET 的**头签名**（header-based signing，不预签 URL）。
 */

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** 临时凭证（STS）用；不填则不带 `x-amz-security-token` */
  sessionToken?: string;
}

export interface SignInput {
  method: 'PUT' | 'DELETE' | 'GET' | 'HEAD';
  /** 完整 URL（含 query） */
  url: string;
  /** 参与签名的自定义头（会被小写化后并入 canonical headers） */
  headers?: Record<string, string>;
  /** 请求体；GET/HEAD 传空 Buffer */
  body: Buffer;
  region: string;
  /** 默认 s3 */
  service?: string;
  credentials: S3Credentials;
  /** 签名时刻（UTC）。注入是为了让测试可复现 */
  date: Date;
  /**
   * 是否附加 `x-amz-content-sha256`。
   *
   * S3 系（COS / OSS / MinIO / R2）**必须**带；其它 AWS 服务不需要。
   * 之所以做成开关，一是为了能拿 AWS 官方文档里那个 IAM 示例做端到端校验
   * （那个示例的 SignedHeaders 里没有这一项），二是避免把 S3 专有头
   * 硬塞给非 S3 调用方。
   */
  includeContentSha256?: boolean;
}

/** 结果里含必须**原样发出**的头（Authorization 与 x-amz-*） */
export type SignedHeaders = Record<string, string>;

const ALGORITHM = 'AWS4-HMAC-SHA256';

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** RFC 3986 的 percent-encode；`encodeURIComponent` 不编码 `!'()*`，S3 要求编码 */
function uriEncode(value: string, encodeSlash: boolean): string {
  let out = '';
  for (const char of Buffer.from(value, 'utf8').toString('latin1')) {
    const code = char.charCodeAt(0);
    const isUnreserved =
      (code >= 0x41 && code <= 0x5a) || // A-Z
      (code >= 0x61 && code <= 0x7a) || // a-z
      (code >= 0x30 && code <= 0x39) || // 0-9
      char === '-' ||
      char === '_' ||
      char === '.' ||
      char === '~';
    if (isUnreserved) out += char;
    else if (char === '/') out += encodeSlash ? '%2F' : '/';
    else out += `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** `2026-10-17T06:00:00.000Z` → `20261017T060000Z` */
function amzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function dateStamp(date: Date): string {
  return amzDate(date).slice(0, 8);
}

/**
 * canonical URI。
 *
 * `new URL().pathname` 拿到的已经是**已编码**的路径，直接再编码会变成双重编码
 * （`%E6%A0%A1` → `%25E6...`），签名必然不匹配。所以先解码回原始字符再按
 * RFC 3986 编码一次。解码失败（路径里有裸 `%`）时退回原样 —— 宁可让签名
 * 服务端报错，也不能因为 `decodeURIComponent` 抛 URIError 把请求变成 500。
 */
function canonicalPath(pathname: string): string {
  const raw = pathname === '' ? '/' : pathname;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  return uriEncode(decoded, false);
}

/**
 * 计算并返回需要附加到请求上的头。
 *
 * 返回的头**必须**原样发出去（大小写不敏感，但值必须完全一致），
 * 因为其中任何一项变了签名都会失效。
 */
export function signS3Request(input: SignInput): SignedHeaders {
  const url = new URL(input.url);
  const service = input.service ?? 's3';

  // ---- 1. canonical headers（必须含 host 与 x-amz-content-sha256）----
  const payloadHash = sha256Hex(input.body);
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-date': amzDate(input.date),
    ...normalizeHeaders(input.headers ?? {}),
  };
  if (input.includeContentSha256 !== false) headers['x-amz-content-sha256'] = payloadHash;
  if (input.credentials.sessionToken !== undefined) {
    headers['x-amz-security-token'] = input.credentials.sessionToken;
  }

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames
    .map((name) => `${name}:${(headers[name] ?? '').trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const signedHeaders = sortedNames.join(';');

  // ---- 2. canonical request ----
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([key, value]) => [uriEncode(key, true), uriEncode(value, true)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const canonicalRequest = [
    input.method,
    canonicalPath(url.pathname),
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // ---- 3. string to sign ----
  const scope = `${dateStamp(input.date)}/${input.region}/${service}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate(input.date), scope, sha256Hex(canonicalRequest)].join('\n');

  // ---- 4. signing key（HMAC 链）----
  const kDate = hmac(`AWS4${input.credentials.secretAccessKey}`, dateStamp(input.date));
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return {
    ...headers,
    authorization:
      `${ALGORITHM} Credential=${input.credentials.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = value;
  return out;
}
