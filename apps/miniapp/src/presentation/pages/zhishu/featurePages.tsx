import { Text, View } from "@tarojs/components";
import { useState } from "react";

import {
  buildZhishuDaily,
  normalizeZhishuUrl,
  searchZhishuItems,
  type ZhishuFeedItem,
} from "@kedaya/shared";

import { toast } from "../../../platform/navigation";
import {
  KdyButton,
  KdyCard,
  KdyChip,
  KdyEmpty,
  KdyField,
  KdyTag,
} from "../../components";
import { KdyHeading } from "../../components/KdyHeading";
import "./featurePages.scss";
import { useZhishuWorkspace } from "./useZhishuWorkspace";
import {
  addMaterialToWorkspace,
  answerFromWorkspace,
  importQqIntoWorkspace,
  saveFeedItemToMaterials,
  type ZhishuAnswer,
} from "./workspaceView";

const sourceLabels = {
  mail: "校园邮箱",
  wechat: "公众号",
  zhihu: "知乎",
  qq: "QQ",
  material: "资料",
} as const;
const focusOptions = ["学术", "学习", "活动", "校园"];

function FeedCard({
  item,
  onIgnore,
  onSave,
}: {
  item: ZhishuFeedItem;
  onIgnore?: () => void;
  onSave?: () => void;
}) {
  return (
    <KdyCard
      title={item.title}
      extra={<KdyTag>{sourceLabels[item.source]}</KdyTag>}
    >
      <Text className="kdy-zhishu__text">{item.excerpt}</Text>
      <View className="kdy-zhishu__meta">
        <KdyTag tone="neutral">{item.topic}</KdyTag>
        <Text className="kdy-zhishu__muted">
          {item.publishedAt.slice(0, 10)}
        </Text>
      </View>
      <View className="kdy-zhishu__actions">
        {onSave && (
          <KdyButton size="sm" variant="ghost" onClick={onSave}>
            存入资料库
          </KdyButton>
        )}
        {onIgnore && (
          <KdyButton size="sm" variant="ghost" onClick={onIgnore}>
            忽略
          </KdyButton>
        )}
      </View>
    </KdyCard>
  );
}

export function ZhishuDailyPage() {
  const { workspace, update } = useZhishuWorkspace();
  const [query, setQuery] = useState("");
  const daily = searchZhishuItems(
    buildZhishuDaily(workspace.items, {
      focusTopics: workspace.focusTopics,
      limit: 20,
    }),
    query,
  );
  return (
    <View className="kdy-page kdy-zhishu">
      <KdyHeading
        title="知枢日报"
        subtitle="关注话题优先，每个来源限量；忽略项不会进入日报"
      />
      <KdyCard title="固定关注话题">
        <View className="kdy-zhishu__chips">
          {focusOptions.map((topic) => (
            <KdyChip
              key={topic}
              active={workspace.focusTopics.includes(topic)}
              onClick={() =>
                update((current) => ({
                  ...current,
                  focusTopics: current.focusTopics.includes(topic)
                    ? current.focusTopics.filter((item) => item !== topic)
                    : [...current.focusTopics, topic],
                }))
              }
            >
              {topic}
            </KdyChip>
          ))}
        </View>
        <KdyField
          label="检索今日内容"
          value={query}
          onChange={setQuery}
          placeholder="标题、摘要、来源或话题"
        />
      </KdyCard>
      {daily.length === 0 ? (
        <KdyEmpty
          title="没有匹配的日报条目"
          description="换个关键词，或先到知乎和 QQ 页面导入内容。"
        />
      ) : (
        daily.map((item) => (
          <FeedCard
            key={item.id}
            item={item}
            onSave={() => {
              update((current) => saveFeedItemToMaterials(current, item));
              toast("已存入资料库");
            }}
            onIgnore={() =>
              update((current) => ({
                ...current,
                items: current.items.map((entry) =>
                  entry.id === item.id ? { ...entry, ignored: true } : entry,
                ),
              }))
            }
          />
        ))
      )}
    </View>
  );
}

export function ZhishuJarvisPage() {
  const { workspace } = useZhishuWorkspace();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ZhishuAnswer>(() =>
    answerFromWorkspace(workspace, ""),
  );
  function ask(): void {
    setResult(answerFromWorkspace(workspace, query));
  }
  return (
    <View className="kdy-page kdy-zhishu">
      <KdyHeading
        title="JARVIS"
        subtitle="本机检索助手：回答必须能回到工作区里的引用"
      />
      <KdyCard title="问一问">
        <KdyField
          label="问题关键词"
          value={query}
          onChange={setQuery}
          onConfirm={ask}
          placeholder="例如：信息论、讲座、报名"
        />
        <View className="kdy-zhishu__actions">
          <KdyButton onClick={ask}>本地检索</KdyButton>
        </View>
        <Text className="kdy-zhishu__text">{result.answer}</Text>
      </KdyCard>
      {result.references.map((item) => (
        <FeedCard key={item.id} item={item} />
      ))}
      <Text className="kdy-disclaimer">
        当前页面不调用大模型，不生成引用之外的事实。接入服务端 Agent
        后仍需保留引用。
      </Text>
    </View>
  );
}

