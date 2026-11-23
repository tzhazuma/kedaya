import { createHash } from "node:crypto";

import {
  NotFoundError,
  ValidationError,
} from "../../../common/errors/app-error";
import type { PushProvider } from "./push.providers";

export type PushChannel = "wechat-subscribe" | "apns" | "fcm" | "hms";
export type PushDeliveryStatus = "pending" | "sending" | "sent" | "failed";

export interface PushTarget {
  id: string;
  userId: string;
  channel: PushChannel;
  token: string;
  templateId: string | null;
  status: "active" | "exhausted" | "revoked";
}

export interface PushDelivery {
  id: string;
  userId: string;
  channel: PushChannel;
  token: string;
  templateId: string | null;
  title: string;
  body: string;
  link: string | null;
  source: string;
  status: PushDeliveryStatus;
  attempts: number;
}

export interface EnqueuePushInput {
  userId: string;
  title: string;
  body: string;
  source: string;
  link: string | null;
  dedupeKey: string;
}

export interface PushRepository {
  upsertTarget(
    userId: string,
    channel: PushChannel,
    token: string,
    templateId?: string,
  ): Promise<PushTarget>;
  revokeTarget(
    userId: string,
    channel: PushChannel,
    token: string,
  ): Promise<boolean>;
  findWechatOpenId(userId: string): Promise<string | null>;
  listActiveTargets(userId: string): Promise<PushTarget[]>;
  enqueue(
    input: EnqueuePushInput,
    targets: readonly PushTarget[],
  ): Promise<number>;
  claimPending(limit: number, now: Date): Promise<PushDelivery[]>;
  markSent(id: string, sentAt: Date): Promise<boolean>;
  markRetry(
    id: string,
    status: "pending" | "failed",
    reason: string,
  ): Promise<boolean>;
  markTargetExhausted(id: string): Promise<void>;
}

export class PushService {
  constructor(
    private readonly repo: PushRepository,
    private readonly providers: Readonly<
      Partial<Record<PushChannel, PushProvider>>
    >,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  registerTarget(
    userId: string,
    channel: PushChannel,
    token: string,
  ): Promise<PushTarget> {
    assertToken(token);
    if (channel === "wechat-subscribe") {
      throw new ValidationError(
        "微信订阅请使用模板订阅端点，不接受客户端提交 openid",
      );
    }
    return this.repo.upsertTarget(userId, channel, token);
  }

  revokeTarget(
    userId: string,
    channel: PushChannel,
    token: string,
  ): Promise<boolean> {
    assertToken(token);
    return this.repo.revokeTarget(userId, channel, token);
  }

  async subscribeWechat(
    userId: string,
    templateId: string,
  ): Promise<PushTarget> {
    if (
      templateId.trim() === "" ||
      templateId.length > 128 ||
      templateId.includes("PLACEHOLDER")
    ) {
      throw new ValidationError("订阅消息模板 ID 无效");
    }
    const openid = await this.repo.findWechatOpenId(userId);
    if (openid === null || openid.startsWith("dev_openid_")) {
      throw new NotFoundError("当前账号没有真实微信绑定，不能发送订阅消息");
    }
    return this.repo.upsertTarget(
      userId,
      "wechat-subscribe",
      openid,
      templateId,
    );
  }

  async enqueue(input: EnqueuePushInput): Promise<number> {
    const targets = await this.repo.listActiveTargets(input.userId);
    if (targets.length === 0) return 0;
    return this.repo.enqueue(input, targets);
  }

  configuredChannels(): PushChannel[] {
    return Object.keys(this.providers) as PushChannel[];
  }

  async targetViews(
    userId: string,
  ): Promise<Array<Pick<PushTarget, "channel" | "templateId" | "status">>> {
    const targets = await this.repo.listActiveTargets(userId);
    return targets.map(({ channel, templateId, status }) => ({
      channel,
      templateId,
      status,
    }));
  }

  async dispatchPending(limit = 50): Promise<{ sent: number; failed: number }> {
    const now = this.clock();
    const deliveries = await this.repo.claimPending(
      Math.max(1, Math.min(200, limit)),
      now,
    );
    let sent = 0;
    let failed = 0;
    for (const delivery of deliveries) {
      const provider = this.providers[delivery.channel];
      if (!provider) {
        failed += 1;
        await this.repo.markRetry(
          delivery.id,
          "failed",
          `${delivery.channel} 推送渠道未配置`,
        );
        continue;
      }
      try {
        await provider.send({
          token: delivery.token,
          title: delivery.title,
          body: delivery.body,
          ...(delivery.link ? { link: delivery.link } : {}),
        });
        await this.repo.markSent(delivery.id, this.clock());
        if (delivery.channel === "wechat-subscribe") {
          const targets = await this.repo.listActiveTargets(delivery.userId);
          const target = targets.find(
            (item) =>
              item.channel === delivery.channel &&
              item.token === delivery.token,
          );
          if (target) await this.repo.markTargetExhausted(target.id);
        }
        sent += 1;
      } catch (error) {
        failed += 1;
        const status = delivery.attempts >= 3 ? "failed" : "pending";
        await this.repo.markRetry(
          delivery.id,
          status,
          error instanceof Error
            ? error.message.slice(0, 500)
            : String(error).slice(0, 500),
        );
      }
    }
    return { sent, failed };
  }
}

export function pushDedupeKey(input: {
  userId: string;
  title: string;
  body: string;
  source: string;
  link?: string | null;
}): string {
  return createHash("sha256")
    .update(
      [
        input.userId,
        input.title,
        input.body,
        input.source,
        input.link ?? "",
      ].join("\n"),
    )
    .digest("hex");
}

function assertToken(token: string): void {
  if (token.trim() === "" || token.length > 4096) {
    throw new ValidationError("设备令牌为空或过长");
  }
}
