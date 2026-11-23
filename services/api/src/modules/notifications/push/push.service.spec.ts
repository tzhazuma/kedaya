import { describe, expect, it, vi } from "vitest";

import type { PushProvider } from "./push.providers";
import {
  PushService,
  type PushDelivery,
  type PushRepository,
  type PushTarget,
} from "./push.service";

function target(patch: Partial<PushTarget> = {}): PushTarget {
  return {
    id: "target-1",
    userId: "user",
    channel: "fcm",
    token: "device",
    templateId: null,
    status: "active",
    ...patch,
  };
}

function delivery(patch: Partial<PushDelivery> = {}): PushDelivery {
  return {
    id: "delivery-1",
    userId: "user",
    channel: "fcm",
    token: "device",
    templateId: null,
    title: "标题",
    body: "正文",
    link: null,
    source: "activities",
    status: "sending",
    attempts: 1,
    ...patch,
  };
}

function makeRepo(): PushRepository {
  return {
    upsertTarget: vi.fn().mockResolvedValue(target()),
    revokeTarget: vi.fn().mockResolvedValue(true),
    findWechatOpenId: vi.fn().mockResolvedValue("openid-from-identity"),
    listActiveTargets: vi.fn().mockResolvedValue([target()]),
    enqueue: vi.fn().mockResolvedValue(1),
    claimPending: vi.fn().mockResolvedValue([delivery()]),
    markSent: vi.fn().mockResolvedValue(true),
    markRetry: vi.fn().mockResolvedValue(true),
    markTargetExhausted: vi.fn().mockResolvedValue(undefined),
  };
}

describe("推送发件箱", () => {
  it("登记设备后，通知按目标快照入队并派发", async () => {
    const repo = makeRepo();
    const provider: PushProvider = {
      send: vi.fn().mockResolvedValue(undefined),
    };
    const service = new PushService(repo, { fcm: provider });
    await service.registerTarget("user", "fcm", "device");
    await service.enqueue({
      userId: "user",
      title: "标题",
      body: "正文",
      source: "activities",
      link: null,
      dedupeKey: "dedupe",
    });
    expect(repo.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: "dedupe" }),
      [target()],
    );

    const result = await service.dispatchPending(10);
    expect(result).toMatchObject({ sent: 1, failed: 0 });
    expect(provider.send).toHaveBeenCalledWith({
      token: "device",
      title: "标题",
      body: "正文",
    });
    expect(repo.markSent).toHaveBeenCalledWith("delivery-1", expect.any(Date));
  });

  it("失败重试，达到三次后标记 failed", async () => {
    const repo = makeRepo();
    vi.mocked(repo.claimPending).mockResolvedValue([delivery({ attempts: 3 })]);
    const provider: PushProvider = {
      send: vi.fn().mockRejectedValue(new Error("upstream down")),
    };
    const service = new PushService(repo, { fcm: provider });
    const result = await service.dispatchPending(10);
    expect(result.failed).toBe(1);
    expect(repo.markRetry).toHaveBeenCalledWith(
      "delivery-1",
      "failed",
      "upstream down",
    );
  });

  it("微信订阅只用账号绑定的 openid，成功后将一次性授权耗尽", async () => {
    const repo = makeRepo();
    vi.mocked(repo.upsertTarget).mockResolvedValue(
      target({
        channel: "wechat-subscribe",
        token: "openid-from-identity",
        templateId: "template",
      }),
    );
    vi.mocked(repo.listActiveTargets).mockResolvedValue([
      target({
        channel: "wechat-subscribe",
        token: "openid-from-identity",
        templateId: "template",
      }),
    ]);
    vi.mocked(repo.claimPending).mockResolvedValue([
      delivery({
        channel: "wechat-subscribe",
        token: "openid-from-identity",
        templateId: "template",
      }),
    ]);
    const provider: PushProvider = {
      send: vi.fn().mockResolvedValue(undefined),
    };
    const service = new PushService(repo, { "wechat-subscribe": provider });

    await service.subscribeWechat("user", "template");
    expect(repo.upsertTarget).toHaveBeenCalledWith(
      "user",
      "wechat-subscribe",
      "openid-from-identity",
      "template",
    );
    await service.dispatchPending(10);
    expect(repo.markTargetExhausted).toHaveBeenCalledWith("target-1");
  });

  it("未配置厂商不伪报 sent", async () => {
    const repo = makeRepo();
    const service = new PushService(repo, {});
    const result = await service.dispatchPending(10);
    expect(result.failed).toBe(1);
    expect(repo.markSent).not.toHaveBeenCalled();
    expect(repo.markRetry).toHaveBeenCalledWith(
      "delivery-1",
      "failed",
      expect.stringContaining("未配置"),
    );
  });
});
