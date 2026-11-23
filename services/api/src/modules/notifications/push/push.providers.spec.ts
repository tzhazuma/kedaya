import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  ApnsPushProvider,
  FcmPushProvider,
  HmsPushProvider,
  WechatSubscribePushProvider,
  buildApnsJwt,
} from "./push.providers";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("微信订阅消息", () => {
  it("缓存 access_token，并发送用户同意过的模板", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "access", expires_in: 7200 }),
      )
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, msgid: 42 }));
    const provider = new WechatSubscribePushProvider({
      appId: "wx-app",
      secret: "secret",
      templateId: "template",
      titleKey: "thing1",
      bodyKey: "thing2",
      fetcher,
    });

    await provider.send({
      token: "openid",
      title: "活动标题",
      body: "提醒正文",
      link: "activities/detail",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(url).toContain("subscribe/send?access_token=access");
    expect(JSON.parse(String(init.body))).toMatchObject({
      touser: "openid",
      template_id: "template",
      page: "activities/detail",
      data: { thing1: { value: "活动标题" }, thing2: { value: "提醒正文" } },
    });
  });

  it("微信业务错误不会伪装成已发送", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "access", expires_in: 7200 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ errcode: 43101, errmsg: "user refused" }),
      );
    const provider = new WechatSubscribePushProvider({
      appId: "wx-app",
      secret: "secret",
      templateId: "template",
      titleKey: "thing1",
      bodyKey: "thing2",
      fetcher,
    });
    await expect(
      provider.send({ token: "openid", title: "t", body: "b" }),
    ).rejects.toThrow("43101");
  });
});

describe("FCM v1 与 HMS", () => {
  it("FCM 用服务账号 JWT 换 OAuth token，再调用 messages:send", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "oauth", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(jsonResponse({ name: "projects/p/messages/1" }));
    const provider = new FcmPushProvider({
      projectId: "project",
      clientEmail: "svc@example.com",
      privateKey: privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      fetcher,
    });
    await provider.send({
      token: "device",
      title: "标题",
      body: "正文",
      link: "/activities/1",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(
      "https://fcm.googleapis.com/v1/projects/project/messages:send",
    );
    expect(init.headers).toMatchObject({ authorization: "Bearer oauth" });
    expect(JSON.parse(String(init.body))).toMatchObject({
      message: {
        token: "device",
        notification: { title: "标题", body: "正文" },
        data: { link: "/activities/1" },
      },
    });
  });

  it("HMS 用客户端凭证换 token，并只发给登记设备", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "oauth", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ code: "80000000", requestId: "hms-1" }),
      );
    const provider = new HmsPushProvider({
      appId: "app",
      clientId: "client",
      clientSecret: "secret",
      fetcher,
    });
    await provider.send({ token: "device", title: "标题", body: "正文" });
    const [url, init] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://push-api.cloud.huawei.com/v1/app/messages:send");
    expect(JSON.parse(String(init.body))).toMatchObject({
      validate_only: false,
      message: { token: ["device"] },
    });
  });
});

describe("APNs", () => {
  it("ES256 JWT 可由公钥验证", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const token = buildApnsJwt({
      teamId: "team",
      keyId: "key",
      privateKey: pem,
      nowSeconds: 100,
    });
    const [header, payload, signature] = token.split(".");
    expect(
      JSON.parse(Buffer.from(header!, "base64url").toString()),
    ).toMatchObject({ alg: "ES256", kid: "key" });
    expect(
      JSON.parse(Buffer.from(payload!, "base64url").toString()),
    ).toMatchObject({ iss: "team", iat: 100 });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
  });

  it("通过 HTTP/2 发送标题、正文、topic 与设备 token", async () => {
    const { privateKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const request = vi
      .fn()
      .mockResolvedValue({
        status: 200,
        body: "{}",
        headers: { "apns-id": "apns-1" },
      });
    const provider = new ApnsPushProvider({
      teamId: "team",
      keyId: "key",
      privateKey: privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      topic: "cn.kedaya",
      sandbox: true,
      request,
    });
    await provider.send({
      token: "device",
      title: "标题",
      body: "正文",
      link: "/activities/1",
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: "https://api.sandbox.push.apple.com",
        path: "/3/device/device",
        method: "POST",
      }),
    );
    const options = request.mock.calls[0]?.[0] as { body: string };
    expect(JSON.parse(options.body)).toMatchObject({
      aps: { alert: { title: "标题", body: "正文" } },
      link: "/activities/1",
    });
  });
});
