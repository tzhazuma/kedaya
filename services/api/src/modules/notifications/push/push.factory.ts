import { ConfigService } from "@nestjs/config";

import {
  ApnsPushProvider,
  FcmPushProvider,
  HmsPushProvider,
  WechatSubscribePushProvider,
  type PushProvider,
} from "./push.providers";
import type { PushChannel } from "./push.service";

export const PUSH_PROVIDERS = Symbol("KEDAYA_PUSH_PROVIDERS");

export function createPushProviders(
  config: ConfigService,
): Partial<Record<PushChannel, PushProvider>> {
  const providers: Partial<Record<PushChannel, PushProvider>> = {};
  const wechatAppId = text(config, "WECHAT_MINIAPP_APPID");
  const wechatSecret = text(config, "WECHAT_MINIAPP_SECRET");
  const wechatTemplate = text(config, "WECHAT_ACTIVITY_TEMPLATE_ID");
  if (
    wechatAppId &&
    wechatSecret &&
    wechatTemplate &&
    !wechatTemplate.includes("PLACEHOLDER")
  ) {
    providers["wechat-subscribe"] = new WechatSubscribePushProvider({
      appId: wechatAppId,
      secret: wechatSecret,
      templateId: wechatTemplate,
      titleKey: text(config, "WECHAT_ACTIVITY_TITLE_KEY") ?? "thing1",
      bodyKey: text(config, "WECHAT_ACTIVITY_BODY_KEY") ?? "thing2",
    });
  }

  const fcmProject = text(config, "FCM_PROJECT_ID");
  const fcmEmail = text(config, "FCM_CLIENT_EMAIL");
  const fcmKey = privateKey(config, "FCM_PRIVATE_KEY");
  if (fcmProject && fcmEmail && fcmKey) {
    providers.fcm = new FcmPushProvider({
      projectId: fcmProject,
      clientEmail: fcmEmail,
      privateKey: fcmKey,
    });
  }

  const hmsAppId = text(config, "HMS_APP_ID");
  const hmsClientId = text(config, "HMS_CLIENT_ID");
  const hmsSecret = text(config, "HMS_CLIENT_SECRET");
  if (hmsAppId && hmsClientId && hmsSecret) {
    providers.hms = new HmsPushProvider({
      appId: hmsAppId,
      clientId: hmsClientId,
      clientSecret: hmsSecret,
    });
  }

  const apnsTeam = text(config, "APNS_TEAM_ID");
  const apnsKeyId = text(config, "APNS_KEY_ID");
  const apnsKey = privateKey(config, "APNS_PRIVATE_KEY");
  const apnsTopic = text(config, "APNS_TOPIC");
  if (apnsTeam && apnsKeyId && apnsKey && apnsTopic) {
    providers.apns = new ApnsPushProvider({
      teamId: apnsTeam,
      keyId: apnsKeyId,
      privateKey: apnsKey,
      topic: apnsTopic,
      sandbox: text(config, "APNS_SANDBOX") !== "false",
    });
  }
  return providers;
}

function text(config: ConfigService, key: string): string | null {
  const value = config.get<string>(key)?.trim();
  return value ? value : null;
}

function privateKey(config: ConfigService, key: string): string | null {
  const value = text(config, key);
  return value?.replace(/\\n/g, "\n") ?? null;
}
