import { Injectable } from '@nestjs/common';

import { parseWechatArticle, type WechatArticle } from '@kedaya/shared';

/** 取一次文章 HTML 的超时（毫秒）。微信正文页 3–4 MB，给宽一点。 */
const FETCH_TIMEOUT_MS = 12_000;

/** 文章页大小上限。超过这个基本不是文章（或被注入了别的东西）。 */
const MAX_HTML_BYTES = 12 * 1024 * 1024;

export type WechatFetchOutcome =
  | { readonly ok: true; readonly article: WechatArticle }
  | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * 公众号文章抓取 + 解析。
 *
 * ## ⚠️ 三条安全边界（都很关键）
 *
 * 1. **只允许 `mp.weixin.qq.com`**。这个端点接受用户给的 URL ——
 *    不做域名白名单的话，它就是一个**内网 SSRF 跳板**
 *    （`http://169.254.169.254/` 之类）。这是硬校验，不是建议。
 * 2. **不跟随跳转**（`redirect: 'manual'`）。跳转是绕过域名白名单的常见手法。
 * 3. **限制响应体大小 + 超时**。否则一个超大响应能把进程拖死。
 *
 * ## 为什么不带任何 Cookie / 登录态
 *
 * 我们读的是**公开文章页**。带 Cookie 既无必要，也会让「我们不是爬虫」
 * 这个定位站不住。用户自己的 Cookie 一律不接收。
 */
@Injectable()
export class WechatArticleService {
  async fetchAndParse(rawUrl: string): Promise<WechatFetchOutcome> {
    const normalized = this.normalizeUrl(rawUrl);
    if (normalized === null) {
      return {
        ok: false,
        code: 'invalid-url',
        message: '只支持 https://mp.weixin.qq.com/s/ 形式的公众号文章链接',
      };
    }

    let html: string;
    try {
      html = await this.fetchHtml(normalized);
    } catch (error) {
      return {
        ok: false,
        code: 'http-error',
        message: error instanceof Error ? error.message : '取文章失败',
      };
    }

    const parsed = parseWechatArticle(html, normalized);
    if (!parsed.ok) {
      return { ok: false, code: parsed.error.code, message: parsed.error.message };
    }
    return { ok: true, article: parsed.value };
  }

  /**
   * 校验并规范化 URL。
   *
   * ⚠️ 只认 `https` + `mp.weixin.qq.com`，且路径必须是文章路径。
   * 三个条件缺一不可。
   */
  private normalizeUrl(rawUrl: string): string | null {
    let url: URL;
    try {
      url = new URL(rawUrl.trim());
    } catch {
      return null;
    }
    if (url.protocol !== 'https:') return null;
    if (url.hostname !== 'mp.weixin.qq.com') return null;
    // `/s/<id>` 是现行写法；`/mp/appmsg/show` 是历史写法，仍有人分享
    if (!/^\/(s\/|mp\/appmsg\/show)/.test(url.pathname)) return null;
    return url.toString();
  }

  private async fetchHtml(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        // ⚠️ 不跟随跳转：跳转是绕过域名白名单的常见手法
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          // 普通桌面浏览器 UA 取公开页。不伪装成别的平台，也不带 Cookie。
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
          'accept-language': 'zh-CN,zh;q=0.9',
        },
      });

      // `redirect: 'manual'` 下 3xx 会以 opaque 响应返回（status 0）
      if (response.status === 0) {
        throw new Error('文章地址发生了跳转，已拒绝跟随（可能是短链或已失效）');
      }
      if (!response.ok) {
        throw new Error(`取文章失败：HTTP ${response.status}`);
      }

      const lengthHeader = response.headers.get('content-length');
      if (lengthHeader !== null && Number(lengthHeader) > MAX_HTML_BYTES) {
        throw new Error('文章页面过大，已拒绝处理');
      }
      const html = await response.text();
      if (html.length > MAX_HTML_BYTES) {
        throw new Error('文章页面过大，已拒绝处理');
      }
      return html;
    } finally {
      clearTimeout(timer);
    }
  }
}
