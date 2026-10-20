import { describe, expect, it } from 'vitest';

import {
  looksLikeWechatArticle,
  parseWechatArticle,
  pickEventCandidateLines,
} from './wechat-article';

/**
 * 微信公众号文章解析。
 *
 * ## 这些测试锁的是什么
 *
 * 1. **「打不开」的原因要说清** —— 环境异常 / 已删除 / 需关注 / 非文章页，
 *    四种情况给四种不同的中文提示，不能都变成「解析失败」
 * 2. **发布时间不许拿抓取时间冒充** —— 读不到就是 `null`
 * 3. **图片必须是绝对 URL 且去重** —— 相对地址在客户端会加载失败
 * 4. **不返回半篇正文** —— 正文容器为空时宁可失败
 */
const URL_BASE = 'https://mp.weixin.qq.com/s/abcdefg';

/** 造一个最小但结构正确的微信文章页 */
function article(options: {
  title?: string | null;
  nickname?: string | null;
  ct?: string | null;
  body?: string;
  extra?: string;
}): string {
  const { title = '关于举办某某讲座的通知', nickname = '上海科技大学', ct = '1694078981', body = '<p>正文第一段</p>', extra = '' } = options;

  const titleVar = title === null ? '' : `var msg_title = "${title}".html(false);`;
  const nickVar = nickname === null ? '' : `var nickname = htmlDecode("${nickname}");`;
  const ctVar = ct === null ? '' : `var ct = "${ct}";`;

  return `<!DOCTYPE html><html><head><title>${title ?? ''}</title></head><body>
<div class="rich_media_area_primary">
  <div class="rich_media_title" id="activity-name"></div>
  <div class="rich_media_content" id="js_content" style="visibility: hidden;">
    ${body}
  </div>
  <div class="rich_media_area_extra"></div>
</div>
<script>
${titleVar}
${nickVar}
${ctVar}
</script>
${extra}
</body></html>`;
}

describe('looksLikeWechatArticle', () => {
  it('真文章页返回 true', () => {
    expect(looksLikeWechatArticle(article({}))).toBe(true);
  });

  it('普通 HTML 返回 false', () => {
    expect(looksLikeWechatArticle('<html><body><p>hello</p></body></html>')).toBe(false);
  });

  it('空串返回 false', () => {
    expect(looksLikeWechatArticle('')).toBe(false);
  });
});

describe('⚠️ 「打不开」的四种原因要分开说', () => {
  const cases: readonly { name: string; needle: string; expectIn: string }[] = [
    { name: '环境异常', needle: '环境异常', expectIn: '验证环境' },
    { name: '已删除', needle: '该内容已被发布者删除', expectIn: '删除' },
    { name: '违规', needle: '此内容因违规无法查看', expectIn: '违规' },
    { name: '需微信内打开', needle: '请在微信客户端打开链接', expectIn: '微信客户端' },
  ];

  for (const item of cases) {
    it(`${item.name} → login-required 且提示含「${item.expectIn}」`, () => {
      const html = article({ extra: `<div>${item.needle}</div>` });
      const result = parseWechatArticle(html, URL_BASE);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error.code).toBe('login-required');
      expect(result.error.message).toContain(item.expectIn);
    });
  }

  it('四种提示互不相同（不能都变成同一句话）', () => {
    const messages = cases.map((item) => {
      const result = parseWechatArticle(article({ extra: item.needle }), URL_BASE);
      return result.ok ? '' : result.error.message;
    });
    expect(new Set(messages).size).toBe(cases.length);
  });
});

