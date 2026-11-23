import { describe, expect, it, vi } from "vitest";

vi.mock("../../storage/taroStorage", () => ({
  createTaroStorage: () => ({
    read: () => null,
    write: () => undefined,
    remove: () => undefined,
  }),
}));

import type { CachePort } from "../../../domain/ports/cachePort";
import {
  createZhishuLocalRepository,
  emptyZhishuWorkspace,
  ZHISHU_LOCAL_STORAGE_KEY,
} from "../zhishuLocalRepository";

function memoryCache(): CachePort & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  return {
    values,
    read<T>(key: string): T | null {
      return (values.has(key) ? values.get(key) : null) as T | null;
    },
    write<T>(key: string, value: T): void {
      values.set(key, value);
    },
    remove(key: string): void {
      values.delete(key);
    },
  };
}

describe("知枢本机工作区", () => {
  it("保存资料、来源条目、QQ 消息与关注话题，并清洗链接", () => {
    const cache = memoryCache();
    const repository = createZhishuLocalRepository(cache);
    const next = {
      ...emptyZhishuWorkspace,
      focusTopics: ["学术"],
      items: [
        {
          id: "z1",
          source: "zhihu" as const,
          title: "一个问题",
          excerpt: "回答摘要",
          topic: "学术",
          url: "https://www.zhihu.com/question/1?token=secret",
          publishedAt: "2026-11-23T01:00:00.000Z",
          ignored: false,
        },
      ],
      materials: [
        {
          id: "m1",
          title: "笔记",
          content: "正文",
          createdAt: "2026-11-23T01:00:00.000Z",
          sourceUrl: null,
        },
      ],
      qqMessages: [
        {
          id: "q1",
          sender: "张三",
          sentAt: "2026-11-23T01:00:00.000Z",
          text: "明天有讲座",
        },
      ],
    };

    repository.write(next);
    expect(repository.read()).toEqual({
      ...next,
      items: [{ ...next.items[0], url: "https://www.zhihu.com/question/1" }],
    });
    expect(cache.values.has(ZHISHU_LOCAL_STORAGE_KEY)).toBe(true);
  });

  it("损坏缓存回退为空工作区，清理只删除自己的键", () => {
    const cache = memoryCache();
    cache.write(ZHISHU_LOCAL_STORAGE_KEY, "{broken");
    const repository = createZhishuLocalRepository(cache);
    expect(repository.read()).toEqual(emptyZhishuWorkspace);
    repository.clear();
    expect(repository.read()).toEqual(emptyZhishuWorkspace);
  });
});
