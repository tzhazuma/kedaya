import { describe, expect, it } from "vitest";
import {
  BUSINESS_MODULES,
  CONSENT_MODULES,
  CORE_MODULES,
  MODULES,
  SENSITIVE_MODULES,
  getModule,
  isSensitive,
  modulePath,
  requiresConsent,
} from "./modules";

describe("模块注册表", () => {
  it("共 26 个模块（17 业务 + 9 基础）", () => {
    // 第 21 个是 `deadlines`（DDL 聚合），第 22 个是 `campus-map`，都归基础模块。
    // 第 23 个是 2026-10-20 新增的 `petition`（众筹诉求）—— 它是**业务模块**，
    // 因为它是面向学生需求的完整业务闭环（提诉求 → 附议 → 发信 → 追回复），
    // 不属于学业/身份基础设施。
    // 第 25 个是 `activities`（校园活动）—— 与 deadlines 同属学业/日程基础设施，
    // 但它是独立域：活动不能塞进课程 DDL 列表。
    expect(MODULES).toHaveLength(26);
    expect(BUSINESS_MODULES).toHaveLength(17);
    expect(CORE_MODULES).toHaveLength(9);
  });

  it("覆盖需求图中的全部 14 个业务模块 + 场馆预约 / 诉求 / 茶歇（TechPie 并入）", () => {
    const ids = BUSINESS_MODULES.map((m) => m.id);
    expect(ids).toEqual([
      "groupbuy",
      "takeout-guard",
      "flea-market",
      "dorm-harmony",
      "errand",
      "buddy",
      "lost-found",
      "canteen",
      "forum",
      "ai-portrait",
      "wellbeing",
      "faq",
      "techpie",
      "wildlife",
      "facility",
      "petition",
      "teabreak",
    ]);
  });

  it("模块 id 唯一", () => {
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每个模块都有中文名、英文名、摘要与路由", () => {
    for (const m of MODULES) {
      expect(m.nameZh.length, `${m.id} 缺中文名`).toBeGreaterThan(0);
      expect(m.nameEn.length, `${m.id} 缺英文名`).toBeGreaterThan(0);
      expect(m.summary.length, `${m.id} 缺摘要`).toBeGreaterThan(0);
      expect(m.route.length, `${m.id} 缺路由`).toBeGreaterThan(0);
    }
  });

  it("最高敏感级 (critical) 必须要求二次同意（契约 §9）", () => {
    for (const m of MODULES) {
      if (m.sensitivity === "critical") {
        expect(m.requiresConsent, `${m.id} 是 critical 但未要求同意`).toBe(
          true,
        );
      }
    }
  });

  it("high 敏感级不强制同意门：auth / campus-card 的同意由使用行为隐含", () => {
    // 契约 §9 只对 wellbeing / dorm-harmony / ai-portrait 设"显式二次同意"。
    // auth 与 campus-card 是高敏感（需审计 + 最小采集），但用户登录/开卡本身就是同意行为，
    // 再叠一层同意门只会造成无意义的点击。两者必须区分清楚。
    expect(getModule("auth")?.sensitivity).toBe("high");
    expect(getModule("auth")?.requiresConsent).toBe(false);
    expect(getModule("campus-card")?.sensitivity).toBe("high");
    expect(getModule("campus-card")?.requiresConsent).toBe(false);
  });

  it("要求同意的模块必须至少是 high 敏感级", () => {
    for (const m of MODULES) {
      if (m.requiresConsent) {
        expect(["high", "critical"], `${m.id} 要求同意但不是高敏感`).toContain(
          m.sensitivity,
        );
      }
    }
  });

  it("心理支持是最高敏感级", () => {
    expect(getModule("wellbeing")?.sensitivity).toBe("critical");
  });

  it("DDL 聚合：学业数据按 medium 处理，不设同意门", () => {
    expect(getModule("deadlines")).toMatchObject({
      id: "deadlines",
      nameZh: "DDL 聚合",
      nameEn: "Deadlines",
      category: "core",
      sensitivity: "medium",
      requiresConsent: false,
      route: "deadlines",
    });
    // 摘要必须写清「聚合哪些平台」，而不是一句空泛的「课程 DDL」。
    expect(getModule("deadlines")?.summary).toContain("Gradescope");
  });

  it("校园活动：独立 core 模块，medium 敏感级，不设二次同意门", () => {
    expect(getModule("activities")).toMatchObject({
      id: "activities",
      nameZh: "校园活动",
      nameEn: "Campus Activities",
      category: "core",
      sensitivity: "medium",
      requiresConsent: false,
      route: "activities",
    });
    // 摘要必须说清「候选要用户确认」这条边界，而不是暗示自动进日程。
    expect(getModule("activities")?.summary).toContain("确认");
    expect(CONSENT_MODULES.map((m) => m.id)).not.toContain("activities");
  });

  it("知枢工作台是独立 core 模块，并明确五个功能页与本地导入边界", () => {
    expect(getModule("zhishu")).toMatchObject({
      id: "zhishu",
      nameZh: "知枢工作台",
      nameEn: "Zhishu Workspace",
      category: "core",
      sensitivity: "medium",
      requiresConsent: false,
      route: "zhishu",
    });
    expect(getModule("zhishu")?.summary).toContain("日报");
    expect(getModule("zhishu")?.summary).toContain("JARVIS");
    expect(getModule("zhishu")?.summary).toContain("资料库");
    expect(getModule("zhishu")?.summary).toContain("知乎");
    expect(getModule("zhishu")?.summary).toContain("QQ");
  });

  it("需要二次同意的正好是 wellbeing / dorm-harmony / ai-portrait", () => {
    expect(CONSENT_MODULES.map((m) => m.id).sort()).toEqual([
      "ai-portrait",
      "dorm-harmony",
      "wellbeing",
    ]);
  });

  it("高敏感集合包含身份与校园卡", () => {
    const ids = SENSITIVE_MODULES.map((m) => m.id);
    expect(ids).toContain("auth");
    expect(ids).toContain("campus-card");
    expect(ids).toContain("wellbeing");
  });
});

describe("查询函数", () => {
  it("getModule 命中与未命中", () => {
    expect(getModule("forum")?.nameZh).toBe("论坛");
    expect(getModule("nope")).toBeUndefined();
  });

  it("requiresConsent / isSensitive", () => {
    expect(requiresConsent("wellbeing")).toBe(true);
    expect(requiresConsent("canteen")).toBe(false);
    expect(requiresConsent("unknown")).toBe(false);
    expect(isSensitive("dorm-harmony")).toBe(true);
    expect(isSensitive("faq")).toBe(false);
  });

  it("modulePath 拼接路由段", () => {
    expect(modulePath("groupbuy")).toBe("groupbuy");
    expect(modulePath("groupbuy", "items")).toBe("groupbuy/items");
    expect(modulePath("groupbuy", "items", 123)).toBe("groupbuy/items/123");
    expect(modulePath("takeout-guard", "reports")).toBe(
      "takeout-guard/reports",
    );
  });
});
