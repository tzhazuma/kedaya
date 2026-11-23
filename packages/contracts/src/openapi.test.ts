import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { API_BASE_PATH, type ApiErrorCode } from "./envelope";
import { MODULES } from "./modules";
import {
  ACTIVITY_KINDS,
  ACTIVITY_REMINDER_CHANNELS,
  ACTIVITY_REMINDER_KINDS,
  ACTIVITY_REMINDER_STATUSES,
  ACTIVITY_SOURCES,
  ACTIVITY_STATUSES,
} from "./activities";

const here = dirname(fileURLToPath(import.meta.url));
const specPath = join(here, "..", "openapi", "kedaya.v1.yaml");
const spec = parse(readFileSync(specPath, "utf8")) as Record<string, any>;

describe("OpenAPI 契约文件", () => {
  it("是 OpenAPI 3.1 文档", () => {
    expect(spec.openapi).toMatch(/^3\.1\./);
    expect(spec.info?.title).toContain("可达鸭");
    expect(spec.info?.version).toBe("1.0.0");
  });

  it("声明了 /api/v1 base path", () => {
    expect(API_BASE_PATH).toBe("/api/v1");
    const urls: string[] = (spec.servers ?? []).map((s: any) => s.url);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(
        url.endsWith(API_BASE_PATH),
        `server ${url} 未以 ${API_BASE_PATH} 结尾`,
      ).toBe(true);
    }
  });

  it("每个 path 都属于某个已注册模块（第一段必须是模块路由）", () => {
    const knownRoutes = new Set(MODULES.map((m) => m.route));
    const paths = Object.keys(spec.paths ?? {});
    expect(paths.length).toBeGreaterThan(20);
    for (const p of paths) {
      const first = p.replace(/^\//, "").split("/")[0] ?? "";
      expect(
        knownRoutes.has(first),
        `路径 ${p} 的第一段 "${first}" 不是已注册模块路由`,
      ).toBe(true);
    }
  });

  it("有后端端点的模块都有对应的 tag 与至少一个端点", () => {
    // 第 21 个 `deadlines`（DDL）与第 22 个 `campus-map`（校园地点）本轮都只有
    // 小程序端本机数据
    // （粘贴 / 手填），`services/` 里还没有对应接口，因此 OpenAPI 里
    // 暂时没有它的 tag 与端点。这里显式排除，并保留「数量必须相等」
    // 的强断言：等后端模块落地，删掉这个 filter，测试会立刻要求它 MUST 有 tag ——
    // 不要为了变绿把断言放宽成 `> 0`。
    // 第 23 个 `petition`（众筹诉求）本轮也只有契约与规则层，
    // `services/` 里还没有对应接口 —— 与 deadlines / campus-map 同样排除。
    const withoutApi = new Set([
      "deadlines",
      "campus-map",
      "petition",
      "teabreak",
      "zhishu",
    ]);
    const withApi = MODULES.filter((module) => !withoutApi.has(module.id));
    const tagNames = (spec.tags ?? []).map((t: any) => t.name);
    expect(tagNames).toHaveLength(withApi.length);

    const taggedRoutes = new Set<string>();
    for (const [path, ops] of Object.entries(spec.paths ?? {})) {
      for (const op of Object.values(ops as Record<string, any>)) {
        for (const tag of op?.tags ?? []) taggedRoutes.add(tag);
      }
      void path;
    }

    for (const m of withApi) {
      expect(tagNames, `模块 ${m.id} 缺 tag`).toContain(m.id);
      expect(taggedRoutes, `模块 ${m.id} 没有任何带该 tag 的端点`).toContain(
        m.id,
      );
    }
  });

  it("ApiErrorCode 枚举与 TypeScript 联合类型完全一致", () => {
    const fromSpec: string[] = spec.components.schemas.ApiErrorCode.enum;
    // 编译期断言：这里的字面量集合必须覆盖 ApiErrorCode
    const fromTs: ApiErrorCode[] = [
      "UNAUTHENTICATED",
      "FORBIDDEN",
      "NOT_FOUND",
      "VALIDATION_FAILED",
      "RATE_LIMITED",
      "CONFLICT",
      "CAMPUS_BINDING_REQUIRED",
      "CONSENT_REQUIRED",
      "UPSTREAM_UNAVAILABLE",
      "INTERNAL",
    ];
    expect([...fromSpec].sort()).toEqual([...fromTs].sort());
  });

  it("信封 schema 与 TS 契约形状一致", () => {
    const success = spec.components.schemas.ApiSuccess;
    expect(success.required).toEqual(
      expect.arrayContaining(["ok", "data", "traceId"]),
    );
    expect(success.properties.ok.const).toBe(true);

    const failure = spec.components.schemas.ApiFailure;
    expect(failure.required).toEqual(
      expect.arrayContaining(["ok", "error", "traceId"]),
    );
    expect(failure.properties.ok.const).toBe(false);
  });

  it("分页 schema 用游标而非 offset（契约冻结）", () => {
    const page = spec.components.schemas.PageMeta;
    expect(page.required).toContain("nextCursor");
    expect(Object.keys(page.properties)).not.toContain("offset");
    expect(Object.keys(page.properties)).not.toContain("page");
  });

  it("敏感模块的端点标注了 CONSENT_REQUIRED 响应", () => {
    for (const id of ["wellbeing", "dorm-harmony", "ai-portrait"]) {
      const raw = readFileSync(specPath, "utf8");
      // 该模块的某个端点必须引用 ConsentRequired 响应
      const section = raw.split(`/${id}/`)[1] ?? "";
      expect(section, `${id} 未引用 ConsentRequired`).toContain(
        "ConsentRequired",
      );
    }
  });

  it("CampusBindingSummary 不泄漏任何 session/cookie 字段（契约 §5）", () => {
    const binding = spec.components.schemas.CampusBindingSummary;
    const keys = Object.keys(binding.properties).map((k) => k.toLowerCase());
    for (const forbidden of [
      "cookie",
      "cookies",
      "session",
      "sessiontoken",
      "tgc",
      "castgc",
    ]) {
      expect(keys, `CampusBindingSummary 不得含 ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it("wellbeing 的危机出口端点无需认证（危机出口不可被门槛拦住）", () => {
    const crisis = spec.paths["/wellbeing/crisis-line"].get;
    expect(crisis.security).toEqual([]);
  });

  it("活动域的端点与枚举已进入 OpenAPI", () => {
    const expectedPaths = [
      "/activities/items",
      "/activities/items/{id}",
      "/activities/items/{id}/confirm",
      "/activities/items/{id}/dismiss",
      "/activities/items/{id}/archive",
      "/activities/items/{id}/restore",
      "/activities/imports/wechat",
      "/activities/imports/mail",
      "/activities/reminders",
      "/activities/items/{id}/reminders",
      "/activities/reminders/{id}",
      "/activities/reminders/dispatch",
    ];
    for (const path of expectedPaths) {
      expect(Object.keys(spec.paths), `OpenAPI 缺 ${path}`).toContain(path);
    }
    expect((spec.tags ?? []).map((t: any) => t.name)).toContain("activities");

    const item = spec.components.schemas.ActivityItem;
    expect(item.required).toEqual(
      expect.arrayContaining([
        "id",
        "source",
        "kind",
        "title",
        "evidenceText",
        "status",
      ]),
    );
    expect(item.properties.source.enum).toEqual([...ACTIVITY_SOURCES]);
    expect(item.properties.kind.enum).toEqual([...ACTIVITY_KINDS]);
    expect(item.properties.status.enum).toEqual([...ACTIVITY_STATUSES]);
    expect(item.properties.evidenceText.maxLength).toBe(200);

    const reminder = spec.components.schemas.ActivityReminderItem;
    expect(reminder.required).toEqual(
      expect.arrayContaining(["id", "kind", "remindAt", "channel", "status"]),
    );
    expect(reminder.properties.kind.enum).toEqual([...ACTIVITY_REMINDER_KINDS]);
    expect(reminder.properties.channel.enum).toEqual([
      ...ACTIVITY_REMINDER_CHANNELS,
    ]);
    expect(reminder.properties.status.enum).toEqual([
      ...ACTIVITY_REMINDER_STATUSES,
    ]);
  });

  it("活动确认是独立动作，创建端点不直接把 candidate 标成 confirmed", () => {
    const create = spec.paths["/activities/items"].post;
    const confirm = spec.paths["/activities/items/{id}/confirm"].post;
    expect(confirm).toBeDefined();
    // 创建请求体只能带活动事实字段，不能由客户端指定 status / source=confirmed
    const raw = create.requestBody.content["application/json"].schema;
    const refName =
      raw.$ref === undefined ? "" : (String(raw.$ref).split("/").pop() ?? "");
    const createSchema =
      raw.$ref === undefined ? raw : (spec.components.schemas[refName] ?? {});
    const createProps = createSchema.properties ?? {};
    expect(Object.keys(createProps)).not.toContain("status");
    expect(Object.keys(createProps)).not.toContain("confidence");
    expect(Object.keys(createProps)).not.toContain("source");
  });

  it("活动提醒列表的 status 过滤枚举包含 scheduled 别名", () => {
    const parameters = spec.paths["/activities/reminders"].get.parameters ?? [];
    const status = parameters.find(
      (parameter: any) => parameter.name === "status",
    );
    expect(status?.schema?.enum).toEqual([
      ...ACTIVITY_REMINDER_STATUSES,
      "scheduled",
    ]);
  });

  it("活动列表 / 详情 / 提醒响应引用真实 ActivityItem / ActivityReminderItem", () => {
    const listData =
      spec.paths["/activities/items"].get.responses["200"].content[
        "application/json"
      ].schema.allOf[1].properties.data;
    expect(listData.$ref).toBe("#/components/schemas/ActivityPage");
    expect(
      spec.components.schemas.ActivityPage.properties.items.items.$ref,
    ).toBe("#/components/schemas/ActivityItem");

    const detailData =
      spec.paths["/activities/items/{id}"].get.responses["200"].content[
        "application/json"
      ].schema.allOf[1].properties.data;
    expect(detailData.$ref).toBe("#/components/schemas/ActivityItem");

    const remindersData =
      spec.paths["/activities/reminders"].get.responses["200"].content[
        "application/json"
      ].schema.allOf[1].properties.data;
    expect(remindersData.$ref).toBe(
      "#/components/schemas/ActivityReminderPage",
    );
    expect(
      spec.components.schemas.ActivityReminderPage.properties.items.items.$ref,
    ).toBe("#/components/schemas/ActivityReminderItem");
  });

  it("多候选导入响应声明 {item,items,created,skipped}", () => {
    const result = spec.components.schemas.ActivityImportResult;
    expect(result.required).toEqual(["item", "items", "created", "skipped"]);
    expect(result.properties.items.items.$ref).toBe(
      "#/components/schemas/ActivityItem",
    );
    expect(result.properties.created.minimum).toBe(0);
    expect(result.properties.skipped.minimum).toBe(0);

    const mailData =
      spec.paths["/activities/imports/mail"].post.responses["201"].content[
        "application/json"
      ].schema.allOf[1].properties.data;
    expect(mailData.$ref).toBe("#/components/schemas/ActivityImportResult");

    // 一篇文章可能识别出多场活动，单篇公众号导入也是同一个形状
    const wechatData =
      spec.paths["/activities/imports/wechat"].post.responses["201"].content[
        "application/json"
      ].schema.allOf[1].properties.data;
    expect(wechatData.$ref).toBe("#/components/schemas/ActivityImportResult");
    expect(spec.components.schemas.ActivityWechatImportResult).toBeUndefined();
  });

  it("管理员派发端点声明 x-admin-key 与 401/403", () => {
    const dispatch = spec.paths["/activities/reminders/dispatch"].post;
    const header = (dispatch.parameters ?? []).find(
      (parameter: any) =>
        parameter.in === "header" && parameter.name === "x-admin-key",
    );
    expect(header).toBeDefined();
    expect(dispatch.responses["401"]).toBeDefined();
    expect(dispatch.responses["403"]).toBeDefined();
    expect(spec.components.securitySchemes.adminKey).toMatchObject({
      type: "apiKey",
      in: "header",
      name: "x-admin-key",
    });
  });

  it("活动详情 / 确认 / 忽略 / 提醒端点声明 401 与 404", () => {
    const endpoints: Array<[string, string]> = [
      ["/activities/items/{id}", "get"],
      ["/activities/items/{id}/confirm", "post"],
      ["/activities/items/{id}/dismiss", "post"],
      ["/activities/items/{id}/reminders", "post"],
      ["/activities/reminders/{id}", "delete"],
    ];
    for (const [path, method] of endpoints) {
      const operation = spec.paths[path][method];
      expect(
        operation.responses["401"],
        `${method} ${path} 缺 401`,
      ).toBeDefined();
      expect(
        operation.responses["404"],
        `${method} ${path} 缺 404`,
      ).toBeDefined();
    }
  });

  it("归档 / 恢复领域动作已登记", () => {
    expect(spec.paths["/activities/items/{id}/archive"].post).toBeDefined();
    expect(spec.paths["/activities/items/{id}/restore"].post).toBeDefined();
  });

  it("公众号/邮件导入的字段名与 API 实现一致", () => {
    const wechat = spec.components.schemas.ActivityWechatImport;
    expect(Object.keys(wechat.properties)).toEqual(
      expect.arrayContaining(["url", "text", "title"]),
    );
    // 小程序早期用的是 link；契约统一为 url，避免同一个字段两种拼法
    expect(Object.keys(wechat.properties)).not.toContain("link");
    expect(Object.keys(wechat.properties)).not.toContain("pastedText");

    const mail = spec.components.schemas.ActivityMailImport;
    expect(mail.required).toContain("eventIds");
    expect(Object.keys(mail.properties)).not.toContain("eventId");
    expect(Object.keys(mail.properties)).not.toContain("messageIds");
  });

  it("金额字段一律以 Fen 结尾且为 integer（契约冻结：整数分）", () => {
    const raw = readFileSync(specPath, "utf8");
    // 收集所有 "...Fen:" 定义行，断言类型是 integer
    const fenLines = raw
      .split("\n")
      .filter((l) => /^\s+\w*[Ff]en:\s*\{/.test(l));
    expect(fenLines.length).toBeGreaterThan(5);
    for (const line of fenLines) {
      expect(line, `金额字段必须为 integer: ${line.trim()}`).toContain(
        "type: integer",
      );
    }
  });
});
