'use client';

/**
 * 主题 Provider（契约 §7：presentation/theme）。
 *
 * 实现要点：主题偏好是**外部系统状态**（`localStorage` + `matchMedia`），
 * 因此用 `useSyncExternalStore` 订阅，而不是在 `useEffect` 里 `setState`
 * （后者会触发级联渲染，并被 `react-hooks/set-state-in-effect` 判为错误）。
 * `getServerSnapshot` 固定返回 `'system'`，保证 SSR 与 hydration 首帧一致。
 *
 * 与 design-tokens 的暗色约定对齐：令牌通过 `[data-theme="dark"]` 与
 * `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` 暴露暗色，
 * 本 Provider 负责写 `<html data-theme>`（system 模式则移除该属性）。
 * 同时切换 `dark` class（Tailwind `dark:` 变体可用）与 `color-scheme`（原生控件）。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'kedaya.theme';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

/* ------------------------------------------------------------------ *
 * 外部存储 1：用户偏好（localStorage）
 * ------------------------------------------------------------------ */

const modeListeners = new Set<() => void>();
let cachedMode: ThemeMode | undefined;

function readStoredMode(): ThemeMode {
  if (cachedMode !== undefined) return cachedMode;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    cachedMode = isThemeMode(raw) ? raw : 'system';
  } catch {
    // 隐私模式 / 禁用 localStorage：静默降级（契约 §8：失败静默降级）
    cachedMode = 'system';
  }
  return cachedMode;
}

function subscribeMode(listener: () => void): () => void {
  modeListeners.add(listener);
  const onStorage = (event: StorageEvent): void => {
    if (event.key === STORAGE_KEY) {
      cachedMode = undefined;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    modeListeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function writeMode(next: ThemeMode): void {
  cachedMode = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 忽略：内存态仍然生效
  }
  for (const listener of modeListeners) listener();
}

function getServerMode(): ThemeMode {
  return 'system';
}

/* ------------------------------------------------------------------ *
 * 外部存储 2：系统深色偏好（matchMedia）
 * ------------------------------------------------------------------ */

function subscribeSystemDark(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const query = window.matchMedia(MEDIA_QUERY);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

function getSystemDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(MEDIA_QUERY).matches;
}

function getServerSystemDark(): boolean {
  return false;
}

/* ------------------------------------------------------------------ *
 * Context
 * ------------------------------------------------------------------ */

export interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const mode = useSyncExternalStore(subscribeMode, readStoredMode, getServerMode);
  const systemDark = useSyncExternalStore(subscribeSystemDark, getSystemDark, getServerSystemDark);
  const resolved: ResolvedTheme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  // 只写外部系统（<html> 的 data-theme / class / color-scheme），不 setState。
  //
  // 与 design-tokens 的暗色约定对齐（tokens.css 的 colorDark 块）：
  //   [data-theme="dark"]                        → 显式深色
  //   @media (prefers-color-scheme: dark)
  //     :root:not([data-theme="light"])          → 跟随系统
  // 因此 system 模式必须**移除** data-theme，light 模式必须显式写 "light"
  // 才能同时满足这两条规则。`dark` class 保留给 Tailwind `dark:` 变体。
  useEffect(() => {
    const root = document.documentElement;
    if (mode === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', mode);
    }
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;
  }, [mode, resolved]);

  const setMode = useCallback((next: ThemeMode) => {
    writeMode(next);
  }, []);

  const toggle = useCallback(() => {
    writeMode(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved]);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved, setMode, toggle }),
    [mode, resolved, setMode, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme 必须在 <ThemeProvider> 内使用');
  return ctx;
}
