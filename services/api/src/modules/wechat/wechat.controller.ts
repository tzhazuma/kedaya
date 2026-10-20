import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { WechatArticleService } from './application/wechat-article.service';

/**
 * `POST /wechat/article` 的入参。
 *
 * `.strict()`：客户端多塞 `cookie` / `headers` 之类会被结构性拒绝 ——
 * 否则会让人以为那些字段起了作用。
 */
const articleRequestSchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(10)
      .max(2048)
      .url('必须是合法 URL'),
  })
  .strict();

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

    const outcome = await this.service.fetchAndParse(parsed.data.url);
    if (!outcome.ok) {
      // ⚠️ 用 200 返回结构化的失败，而不是 4xx：
      // 「文章要求关注后查看」是**业务结果**，不是客户端错误。
      // 用 4xx 会让前端把它渲染成「请求失败」，盖掉那句有用的解释
      // —— 和付款码那次 POST→405 是同一类错误。
      return { ok: false, code: outcome.code, message: outcome.message };
    }

    return {
      ok: true,
      article: {
        title: outcome.article.title,
        accountName: outcome.article.accountName,
        publishedAt: outcome.article.publishedAt,
        // 正文行数可能很大（实测 30–80 行），但不含图片二进制，可以全量返回
        bodyLines: outcome.article.bodyLines,
        images: outcome.article.images,
        sourceUrl: outcome.article.sourceUrl,
      },
    };
  }
}
