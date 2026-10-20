import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { WechatArticleService } from './wechat-article.service';

/**
 * 公众号文章抓取服务。
 *
 * ## 这组测试的重心是 **SSRF 防护**，不是解析正确性
 *
 * 这个端点接受**用户给的 URL**。如果不做域名白名单，它就是一个内网跳板 ——
 * 攻击者可以让服务器去请求 `http://169.254.169.254/`（云厂商元数据）或
 * `http://localhost:3100/`（我们自己的 API），把响应读出来。
 *
 * 解析正确性由 `@kedaya/shared` 的 26 条测试保证，这里只验「我们放不放行」。
 */
describe('WechatArticleService · ⚠️ SSRF 防护', () => {
  const service = new WechatArticleService();
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const rejected = [
    ['内网 IP', 'https://127.0.0.1/s/abc'],
    ['云厂商元数据地址', 'https://169.254.169.254/latest/meta-data/'],
    ['我们自己的 API', 'https://localhost:3100/api/v1/health'],
    ['http 而非 https', 'http://mp.weixin.qq.com/s/abc'],
    ['冒充的子域', 'https://mp.weixin.qq.com.evil.com/s/abc'],
    ['路径伪装', 'https://mp.weixin.qq.com/../../etc/passwd'],
    ['非文章路径', 'https://mp.weixin.qq.com/cgi-bin/token'],
    ['完全无关的站', 'https://example.com/s/abc'],
  ] as const;

  for (const [label, url] of rejected) {
    it(`拒绝 ${label}`, async () => {
      const result = await service.fetchAndParse(url);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.code).toBe('invalid-url');
      // 最关键的一条：**根本不该发出请求**
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it('畸形 URL 也不发请求', async () => {
    const result = await service.fetchAndParse('not a url');
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('WechatArticleService · ⚠️ 不跟随跳转', () => {
  const service = new WechatArticleService();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('用 redirect: manual（不自动跟随）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Map(),
      text: async () => '<html><body>没有正文容器</body></html>',
    });
    vi.stubGlobal('fetch', fetchMock);

    await service.fetchAndParse('https://mp.weixin.qq.com/s/abc');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.redirect).toBe('manual');
    expect(init?.signal).toBeDefined();
  });

  it('3xx（opaque 响应 status 0）被当作失败，不当作内容', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 0,
        ok: false,
        headers: new Map(),
        text: async () => 'should not be read',
      }),
    );

    const result = await service.fetchAndParse('https://mp.weixin.qq.com/s/abc');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('http-error');
    expect(result.message).toContain('跳转');
  });
});

describe('WechatArticleService · HTTP 失败与解析委托', () => {
  const service = new WechatArticleService();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('HTTP 404 → http-error，消息带状态码', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 404, ok: false, headers: new Map(), text: async () => '' }),
    );
    const result = await service.fetchAndParse('https://mp.weixin.qq.com/s/abc');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('http-error');
    expect(result.message).toContain('404');
  });

  it('content-length 超限 → 直接拒绝，不读 body', async () => {
    const textMock = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Map([['content-length', String(999 * 1024 * 1024)]]),
        text: textMock,
      }),
    );
    const result = await service.fetchAndParse('https://mp.weixin.qq.com/s/abc');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.message).toContain('过大');
    expect(textMock).not.toHaveBeenCalled();
  });

  it('页面不是文章 → 委托给 shared 的解析器，返回它的错误码', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Map(),
        text: async () => '<html><body><p>这不是微信公众号文章页</p></body></html>',
      }),
    );
    const result = await service.fetchAndParse('https://mp.weixin.qq.com/s/abc');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    // shared 的 `parseWechatArticle` 给 unrecognized-structure
    expect(result.code).toBe('unrecognized-structure');
  });

  it('正常文章 → 返回 title / accountName / bodyLines / images', async () => {
    const html = `<!DOCTYPE html><html><head>
      <meta property="og:article:author" content="图信中心" />
    </head><body>
      <div class="rich_media_content" id="js_content">
        <p>讲座时间：10月25日 14:00</p>
        <p>地点：信息学院 1-101</p>
        <img data-src="/mmbiz/a.png" />
      </div>
      <div class="rich_media_area_extra"></div>
      <script>
        var msg_title = "关于举办某某讲座的通知".html(false);
        var nickname = htmlDecode("上海科技大学");
        var ct = "1694078981";
      </script>
    </body></html>`;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Map(),
        text: async () => html,
      }),
    );

    const result = await service.fetchAndParse('https://mp.weixin.qq.com/s/abc');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.article.title).toBe('关于举办某某讲座的通知');
    expect(result.article.accountName).toBe('上海科技大学');
    expect(result.article.publishedAt).toBe('2023-09-07T17:29:41.000+08:00');
    expect(result.article.bodyLines).toContain('讲座时间：10月25日 14:00');
    expect(result.article.images).toHaveLength(1);
  });
});
