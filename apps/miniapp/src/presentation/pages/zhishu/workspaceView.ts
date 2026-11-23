import {
  normalizeZhishuUrl,
  parseQqChatExport,
  searchZhishuItems,
  type ZhishuFeedItem,
} from "@kedaya/shared";

import type {
  ZhishuMaterial,
  ZhishuWorkspace,
} from "../../../data/repositories/zhishuLocalRepository";

export function zhishuDemoWorkspace(): ZhishuWorkspace {
  return {
    items: [
      demoItem(
        "demo-zhihu-1",
        "zhihu",
        "【演示】信息论学习路线",
        "从课程基础到科研入门的资料索引",
        "学习",
      ),
      demoItem(
        "demo-wechat-1",
        "wechat",
        "【演示】信息学院讲座通知",
        "明天 14:00，信息学院 1-101",
        "学术",
      ),
      demoItem(
        "demo-qq-1",
        "qq",
        "【演示】课程群活动提醒",
        "报名截止本周五，请自行核对原消息",
        "活动",
      ),
      demoItem(
        "demo-mail-1",
        "mail",
        "【演示】校园邮箱周报",
        "三封邮件中包含两个待确认活动",
        "校园",
      ),
    ],
    materials: [],
    qqMessages: [],
    focusTopics: ["学术", "学习"],
  };
}

function demoItem(
  id: string,
  source: ZhishuFeedItem["source"],
  title: string,
  excerpt: string,
  topic: string,
): ZhishuFeedItem {
  return {
    id,
    source,
    title,
    excerpt,
    topic,
    url:
      source === "zhihu" ? "https://www.zhihu.com/question/1?token=demo" : null,
    publishedAt: "2026-11-23T01:00:00.000Z",
    ignored: false,
  };
}

export interface ZhishuAnswer {
  answer: string;
  references: ZhishuFeedItem[];
}

export function answerFromWorkspace(
  workspace: ZhishuWorkspace,
  query: string,
): ZhishuAnswer {
  const references = searchZhishuItems(workspace.items, query).slice(0, 3);
  if (query.trim() === "") {
    return {
      answer: "输入关键词后，JARVIS 会检索本机工作区并给出引用。",
      references: [],
    };
  }
  if (references.length === 0) {
    return {
      answer:
        "本地检索没有找到相关内容。可以换关键词，或先导入文章、知乎条目和 QQ 消息。",
      references: [],
    };
  }
  return {
    answer: `本地检索找到 ${references.length} 条相关内容；以下答案只来自这些引用，未调用大模型。`,
    references,
  };
}

export function saveFeedItemToMaterials(
  workspace: ZhishuWorkspace,
  item: ZhishuFeedItem,
): ZhishuWorkspace {
  const id = `material-${item.id}`;
  if (workspace.materials.some((material) => material.id === id))
    return workspace;
  const material: ZhishuMaterial = {
    id,
    title: item.title,
    content: item.excerpt,
    createdAt: new Date().toISOString(),
    sourceUrl: item.url === null ? null : normalizeZhishuUrl(item.url),
  };
  return { ...workspace, materials: [material, ...workspace.materials] };
}

export function importQqIntoWorkspace(
  workspace: ZhishuWorkspace,
  input: string,
): { workspace: ZhishuWorkspace; rejected: string[] } {
  const imported = parseQqChatExport(input);
  const start = workspace.qqMessages.length;
  const messages = imported.messages.map((message, index) => ({
    ...message,
    id: `qq-local-${Date.now()}-${start + index}`,
  }));
  const feedItems: ZhishuFeedItem[] = messages.map((message) => ({
    id: `feed-${message.id}`,
    source: "qq",
    title: `${message.sender}的群消息`,
    excerpt: [...message.text].slice(0, 200).join(""),
    topic: /讲座|活动|报名|会议/.test(message.text) ? "活动" : "群聊",
    url: null,
    publishedAt: message.sentAt,
    ignored: false,
  }));
  return {
    workspace: {
      ...workspace,
      qqMessages: [...messages, ...workspace.qqMessages],
      items: [...feedItems, ...workspace.items],
    },
    rejected: imported.rejected,
  };
}

export function addMaterialToWorkspace(
  workspace: ZhishuWorkspace,
  title: string,
  content: string,
): ZhishuWorkspace {
  const cleanTitle = title.trim();
  const cleanContent = content.trim();
  if (cleanTitle === "" || cleanContent === "")
    throw new Error("请填写资料标题和正文");
  const material: ZhishuMaterial = {
    id: `material-local-${Date.now()}`,
    title: [...cleanTitle].slice(0, 120).join(""),
    content: [...cleanContent].slice(0, 20_000).join(""),
    createdAt: new Date().toISOString(),
    sourceUrl: null,
  };
  return { ...workspace, materials: [material, ...workspace.materials] };
}
