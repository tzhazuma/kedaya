import Taro from '@tarojs/taro'
import tokens from '@kedaya/design-tokens/tokens.json'
import { useEffect, useSyncExternalStore } from 'react'

export type ThemeMode = 'dark' | 'light'

const STORAGE_KEY = 'kedaya-theme-mode'
const listeners = new Set<() => void>()
let currentMode: ThemeMode | null = null

function readStoredMode(): ThemeMode {
  try {
    return Taro.getStorageSync(STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function getMode(): ThemeMode {
  currentMode ??= readStoredMode()
  return currentMode
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function setThemeMode(mode: ThemeMode): void {
  if (getMode() === mode) return
  currentMode = mode
  try { Taro.setStorageSync(STORAGE_KEY, mode) } catch { /* Keep the current session usable. */ }
  listeners.forEach((listener) => listener())
}

export function useThemeMode() {
  const mode = useSyncExternalStore(subscribe, getMode, () => 'light' as ThemeMode)

  useEffect(() => {
    try {
      void Promise.resolve(Taro.setNavigationBarColor({
        frontColor: mode === 'dark' ? '#ffffff' : '#000000',
        backgroundColor: mode === 'dark' ? tokens.colorNight.bg : tokens.color.surface,
      })).catch(() => { /* H5 may not expose the native bar. */ })
    } catch { /* H5 may not expose the native bar. */ }
  }, [mode])
  return {
    mode,
    toggleTheme: () => setThemeMode(mode === 'dark' ? 'light' : 'dark'),
  }
}
