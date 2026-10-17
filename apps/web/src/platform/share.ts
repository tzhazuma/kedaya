/**
 * 分享适配（契约 §7：platform/share）。
 * Web 端优先用 Web Share API，退化到剪贴板；两者都不可用则如实返回失败原因。
 */
import { isBrowser } from './env';

export interface SharePayload {
  title: string;
  text?: string;
  url?: string;
}

export type ShareOutcome =
  | { ok: true; channel: 'native' | 'clipboard' }
  | { ok: false; reason: string };

export function canUseNativeShare(): boolean {
  return isBrowser() && typeof navigator.share === 'function';
}

export function canUseClipboard(): boolean {
  return isBrowser() && typeof navigator.clipboard?.writeText === 'function';
}

export async function shareOrCopy(payload: SharePayload): Promise<ShareOutcome> {
  if (!isBrowser()) return { ok: false, reason: '当前不在浏览器环境' };

  if (canUseNativeShare()) {
    try {
      await navigator.share(payload);
      return { ok: true, channel: 'native' };
    } catch {
      // 用户取消也走剪贴板兜底
    }
  }

  if (canUseClipboard()) {
    try {
      const text = [payload.title, payload.text, payload.url].filter(Boolean).join(' ');
      await navigator.clipboard.writeText(text);
      return { ok: true, channel: 'clipboard' };
    } catch {
      return { ok: false, reason: '剪贴板写入被浏览器拒绝' };
    }
  }

  return { ok: false, reason: '当前浏览器不支持分享或剪贴板' };
}
