import { describe, expect, it, vi } from "vitest";

import { OfficialSyncService } from "./official-sync.service";

describe("公众号订阅同步", () => {
  it("只允许订阅已配置账号，并记录每个订阅的独立结果", async () => {
    const prisma = {
      officialAccountSubscription: {
        upsert: vi.fn().mockResolvedValue({ accountKey: "shtu" }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([
          { userId: "u1", accountKey: "shtu" },
          { userId: "u2", accountKey: "shtu" },
        ]),
      },
    };
    const activities = {
      syncOfficial: vi
        .fn()
        .mockResolvedValueOnce({ created: 2, skipped: 1, items: [] })
        .mockRejectedValueOnce(new Error("upstream down")),
    };
    const official = {
      accounts: () => [{ key: "shtu", name: "上海科技大学" }],
    };
    const service = new OfficialSyncService(
      prisma as never,
      activities as never,
      official as never,
    );

    await expect(service.subscribe("u1", "unknown")).rejects.toThrow(
      "未配置公众号",
    );
    await service.subscribe("u1", "shtu");
    expect(prisma.officialAccountSubscription.upsert).toHaveBeenCalled();
    const result = await service.syncAll();
    expect(result).toMatchObject({ created: 2, skipped: 1, failed: 1 });
  });
});