export function ZhishuMaterialsPage() {
  const { workspace, update } = useZhishuWorkspace();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const materials = workspace.materials.filter((item) =>
    `${item.title}\n${item.content}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  function add(): void {
    try {
      update((current) => addMaterialToWorkspace(current, title, content));
      setTitle("");
      setContent("");
      setError(null);
      toast("资料已保存");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  return (
    <View className="kdy-page kdy-zhishu">
      <KdyHeading
        title="资料库"
        subtitle="保存笔记与来源摘要；内容仅写入本机工作区"
      />
      <KdyCard title="新建资料">
        <KdyField
          label="标题"
          value={title}
          onChange={setTitle}
          maxLength={120}
        />
        <KdyField
          label="正文"
          value={content}
          onChange={setContent}
          multiline
          maxLength={20000}
        />
        {error && <Text className="kdy-zhishu__error">{error}</Text>}
        <View className="kdy-zhishu__actions">
          <KdyButton onClick={add}>保存资料</KdyButton>
        </View>
      </KdyCard>
      <KdyField
        label="搜索资料"
        value={query}
        onChange={setQuery}
        placeholder="标题或正文"
      />
      {materials.length === 0 ? (
        <KdyEmpty
          title="还没有资料"
          description="在上方新建，或从日报和知乎条目保存。"
        />
      ) : (
        materials.map((item) => (
          <KdyCard key={item.id} title={item.title}>
            <Text className="kdy-zhishu__text">{item.content}</Text>
            <View className="kdy-zhishu__actions">
              <KdyButton
                size="sm"
                variant="ghost"
                onClick={() =>
                  update((current) => ({
                    ...current,
                    materials: current.materials.filter(
                      (entry) => entry.id !== item.id,
                    ),
                  }))
                }
              >
                删除
              </KdyButton>
            </View>
          </KdyCard>
        ))
      )}
    </View>
  );
}

export function ZhishuZhihuPage() {
  const { workspace, update } = useZhishuWorkspace();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const items = workspace.items.filter(
    (item) => item.source === "zhihu" && !item.ignored,
  );
  function add(): void {
    const cleanTitle = title.trim();
    const cleanUrl = url.trim() === "" ? null : normalizeZhishuUrl(url);
    if (cleanTitle === "") return setError("请填写条目标题");
    if (url.trim() !== "" && cleanUrl === null)
      return setError("只接受有效的 https 链接");
    const item: ZhishuFeedItem = {
      id: `zhihu-local-${Date.now()}`,
      source: "zhihu",
      title: cleanTitle,
      excerpt: "用户手动添加的知乎条目；未在线读取正文。",
      topic: "知乎",
      url: cleanUrl,
      publishedAt: new Date().toISOString(),
      ignored: false,
    };
    update((current) => ({ ...current, items: [item, ...current.items] }));
    setTitle("");
    setUrl("");
    setError(null);
    toast("条目已添加");
  }
  return (
    <View className="kdy-page kdy-zhishu">
      <KdyHeading
        title="知乎推荐与反推荐"
        subtitle="管理手动添加的条目；本页不声称已同步知乎推荐流"
      />
      <KdyCard title="添加条目">
        <KdyField
          label="标题"
          value={title}
          onChange={setTitle}
          maxLength={120}
        />
        <KdyField
          label="https 链接（可选）"
          value={url}
          onChange={setUrl}
          placeholder="https://www.zhihu.com/…"
        />
        {error && <Text className="kdy-zhishu__error">{error}</Text>}
        <View className="kdy-zhishu__actions">
          <KdyButton onClick={add}>添加</KdyButton>
        </View>
      </KdyCard>
      {items.length === 0 ? (
        <KdyEmpty
          title="没有知乎条目"
          description="手动添加一条，或恢复演示数据后体验保存与忽略。"
        />
      ) : (
        items.map((item) => (
          <FeedCard
            key={item.id}
            item={item}
            onSave={() => {
              update((current) => saveFeedItemToMaterials(current, item));
              toast("已存入资料库");
            }}
            onIgnore={() =>
              update((current) => ({
                ...current,
                items: current.items.map((entry) =>
                  entry.id === item.id ? { ...entry, ignored: true } : entry,
                ),
              }))
            }
          />
        ))
      )}
    </View>
  );
}

export function ZhishuQqPage() {
  const { workspace, update } = useZhishuWorkspace();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  function importMessages(): void {
    try {
      update((current) => {
        const result = importQqIntoWorkspace(current, input);
        setRejected(result.rejected);
        return result.workspace;
      });
      setInput("");
      setError(null);
      toast("消息已导入日报");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  return (
    <View className="kdy-page kdy-zhishu">
      <KdyHeading
        title="QQ 聊天导入"
        subtitle="只处理你主动粘贴的文本，不读取进程、不控制 QQ、不自动抓取群聊"
      />
      <KdyCard title="粘贴聊天导出">
        <Text className="kdy-zhishu__muted">
          消息头格式：2026-11-23 09:30:00 张三(10001)，下一行写消息正文；上限
          500KB。
        </Text>
        <KdyField
          label="聊天记录"
          value={input}
          onChange={setInput}
          multiline
          maxLength={500000}
        />
        {error && <Text className="kdy-zhishu__error">{error}</Text>}
        {rejected.length > 0 && (
          <Text className="kdy-zhishu__muted">
            已跳过 {rejected.length} 行无法识别的内容。
          </Text>
        )}
        <View className="kdy-zhishu__actions">
          <KdyButton onClick={importMessages}>导入到工作区</KdyButton>
        </View>
      </KdyCard>
      {workspace.qqMessages.length === 0 ? (
        <KdyEmpty
          title="还没有导入消息"
          description="粘贴文本后，消息会同时出现在这里和知枢日报。"
        />
      ) : (
        workspace.qqMessages.map((message) => (
          <KdyCard
            key={message.id}
            title={message.sender}
            extra={<KdyTag>QQ</KdyTag>}
          >
            <Text className="kdy-zhishu__text">{message.text}</Text>
            <Text className="kdy-zhishu__muted">
              {message.sentAt.slice(0, 16).replace("T", " ")}
            </Text>
          </KdyCard>
        ))
      )}
    </View>
  );
}
