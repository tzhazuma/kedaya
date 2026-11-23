import { createSign } from "node:crypto";
import { connect } from "node:http2";

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  link?: string;
}

export interface PushProvider {
  send(message: PushMessage): Promise<void>;
}

type Fetcher = typeof fetch;

interface TokenCache {
  value: string;
  expiresAt: number;
}

function jwtSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signedJwt(
  header: unknown,
  payload: unknown,
  privateKey: string,
  dsaEncoding?: "ieee-p1363",
): string {
  const input = `${jwtSegment(header)}.${jwtSegment(payload)}`;
  const signer = createSign("sha256");
  signer.update(input);
  const signature = signer.sign({
    key: privateKey,
    ...(dsaEncoding ? { dsaEncoding } : {}),
  });
  return `${input}.${signature.toString("base64url")}`;
}

export function buildApnsJwt(options: {
  teamId: string;
  keyId: string;
  privateKey: string;
  nowSeconds?: number;
}): string {
  return signedJwt(
    { alg: "ES256", kid: options.keyId, typ: "JWT" },
    {
      iss: options.teamId,
      iat: options.nowSeconds ?? Math.floor(Date.now() / 1000),
    },
    options.privateKey,
    "ieee-p1363",
  );
}

async function responseJson(
  response: Response,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`推送上游返回非 JSON（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    throw new Error(`推送上游 HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return body;
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value === "")
    throw new Error(`推送上游缺少 ${key}`);
  return value;
}

export class WechatSubscribePushProvider implements PushProvider {
  private token: TokenCache | null = null;

  constructor(
    private readonly options: {
      appId: string;
      secret: string;
      templateId: string;
      titleKey: string;
      bodyKey: string;
      fetcher?: Fetcher;
    },
  ) {}

  async send(message: PushMessage): Promise<void> {
    const fetcher = this.options.fetcher ?? fetch;
    const accessToken = await this.accessToken();
    const response = await fetcher(
      `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          touser: message.token,
          template_id: this.options.templateId,
          ...(message.link ? { page: message.link } : {}),
          data: {
            [this.options.titleKey]: { value: message.title.slice(0, 20) },
            [this.options.bodyKey]: { value: message.body.slice(0, 100) },
          },
        }),
      },
    );
    const body = await responseJson(response);
    if (body.errcode !== 0) {
      throw new Error(
        `微信订阅消息失败 ${String(body.errcode)}: ${String(body.errmsg ?? "")}`,
      );
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000)
      return this.token.value;
    const fetcher = this.options.fetcher ?? fetch;
    const query = new URLSearchParams({
      grant_type: "client_credential",
      appid: this.options.appId,
      secret: this.options.secret,
    });
    const response = await fetcher(
      `https://api.weixin.qq.com/cgi-bin/token?${query}`,
    );
    const body = await responseJson(response);
    const value = requiredString(body, "access_token");
    this.token = {
      value,
      expiresAt: Date.now() + Number(body.expires_in ?? 7200) * 1000,
    };
    return value;
  }
}

export class FcmPushProvider implements PushProvider {
  private token: TokenCache | null = null;

  constructor(
    private readonly options: {
      projectId: string;
      clientEmail: string;
      privateKey: string;
      fetcher?: Fetcher;
    },
  ) {}

  async send(message: PushMessage): Promise<void> {
    const fetcher = this.options.fetcher ?? fetch;
    const accessToken = await this.accessToken();
    const response = await fetcher(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.options.projectId)}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: message.token,
            notification: { title: message.title, body: message.body },
            data: message.link ? { link: message.link } : {},
          },
        }),
      },
    );
    await responseJson(response);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000)
      return this.token.value;
    const now = Math.floor(Date.now() / 1000);
    const assertion = signedJwt(
      { alg: "RS256", typ: "JWT" },
      {
        iss: this.options.clientEmail,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      },
      this.options.privateKey,
    );
    const fetcher = this.options.fetcher ?? fetch;
    const response = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    const body = await responseJson(response);
    const value = requiredString(body, "access_token");
    this.token = {
      value,
      expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000,
    };
    return value;
  }
}

export class HmsPushProvider implements PushProvider {
  private token: TokenCache | null = null;

  constructor(
    private readonly options: {
      appId: string;
      clientId: string;
      clientSecret: string;
      fetcher?: Fetcher;
    },
  ) {}

  async send(message: PushMessage): Promise<void> {
    const fetcher = this.options.fetcher ?? fetch;
    const accessToken = await this.accessToken();
    const response = await fetcher(
      `https://push-api.cloud.huawei.com/v1/${encodeURIComponent(this.options.appId)}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          validate_only: false,
          message: {
            notification: { title: message.title, body: message.body },
            data: message.link
              ? JSON.stringify({ link: message.link })
              : undefined,
            android: {
              notification: { title: message.title, body: message.body },
            },
            token: [message.token],
          },
        }),
      },
    );
    const body = await responseJson(response);
    if (body.code !== "80000000") {
      throw new Error(
        `HMS 推送失败 ${String(body.code)}: ${String(body.msg ?? "")}`,
      );
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000)
      return this.token.value;
    const fetcher = this.options.fetcher ?? fetch;
    const response = await fetcher(
      "https://oauth-login.cloud.huawei.com/oauth2/v3/token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
        }),
      },
    );
    const body = await responseJson(response);
    const value = requiredString(body, "access_token");
    this.token = {
      value,
      expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000,
    };
    return value;
  }
}

export interface ApnsRequestOptions {
  hostname: string;
  path: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface ApnsResponse {
  status: number;
  body: string;
  headers: Record<string, unknown>;
}

type ApnsRequest = (options: ApnsRequestOptions) => Promise<ApnsResponse>;

export class ApnsPushProvider implements PushProvider {
  constructor(
    private readonly options: {
      teamId: string;
      keyId: string;
      privateKey: string;
      topic: string;
      sandbox: boolean;
      request?: ApnsRequest;
    },
  ) {}

  async send(message: PushMessage): Promise<void> {
    const request = this.options.request ?? apnsRequest;
    const response = await request({
      hostname: this.options.sandbox
        ? "https://api.sandbox.push.apple.com"
        : "https://api.push.apple.com",
      path: `/3/device/${encodeURIComponent(message.token)}`,
      method: "POST",
      headers: {
        authorization: `bearer ${buildApnsJwt(this.options)}`,
        "apns-topic": this.options.topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
      },
      body: JSON.stringify({
        aps: {
          alert: { title: message.title, body: message.body },
          sound: "default",
        },
        ...(message.link ? { link: message.link } : {}),
      }),
    });
    if (response.status !== 200) {
      throw new Error(
        `APNs 推送失败 HTTP ${response.status}: ${response.body.slice(0, 200)}`,
      );
    }
  }
}

async function apnsRequest(options: ApnsRequestOptions): Promise<ApnsResponse> {
  return new Promise<ApnsResponse>((resolve, reject) => {
    const client = connect(options.hostname);
    const chunks: Buffer[] = [];
    const request = client.request({
      ":method": options.method,
      ":path": options.path,
      "content-type": "application/json",
      ...options.headers,
    });
    request.on("response", (headers) => {
      const status = Number(headers[":status"] ?? 0);
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        client.close();
        resolve({
          status,
          body: Buffer.concat(chunks).toString("utf8"),
          headers: headers as Record<string, unknown>,
        });
      });
    });
    request.on("error", (error) => {
      client.close();
      reject(error);
    });
    request.end(options.body);
  });
}
