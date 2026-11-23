/**
 * 公众号文章端点（`POST /wechat/article`）的 Web 客户端。
 *
 * ## 为什么不用 `getApiClient()`
 *
 * 这是全仓少数**不套 ApiEnvelope** 的公开端点：成功返回
 * `{ ok: true, article }`，业务失败也是 HTTP 200 + `{ ok: false, code, message }`。
 * 统一客户端会把 `{ok:true}` 当成信封，解出 `data: undefined` —— 于是「成功但
 * 文章为空」和「解析失败」看起来一样。这里按端点自己的契约解包，并继续走
 * `data/` 层（网络访问不散落在组件里）。
 *
 * 仍然保留统一客户端的两个习惯：`X-KedaYa-Trace` 与显式超时；**不带 Cookie**。
 */
import { API_BASE_PATH, TRACE_HEADER } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import { validateWechatArticleUrl } from '@/domain/models/activities';

import { createTraceId } from './client';

export interface WechatArticleView {
  readonly title: string;
  readonly accountName: string;
  readonly publishedAt: string | null;
  readonly bodyLines: readonly string[];
  readonly images: readonly string[];
  readonly sourceUrl: string;
}

export interface WechatArticleError {
  readonly code: string;
  readonly message: string;
  readonly status?: number;
}

export interface FetchWechatArticleOptions {
  readonly fetchImpl?: typeof globalThis.fetch;
  /** 默认 `/api/v1`（同源反代）；独立部署时传绝对地址 */
  readonly baseUrl?: string;
  readonly traceId?: string;
  /** 默认 15 秒 */
  readonly timeoutMs?: number;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isArticleView(value: unknown): value is WechatArticleView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.title === 'string'
    && typeof candidate.accountName === 'string'
    && (candidate.publishedAt === null || typeof candidate.publishedAt === 'string')
    && isStringArray(candidate.bodyLines)
    && isStringArray(candidate.images)
    && typeof candidate.sourceUrl === 'string'
  );
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function fetchWechatArticle(
  rawUrl: string,
  options: FetchWechatArticleOptions = {},
): Promise<Result<WechatArticleView, WechatArticleError>> {
  const validation = validateWechatArticleUrl(rawUrl);
  if (!validation.ok) {
    return err({ code: 'invalid-url', message: validation.message });
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return err({
      code: 'network-error',
      message: '当前浏览器没有可用的网络请求能力，请更换浏览器后重试。',
    });
  }

  const baseUrl = options.baseUrl ?? process.env.NEXT_PUBLIC_KEDAYA_API_BASE ?? API_BASE_PATH;
  const traceId = options.traceId ?? createTraceId();
  const timeoutMs = options.timeoutMs ?? 15_000;

  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs > 0 && typeof AbortController === 'function') {
    controller = new AbortController();
    timer = setTimeout(() => controller?.abort(), timeoutMs);
  }

  let response: Response;
  try {
    response = await fetchImpl(joinUrl(baseUrl, '/wechat/article'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        [TRACE_HEADER]: traceId,
      },
      body: JSON.stringify({ url: validation.url }),
      // 公开文章，无需登录态；明确不带 Cookie
      credentials: 'omit',
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch {
    return err({
      code: 'network-error',
      message: '网络请求失败，请检查网络后重试。',
    });
  } finally {
    if (timer) clearTimeout(timer);
  }

  let payload: unknown;
  try {
    const text = await response.text();
    payload = text === '' ? undefined : JSON.parse(text);
  } catch {
    return err({
      code: response.ok ? 'invalid-response' : 'http-error',
      message: response.ok
        ? '服务端返回的不是合法 JSON，请稍后重试。'
        : `读取文章失败（HTTP ${response.status}），请稍后重试。`,
      status: response.status,
    });
  }

  if (typeof payload !== 'object' || payload === null || !('ok' in payload)) {
    return err({
      code: response.ok ? 'invalid-response' : 'http-error',
      message: `读取文章失败（HTTP ${response.status}），请稍后重试。`,
      status: response.status,
    });
  }

  const body = payload as Record<string, unknown>;
  if (body.ok === true) {
    if (!isArticleView(body.article)) {
      return err({
        code: 'invalid-response',
        message: '服务端返回的文章结构不完整，请稍后重试或反馈给我们。',
        status: response.status,
      });
    }
    return ok(body.article);
  }

  if (body.ok === false) {
    return err({
      code: typeof body.code === 'string' ? body.code : 'unknown',
      message:
        typeof body.message === 'string' && body.message.trim() !== ''
          ? body.message
          : '读取文章失败，请稍后重试。',
      status: response.status,
    });
  }

  return err({
    code: 'invalid-response',
    message: '服务端返回了无法识别的结果，请稍后重试。',
    status: response.status,
  });
}