describe('parseWechatArticle · 正常路径', () => {
  it('标题 / 公众号 / 正文都对', () => {
    const result = parseWechatArticle(article({ body: '<p>第一段</p><p>第二段</p>' }), URL_BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.title).toBe('关于举办某某讲座的通知');
    expect(result.value.accountName).toBe('上海科技大学');
    expect(result.value.bodyLines).toEqual(['第一段', '第二段']);
    expect(result.value.sourceUrl).toBe(URL_BASE);
  });

  it('⚠️ 发布时间按 Asia/Shanghai 解释，且带 +08:00 偏移', () => {
    const result = parseWechatArticle(article({ ct: '1694078981' }), URL_BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    // 1694078981 = 2023-09-07 17:29:41 +08:00
    expect(result.value.publishedAt).toBe('2023-09-07T17:29:41.000+08:00');
  });

  it('⚠️ 读不到发布时间 → null，不拿抓取时间冒充', () => {
    const result = parseWechatArticle(article({ ct: null }), URL_BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.publishedAt).toBeNull();
  });

  it('ct 不是纯数字时也返回 null（不硬解）', () => {
    const result = parseWechatArticle(article({ ct: 'not-a-timestamp' }), URL_BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.publishedAt).toBeNull();
  });

  it('公众号名缺失时回落 og:article:author', () => {
    const html = article({ nickname: null }).replace(
      '<head>',
      '<head><meta property="og:article:author" content="图信中心" />',
    );
    const result = parseWechatArticle(html, URL_BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.accountName).toBe('图信中心');
  });

  it('公众号名和 og 都没有 → 空串（不编）', () => {
    const result = parseWechatArticle(article({ nickname: null }), URL_BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.accountName).toBe('');
  });
});

describe('⚠️ 标题读不到就失败，不返回无标题文章', () => {
  it('没有 msg_title → unrecognized-structure', () => {
    const result = parseWechatArticle(article({ title: null }), URL_BASE);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('unrecognized-structure');
  });
});

describe('⚠️ 正文容器为空 → 不返回半篇', () => {
  it('js_content 里没内容 → login-required', () => {
    const html = article({ body: '' });
    const result = parseWechatArticle(html, URL_BASE);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    // 空正文更可能是「关注后可见」而不是「解析坏了」，所以给 login-required
    expect(result.error.code).toBe('login-required');
    expect(result.error.message).toContain('关注');
  });
});

describe('图片提取', () => {
  it('相对地址补成绝对 URL', () => {
    const result = parseWechatArticle(
      article({ body: '<img data-src="/mmbiz/a.png" /><p>文字</p>' }),
      URL_BASE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.images).toEqual(['https://mp.weixin.qq.com/mmbiz/a.png']);
  });

  it('优先 data-src（懒加载真实地址）而不是 src 占位图', () => {
    const result = parseWechatArticle(
      article({ body: '<img src="/placeholder.gif" data-src="/real.png" />' }),
      URL_BASE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.images).toContain('https://mp.weixin.qq.com/real.png');
    expect(result.value.images.some((u) => u.includes('placeholder'))).toBe(false);
  });

  it('去重且保序', () => {
    const result = parseWechatArticle(
      article({ body: '<img data-src="/a.png" /><img data-src="/b.png" /><img data-src="/a.png" />' }),
      URL_BASE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.images).toEqual([
      'https://mp.weixin.qq.com/a.png',
      'https://mp.weixin.qq.com/b.png',
    ]);
  });

  it('data: 内联图被丢弃（不是真实照片，体积还大）', () => {
    const result = parseWechatArticle(
      article({ body: '<img src="data:image/png;base64,AAAA" /><img data-src="/real.png" />' }),
      URL_BASE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.images).toEqual(['https://mp.weixin.qq.com/real.png']);
  });

  it('没有图片时是空数组（不是 undefined）', () => {
    const result = parseWechatArticle(article({ body: '<p>纯文字</p>' }), URL_BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.images).toEqual([]);
  });
});

describe('pickEventCandidateLines', () => {
  it('时间 + 地点都在同一段 → 命中', () => {
    const lines = ['讲座时间：10月25日 14:00，地点：信息学院 1-101'];
    expect(pickEventCandidateLines(lines)).toHaveLength(1);
  });

  it('时间 + 报名线索 → 命中', () => {
    const lines = ['10月25日 14:00 开始，请扫码报名'];
    expect(pickEventCandidateLines(lines)).toHaveLength(1);
  });

  it('只有时间没有地点/报名 → 不命中（避免把日程表每行都选中）', () => {
    const lines = ['10月25日 14:00'];
    expect(pickEventCandidateLines(lines)).toHaveLength(0);
  });

  it('太短的段落直接跳过', () => {
    const lines = ['14:00 楼'];
    expect(pickEventCandidateLines(lines)).toHaveLength(0);
  });

  it('空输入不崩', () => {
    expect(pickEventCandidateLines([])).toEqual([]);
  });
});
