/* 由 packages/design-tokens/scripts/generate.mjs 生成 —— 请勿手改。
 * 真相来源: packages/design-tokens/tokens.json */

export const tokens = {
  "color": {
    "brand": "#FFC53D",
    "brandStrong": "#F08F2A",
    "brandSoft": "#FFF3B8",
    "ink": "#1B2436",
    "inkSoft": "#33405A",
    "bg": "#F7F8FA",
    "surface": "#FFFFFF",
    "surfaceAlt": "#F1F3F7",
    "text": "#1F2733",
    "textMuted": "#6B7A90",
    "textInverse": "#FFFFFF",
    "border": "#E3E8EF",
    "success": "#22A06B",
    "warning": "#E8833A",
    "danger": "#D64545",
    "info": "#3B82F6"
  },
  "colorDark": {
    "brand": "#FFD666",
    "brandStrong": "#FFC53D",
    "brandSoft": "#3A2F12",
    "ink": "#0B1220",
    "inkSoft": "#1B2436",
    "bg": "#0B1220",
    "surface": "#151C28",
    "surfaceAlt": "#1E2734",
    "text": "#E8EEF7",
    "textMuted": "#93A3B8",
    "textInverse": "#0B1220",
    "border": "#2A3444",
    "success": "#3DD68C",
    "warning": "#F0A05A",
    "danger": "#F07171",
    "info": "#60A5FA"
  },
  "space": {
    "0": 0,
    "1": 4,
    "2": 8,
    "3": 12,
    "4": 16,
    "5": 20,
    "6": 24,
    "8": 32,
    "10": 40,
    "12": 48,
    "16": 64
  },
  "radius": {
    "sm": 4,
    "md": 8,
    "lg": 12,
    "xl": 16,
    "pill": 999
  },
  "fontSize": {
    "xs": 12,
    "sm": 14,
    "md": 16,
    "lg": 18,
    "xl": 20,
    "xxl": 24,
    "display": 32
  },
  "lineHeight": {
    "tight": 1.25,
    "normal": 1.5,
    "loose": 1.75
  },
  "fontWeight": {
    "regular": 400,
    "medium": 500,
    "semibold": 600,
    "bold": 700
  },
  "shadow": {
    "sm": "0 1px 2px rgba(27,36,54,0.06)",
    "md": "0 4px 12px rgba(27,36,54,0.08)",
    "lg": "0 12px 32px rgba(27,36,54,0.12)"
  },
  "fontFamily": {
    "sans": "PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif",
    "mono": "SFMono-Regular, Menlo, Consolas, monospace"
  },
  "zIndex": {
    "base": 0,
    "dropdown": 1000,
    "sticky": 1100,
    "overlay": 1200,
    "modal": 1300,
    "toast": 1400
  }
} as const;

export type Tokens = typeof tokens;
export type ColorToken = keyof Tokens['color'];
export type SpaceToken = keyof Tokens['space'];
export type RadiusToken = keyof Tokens['radius'];
export type FontSizeToken = keyof Tokens['fontSize'];

/** 主题名（CSS: [data-theme="<name>"]） */
export type ThemeName = 'light' | 'dark';

/** CSS 变量名，例: cssVar('color', 'brandStrong') -> 'var(--kdy-color-brand-strong)' */
export function cssVar(group: keyof Tokens, key: string): string {
  const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return `var(--kdy-${kebab(String(group))}-${kebab(key)})`;
}

/** 取像素值，例: px('space', '4') -> '16px' */
export function px(group: keyof Tokens, key: string): string {
  const value = (tokens[group] as Record<string, unknown>)[key];
  return typeof value === 'number' ? `${value}px` : String(value);
}

/**
 * 暗色主题的原始色值（不用于直接内联样式）。
 *
 * 在 Web 上**不要**用这个函数手动换色 —— 直接依赖 `[data-theme="dark"]`
 * 对 CSS 变量的覆盖即可，消费方代码零改动。
 * 它只用于需要 JS 拿到具体色值的场景（如 Canvas 绘制、图表库配置）。
 */
export function darkColor(key: ColorToken): string {
  return (tokens.colorDark as Record<string, string>)[key] ?? tokens.color[key];
}
