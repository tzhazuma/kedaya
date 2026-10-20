import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import type { WechatArticle } from '@kedaya/shared';

import { WechatArticleService } from './application/wechat-article.service';

/**
 * `POST /wechat/article` 的入参。
 *
 * `.strict()`：客户端多塞 `cookie` / `headers` 之类会被结构性拒绝 ——
 * 否则会让人以为那些字段起了作用。
 */
const singleUrl = z
  .string()
  .trim()
  .min(10)
  .max(2048)
  .url('必须是合法 URL');

/**
 * 入参：**单条 `url` 或批量 `urls`**（二选一）。
 *
 * ## 为什么需要批量
 *
 * 微信**没有**公开的「公众号历史文章」API —— 实测：
 * - `profile_ext?action=home` 无登录态返回 2 KB 的「请在微信客户端打开」墙
 * - `getmsg` 返回 111 B 的错误 JSON
 * - 搜狗微信搜索结果里**零个**文章链接（已失效）
 * - 文章页里的「相关文章」来自**别的号**，不是该号历史
 *
 * 所以唯一可行的「拿到多篇文章」的路是：**用户自己在微信里逐篇复制链接**，
 * 一次性交给我们批量解析。这不是爬虫，是「把用户已经打开的东西读出来」。
 */
const articleRequestSchema = z
  .object({
    url: singleUrl.optional(),
    urls: z.array(singleUrl).min(1).max(20).optional(),
  })
  .strict()
  .refine(
    (value) => value.url !== undefined || value.urls !== undefined,
    '必须给 `url` 或 `urls` 之一',
  )
  .refine(
    (value) => !(value.url !== undefined && value.urls !== undefined),
    '`url` 与 `urls` 只能给一个',
  );

/** 批量上限：超过这个数就拒绝 —— 20 篇已经是一次「整理几周通知」的量了 */
const MAX_BATCH = 20;

@ApiTags('wechat')
@Controller('wechat')
export class WechatController {
  constructor(private readonly service: WechatArticleService) {}

  @Post('article')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '解析一篇公众号文章',
    description:
      '入参 `{url}`，只接受 `https://mp.weixin.qq.com/s/...`。' +
      '返回 `{title, accountName, publishedAt, bodyLines, images, sourceUrl}`。' +
      '\n\n⚠️ **只解析用户给的那一篇**，不做公众号历史文章抓取（微信无公开 API，且批量采集违反其条款）。' +
      '\n\n失败时返回 `{ok:false, code, message}`：`invalid-url` / `http-error` / ' +
      '`login-required`（需关注或需微信内打开）/ `unrecognized-structure`。',
  })
  @ApiResponse({ status: 200, description: '解析成功或结构化的失败（都在 200 里，用 ok 区分）' })
  @ApiResponse({ status: 400, description: '入参不合法' })
  async article(@Body() body: unknown) {
    const parsed = articleRequestSchema.safeParse(body);
    if (!parsed.success) {
      return {
        ok: false,
        code: 'invalid-request',
        message: '只接受 `{url}` 一个字段，且必须是合法链接',
      };
    }

    // 批量：逐篇串行取（对微信的请求要克制，不做并发轰炸）
    if (parsed.data.urls !== undefined) {
      const results = [];
      for (const url of parsed.data.urls) {
        const outcome = await this.service.fetchAndParse(url);
        results.push(
          outcome.ok
            ? { url, ok: true as const, article: this.toArticleView(outcome.article) }
            : { url, ok: false as const, code: outcome.code, message: outcome.message },
        );
      }
      const succeeded = results.filter((item) => item.ok).length;
      return {
        ok: succeeded > 0,
        total: results.length,
        succeeded,
        failed: results.length - succeeded,
        items: results,
      };
    }

    const outcome = await this.service.fetchAndParse(parsed.data.url ?? '');
    if (!outcome.ok) {
      // ⚠️ 用 200 返回结构化的失败，而不是 4xx：
      // 「文章要求关注后查看」是**业务结果**，不是客户端错误。
      // 用 4xx 会让前端把它渲染成「请求失败」，盖掉那句有用的解释
      // —— 和付款码那次 POST→405 是同一类错误。
      return { ok: false, code: outcome.code, message: outcome.message };
    }

    return { ok: true, article: this.toArticleView(outcome.article) };
  }

  /** 把领域对象转成对外视图（单条与批量共用，避免两处漂移） */
  private toArticleView(article: WechatArticle) {
    return {
      title: article.title,
      accountName: article.accountName,
      publishedAt: article.publishedAt,
      // 正文行数可能很大（实测 30–80 行），但不含图片二进制，可以全量返回
      bodyLines: article.bodyLines,
      images: article.images,
      sourceUrl: article.sourceUrl,
    };
  }
}
