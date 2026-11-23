import { Text, View } from "@tarojs/components";

import { PAGE_PATHS } from "../../../../app/routes";
import { navigateTo } from "../../../../platform/navigation";
import { KdyButton, KdyCard, KdyTag } from "../../../components";
import { KdyHeading } from "../../../components/KdyHeading";
import "../featurePages.scss";

const features = [
  {
    title: "日报",
    description: "按关注话题整理校园邮件、公众号、知乎与 QQ 导入内容。",
    path: PAGE_PATHS.zhishuDaily,
    tag: "聚合",
  },
  {
    title: "JARVIS",
    description: "检索本机工作区，回答附带引用；未配置模型时不伪装成 AI。",
    path: PAGE_PATHS.zhishuJarvis,
    tag: "检索",
  },
  {
    title: "资料库",
    description: "保存笔记与来源摘要，支持搜索和删除。",
    path: PAGE_PATHS.zhishuMaterials,
    tag: "本机",
  },
  {
    title: "知乎",
    description: "管理手动添加的推荐与反推荐条目，可存入资料库。",
    path: PAGE_PATHS.zhishuZhihu,
    tag: "收藏",
  },
  {
    title: "QQ 聊天",
    description: "导入用户自己的聊天文本，提取到日报；不控制或结束 QQ 进程。",
    path: PAGE_PATHS.zhishuQq,
    tag: "导入",
  },
] as const;

export default function ZhishuHomePage() {
  return (
    <View className="kdy-page kdy-zhishu">
      <KdyHeading
        title="知枢工作台"
        subtitle="日报、检索、资料与消息导入，共享一份本机工作区"
      />
      <KdyCard title="迁移边界">
        <Text className="kdy-zhishu__text">
          本页保留知枢的核心工作流。内置条目标有「【演示】」；在线知乎、公众号和
          QQ 同步需要各自的授权来源，不会显示虚假同步成功。
        </Text>
      </KdyCard>
      {features.map((feature) => (
        <KdyCard
          key={feature.title}
          title={feature.title}
          extra={<KdyTag>{feature.tag}</KdyTag>}
        >
          <Text className="kdy-zhishu__text">{feature.description}</Text>
          <View className="kdy-zhishu__actions">
            <KdyButton size="sm" onClick={() => void navigateTo(feature.path)}>
              打开{feature.title}
            </KdyButton>
          </View>
        </KdyCard>
      ))}
    </View>
  );
}
