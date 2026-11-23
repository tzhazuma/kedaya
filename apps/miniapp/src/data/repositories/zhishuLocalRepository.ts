import {
  normalizeZhishuUrl,
  type QqChatMessage,
  type ZhishuFeedItem,
  type ZhishuSource,
} from "@kedaya/shared";

import type { CachePort } from "../../domain/ports/cachePort";
import { STORAGE_PREFIX } from "../storage/keys";
import { createTaroStorage } from "../storage/taroStorage";

export const ZHISHU_LOCAL_STORAGE_KEY = `${STORAGE_PREFIX}zhishu:workspace:v1`;

export interface ZhishuMaterial {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  sourceUrl: string | null;
}

export interface ZhishuWorkspace {
  items: ZhishuFeedItem[];
  materials: ZhishuMaterial[];
  qqMessages: QqChatMessage[];
  focusTopics: string[];
}

export const emptyZhishuWorkspace: ZhishuWorkspace = {
  items: [],
  materials: [],
  qqMessages: [],
  focusTopics: [],
};

export interface ZhishuLocalRepository {
  read(): ZhishuWorkspace;
  write(workspace: ZhishuWorkspace): void;
  clear(): void;
}

export function createZhishuLocalRepository(
  cache: CachePort = createTaroStorage(),
): ZhishuLocalRepository {
  return {
    read(): ZhishuWorkspace {
      const raw = cache.read<unknown>(ZHISHU_LOCAL_STORAGE_KEY);
      if (!isRecord(raw)) return cloneEmpty();
      return {
        items: Array.isArray(raw.items)
          ? raw.items.filter(isFeedItem).map(cleanFeedItem)
          : [],
        materials: Array.isArray(raw.materials)
          ? raw.materials.filter(isMaterial).map(cleanMaterial)
          : [],
        qqMessages: Array.isArray(raw.qqMessages)
          ? raw.qqMessages.filter(isQqMessage)
          : [],
        focusTopics: Array.isArray(raw.focusTopics)
          ? raw.focusTopics
              .filter((topic): topic is string => typeof topic === "string")
              .slice(0, 20)
          : [],
      };
    },
    write(workspace: ZhishuWorkspace): void {
      cache.write(ZHISHU_LOCAL_STORAGE_KEY, {
        items: workspace.items.slice(0, 1000).map(cleanFeedItem),
        materials: workspace.materials.slice(0, 500).map(cleanMaterial),
        qqMessages: workspace.qqMessages.slice(0, 1000),
        focusTopics: workspace.focusTopics.slice(0, 20),
      });
    },
    clear(): void {
      cache.remove(ZHISHU_LOCAL_STORAGE_KEY);
    },
  };
}

function cloneEmpty(): ZhishuWorkspace {
  return { items: [], materials: [], qqMessages: [], focusTopics: [] };
}

function cleanFeedItem(item: ZhishuFeedItem): ZhishuFeedItem {
  return {
    ...item,
    url: item.url === null ? null : normalizeZhishuUrl(item.url),
  };
}

function cleanMaterial(item: ZhishuMaterial): ZhishuMaterial {
  return {
    ...item,
    sourceUrl:
      item.sourceUrl === null ? null : normalizeZhishuUrl(item.sourceUrl),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFeedItem(value: unknown): value is ZhishuFeedItem {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isSource(value.source) &&
    typeof value.title === "string" &&
    typeof value.excerpt === "string" &&
    typeof value.topic === "string" &&
    (value.url === null || typeof value.url === "string") &&
    isNonEmptyString(value.publishedAt) &&
    typeof value.ignored === "boolean"
  );
}

function isMaterial(value: unknown): value is ZhishuMaterial {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    typeof value.title === "string" &&
    typeof value.content === "string" &&
    isNonEmptyString(value.createdAt) &&
    (value.sourceUrl === null || typeof value.sourceUrl === "string")
  );
}

function isQqMessage(value: unknown): value is QqChatMessage {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    typeof value.sender === "string" &&
    isNonEmptyString(value.sentAt) &&
    typeof value.text === "string"
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isSource(value: unknown): value is ZhishuSource {
  return ["mail", "wechat", "zhihu", "qq", "material"].includes(String(value));
}
