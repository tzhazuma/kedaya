import { describe, expect, it } from 'vitest';

import { parseWechatProfileList } from './wechat-profile-list';

/** 造一个和历史页同形的页面：`var msgList = '...';` 里套 JSON。 */
function page(msgList: unknown, extra = ''): string {
  return `<!DOCTYPE html><html><head><title>历史消息</title></head><body>
<script>
var nickname = "上科大信息学院";
var msgList = '${JSON.stringify(msgList)}';
${extra}
</script></body></html>`;
}

const oneArticle = {
  list: [
    {
      comm_msg_info: { id: 1, type: 49, datetime: 1732000000 },
      app_msg_ext_info: {
        title: '关于举办 2026 年校园马拉松的通知',
        digest: '11 月 30 日开跑，报名截止 11 月 26 日',
        content_url: 'http://mp.weixin.qq.com/s?__biz=ABC&amp;mid=1&amp;idx=1&amp;sn=x',
        cover: 'https://mmbiz.qpic.cn/cover1.jpg',
        multi_app_msg_item_list: [],
      },
    },
  ],
};

describe('parseWechatProfileList', () => {
  it('解析单篇文章：标题、链接、时间、摘要、封面', () => {
    const result = parseWechatProfileList(page(oneArticle));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.items).toHaveLength(1);
    const item = result.value.items[0]!;
    expect(item.title).toBe('关于举办 2026 年校园马拉松的通知');
    expect(item.url).toContain('__biz=ABC');
    expect(item.url).toContain('&mid=1'); // &amp; 已还原
    expect(item.url).not.toContain('&amp;');
    expect(item.digest).toContain('报名截止');
    expect(item.coverUrl).toBe('https://mmbiz.qpic.cn/cover1.jpg');
    expect(item.isHeadline).toBe(true);
    expect(item.publishedAt).toBe(new Date(1732000000 * 1000).toISOString());
  });

  it('一次推送多篇时展开副条，并共用同一发布时间', () => {
    const result = parseWechatProfileList(
      page({
        list: [
          {
            comm_msg_info: { type: 49, datetime: 1732000000 },
            app_msg_ext_info: {
              title: '主条',
              content_url: 'https://mp.weixin.qq.com/s?a=1',
              multi_app_msg_item_list: [
                { title: '副条一', content_url: 'https://mp.weixin.qq.com/s?a=2' },
                {
                  title: '副条二',
                  content_url: 'https://mp.weixin.qq.com/s?a=3',
                  digest: '附：报名表',
                },
              ],
            },
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.items.map((item) => item.title).sort()).toEqual([
      '主条',
      '副条一',
      '副条二',
    ]);
    expect(result.value.items.every((item) => item.publishedAt === new Date(1732000000 * 1000).toISOString())).toBe(true);
    expect(result.value.items.filter((item) => item.isHeadline)).toHaveLength(1);
    expect(
      result.value.items.find((item) => item.title === '副条二')?.digest,
    ).toBe('附：报名表');
  });

  it('跳过非图文消息（type 不等于 49）', () => {
    const result = parseWechatProfileList(
      page({
        list: [
          { comm_msg_info: { type: 1, datetime: 1732000000 }, app_msg_ext_info: null },
          oneArticle.list[0],
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(1);
  });

  it('缺标题或缺链接的条目被跳过，而不是留空条目', () => {
    const result = parseWechatProfileList(
      page({
        list: [
          {
            comm_msg_info: { type: 49, datetime: 1732000000 },
            app_msg_ext_info: { title: '', content_url: 'https://mp.weixin.qq.com/s?a=1' },
          },
          {
            comm_msg_info: { type: 49, datetime: 1732000000 },
            app_msg_ext_info: { title: '有标题没链接' },
          },
          {
            comm_msg_info: { type: 49, datetime: 1732000000 },
            app_msg_ext_info: {
              title: '正常一条',
              content_url: 'https://mp.weixin.qq.com/s?a=9',
            },
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((item) => item.title)).toEqual(['正常一条']);
  });

  it('按发布时间倒序，同一页顺序不影响结果', () => {
    const result = parseWechatProfileList(
      page({
        list: [
          {
            comm_msg_info: { type: 49, datetime: 1732000000 },
            app_msg_ext_info: { title: '旧', content_url: 'https://mp.weixin.qq.com/s?o=1' },
          },
          {
            comm_msg_info: { type: 49, datetime: 1733000000 },
            app_msg_ext_info: { title: '新', content_url: 'https://mp.weixin.qq.com/s?o=2' },
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((item) => item.title)).toEqual(['新', '旧']);
  });

  it('兼容 \\x22 转义的引号', () => {
    const json = JSON.stringify(oneArticle).replace(/"/g, '\\x22');
    const result = parseWechatProfileList(
      `<html><body><script>var msgList = '${json}';</script></body></html>`,
    );
    expect(result.ok).toBe(true);
  });

  it('兼容 &quot; 转义', () => {
    const json = JSON.stringify(oneArticle).replace(/"/g, '&quot;');
    const result = parseWechatProfileList(
      `<html><body><script>var msgList = '${json}';</script></body></html>`,
    );
    expect(result.ok).toBe(true);
  });

  it('带出公众号昵称与 __biz（优先页面级声明，不取文章链接里的）', () => {
    const result = parseWechatProfileList(
      page(oneArticle, 'var biz = "XYZ123";'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.accountName).toBe('上科大信息学院');
    expect(result.value.biz).toBe('XYZ123');
  });

  it('空页面报 empty-page', () => {
    const result = parseWechatProfileList('   ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('empty-page');
  });

  it('拿成文章页（没有 msgList）报 unrecognized-structure 且说明原因', () => {
    const result = parseWechatProfileList(
      '<html><body><h1 id="activity-name">某篇文章</h1></body></html>',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unrecognized-structure');
    expect(result.error.message).toContain('历史');
  });

  it('msgList 不是合法 JSON 时报结构不认识，而不是抛异常', () => {
    const result = parseWechatProfileList(
      `<html><body><script>var msgList = '{"list":[broken'}';</script></body></html>`,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unrecognized-structure');
  });

  it('有 msgList 但没有任何文章时报 module-missing', () => {
    const result = parseWechatProfileList(page({ list: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('module-missing');
  });
});
