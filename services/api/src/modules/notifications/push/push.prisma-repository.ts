import { Inject, Injectable } from "@nestjs/common";
import {
  Prisma,
  type PushDelivery as PushDeliveryRow,
  type PushTarget as PushTargetRow,
} from "@prisma/client";

import { PrismaService } from "../../../prisma/prisma.service";
import type {
  EnqueuePushInput,
  PushChannel,
  PushDelivery,
  PushRepository,
  PushTarget,
} from "./push.service";

export const PUSH_REPOSITORY = Symbol("KEDAYA_PUSH_REPOSITORY");

@Injectable()
export class PushPrismaRepository implements PushRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async upsertTarget(
    userId: string,
    channel: PushChannel,
    token: string,
    templateId?: string,
  ): Promise<PushTarget> {
    const row = await this.prisma.pushTarget.upsert({
      where: { channel_token: { channel, token } },
      create: { userId, channel, token, templateId: templateId ?? null },
      update: {
        userId,
        templateId: templateId ?? null,
        status: "active",
        lastSeenAt: new Date(),
      },
    });
    return toTarget(row);
  }

  async revokeTarget(
    userId: string,
    channel: PushChannel,
    token: string,
  ): Promise<boolean> {
    const result = await this.prisma.pushTarget.updateMany({
      where: { userId, channel, token, status: "active" },
      data: { status: "revoked" },
    });
    return result.count > 0;
  }

  async findWechatOpenId(userId: string): Promise<string | null> {
    const identity = await this.prisma.authIdentity.findFirst({
      where: { userId, provider: "WECHAT_MINIPROGRAM" },
      select: { externalId: true },
    });
    return identity?.externalId ?? null;
  }

  async listActiveTargets(userId: string): Promise<PushTarget[]> {
    const rows = await this.prisma.pushTarget.findMany({
      where: { userId, status: "active" },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toTarget);
  }

  async enqueue(
    input: EnqueuePushInput,
    targets: readonly PushTarget[],
  ): Promise<number> {
    if (targets.length === 0) return 0;
    const result = await this.prisma.pushDelivery.createMany({
      data: targets.map((target) => ({
        userId: input.userId,
        channel: target.channel,
        token: target.token,
        templateId: target.templateId,
        title: input.title,
        body: input.body,
        link: input.link,
        source: input.source,
        dedupeKey: `${input.dedupeKey}:${target.id}`,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  async claimPending(limit: number, now: Date): Promise<PushDelivery[]> {
    await this.prisma.pushDelivery.updateMany({
      where: {
        status: "sending",
        OR: [
          { claimedAt: null },
          { claimedAt: { lt: new Date(now.getTime() - 300_000) } },
        ],
      },
      data: { status: "pending", claimedAt: null },
    });
    const rows = await this.prisma.$queryRaw<PushDeliveryRow[]>(Prisma.sql`
      UPDATE "PushDelivery"
      SET "status" = 'sending', "claimedAt" = ${now}, "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "PushDelivery"
        WHERE "status" = 'pending'
        ORDER BY "createdAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING *
    `);
    return rows.map(toDelivery);
  }

  async markSent(id: string, sentAt: Date): Promise<boolean> {
    const result = await this.prisma.pushDelivery.updateMany({
      where: { id, status: "sending" },
      data: { status: "sent", sentAt, claimedAt: null, lastError: null },
    });
    return result.count > 0;
  }

  async markRetry(
    id: string,
    status: "pending" | "failed",
    reason: string,
  ): Promise<boolean> {
    const result = await this.prisma.pushDelivery.updateMany({
      where: { id, status: "sending" },
      data: { status, lastError: reason.slice(0, 500), claimedAt: null },
    });
    return result.count > 0;
  }

  async markTargetExhausted(id: string): Promise<void> {
    await this.prisma.pushTarget.updateMany({
      where: { id, status: "active" },
      data: { status: "exhausted" },
    });
  }
}

function toTarget(row: PushTargetRow): PushTarget {
  return {
    id: row.id,
    userId: row.userId,
    channel: row.channel as PushChannel,
    token: row.token,
    templateId: row.templateId,
    status: row.status as PushTarget["status"],
  };
}

function toDelivery(row: PushDeliveryRow): PushDelivery {
  return {
    id: row.id,
    userId: row.userId,
    channel: row.channel as PushChannel,
    token: row.token,
    templateId: row.templateId,
    title: row.title,
    body: row.body,
    link: row.link,
    source: row.source,
    status: row.status as PushDelivery["status"],
    attempts: row.attempts,
  };
}
