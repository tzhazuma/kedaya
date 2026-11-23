import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
  UpstreamUnavailableError,
  ValidationError,
} from "../../../common/errors/app-error";
import type { ActivityArticleLike } from "@kedaya/shared";

interface OfficialAccountConfig {
  key: string;
  name: string;
  appId?: string;
  appSecret?: string;
  authorizerAccessToken?: string;
}

export interface OfficialArticle extends ActivityArticleLike {
  articleId: string;
  accountKey: string;
  digest: string;
}

interface TokenCache {
  value: string;
  expiresAt: number;
}

@Injectable()
export class WechatOfficialAccountService {
  private readonly configs: OfficialAccountConfig[];
  private readonly tokens = new Map<string, TokenCache>();

  constructor(
    config: ConfigService,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.configs = parseAccounts(
      config.get<string>("WECHAT_OFFICIAL_ACCOUNTS"),
    );
  }

  accounts(): Array<{ key: string; name: string }> {
    return this.configs.map(({ key, name }) => ({ key, name }));
  }

  async listPublished(accountKey: string): Promise<OfficialArticle[]> {
    const account = this.account(accountKey);
    const accessToken = await this.accessToken(account);
    const articles: OfficialArticle[] = [];
    for (let offset = 0; offset < 2000;) {
      const response = await this.fetcher(
        `https://api.weixin.qq.com/cgi-bin/freepublish/batchget?access_token=${encodeURIComponent(accessToken)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ offset, count: 20, no_content: 0 }),
        },
      );
      const body = (await response.json()) as {
        errcode?: number;
        errmsg?: string;
        total_count?: number;
        item_count?: number;
        item?: Array<{
          article_id: string;
          update_time: number;
          content: {
            news_item?: Array<{
              title: string;
              digest?: string;
              url?: string;
              content_source_url?: string;
              content?: string;
            }>;
          };
        }>;
      };
      if (!response.ok || (body.errcode !== undefined && body.errcode !== 0)) {
        throw new UpstreamUnavailableError(
          `公众号同步失败 ${String(body.errcode ?? response.status)}: ${body.errmsg ?? response.statusText}`,
        );
      }
      const items = body.item ?? [];
      for (const item of items) {
        for (const news of item.content.news_item ?? []) {
          articles.push({
            articleId: item.article_id,
            accountKey,
            accountName: account.name,
            title: news.title,
            digest: news.digest ?? "",
            publishedAt: new Date(item.update_time * 1000).toISOString(),
            sourceUrl: news.url ?? news.content_source_url ?? "",
            bodyLines: htmlLines(news.content ?? ""),
          });
        }
      }
      const received = Number(body.item_count ?? items.length);
      offset += received;
      if (
        received === 0 ||
        offset >= Number(body.total_count ?? 0) ||
        received < 20
      )
        break;
    }
    return articles;
  }

  private account(key: string): OfficialAccountConfig {
    const account = this.configs.find((item) => item.key === key);
    if (!account) throw new ValidationError(`未配置公众号：${key}`);
    return account;
  }

  private async accessToken(account: OfficialAccountConfig): Promise<string> {
    if (account.authorizerAccessToken) return account.authorizerAccessToken;
    const cached = this.tokens.get(account.key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
    if (!account.appId || !account.appSecret) {
      throw new ValidationError(
        `公众号 ${account.name} 缺少 authorizerAccessToken 或 appId/appSecret`,
      );
    }
    const query = new URLSearchParams({
      grant_type: "client_credential",
      appid: account.appId,
      secret: account.appSecret,
    });
    const response = await this.fetcher(
      `https://api.weixin.qq.com/cgi-bin/token?${query}`,
    );
    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      errcode?: number;
      errmsg?: string;
    };
    if (!response.ok || !body.access_token) {
      throw new UpstreamUnavailableError(
        `公众号令牌获取失败 ${String(body.errcode ?? response.status)}: ${body.errmsg ?? ""}`,
      );
    }
    this.tokens.set(account.key, {
      value: body.access_token,
      expiresAt: Date.now() + Number(body.expires_in ?? 7200) * 1000,
    });
    return body.access_token;
  }
}

function parseAccounts(raw: string | undefined): OfficialAccountConfig[] {
  if (!raw) return [];
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value))
    throw new Error("WECHAT_OFFICIAL_ACCOUNTS 必须是 JSON 数组");
  return value.filter(
    (item): item is OfficialAccountConfig =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as OfficialAccountConfig).key === "string" &&
      typeof (item as OfficialAccountConfig).name === "string",
  );
}

function htmlLines(html: string): string[] {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<(?:p|div|section|br|li|h[1-6]|tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}
