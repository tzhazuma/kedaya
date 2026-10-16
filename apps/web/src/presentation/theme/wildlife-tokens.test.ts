/**
 * wildlife 令牌纪律测试（契约 §6.2 / §11.5）—— **禁止手写色值** 的机器守卫。
 *
 * 三件事：
 * 1. wildlife 切片的全部源文件里不得出现 hex / rgb / hsl / oklch 色值字面量；
 *    颜色只能来自 `@kedaya/design-tokens`（Tailwind 工具类 / `currentColor`）。
 * 2. `public/wildlife/basemap.svg` 是**静态资源**（无法读 CSS 变量），
 *    因此它的每一个 hex 都必须是 `tokens.css` 里**真实存在的令牌值** ——
 *    这条断言把"占位底图的颜色也是从令牌派生的"变成机器可检查的事实。
 * 3. 暗色令牌确实可达（`[data-theme="dark"]` 覆盖同名 `--kdy-color-*`），
 *    因此 wildlife 的组件不需要、也不允许自己写一套暗色色值。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = fileURLToPath(new URL('.', import.meta.url));
/** apps/web/src */
const SRC = join(HERE, '..', '..');
/** apps/web */
const APP = join(SRC, '..');

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/;

/** wildlife 切片的全部产出（不含测试文件） */
const TARGETS: readonly string[] = [
  'domain/models/wildlife',
  'application/wildlife',
  'data/schemas/wildlife.ts',
  'data/mock/fixtures/wildlife.ts',
  'data/mock/wildlife.repository.ts',
  'data/repositories/wildlife.http.ts',
  'presentation/components/wildlife',
  'presentation/components/admin/WildlifeModerationQueue.tsx',
  'app/(portal)/wildlife',
  'app/(admin)/admin/wildlife',
];

function collectFiles(target: string): string[] {
  const absolute = join(SRC, target);
  const stats = statSync(absolute);
  if (stats.isFile()) return [absolute];
  return readdirSync(absolute).flatMap((entry) => {
    const child = join(absolute, entry);
    if (statSync(child).isDirectory()) return collectFiles(relative(SRC, child));
    return child.endsWith('.test.ts') || child.endsWith('.test.tsx') ? [] : [child];
  });
}

const FILES = TARGETS.flatMap(collectFiles);

describe('令牌纪律：wildlife 源码零手写色值', () => {
  it('扫描范围覆盖 wildlife 的主要源文件（防止"扫了个空目录"）', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(25);
    expect(FILES.some((file) => file.endsWith('WildlifeBasemapMap.tsx'))).toBe(true);
    expect(FILES.some((file) => file.endsWith('basemap.ts'))).toBe(true);
    expect(FILES.some((file) => file.endsWith('wildlife.repository.ts'))).toBe(true);
    expect(FILES.some((file) => file.endsWith('wildlife.http.ts'))).toBe(true);
    expect(FILES.some((file) => file.endsWith('page.tsx'))).toBe(true);
  });

  it('没有任何 hex / rgb / hsl / oklch 字面量', () => {
    const offenders = FILES.map((file) => ({
      file: relative(SRC, file),
      source: readFileSync(file, 'utf8'),
    })).flatMap(({ file, source }) =>
      source
        .split('\n')
        .map((line, index) => ({ file, line: index + 1, text: line }))
        .filter(({ text }) => COLOR_LITERAL.test(text)),
    );

    expect(offenders).toEqual([]);
  });

  it('地图叠加层用 currentColor + 令牌工具类表达颜色', () => {
    const map = readFileSync(join(SRC, 'presentation/components/wildlife/WildlifeBasemapMap.tsx'), 'utf8');
    expect(map).toMatch(/currentColor/);
    expect(map).toMatch(/\btext-danger\b/);
    expect(map).toMatch(/\btext-warning\b/);
    expect(map).toMatch(/\btext-info\b/);
    expect(map).toMatch(/\btext-brand-strong\b/);
    expect(map).toMatch(/\bborder-border\b/);
    expect(map).toMatch(/\bbg-surface\b/);
    // 不允许内联 style 写颜色（`style` 只用于 aspect-ratio / 尺寸对齐）
    expect(map).not.toMatch(/style=\{\{[^}]*color/i);
  });

  it('列表/表单组件同样只用令牌工具类', () => {
    const card = readFileSync(join(SRC, 'presentation/components/wildlife/SightingCard.tsx'), 'utf8');
    expect(card).toMatch(/\btext-muted\b/);
    expect(card).toMatch(/\btext-danger\b/);
    expect(card).toMatch(/\bborder-danger\/40\b/);
    expect(card).not.toMatch(/style=\{\{/);
  });
});

describe('占位底图 SVG 的颜色全部来自 design-tokens', () => {
  const tokensCss = readFileSync(
    join(APP, '..', '..', 'packages', 'design-tokens', 'dist', 'tokens.css'),
    'utf8',
  );
  const svg = readFileSync(join(APP, 'public', 'wildlife', 'basemap.svg'), 'utf8');

  const tokenHex = new Set(
    (tokensCss.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((value) => value.toLowerCase()),
  );

  it('tokens.css 里确实有颜色令牌可对照', () => {
    expect(tokenHex.size).toBeGreaterThanOrEqual(16);
    expect(tokenHex.has('#ffc53d')).toBe(true);
  });

  it('SVG 里出现的每一个 hex 都是令牌里存在的值（没有发明新颜色）', () => {
    const svgHex = (svg.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((value) => value.toLowerCase());
    expect(svgHex.length).toBeGreaterThan(5);
    const invented = [...new Set(svgHex)].filter((value) => !tokenHex.has(value));
    expect(invented).toEqual([]);
  });

  it('SVG 使用的主要语义色与令牌一一对应', () => {
    // 绿地 = success，水面 = info，警示框 = warning，控制点 = danger
    expect(svg).toContain('#22A06B');
    expect(svg).toContain('#3B82F6');
    expect(svg).toContain('#E8833A');
    expect(svg).toContain('#D64545');
    expect(tokenHex.has('#22a06b')).toBe(true);
    expect(tokenHex.has('#3b82f6')).toBe(true);
    expect(tokenHex.has('#e8833a')).toBe(true);
    expect(tokenHex.has('#d64545')).toBe(true);
  });

  it('SVG 自身也标注了"占位底图"（图上可见，不只是代码注释）', () => {
    expect(svg).toContain('占位底图');
    expect(svg).toContain('待学校授权后替换');
  });
});

describe('暗色令牌可达（契约 §11.5）', () => {
  const tokensCss = readFileSync(
    join(APP, '..', '..', 'packages', 'design-tokens', 'dist', 'tokens.css'),
    'utf8',
  );

  it('提供 [data-theme="dark"] 覆盖同名 --kdy-color-* 变量（消费方代码零改动）', () => {
    expect(tokensCss).toContain('[data-theme="dark"]');
    const darkBlock = tokensCss.slice(tokensCss.indexOf('[data-theme="dark"]'));
    expect(darkBlock).toContain('--kdy-color-brand:');
    expect(darkBlock).toContain('--kdy-color-surface:');
    expect(darkBlock).toContain('--kdy-color-danger:');
  });

  it('wildlife 组件不需要、也没有自己写一套暗色色值', () => {
    const offenders = FILES.map((file) => ({
      file: relative(SRC, file),
      source: readFileSync(file, 'utf8'),
    })).filter(({ source }) => /dark:[^"'`\s]*(#|rgb|hsl|oklch)/i.test(source));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });
});
