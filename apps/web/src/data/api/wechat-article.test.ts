import { describe, expect, it, vi } from 'vitest';

import { fetchWechatArticle } from './wechat-article';

/**
 * `POST /wechat/article` 的 Web 客户端。
 *
 * 这个端点是**公开的、且不套 ApiEnvelope**（成功 `{ok:true, article}`，
 * 业务失败也是 HTTP 200 + `{ok:false, code, message}`）。所以不能直接复用
 * `ApiClient` 的信封解包 —— 它会把这些响应当成脏数据。
 */
const ARTICLE = {
  title: '人工智能前沿讲座',
  accountName: '上科大信息学院',
  publishedAt: '2026-10-20T10:00:00+08:00',
  bodyLines: ['讲座时间：2026年10月25日 14:00', '地点：信息学院 1-101'],
  images: ['https://mmbiz.qpic.cn/demo.png'],
  sourceUrl: 'https://mp.weixin.qq.com/s/demo',
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchWechatArticle', () => {
  it('成功时返回文章视图，POST 只带 url 字段', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true, article: ARTICLE }));
    const result = await fetchWechatArticle('https://mp.weixin.qq.com/s/demo', {
      fetchImpl,
      traceId: 'trc-test',
      baseUrl: 'https://api.example.com/api/v1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toEqual(ARTICLE);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/api/v1/wechat/article');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ url: 'https://mp.weixin.qq.com/s/demo' });
    expect(init.credentials).toBe('omit');
    expect((init.headers as Record<string, string>)['X-KedaYa-Trace']).toBe('trc-test');
  });

  it('非公众号 / 非 https 链接在发请求前就被拒绝', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true, article: ARTICLE }));
    for (const url of [
      'http://mp.weixin.qq.com/s/demo',
      'https://example.com/s/demo',
      'https://mp.weixin.qq.com/mp/profile_ext?action=home',
      'not a url',
    ]) {
      const result = await fetchWechatArticle(url, { fetchImpl });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error.code).toBe('invalid-url');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('业务失败（HTTP 200 + ok:false）原样保留 code 与中文提示', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        ok: false,
        code: 'login-required',
        message: '正文容器是空的 —— 这篇文章可能要求「关注公众号后查看」',
      }),
    );
    const result = await fetchWechatArticle('https://mp.weixin.qq.com/s/demo', { fetchImpl });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('login-required');
    expect(result.error.message).toContain('关注公众号后查看');
    expect(result.error.status).toBe(200);
  });

  it('网络错误给出可执行提示，而不是抛出异常', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const result = await fetchWechatArticle('https://mp.weixin.qq.com/s/demo', { fetchImpl });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('network-error');
    expect(result.error.message).toContain('网络');
  });

  it('非 JSON / 结构不对的响应不会被当成成功', async () => {
    const notJson = vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 }));
    const first = await fetchWechatArticle('https://mp.weixin.qq.com/s/demo', {
      fetchImpl: notJson,
    });
    expect(first.ok).toBe(false);
    if (first.ok) throw new Error('unreachable');
    expect(first.error.code).toBe('http-error');
    expect(first.error.status).toBe(502);

    const dirty = vi.fn(async () =>
      jsonResponse({ ok: true, article: { title: '缺字段', bodyLines: '不是数组' } }),
    );
    const second = await fetchWechatArticle('https://mp.weixin.qq.com/s/demo', {
      fetchImpl: dirty,
    });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.error.code).toBe('invalid-response');
  });
});
