import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../data/storage/taroStorage", () => ({
  createTaroStorage: () => ({
    read: () => null,
    write: () => undefined,
    remove: () => undefined,
  }),
}));

import { emptyZhishuWorkspace } from "../../../../data/repositories/zhishuLocalRepository";
import {
  addMaterialToWorkspace,
  answerFromWorkspace,
  importQqIntoWorkspace,
  saveFeedItemToMaterials,
  zhishuDemoWorkspace,
} from "../workspaceView";

describe("知枢工作台页面行为", () => {
  it("JARVIS 本地检索回答附带真实引用，不伪装成大模型", () => {
    const workspace = zhishuDemoWorkspace();
    const result = answerFromWorkspace(workspace, "信息论");
    expect(result.answer).toContain("本地检索");
    expect(result.references.map((item) => item.id)).toContain("demo-zhihu-1");
    expect(answerFromWorkspace(workspace, "完全不存在").references).toEqual([]);
  });

  it("知乎条目可存为资料，重复保存不会创建副本", () => {
    const workspace = zhishuDemoWorkspace();
    const item = workspace.items.find((entry) => entry.id === "demo-zhihu-1");
    expect(item).toBeDefined();
    const once = saveFeedItemToMaterials(workspace, item!);
    const twice = saveFeedItemToMaterials(once, item!);
    expect(once.materials).toHaveLength(1);
    expect(twice.materials).toHaveLength(1);
    expect(once.materials[0]?.sourceUrl).not.toContain("token=");
  });

  it("QQ 导入加入消息与日报来源，非法输入不污染原工作区", () => {
    const result = importQqIntoWorkspace(
      emptyZhishuWorkspace,
      "2026-11-23 09:30:00 张三\n明天下午两点有讲座",
    );
    expect(result.workspace.qqMessages).toHaveLength(1);
    expect(result.workspace.items[0]).toMatchObject({
      source: "qq",
      title: "张三的群消息",
    });
    expect(() => importQqIntoWorkspace(emptyZhishuWorkspace, "bad")).toThrow(
      "没有可导入",
    );
  });

  it("手动资料校验标题与正文，并保存在最前面", () => {
    expect(() => addMaterialToWorkspace(emptyZhishuWorkspace, "", "")).toThrow(
      "标题和正文",
    );
    const next = addMaterialToWorkspace(
      emptyZhishuWorkspace,
      "讲座笔记",
      "分布式系统",
    );
    expect(next.materials[0]).toMatchObject({
      title: "讲座笔记",
      content: "分布式系统",
    });
  });

  it("所有内置条目都明确标为演示", () => {
    for (const item of zhishuDemoWorkspace().items) {
      expect(item.title).toContain("【演示】");
    }
  });
});
