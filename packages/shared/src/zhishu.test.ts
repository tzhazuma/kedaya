import { describe, expect, it } from "vitest";

import {
  buildZhishuDaily,
  normalizeZhishuUrl,
  parseQqChatExport,
  searchZhishuItems,
  type ZhishuFeedItem,
} from "./zhishu";

function item(patch: Partial<ZhishuFeedItem> = {}): ZhishuFeedItem {
  return {
    id: "zhihu-1",
    source: "zhihu",
    title: "信息论学习资料",
    excerpt: "课程与科研入门",
    topic: "学习",
    url: null,
    publishedAt: "2026-11-23T01:00:00.000Z",
    ignored: false,
    ...patch,
  };
}

describe("知枢 QQ 聊天导出", () => {
  it("解析发送人、时间、多行正文，并保留无法识别的行", () => {
    const result = parseQqChatExport(
      [
        "2026-11-23 09:30:00 张三(10001)",
        "明天下午两点在信息学院 1-101 有讲座",
        "欢迎参加",
        "这一行不是消息头，应并入上一条",
        "2026-11-23 09:31:20 李四",
        "报名链接稍后发",
        "导出尾部损坏行\x00",
      ].join("\r\n"),
    );

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({
      sender: "张三",
      sentAt: "2026-11-23T01:30:00.000Z",
      text: "明天下午两点在信息学院 1-101 有讲座\n欢迎参加\n这一行不是消息头，应并入上一条",
    });
    expect(result.messages[1]?.sender).toBe("李四");
    expect(result.rejected).toHaveLength(1);
  });

  it("空输入与超大导出明确拒绝", () => {
    expect(() => parseQqChatExport("")).toThrow("没有可导入的消息");
    expect(() => parseQqChatExport("x".repeat(500_001))).toThrow("500KB");
  });
});

describe("知枢日报与检索", () => {
  it("日报排除忽略项、提升关注话题并限制每个来源的数量", () => {
    const daily = buildZhishuDaily(
      [
        item({ id: "z1", title: "普通推荐", topic: "娱乐" }),
        item({
          id: "z2",
          title: "科研讲座",
          topic: "学术",
          publishedAt: "2026-11-22T01:00:00.000Z",
        }),
        item({ id: "z3", title: "忽略我", ignored: true }),
        item({ id: "q1", source: "qq", title: "群活动", topic: "学术" }),
        item({ id: "m1", source: "wechat", title: "校园通知", topic: "校园" }),
      ],
      { focusTopics: ["学术"], perSource: 1, limit: 3 },
    );

    expect(daily.map((entry) => entry.id)).toEqual(["q1", "z2", "m1"]);
  });

  it("搜索匹配标题、摘要、来源和话题，不返回忽略项", () => {
    const items = [
      item(),
      item({
        id: "q1",
        source: "qq",
        title: "群公告",
        excerpt: "报名截止周五",
        topic: "活动",
      }),
      item({ id: "x", title: "信息论但已忽略", ignored: true }),
    ];
    expect(searchZhishuItems(items, "报名").map((entry) => entry.id)).toEqual([
      "q1",
    ]);
    expect(searchZhishuItems(items, "qq").map((entry) => entry.id)).toEqual([
      "q1",
    ]);
    expect(searchZhishuItems(items, "信息论").map((entry) => entry.id)).toEqual(
      ["zhihu-1"],
    );
    expect(searchZhishuItems(items, "  ")).toHaveLength(2);
  });

  it("只保留 https 链接并清理会话参数", () => {
    expect(
      normalizeZhishuUrl(
        "https://www.zhihu.com/question/1?token=secret&utm_source=x",
      ),
    ).toBe("https://www.zhihu.com/question/1");
    expect(normalizeZhishuUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeZhishuUrl("not a url")).toBeNull();
  });
});
