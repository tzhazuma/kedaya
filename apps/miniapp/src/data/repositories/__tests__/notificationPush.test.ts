import { ok } from "@kedaya/shared";
import { describe, expect, it, vi } from "vitest";

import type { ApiClient } from "../../api/request";
import { createHttpNotificationRepository } from "../httpNotificationRepository";
import { createMockNotificationRepository } from "../mockNotificationRepository";

describe("订阅消息回传", () => {
  it("把用户已接受的模板 ID 发送到服务端，不接受伪造 openid", async () => {
    const post = vi.fn().mockResolvedValue(
      ok({
        channel: "wechat-subscribe",
        templateId: "template-real",
        status: "active",
      }),
    );
    const client = { post } as unknown as ApiClient;
    const repository = createHttpNotificationRepository(client);
    const result = await repository.subscribeWechat("template-real");

    expect(result.ok).toBe(true);
    expect(post).toHaveBeenCalledWith(
      "notifications/push/wechat-subscriptions",
      { templateId: "template-real" },
    );
    expect(post.mock.calls[0]?.[1]).not.toHaveProperty("openid");
  });

  it("Mock 遇到占位模板时明确失败，不显示已接通", async () => {
    const repository = createMockNotificationRepository({ latencyMs: 0 });
    const result = await repository.subscribeWechat(
      "TMPL_ACTIVITY_PLACEHOLDER",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("未配置");
  });
});
