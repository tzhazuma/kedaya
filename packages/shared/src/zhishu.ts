export type ZhishuSource = "mail" | "wechat" | "zhihu" | "qq" | "material";

export interface ZhishuFeedItem {
  id: string;
  source: ZhishuSource;
  title: string;
  excerpt: string;
  topic: string;
  url: string | null;
  publishedAt: string;
  ignored: boolean;
}

export interface QqChatMessage {
  id: string;
  sender: string;
  sentAt: string;
  text: string;
}

export interface QqChatImport {
  messages: QqChatMessage[];
  rejected: string[];
}

const QQ_HEADER =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s+(.+?)(?:\(([^()]*)\))?\s*$/;
const MAX_QQ_EXPORT_LENGTH = 500_000;

export function parseQqChatExport(input: string): QqChatImport {
  if (input.length > MAX_QQ_EXPORT_LENGTH) {
    throw new Error("QQ 聊天记录不能超过 500KB，请分批导入");
  }

  const messages: QqChatMessage[] = [];
  const rejected: string[] = [];
  let current: { sender: string; sentAt: string; lines: string[] } | null =
    null;

  const flush = (): void => {
    if (current === null) return;
    const text = current.lines.join("\n").trim();
    if (text !== "") {
      messages.push({
        id: `qq-${messages.length + 1}`,
        sender: current.sender,
        sentAt: current.sentAt,
        text,
      });
    }
    current = null;
  };

  for (const rawLine of input.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.includes("\0")) {
      rejected.push(line);
      continue;
    }
    const match = QQ_HEADER.exec(line.trim());
    if (match !== null) {
      const sentAt = new Date(`${match[1]}T${match[2]}+08:00`);
      if (!Number.isNaN(sentAt.getTime())) {
        flush();
        current = {
          sender: (match[3] ?? "").trim(),
          sentAt: sentAt.toISOString(),
          lines: [],
        };
        continue;
      }
    }
    if (current !== null && line.trim() !== "") {
      current.lines.push(line.trim());
    } else if (current === null && line.trim() !== "") {
      rejected.push(line);
    }
  }
  flush();

  if (messages.length === 0) {
    throw new Error("没有可导入的消息，请检查 QQ 导出格式");
  }
  return { messages, rejected };
}

export function buildZhishuDaily(
  items: readonly ZhishuFeedItem[],
  options: {
    focusTopics?: readonly string[];
    perSource?: number;
    limit?: number;
  } = {},
): ZhishuFeedItem[] {
  const focus = new Set(options.focusTopics ?? []);
  const perSource = Math.max(1, options.perSource ?? 2);
  const limit = Math.max(1, options.limit ?? 10);
  const counts = new Map<ZhishuSource, number>();

  return [...items]
    .filter((entry) => !entry.ignored)
    .sort((left, right) => {
      const focusDelta =
        Number(focus.has(right.topic)) - Number(focus.has(left.topic));
      if (focusDelta !== 0) return focusDelta;
      const timeDelta = right.publishedAt.localeCompare(left.publishedAt);
      return timeDelta !== 0 ? timeDelta : left.id.localeCompare(right.id);
    })
    .filter((entry) => {
      const count = counts.get(entry.source) ?? 0;
      if (count >= perSource) return false;
      counts.set(entry.source, count + 1);
      return true;
    })
    .slice(0, limit);
}

export function searchZhishuItems(
  items: readonly ZhishuFeedItem[],
  query: string,
): ZhishuFeedItem[] {
  const needle = query.trim().toLocaleLowerCase();
  return items.filter((entry) => {
    if (entry.ignored) return false;
    if (needle === "") return true;
    return [entry.title, entry.excerpt, entry.topic, entry.source].some(
      (value) => value.toLocaleLowerCase().includes(needle),
    );
  });
}

export function normalizeZhishuUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "")
      return null;
    const sessionKeys = new Set([
      "token",
      "sid",
      "scene",
      "chksm",
      "srcid",
      "exportkey",
      "signature",
      "sig",
      "key",
    ]);
    for (const key of [...url.searchParams.keys()]) {
      if (
        sessionKeys.has(key.toLocaleLowerCase()) ||
        key.toLocaleLowerCase().startsWith("utm_")
      ) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}
