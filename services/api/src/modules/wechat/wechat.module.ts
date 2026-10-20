import { Module } from '@nestjs/common';

import { WechatController } from './wechat.controller';
import { WechatArticleService } from './application/wechat-article.service';

/**
 * 公众号文章接入。
 *
 * ## 为什么这个模块很小
 *
 * 它只做三件事：**取 HTML → 调 `@kedaya/shared` 的解析器 → 返回结构化结果**。
 * 所有解析逻辑在共享包里（`wechat-article.ts`，26 条测试），这里不加业务规则。
 *
 * ## 为什么不做「批量抓取公众号」
 *
 * 微信没有公开的历史文章 API，内部接口需要几小时就失效的 Cookie，
 * 且批量采集违反微信服务条款。所以我们只做**用户主动给一个链接，我们读这一篇**。
 * 详见 `docs/architecture/14-wechat-content-ingestion.md`。
 */
@Module({
  controllers: [WechatController],
  providers: [WechatArticleService],
  exports: [WechatArticleService],
})
export class WechatModule {}
