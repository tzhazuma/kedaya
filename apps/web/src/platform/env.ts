/**
 * 平台环境适配（契约 §7：`platform/` 放平台差异）。
 *
 * Web 端的"平台差异"主要是：构建期注入的公开环境变量、浏览器能力探测。
 * ⚠️ 只读取 `NEXT_PUBLIC_*`（会被 Next 内联）；**不要**在这里读服务端密钥。
 */
import { API_BASE_PATH } from '@kedaya/contracts';

/** 默认 `/api/v1`；部署到独立 API 域名时用 NEXT_PUBLIC_KEDAYA_API_BASE 覆盖 */
export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_KEDAYA_API_BASE ?? API_BASE_PATH;
}

/**
 * 是否走 mock（默认 true：无后端可跑）。
 * 注意命名：**不要**用 `useXxx` 前缀 —— 这不是 React Hook，
 * 否则 `react-hooks/rules-of-hooks` 会在普通函数里误报。
 */
export function isMockMode(): boolean {
  return process.env.NEXT_PUBLIC_KEDAYA_USE_MOCK !== 'false';
}

export function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export interface RuntimeFacts {
  appName: string;
  appVersion: string;
  apiBaseUrl: string;
  mode: 'mock' | 'http';
}

export function runtimeFacts(): RuntimeFacts {
  return {
    appName: '可达鸭 Web 门户',
    appVersion: '0.1.0',
    apiBaseUrl: apiBaseUrl(),
    mode: isMockMode() ? 'mock' : 'http',
  };
}
